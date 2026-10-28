package com.satskeeper

import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

/**
 * Explicit opt-in. Nothing is shared from here: this screen only records consent
 * (server first, so the timestamp is stored), then MainActivity starts the SDK.
 */
class ConsentActivity : AppCompatActivity() {

    private lateinit var check: CheckBox
    private lateinit var accept: Button
    private lateinit var decline: Button
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_consent)

        check = findViewById(R.id.consentCheck)
        accept = findViewById(R.id.consentAccept)
        decline = findViewById(R.id.consentDecline)
        status = findViewById(R.id.consentStatus)

        // Consent needs a deliberate tick, never a pre-checked box.
        check.setOnCheckedChangeListener { _, checked -> accept.isEnabled = checked }
        accept.setOnClickListener { saveConsent() }
        decline.setOnClickListener { leave() }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = leave()
        })
    }

    private fun saveConsent() {
        setBusy(true)
        status.visibility = View.VISIBLE
        status.setTextColor(0xFF808080.toInt())
        status.setText(R.string.consent_saving)

        ApiClient.consent(LocalState.deviceId(this), true) { result ->
            if (isFinishing || isDestroyed) return@consent
            result.onSuccess {
                LocalState.setOptedIn(this)
                finish()
            }.onFailure {
                setBusy(false)
                status.setText(R.string.consent_error)
                status.setTextColor(0xFFC0262D.toInt())
            }
        }
    }

    private fun setBusy(busy: Boolean) {
        check.isEnabled = !busy
        decline.isEnabled = !busy
        accept.isEnabled = !busy && check.isChecked
    }

    /** Declining before ever opting in closes the app; after an opt-out it just returns to the dashboard. */
    private fun leave() {
        if (LocalState.hasDecided(this)) finish() else finishAffinity()
    }
}
