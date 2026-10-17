package com.lios.nativeclient

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/** Native Android Views, not a browser/WebView or a second Home. */
open class HomeActivity : Activity() {
    open val wearable = false
    private lateinit var store: ProtectedStore
    private lateinit var identity: DeviceIdentity
    private lateinit var gateway: HomeGateway
    private lateinit var outbox: ReviewOutbox
    private lateinit var body: LinearLayout
    private lateinit var status: TextView
    private var projectId: Int? = null
    private var chatId: Int? = null
    private var page = 0
    private val run = RunCursor()
    private var runOwner: Int? = null
    private var currentOwner: Int? = null
    private var artifactsPage = 0
    private val foregroundHandler = Handler(Looper.getMainLooper())
    private var foreground = false
    private var notificationFetch = false
    private var replayingReads = false
    private val notificationPoll = object : Runnable {
        override fun run() {
            if (!foreground) return
            if (::gateway.isInitialized && gateway.connected && projectId != null) fetchNotifications(false)
            foregroundHandler.postDelayed(this, 30_000)
        }
    }
    private var reviewed: JSONObject? = null
    private val notified = linkedSetOf<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE, android.view.WindowManager.LayoutParams.FLAG_SECURE)
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(18, 12, 18, 12) }
        status = TextView(this).apply { text = "LiOS Home — disconnected"; textSize = 16f }
        layout.addView(status)
        body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        layout.addView(ScrollView(this).apply { addView(body) })
        setContentView(layout)
        try {
            store = ProtectedStore(this)
            identity = DeviceIdentity(store)
            gateway = HomeGateway(identity, wearable)
            outbox = ReviewOutbox(store)
            gateway.onStatus = { status.text = it }
            gateway.onPairApproved = { endpoint -> store.text("home", endpoint.json().toString()) }
            gateway.onReady = {
                reviewed = null
                if (projectId == null) projects() else continuity()
            }
            gateway.onEvent = { name, payload ->
                if (name == "resync" || name == "data.invalidate") {
                    status.text = "Home changed; refresh current view before review"
                    reviewed = null
                } else if (name == "conversation.event") {
                    if (run.receive(payload)) {
                        persistNavigation()
                        val event = payload.optJSONObject("event") ?: payload
                        status.text = "Home run: ${event.optString("type", "updated")} ${event.optString("message", "").take(300)}"
                        if (run.requestId == null && projectId != null) continuity()
                    }
                }
            }
            val notifications = getSystemService(NotificationManager::class.java)
            notifications.createNotificationChannel(NotificationChannel("lios.home", "LiOS Home monitor updates", NotificationManager.IMPORTANCE_DEFAULT))
            restoreNavigation()
            connection()
            if (projectId != null) runCatching { continuity() }.onFailure { showError(it) }
        } catch (error: Exception) {
            body.removeAllViews()
            text("Native storage unavailable: ${error.message}. Do not export or restore device keys. Clear app data and obtain a new owner-approved pairing if the Keystore was lost.")
        }
    }
    override fun onStart() {
        super.onStart()
        foreground = true
        foregroundHandler.removeCallbacks(notificationPoll)
        foregroundHandler.post(notificationPoll)
    }
    override fun onStop() {
        foreground = false
        foregroundHandler.removeCallbacks(notificationPoll)
        if (::gateway.isInitialized) gateway.close()
        super.onStop()
    }
    override fun onDestroy() {
        if (::gateway.isInitialized) gateway.close()
        super.onDestroy()
    }
    private fun text(value: String) = TextView(this).apply { text = value; textSize = if (wearable) 15f else 16f; setPadding(0, 8, 0, 8); body.addView(this) }
    private fun button(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label; setOnClickListener { runCatching(action).onFailure { showError(it) } }; body.addView(this)
    }
    private fun input(hintText: String, multiline: Boolean = false): EditText = EditText(this).apply {
        hint = hintText; isSingleLine = !multiline
        if (multiline) minLines = 3
        body.addView(this)
    }
    private fun showError(error: Throwable) { status.text = "Refused/unavailable: ${error.message}" }
    private fun confirm(title: String, details: String, action: () -> Unit) {
        AlertDialog.Builder(this).setTitle(title).setMessage(details).setNegativeButton("Cancel", null)
            .setPositiveButton("Confirm") { _, _ -> runCatching(action).onFailure { showError(it) } }.show()
    }
    private fun rpc(method: String, params: JSONObject = JSONObject(), action: (JSONObject) -> Unit) {
        val epoch = gateway.epoch
        gateway.request(method, params) { result ->
            result.onSuccess { if (epoch == gateway.epoch) runCatching { action(it) }.onFailure { error -> showError(error) } }
                .onFailure { showError(it) }
        }
    }
    private fun clear(title: String) {
        body.removeAllViews()
        text(title)
        button("Home connection") { connection() }
        button("Review outbox (${outbox.list().size})") { drafts() }
    }
    private fun connection() {
        clear(if (wearable) "LiOS Wear • user-owned Home" else "LiOS Android • user-owned Home")
        text("Device ${identity.deviceId}\nEd25519 seed encrypted by Android Keystore AES-GCM; no owner/session/provider token is imported.")
        store.text("home")?.let { raw ->
            val endpoint = HomeEndpoint.fromJson(JSONObject(raw))
            text("Remembered Home: ${endpoint.name}\n${endpoint.url}\nCertificate SHA-256: ${endpoint.fingerprint}")
            button("Reconnect remembered Home") { reviewed = null; gateway.connect(endpoint) }
        }
        val invite = input("Paste owner-provided lios-pair:v1 invitation", true)
        val index = input("Endpoint index (0 = first)")
        index.setText("0")
        button("Review pairing invitation") {
            val pair = HomeEndpoint.invitation(invite.text.toString().trim(), index.text.toString().toInt())
            confirm("Verify Home out-of-band", "Compare this Home and certificate fingerprint with the owner's Home Settings before continuing.\n${pair.first.name}\n${pair.first.homeId}\n${pair.first.url}\n${pair.first.fingerprint}\nThe owner must separately approve this device.") {
                projectId = null; chatId = null; reviewed = null; currentOwner = null; runOwner = null; run.clear()
                invite.text.clear()
                gateway.connect(pair.first, pair.second)
            }
        }
        button("Disconnect — never auto-reconnect") { gateway.close(); status.text = "Offline; stored reviews remain drafts" }
        button("Projects") { projects() }
        button("Stored Project / Chat snapshots") { savedViews() }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            button("Allow local Home notifications") { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1) }
        text("Updates arrive while this native app is connected. Android/Wear background suspension stops delivery; no LiOS cloud/push relay exists. Reopen and refresh to catch up. Notification taps only open the app, never approve.")
    }
    private fun projects() {
        rpc("projects.list") { result ->
            clear("Canonical Home Projects")
            val projects = result.getJSONArray("projects")
            for (i in 0 until projects.length()) {
                val project = projects.getJSONObject(i)
                button(project.optString("name", "Project ${project.getInt("id")}")) {
                    projectId = project.getInt("id"); chatId = null; page = 0; artifactsPage = 0; persistNavigation(); continuity()
                }
            }
            if (projects.length() == 0) text("No Projects on this Home. Create one on the Home first.")
        }
    }
    private fun snapshotKey() = "${projectId}.${chatId ?: 0}.$page.$artifactsPage"
    private fun localState(): ContinuityState = ContinuityState(store, requireNotNull(gateway.home ?: rememberedHome()).homeId)
    private fun persistNavigation() {
        if (gateway.home == null && rememberedHome() == null) return
        localState().navigate(JSONObject().put("deviceId", identity.deviceId).put("projectId", projectId).put("chatId", chatId).put("page", page).put("artifactsPage", artifactsPage).put("userId", currentOwner).put("runId", run.requestId).put("runSeq", run.sequence).put("runOwner", runOwner))
    }
    private fun restoreNavigation() {
        val nav = rememberedHome()?.let { ContinuityState(store, it.homeId).navigation() } ?: return
        require(nav.getString("deviceId") == identity.deviceId) { "Offline navigation belongs to another device" }
        projectId = if (nav.isNull("projectId")) null else nav.getInt("projectId")
        chatId = if (nav.isNull("chatId")) null else nav.getInt("chatId")
        page = nav.optInt("page", 0).coerceIn(0, 1_000_000); artifactsPage = nav.optInt("artifactsPage", 0).coerceIn(0, 1_000_000)
        currentOwner = if (nav.isNull("userId")) null else nav.getInt("userId")
        runOwner = if (nav.isNull("runOwner")) null else nav.getInt("runOwner")
        if (!nav.isNull("runId")) run.begin(nav.getString("runId"), nav.optInt("runSeq", -1))
    }
    private fun savedViews() {
        clear("Stored snapshots — offline read-only; Home must reauthorize writes")
        for ((key, value) in localState().views()) {
            button("${value.getJSONObject("project").optString("name")} • ${key}") {
                val fields = key.split(".")
                projectId = fields[0].toInt(); chatId = fields[1].toInt().takeIf { it > 0 }; page = fields[2].toInt(); artifactsPage = fields[3].toInt()
                persistNavigation(); continuity()
            }
        }
    }
    private fun rememberedHome() = store.text("home")?.let { HomeEndpoint.fromJson(JSONObject(it)) }
    private fun continuity() {
        val pid = requireNotNull(projectId) { "Choose a Project" }
        val params = JSONObject().put("projectId", pid).put("offset", page).put("limit", if (wearable) 10 else 50).put("artifactsOffset", artifactsPage).put("artifactsLimit", 100)
        chatId?.let { params.put("chatId", it) }
        val key = snapshotKey()
        if (!gateway.connected) {
            val cached = localState().snapshot(snapshotKey()) ?: throw GatewayFailure("UNAVAILABLE", "Home offline; no saved snapshot for this page")
            renderContinuity(cached, true)
            return
        }
        rpc("device.continuity.read", params) { value ->
            if (key != snapshotKey()) return@rpc
            require(value.getString("homeId") == gateway.home?.homeId) { "Continuity returned a different Home" }
            currentOwner = value.getInt("userId")
            localState().capture(snapshotKey(), value)
            persistNavigation()
            renderContinuity(value, false)
            reattachRun()
            replayNotificationReads()
        }
    }
    private fun renderContinuity(value: JSONObject, offline: Boolean) {
        clear("${value.getJSONObject("project").optString("name", "Project")} • ${if (offline) "OFFLINE READ-ONLY SNAPSHOT" else "Home current state"}")
        button("Refresh canonical state") { continuity() }
        button("Projects") { projects() }
        button("Monitor notifications") { notifications() }
        button("Financial Decision review") { chooseReview() }
        if (!wearable) {
            val chats = value.getJSONArray("chats")
            for (i in 0 until chats.length()) {
                val chat = chats.getJSONObject(i)
                button(chat.optString("title", "Chat ${chat.getInt("id")}")) { chatId = chat.getInt("id"); page = 0; persistNavigation(); continuity() }
            }
            button("Create Chat on Home") {
                rpc("chats.create", JSONObject().put("projectId", projectId)) { result -> chatId = result.getJSONObject("chat").getInt("id"); page = 0; continuity() }
            }
            val messages = value.getJSONArray("messages")
            for (i in 0 until messages.length()) {
                val message = messages.getJSONObject(i)
                text("${message.optString("role")}: ${message.optString("content", message.optString("text", message.toString()))}")
            }
            if (!value.isNull("nextOffset")) button("Next history page") { page = value.getInt("nextOffset"); continuity() }
            button("First message page") { page = 0; persistNavigation(); continuity() }
            button("First Artifact page") { artifactsPage = 0; persistNavigation(); continuity() }
            if (!value.isNull("nextArtifactsOffset")) button("Next Artifact page") { artifactsPage = value.getInt("nextArtifactsOffset"); persistNavigation(); continuity() }
            if (chatId != null) {
                val message = input("Ask in this canonical Chat", true)
                button("Send once to Home") {
                    require(message.text.toString().trim().isNotEmpty())
                    val requestId = UUID.randomUUID().toString()
                    val body = JSONObject().put("requestId", requestId).put("message", message.text.toString().trim())
                    confirm("Send to Home", "This sends your message to the Home runtime; provider and execution permission remain Home-owned. Offline messages are not auto-queued.") {
                        require(gateway.connected) { "Home offline; messages are never queued" }
                        require(run.requestId == null) { "Existing run is attached or unconfirmed; reconnect to inspect it before sending another message" }
                        run.begin(requestId); runOwner = currentOwner; persistNavigation()
                        gateway.request("conversation.start", JSONObject().put("chatId", chatId).put("body", body)) { result ->
                            result.onSuccess { reattachRun() }.onFailure {
                                if (it is GatewayFailure && it.code != "UNAVAILABLE" && run.requestId == requestId) { run.clear(); persistNavigation() }
                                showError(it)
                            }
                        }
                    }
                }
            }
            run.requestId?.let { run -> button("Cancel active Home run") { rpc("conversation.cancel", JSONObject().put("requestId", run)) { status.text = "Home cancellation requested" } } }
            val artifacts = value.getJSONArray("artifacts")
            text("Canonical Artifact revisions")
            for (i in 0 until artifacts.length()) {
                val artifact = artifacts.getJSONObject(i)
                button(artifact.optString("title", artifact.optString("name", "Artifact"))) {
                    inspectArtifact(artifact.getString("id"))
                }
            }
        } else {
            text("Home status: ${value.getJSONArray("chats").length()} Chats, ${value.getJSONArray("artifacts").length()} Artifacts. Open Android/desktop for full professional work.")
        }
    }
    private fun reattachRun() {
        val id = run.requestId ?: return
        if (currentOwner != runOwner) { run.clear(); persistNavigation(); return }
        gateway.request("conversation.subscribe", JSONObject().put("requestId", id).put("afterSeq", run.sequence)) { result ->
            result.onSuccess { run.subscribed(id, it.optString("status")); persistNavigation() }.onFailure {
                if (it is GatewayFailure && it.code == "NOT_FOUND" && run.requestId == id) { run.clear(); persistNavigation() }
                showError(it)
            }
        }
    }
    private fun inspectArtifact(id: String, version: Int? = null, offset: Int = 0) {
        val params = JSONObject().put("artifactId", id)
        version?.let { params.put("version", it) }
        rpc("artifacts.read", params) { detail ->
            clear("Canonical Artifact — ${version?.let { "historical version $it" } ?: "current head"}; no local editing authority")
            text(detail.toString(2)); button("Back to Project") { continuity() }
            rpc("artifacts.versions.list", JSONObject().put("artifactId", id).put("offset", offset).put("limit", 50)) { history ->
                val versions = history.getJSONArray("versions")
                for (i in 0 until versions.length()) {
                    val row = versions.getJSONObject(i)
                    button("Inspect historical version ${row.getInt("version")} • ${row.optString("createdAt")}") { inspectArtifact(id, row.getInt("version"), offset) }
                }
                button("First version page") { inspectArtifact(id, version, 0) }
                if (!history.isNull("nextOffset")) button("Next version page") { inspectArtifact(id, version, history.getInt("nextOffset")) }
            }
        }
    }
    private fun notifications() {
        if (!gateway.connected) renderNotifications(localState().notifications(requireNotNull(projectId)), true)
        else fetchNotifications(true)
    }
    private fun fetchNotifications(render: Boolean) {
        if (notificationFetch || projectId == null || !gateway.connected || !foreground) return
        notificationFetch = true
        val pid = projectId
        val epoch = gateway.epoch
        gateway.request("notifications.list", JSONObject().put("projectId", pid).put("limit", if (wearable) 10 else 50)) { result ->
            notificationFetch = false
            if (!foreground || epoch != gateway.epoch) return@request
            result.onFailure { showError(it) }.onSuccess { value ->
                if (pid != projectId) return@onSuccess
                val rows = value.getJSONArray("notifications")
                localState().captureNotifications(requireNotNull(pid), rows)
                for (i in 0 until rows.length()) if (rows.getJSONObject(i).optString("status") == "delivered" && rows.getJSONObject(i).isNull("readAt")) notifyLocally(rows.getJSONObject(i))
                if (render) renderNotifications(rows, false)
            }
        }
    }
    private fun renderNotifications(rows: JSONArray, offline: Boolean) {
        clear(if (offline) "OFFLINE notification snapshot — read intents only" else "Canonical monitor notifications")
        for (i in 0 until rows.length()) {
            val row = rows.getJSONObject(i)
            text("${row.optString("title")}\n${row.optString("body")}\n${row.optString("createdAt")} • ${row.optString("status")}")
            if (row.optString("status") == "delivered" && row.isNull("readAt")) button(if (offline) "Retain read intent for same-owner reconnect" else "Mark read on Home") {
                val home = requireNotNull(gateway.home ?: rememberedHome())
                val intent = JSONObject().put("homeId", home.homeId).put("userId", requireNotNull(currentOwner)).put("deviceId", identity.deviceId).put("projectId", requireNotNull(projectId)).put("notificationId", row.getString("id"))
                localState().enqueueRead(intent)
                if (gateway.connected) replayNotificationReads()
                status.text = "Read intent retained; Home acknowledgement required"
            }
        }
        button("Refresh notifications") { notifications() }
        button("Back to Project") { continuity() }
    }
    private fun replayNotificationReads() {
        if (replayingReads || !gateway.connected || currentOwner == null) return
        val state = localState()
        val intent = state.reads().firstOrNull { it.getInt("userId") == currentOwner && it.getString("deviceId") == identity.deviceId } ?: return
        replayingReads = true
        gateway.request("notifications.read.replay", intent) { result ->
            replayingReads = false
            result.onSuccess { state.removeRead(intent); replayNotificationReads() }.onFailure { showError(it) }
        }
    }
    private fun notifyLocally(row: JSONObject) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val id = "${gateway.home?.homeId}:${row.getString("id")}" // Different Homes never collide in suppression.
        if (!notified.add(id)) return
        if (notified.size > 500) notified.remove(notified.first())
        val open = PendingIntent.getActivity(this, 0, Intent(this, javaClass), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, "lios.home").setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("LiOS Home update").setContentText("Open LiOS to review canonical Home state.")
            .setContentIntent(open).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build()
        getSystemService(NotificationManager::class.java).notify(id, 1, notification)
    }
    private fun chooseReview() {
        clear("Request-bound Financial Decision review")
        val decision = input("Canonical Decision ID")
        button("Read current Home receipt") {
            val id = decision.text.toString().toInt()
            require(id > 0)
            rpc("decision.review.read", JSONObject().put("decisionId", id)) { review ->
                val binding = review.getJSONObject("binding")
                ReviewOutbox.validateBinding(binding)
                require(binding.getString("homeId") == gateway.home?.homeId && binding.getString("deviceId") == identity.deviceId)
                store.text("review.${binding.getString("homeId")}.$id", review.toString())
                reviewed = review; renderReview(review, false)
            }
        }
        button("Open last read receipt offline") {
            val home = gateway.home ?: requireNotNull(rememberedHome())
            val review = JSONObject(requireNotNull(store.text("review.${home.homeId}.${decision.text.toString().toInt()}")) { "No saved receipt" })
            require(review.getJSONObject("binding").getString("deviceId") == identity.deviceId)
            reviewed = review; renderReview(review, true)
        }
    }
    private fun renderReview(review: JSONObject, offline: Boolean) {
        clear(if (offline) "OFFLINE RECEIPT — draft only; reread required on release" else "Current Home receipt — review does not execute a trade/command")
        text(review.getJSONObject("binding").toString(2))
        text(review.getJSONObject("decision").toString(2))
        text(review.getJSONObject("receipt").toString(2))
        if (!review.getBoolean("canReview")) { text("Home does not authorize this account to review. No approval controls."); return }
        val finalDecision = input("Your final Decision", true)
        val rationale = input("Your rationale", true)
        fun save(outcome: String) {
            val binding = review.getJSONObject("binding")
            confirm("Save $outcome review draft", "Receipt ${binding.getInt("receiptVersionId")}\nHash ${binding.getString("snapshotHash")}\n${finalDecision.text}\n${rationale.text}\nNo approval is sent now; explicitly Release from outbox after reconnect.") {
                require(reviewed === review) { "Displayed review was invalidated; reread Home" }
                outbox.enqueue(binding, outcome, finalDecision.text.toString(), rationale.text.toString())
                drafts()
            }
        }
        button("Save Approve draft — no execution") { save("approved") }
        button("Save Reject draft") { save("rejected") }
    }
    private fun drafts() {
        clear("Encrypted review drafts — explicit Release only")
        val items = outbox.list()
        if (items.isEmpty()) text("No review drafts")
        for (row in items) {
            val submission = row.getJSONObject("submission")
            val id = submission.getString("requestId")
            text("$id • ${row.getString("status")}\n${submission.toString(2)}\n${row.optString("error")}")
            if (row.getString("status") in listOf("pending", "unconfirmed")) button("Release exact draft") {
                confirm("Release after canonical reread", "$id\n${submission.toString(2)}\nHome/user/device/receipt/head/policy must still match. Same request ID reconciles an ambiguous delivery. No external action is authorized.") {
                    outbox.release(id, gateway, identity.deviceId) { result ->
                        result.onFailure { showError(it) }.onSuccess { status.text = "Home receipted request $id: ${it}" }
                        drafts()
                    }
                    drafts()
                }
            }
            if (row.getString("status") != "sending") button("Delete local draft/receipt") {
                confirm("Delete local outbox item", "Home's canonical approval and receipt are not deleted. Unconfirmed items may have reached Home; inspect Home before authoring another review.") { outbox.delete(id); drafts() }
            }
        }
    }
}
