package com.satskeeper

import android.content.Context
import java.util.UUID

/**
 * The only way the app talks to a bandwidth-sharing SDK.
 * To change vendors, implement this interface and change the single factory line in MainActivity.
 */
interface BandwidthProvider {
    /** One-time SDK setup. Must not start sharing. */
    fun init()

    /** Start sharing. Must do nothing unless [isOptedIn] is true. */
    fun start()

    /** Stop sharing immediately. Safe to call at any time. */
    fun stop()

    /** True only after the user explicitly consented (and has not revoked). */
    fun isOptedIn(): Boolean

    /** Stable anonymous id for this install. */
    fun getDeviceId(): String
}

/** Small SharedPreferences store shared by the activities and providers. */
object LocalState {
    const val CONSENT_VERSION = "2026-10-v1"

    private const val FILE = "satskeeper"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_OPTED_IN = "opted_in"
    private const val KEY_DECIDED = "decided"
    private const val KEY_CONSENT_AT = "consent_at_ms"
    private const val KEY_OPT_OUT_PENDING = "opt_out_sync_pending"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** UUID generated once and kept. */
    @Synchronized
    fun deviceId(context: Context): String {
        val p = prefs(context)
        val existing = p.getString(KEY_DEVICE_ID, null)
        if (!existing.isNullOrEmpty()) return existing
        val created = UUID.randomUUID().toString()
        p.edit().putString(KEY_DEVICE_ID, created).apply()
        return created
    }

    fun isOptedIn(context: Context): Boolean = prefs(context).getBoolean(KEY_OPTED_IN, false)

    /** True once the user has made a choice (accepted, or later opted out). */
    fun hasDecided(context: Context): Boolean = prefs(context).getBoolean(KEY_DECIDED, false)

    fun consentAtMillis(context: Context): Long = prefs(context).getLong(KEY_CONSENT_AT, 0L)

    fun setOptedIn(context: Context) {
        prefs(context).edit()
            .putBoolean(KEY_OPTED_IN, true)
            .putBoolean(KEY_DECIDED, true)
            .putLong(KEY_CONSENT_AT, System.currentTimeMillis())
            .putBoolean(KEY_OPT_OUT_PENDING, false)
            .apply()
    }

    /** Local opt-out is applied first (commit) so the SDK can never restart by mistake; the server is told afterwards. */
    fun setOptedOut(context: Context) {
        prefs(context).edit()
            .putBoolean(KEY_OPTED_IN, false)
            .putBoolean(KEY_DECIDED, true)
            .putLong(KEY_CONSENT_AT, 0L)
            .putBoolean(KEY_OPT_OUT_PENDING, true)
            .commit()
    }

    fun optOutSyncPending(context: Context): Boolean = prefs(context).getBoolean(KEY_OPT_OUT_PENDING, false)

    fun markOptOutSynced(context: Context) {
        prefs(context).edit().putBoolean(KEY_OPT_OUT_PENDING, false).apply()
    }
}
