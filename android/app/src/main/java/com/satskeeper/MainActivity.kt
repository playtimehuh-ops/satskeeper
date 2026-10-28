package com.satskeeper

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    // >>> THE ONLY LINE TO CHANGE TO SWAP THE BANDWIDTH SDK VENDOR <<<
    private fun createProvider(): BandwidthProvider = ProxiesSxProvider(applicationContext)

    private lateinit var provider: BandwidthProvider

    private lateinit var tvPoints: TextView
    private lateinit var tvValue: TextView
    private lateinit var tvStreak: TextView
    private lateinit var tvMultiplier: TextView
    private lateinit var tvLeaderboard: TextView
    private lateinit var tvRedeemHint: TextView
    private lateinit var tvError: TextView
    private lateinit var tvSharingStatus: TextView
    private lateinit var btnRedeem: Button
    private lateinit var switchSharing: SwitchCompat

    private val handler = Handler(Looper.getMainLooper())
    private var updatingSwitch = false
    private var resumed = false

    private val heartbeatTask = object : Runnable {
        override fun run() {
            if (!resumed || !provider.isOptedIn()) return
            ApiClient.heartbeat(provider.getDeviceId()) { /* best effort */ }
            handler.postDelayed(this, HEARTBEAT_INTERVAL_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        provider = createProvider()
        provider.init()

        setContentView(R.layout.activity_main)
        tvPoints = findViewById(R.id.tvPoints)
        tvValue = findViewById(R.id.tvValue)
        tvStreak = findViewById(R.id.tvStreak)
        tvMultiplier = findViewById(R.id.tvMultiplier)
        tvLeaderboard = findViewById(R.id.tvLeaderboard)
        tvRedeemHint = findViewById(R.id.tvRedeemHint)
        tvError = findViewById(R.id.tvError)
        tvSharingStatus = findViewById(R.id.tvSharingStatus)
        btnRedeem = findViewById(R.id.btnRedeem)
        switchSharing = findViewById(R.id.switchSharing)

        switchSharing.setOnCheckedChangeListener { _, checked ->
            if (updatingSwitch) return@setOnCheckedChangeListener
            if (checked) onEnableRequested() else onOptOut()
        }
        btnRedeem.setOnClickListener { confirmRedeem() }
    }

    override fun onResume() {
        super.onResume()
        resumed = true

        // First run: ask for explicit consent before anything else happens.
        if (!LocalState.hasDecided(this)) {
            startActivity(Intent(this, ConsentActivity::class.java))
            return
        }

        syncPendingOptOut()
        applySharingState()
        refresh()
    }

    override fun onPause() {
        super.onPause()
        resumed = false
        handler.removeCallbacks(heartbeatTask)
    }

    // ---- sharing on / off

    private fun applySharingState() {
        val optedIn = provider.isOptedIn()
        if (optedIn) provider.start() else provider.stop()

        setSwitch(optedIn)
        tvSharingStatus.text = if (optedIn) {
            val at = LocalState.consentAtMillis(this)
            val shown = if (at > 0) {
                DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(at))
            } else {
                "-"
            }
            getString(R.string.main_sharing_on, shown)
        } else {
            getString(R.string.main_sharing_off)
        }

        handler.removeCallbacks(heartbeatTask)
        if (optedIn) handler.post(heartbeatTask)
    }

    private fun setSwitch(on: Boolean) {
        updatingSwitch = true
        switchSharing.isChecked = on
        updatingSwitch = false
    }

    /** Turning sharing back on always goes through the explicit consent screen again. */
    private fun onEnableRequested() {
        setSwitch(false)
        startActivity(Intent(this, ConsentActivity::class.java))
    }

    /** Opt-out: stop the SDK first, immediately, then record it locally and on the server. */
    private fun onOptOut() {
        provider.stop()
        handler.removeCallbacks(heartbeatTask)
        LocalState.setOptedOut(this)
        applySharingState()
        syncPendingOptOut()
    }

    private fun syncPendingOptOut() {
        if (!LocalState.optOutSyncPending(this) || LocalState.isOptedIn(this)) return
        ApiClient.consent(provider.getDeviceId(), false) { result ->
            // Success, or the device was never registered on the server: either way nothing is left to sync.
            val notRegistered = result.exceptionOrNull() is ApiClient.ApiException &&
                (result.exceptionOrNull() as ApiClient.ApiException).status == 404
            if (result.isSuccess || notRegistered) LocalState.markOptOutSynced(this)
        }
    }

    // ---- data

    private fun refresh() {
        val deviceId = provider.getDeviceId()

        ApiClient.ledger(deviceId) { result ->
            result.onSuccess { showLedger(it) }.onFailure { err ->
                val notRegistered = err is ApiClient.ApiException && err.status == 404
                if (notRegistered) showEmptyLedger() else showError(err.message)
            }
        }

        ApiClient.leaderboard(deviceId) { result ->
            result.onSuccess { showLeaderboard(it) }.onFailure { err ->
                if (!(err is ApiClient.ApiException && err.status == 404)) showError(err.message)
            }
        }
    }

    private fun showLedger(json: JSONObject) {
        tvError.visibility = View.GONE

        val points = json.optDouble("points", 0.0)
        val valueCents = json.optLong("value_cents", 0L)
        val threshold = json.optDouble("threshold", 0.0)
        val canRedeem = json.optBoolean("can_redeem", false)
        val pending = json.optBoolean("pending_redemption", false)

        tvPoints.text = formatNumber(points)
        tvValue.text = getString(R.string.main_value_format, String.format(Locale.US, "%.2f", valueCents / 100.0))
        tvStreak.text = getString(R.string.main_streak_format, json.optInt("streak", 0))
        tvMultiplier.text = getString(
            R.string.main_multiplier_format,
            String.format(Locale.US, "%.2f", json.optDouble("multiplier", 1.0))
        )

        btnRedeem.isEnabled = canRedeem
        tvRedeemHint.text = when {
            pending -> getString(R.string.main_redeem_pending)
            !canRedeem -> getString(R.string.main_redeem_progress, formatNumber(threshold))
            else -> ""
        }
    }

    private fun showEmptyLedger() {
        tvError.visibility = View.GONE
        tvPoints.text = "0"
        tvValue.text = getString(R.string.main_value_format, "0.00")
        tvStreak.text = getString(R.string.main_streak_format, 0)
        tvMultiplier.text = getString(R.string.main_multiplier_format, "1.00")
        btnRedeem.isEnabled = false
        tvRedeemHint.text = ""
    }

    private fun showLeaderboard(json: JSONObject) {
        val rows = json.optJSONArray("leaderboard")
        if (rows == null || rows.length() == 0) {
            tvLeaderboard.setText(R.string.main_leaderboard_empty)
            return
        }
        val lines = StringBuilder()
        for (i in 0 until rows.length()) {
            val row = rows.getJSONObject(i)
            if (i > 0) lines.append('\n')
            lines.append(
                getString(
                    R.string.main_leaderboard_row,
                    row.optInt("rank", i + 1),
                    row.optString("handle"),
                    formatNumber(row.optDouble("points", 0.0)),
                    if (row.optBoolean("you", false)) getString(R.string.main_you) else ""
                )
            )
        }
        tvLeaderboard.text = lines.toString()
    }

    private fun showError(message: String?) {
        tvError.text = getString(R.string.main_error_format, message ?: "unknown")
        tvError.visibility = View.VISIBLE
    }

    // ---- redeem

    private fun confirmRedeem() {
        AlertDialog.Builder(this)
            .setTitle(R.string.main_redeem_confirm_title)
            .setMessage(R.string.main_redeem_confirm_body)
            .setPositiveButton(R.string.main_redeem_ok) { _, _ -> redeem() }
            .setNegativeButton(R.string.main_cancel, null)
            .show()
    }

    private fun redeem() {
        btnRedeem.isEnabled = false
        ApiClient.redeem(provider.getDeviceId()) { result ->
            result.onSuccess {
                Toast.makeText(this, R.string.main_redeem_requested, Toast.LENGTH_LONG).show()
            }.onFailure { err ->
                showError(err.message)
            }
            refresh()
        }
    }

    private fun formatNumber(value: Double): String =
        if (value == Math.floor(value)) value.toLong().toString() else String.format(Locale.US, "%.2f", value)

    private companion object {
        const val HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000L
    }
}
