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
    private var activeRun: String? = null
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
                    val event = payload.optJSONObject("event") ?: payload
                    status.text = "Home run: ${event.optString("type", "updated")} ${event.optString("message", "").take(300)}"
                    if (event.optString("type") == "done") {
                        activeRun = null
                        if (projectId != null) continuity()
                    }
                }
            }
            val notifications = getSystemService(NotificationManager::class.java)
            notifications.createNotificationChannel(NotificationChannel("lios.home", "LiOS Home monitor updates", NotificationManager.IMPORTANCE_DEFAULT))
            connection()
        } catch (error: Exception) {
            body.removeAllViews()
            text("Native storage unavailable: ${error.message}. Do not export or restore device keys. Clear app data and obtain a new owner-approved pairing if the Keystore was lost.")
        }
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
                projectId = null; chatId = null; reviewed = null
                invite.text.clear()
                gateway.connect(pair.first, pair.second)
            }
        }
        button("Disconnect — never auto-reconnect") { gateway.close(); status.text = "Offline; stored reviews remain drafts" }
        button("Projects") { projects() }
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
                    projectId = project.getInt("id"); chatId = null; page = 0; continuity()
                }
            }
            if (projects.length() == 0) text("No Projects on this Home. Create one on the Home first.")
        }
    }
    private fun snapshotKey() = "view.${gateway.home?.homeId ?: rememberedHome()?.homeId}.${projectId}.${chatId ?: 0}.$page"
    private fun rememberedHome() = store.text("home")?.let { HomeEndpoint.fromJson(JSONObject(it)) }
    private fun continuity() {
        val pid = requireNotNull(projectId) { "Choose a Project" }
        val params = JSONObject().put("projectId", pid).put("offset", page).put("limit", if (wearable) 10 else 50)
        chatId?.let { params.put("chatId", it) }
        if (!gateway.connected) {
            val cached = store.text(snapshotKey()) ?: throw GatewayFailure("UNAVAILABLE", "Home offline; no saved snapshot for this page")
            renderContinuity(JSONObject(cached).getJSONObject("value"), true)
            return
        }
        rpc("device.continuity.read", params) { value ->
            require(value.getString("homeId") == gateway.home?.homeId) { "Continuity returned a different Home" }
            store.text(snapshotKey(), JSONObject().put("capturedAt", Instant.now().toString()).put("value", value).toString())
            renderContinuity(value, false)
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
                button(chat.optString("title", "Chat ${chat.getInt("id")}")) { chatId = chat.getInt("id"); page = 0; continuity() }
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
            if (chatId != null) {
                val message = input("Ask in this canonical Chat", true)
                button("Send once to Home") {
                    require(message.text.toString().trim().isNotEmpty())
                    val requestId = UUID.randomUUID().toString()
                    val body = JSONObject().put("requestId", requestId).put("message", message.text.toString().trim())
                    confirm("Send to Home", "This sends your message to the Home runtime; provider and execution permission remain Home-owned. Offline messages are not auto-queued.") {
                        rpc("conversation.start", JSONObject().put("chatId", chatId).put("body", body)) {
                            activeRun = requestId
                            rpc("conversation.subscribe", JSONObject().put("requestId", requestId).put("afterSeq", -1)) { status.text = "Attached to canonical run $requestId" }
                        }
                    }
                }
            }
            activeRun?.let { run -> button("Cancel active Home run") { rpc("conversation.cancel", JSONObject().put("requestId", run)) { status.text = "Home cancellation requested" } } }
            val artifacts = value.getJSONArray("artifacts")
            text("Canonical Artifact revisions")
            for (i in 0 until artifacts.length()) {
                val artifact = artifacts.getJSONObject(i)
                button(artifact.optString("title", artifact.optString("name", "Artifact"))) {
                    rpc("artifacts.read", JSONObject().put("artifactId", artifact.getString("id"))) { detail ->
                        clear("Canonical Artifact — no local editing authority")
                        text(detail.toString(2)); button("Back to Project") { continuity() }
                    }
                }
            }
        } else {
            text("Home status: ${value.getJSONArray("chats").length()} Chats, ${value.getJSONArray("artifacts").length()} Artifacts. Open Android/desktop for full professional work.")
        }
    }
    private fun notifications() {
        rpc("notifications.list", JSONObject().put("projectId", requireNotNull(projectId)).put("limit", if (wearable) 10 else 50)) { result ->
            clear("Canonical monitor notifications")
            val rows = result.getJSONArray("notifications")
            for (i in 0 until rows.length()) {
                val row = rows.getJSONObject(i)
                text("${row.optString("title")}\n${row.optString("body")}\n${row.optString("createdAt")} • ${row.optString("status")}")
                if (row.optString("status") == "delivered" && row.isNull("readAt")) {
                    notifyLocally(row)
                    button("Mark read on Home") {
                        rpc("notifications.read", JSONObject().put("projectId", projectId).put("notificationId", row.getString("id"))) { notifications() }
                    }
                }
            }
            button("Refresh notifications") { notifications() }
            button("Back to Project") { continuity() }
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
