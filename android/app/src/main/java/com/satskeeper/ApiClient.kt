package com.satskeeper

import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

/** Minimal HTTP client for the Vercel API. Callbacks always run on the main thread. */
object ApiClient {

    class ApiException(val status: Int, val code: String, message: String) : Exception(message)

    private val io = Executors.newFixedThreadPool(2)
    private val main = Handler(Looper.getMainLooper())

    private const val TIMEOUT_MS = 15_000

    private fun request(method: String, path: String, body: JSONObject?): JSONObject {
        val base = BuildConfig.API_BASE_URL.trim().trimEnd('/')
        val key = BuildConfig.APP_KEY.trim()
        if (base.isEmpty() || key.isEmpty()) {
            throw ApiException(0, "not_configured", "API_BASE_URL / APP_KEY missing in gradle.properties")
        }

        val conn = URL(base + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = TIMEOUT_MS
            conn.readTimeout = TIMEOUT_MS
            conn.setRequestProperty("x-app-key", key)
            conn.setRequestProperty("Accept", "application/json")

            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }

            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val json = try {
                if (text.isBlank()) JSONObject() else JSONObject(text)
            } catch (e: Exception) {
                JSONObject()
            }

            if (status !in 200..299) {
                val code = json.optString("error", "http_$status")
                throw ApiException(status, code, json.optString("detail", code))
            }
            return json
        } finally {
            conn.disconnect()
        }
    }

    private fun <T> async(work: () -> T, callback: (Result<T>) -> Unit) {
        io.execute {
            val result = runCatching(work)
            main.post { callback(result) }
        }
    }

    private fun q(value: String): String = URLEncoder.encode(value, "UTF-8")

    fun consent(
        deviceId: String,
        optedIn: Boolean,
        callback: (Result<JSONObject>) -> Unit
    ) = async({
        val body = JSONObject()
            .put("device_id", deviceId)
            .put("opted_in", optedIn)
            .put("consent_version", LocalState.CONSENT_VERSION)
        request("POST", "/api/consent", body)
    }, callback)

    fun heartbeat(deviceId: String, callback: (Result<JSONObject>) -> Unit) = async({
        request("POST", "/api/heartbeat", JSONObject().put("device_id", deviceId))
    }, callback)

    fun ledger(deviceId: String, callback: (Result<JSONObject>) -> Unit) = async({
        request("GET", "/api/ledger?device_id=${q(deviceId)}", null)
    }, callback)

    fun leaderboard(deviceId: String, callback: (Result<JSONObject>) -> Unit) = async({
        request("GET", "/api/leaderboard?device_id=${q(deviceId)}", null)
    }, callback)

    fun redeem(deviceId: String, callback: (Result<JSONObject>) -> Unit) = async({
        request("POST", "/api/redeem", JSONObject().put("device_id", deviceId))
    }, callback)
}
