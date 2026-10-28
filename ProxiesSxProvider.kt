package com.satskeeper

import android.content.Context
import android.util.Log

/**
 * Adapter for the Proxies.sx bandwidth SDK. All vendor calls are stubbed.
 * Replace each `// TODO: real SDK` with the vendor's real call; nothing else in the app needs to change.
 */
class ProxiesSxProvider(context: Context) : BandwidthProvider {

    private val appContext = context.applicationContext
    private var initialized = false
    private var running = false

    override fun init() {
        if (initialized) return
        // TODO: real SDK - initialise with your publisher / partner credentials. Do not start sharing here.
        Log.d(TAG, "init (stub)")
        initialized = true
    }

    override fun start() {
        if (!isOptedIn()) {
            // Consent is a hard gate: never start without it.
            Log.d(TAG, "start ignored: user is not opted in")
            return
        }
        if (!initialized) init()
        if (running) return
        // TODO: real SDK - start the vendor service / begin sharing bandwidth.
        Log.d(TAG, "start (stub)")
        running = true
    }

    override fun stop() {
        // TODO: real SDK - stop the vendor service immediately and release resources.
        Log.d(TAG, "stop (stub)")
        running = false
    }

    override fun isOptedIn(): Boolean {
        // TODO: real SDK - if the vendor SDK keeps its own consent flag, set/clear it to match LocalState.
        return LocalState.isOptedIn(appContext)
    }

    override fun getDeviceId(): String = LocalState.deviceId(appContext)

    private companion object {
        const val TAG = "ProxiesSxProvider"
    }
}
