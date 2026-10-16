package com.lios.nativeclient

// Gateway envelope and pinned-leaf trust adapted from OpenClaw at c074824a;
// LiOS protocol, scopes and pairing are intentionally not donor-wire-compatible.
import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

class GatewayFailure(val code: String, message: String) : Exception(message)

data class HomeEndpoint(val homeId: String, val name: String, val url: String, val fingerprint: String) {
    init {
        UUID.fromString(homeId)
        require(name.isNotBlank() && name.length <= 80)
        require(fingerprint.matches(Regex("[a-f0-9]{64}")))
        val uri = URI(url)
        require(url.length <= 512 && uri.scheme == "wss" && !uri.host.isNullOrBlank() && uri.path == "/gateway/device"
            && uri.userInfo == null && uri.query == null && uri.fragment == null) { "Only TLS Home device endpoints are allowed" }
    }
    fun json(): JSONObject = JSONObject().put("homeId", homeId).put("name", name).put("url", url).put("fingerprint", fingerprint)
    companion object {
        fun fromJson(value: JSONObject) = HomeEndpoint(value.getString("homeId"), value.getString("name"), value.getString("url"), value.getString("fingerprint"))
        fun invitation(text: String, endpointIndex: Int): Pair<HomeEndpoint, String> {
            require(text.startsWith("lios-pair:v1:") && text.length <= 16384)
            val json = JSONObject(String(unb64(text.substringAfter("lios-pair:v1:")), Charsets.UTF_8))
            require(json.getInt("version") == 1 && Instant.parse(json.getString("expiresAt")).isAfter(Instant.now())) { "Pairing invitation expired" }
            val urls = json.getJSONArray("urls")
            require(urls.length() in 1..32 && endpointIndex in 0 until urls.length())
            val home = HomeEndpoint(json.getString("homeId"), json.getString("name"), urls.getString(endpointIndex), json.getString("fingerprint"))
            val token = json.getString("pairingToken")
            require(token.matches(Regex("[A-Za-z0-9_-]{43}")))
            return home to token
        }
    }
}

class HomeGateway(private val identity: DeviceIdentity, private val wearable: Boolean) {
    private val handler = Handler(Looper.getMainLooper())
    private var socket: WebSocket? = null
    private var client: OkHttpClient? = null
    private var generation = 0L
    private var sequence: Long? = null
    private val pending = mutableMapOf<String, (Result<JSONObject>) -> Unit>()
    private var token: String? = null
    var home: HomeEndpoint? = null; private set
    var connected = false; private set
    var methods: Set<String> = emptySet(); private set
    var onStatus: (String) -> Unit = {}
    var onReady: () -> Unit = {}
    var onPairApproved: (HomeEndpoint) -> Unit = {}
    var onEvent: (String, JSONObject) -> Unit = { _, _ -> }
    val epoch: Long get() = generation

    fun close() {
        generation++
        connected = false
        token = null
        methods = emptySet()
        socket?.close(1000, "User disconnected")
        socket = null
        client?.dispatcher?.executorService?.shutdown()
        client?.connectionPool?.evictAll()
        client = null
        failPending(GatewayFailure("UNAVAILABLE", "Disconnected; delivery may be unconfirmed"))
    }
    private fun failPending(error: Throwable) {
        val callbacks = pending.values.toList()
        pending.clear()
        callbacks.forEach { it(Result.failure(error)) }
    }
    fun connect(endpoint: HomeEndpoint, pairingToken: String? = null) {
        close()
        home = endpoint
        token = pairingToken
        sequence = null
        val current = generation
        val pin = endpoint.fingerprint
        val manager = object : X509TrustManager {
            override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) { throw CertificateException("Client certificates unsupported") }
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                if (chain.isEmpty() || !MessageDigest.isEqual(sha(chain[0].encoded), pin.chunked(2).map { it.toInt(16).toByte() }.toByteArray()))
                    throw CertificateException("Home certificate pin mismatch; obtain a new owner invitation")
                chain[0].checkValidity()
            }
        }
        val tls = SSLContext.getInstance("TLS").apply { init(null, arrayOf(manager), null) }
        client = OkHttpClient.Builder().sslSocketFactory(tls.socketFactory, manager)
            .hostnameVerifier { _, session ->
                runCatching { hex(sha(session.peerCertificates[0].encoded)) == pin }.getOrDefault(false)
            }.connectTimeout(10, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS)
            .pingInterval(15, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
        onStatus("Connecting to pinned ${endpoint.name}")
        socket = client!!.newWebSocket(Request.Builder().url(endpoint.url).build(), object : WebSocketListener() {
            private fun dispatch(block: () -> Unit) { handler.post { if (generation == current) block() } }
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text.toByteArray(Charsets.UTF_8).size > 1_048_576) { webSocket.close(1009, "Frame too large"); return }
                dispatch { runCatching { receive(JSONObject(text)) }.onFailure { error -> close(); onStatus("Protocol failure: ${error.message}") } }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = dispatch {
                connected = false; token = null; socket = null; generation++
                failPending(GatewayFailure("UNAVAILABLE", "Connection lost; request delivery may be unconfirmed"))
                onStatus("Offline: ${t.message}. Reconnect explicitly; drafts never auto-send.")
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = dispatch {
                connected = false; token = null; socket = null; generation++
                failPending(GatewayFailure("UNAVAILABLE", "Connection closed; request delivery may be unconfirmed"))
                onStatus("Disconnected ($code): $reason")
            }
        })
    }
    private fun receive(frame: JSONObject) {
        when (frame.getString("type")) {
            "res" -> {
                val callback = pending.remove(frame.getString("id")) ?: return
                if (frame.getBoolean("ok")) callback(Result.success(frame.optJSONObject("payload") ?: JSONObject()))
                else {
                    val error = frame.getJSONObject("error")
                    callback(Result.failure(GatewayFailure(error.getString("code"), error.getString("message"))))
                }
            }
            "event" -> {
                val name = frame.getString("event")
                val payload = frame.optJSONObject("payload") ?: JSONObject()
                if (frame.has("seq")) {
                    val next = frame.getLong("seq")
                    sequence?.let { if (next != it + 1) onEvent("resync", JSONObject()) }
                    sequence = next
                }
                if (name == "connect.challenge") handshake(payload.getString("nonce"))
                else if (name == "pairing.resolved") {
                    if (payload.getString("outcome") == "approved") {
                        val endpoint = checkNotNull(home)
                        token = null
                        onPairApproved(endpoint)
                        connect(endpoint)
                    } else { close(); onStatus("Pairing ${payload.getString("outcome")}; owner permission required") }
                } else onEvent(name, payload)
            }
        }
    }
    private fun handshake(nonce: String) {
        require(nonce.length in 16..128)
        val signedAt = System.currentTimeMillis()
        val clientId = if (wearable) "lios-wear" else "lios-android"
        val scope = listOf("read", "write")
        val proof = listOf("lios-device-v1", identity.deviceId, clientId, "ui", scope.sorted().joinToString(","), signedAt.toString(), nonce, token ?: "").joinToString("|")
        val params = JSONObject().put("minProtocol", 1).put("maxProtocol", 1)
            .put("client", JSONObject().put("id", clientId).put("version", "1.0.0").put("platform", if (wearable) "wearos" else "android").put("mode", "ui"))
            .put("scopes", JSONArray(scope)).put("device", JSONObject().put("id", identity.deviceId).put("publicKey", identity.publicKey)
                .put("signature", identity.sign(proof)).put("signedAt", signedAt))
        token?.let { params.put("pairing", JSONObject().put("token", it).put("deviceName", if (wearable) "LiOS Wear" else "LiOS Android")) }
        send("connect", params) { result -> result.onSuccess { hello ->
            if (hello.getString("type") == "pairing-pending") { onStatus("Awaiting Home owner approval. Device ${identity.deviceId}"); return@onSuccess }
            require(hello.getInt("protocol") == 1 && hello.getJSONObject("auth").getString("deviceId") == identity.deviceId)
            methods = hello.getJSONObject("features").getJSONArray("methods").let { values -> (0 until values.length()).map { values.getString(it) }.toSet() }
            connected = true
            onStatus("Connected: ${home?.name}; Home is the sole authority")
            onReady()
        }.onFailure { onStatus("Pairing/authentication refused: ${it.message}"); close() } }
    }
    fun request(method: String, params: JSONObject = JSONObject(), callback: (Result<JSONObject>) -> Unit) {
        if (!connected) { callback(Result.failure(GatewayFailure("UNAVAILABLE", "Home offline"))); return }
        if (!methods.contains(method)) { callback(Result.failure(GatewayFailure("UNAVAILABLE", "Home does not advertise $method"))); return }
        send(method, params, callback)
    }
    private fun send(method: String, params: JSONObject, callback: (Result<JSONObject>) -> Unit) {
        check(Looper.myLooper() == Looper.getMainLooper())
        if (pending.size >= 32) { callback(Result.failure(GatewayFailure("RATE_LIMITED", "Too many pending requests"))); return }
        val id = UUID.randomUUID().toString()
        val text = JSONObject().put("type", "req").put("id", id).put("method", method).put("params", params).toString()
        if (text.toByteArray(Charsets.UTF_8).size > 1_048_576) { callback(Result.failure(GatewayFailure("PAYLOAD_TOO_LARGE", "Request too large"))); return }
        pending[id] = callback
        if (socket?.send(text) != true) { pending.remove(id); callback(Result.failure(GatewayFailure("UNAVAILABLE", "Send unavailable"))); return }
        val epoch = generation
        handler.postDelayed({ if (epoch == generation) pending.remove(id)?.invoke(Result.failure(GatewayFailure("UNAVAILABLE", "No acknowledgement; delivery unconfirmed"))) }, 15000)
    }
}
