package com.lios.nativeclient

import org.json.JSONArray
import org.json.JSONObject

/** A cursor is an observation bookmark, never permission to resend conversation.start. */
class RunCursor {
    var requestId: String? = null; private set
    var sequence: Int = -1; private set
    fun begin(id: String, after: Int = -1) { requestId = id; sequence = after }
    fun clear() { requestId = null; sequence = -1 }
    fun receive(payload: JSONObject): Boolean {
        if (requestId == null || payload.optString("requestId") != requestId || !payload.has("runSeq")) return false
        val next = payload.getInt("runSeq")
        if (next <= sequence) return false
        sequence = next
        val event = payload.optJSONObject("event")
        if (event?.optString("type") == "done" && event.optString("status") != "waiting_approval") clear()
        return true
    }
    fun subscribed(id: String, status: String) { if (requestId == id && status == "finished") clear() }
}

/** One bounded encrypted projection per pinned Home, not a second canonical store. */
class ContinuityState(private val store: ProtectedStore, private val homeId: String) {
    private val key = "continuity.v1.$homeId"
    private fun load(): JSONObject {
        val raw = store.text(key) ?: return JSONObject().put("homeId", homeId).put("snapshots", JSONArray()).put("reads", JSONArray())
        require(raw.toByteArray(Charsets.UTF_8).size <= 5_000_000) { "Offline projection exceeds its bound" }
        return JSONObject(raw).also { require(it.getString("homeId") == homeId) }
    }
    private fun save(value: JSONObject) {
        val raw = value.toString()
        require(raw.toByteArray(Charsets.UTF_8).size <= 5_000_000) { "Offline projection exceeds its bound" }
        store.text(key, raw)
    }
    fun views(): List<Pair<String, JSONObject>> {
        val rows = load().getJSONArray("snapshots")
        require(rows.length() <= 20)
        return (0 until rows.length()).map { rows.getJSONObject(it).let { row -> row.getString("key") to row.getJSONObject("value") } }
    }
    fun navigation(): JSONObject? = load().optJSONObject("navigation")
    fun navigate(value: JSONObject) { save(load().put("navigation", value)) }
    fun snapshot(name: String): JSONObject? {
        val rows = load().getJSONArray("snapshots")
        return (0 until rows.length()).map { rows.getJSONObject(it) }.firstOrNull { it.getString("key") == name }?.getJSONObject("value")
    }
    fun capture(name: String, value: JSONObject) {
        require(value.getString("homeId") == homeId)
        val state = load()
        val priorOwner = state.optInt("userId", -1)
        if (priorOwner != -1 && priorOwner != value.getInt("userId")) {
            state.put("snapshots", JSONArray()).remove("navigation")
            state.remove("notifications")
        }
        state.put("userId", value.getInt("userId"))
        val rows = state.getJSONArray("snapshots")
        val kept = (0 until rows.length()).map { rows.getJSONObject(it) }.filter { it.getString("key") != name }.takeLast(19)
        state.put("snapshots", JSONArray(kept + JSONObject().put("key", name).put("value", value)))
        // Evict oldest pages until below the total bound; never retain a partial page.
        while (state.toString().toByteArray(Charsets.UTF_8).size > 5_000_000 && state.getJSONArray("snapshots").length() > 1) state.getJSONArray("snapshots").remove(0)
        save(state)
    }
    fun notifications(projectId: Int): JSONArray {
        val state = load()
        return if (state.optInt("notificationsProject", -1) == projectId) state.optJSONArray("notifications") ?: JSONArray() else JSONArray()
    }
    fun captureNotifications(projectId: Int, rows: JSONArray) { require(rows.length() <= 100); save(load().put("notificationsProject", projectId).put("notifications", rows)) }
    fun enqueueRead(intent: JSONObject) {
        require(intent.getString("homeId") == homeId && intent.getInt("userId") > 0 && intent.getInt("projectId") > 0)
        require(intent.getString("notificationId").length in 1..300 && intent.getString("deviceId").matches(Regex("[a-f0-9]{32}")))
        val state = load(); val rows = state.getJSONArray("reads")
        if ((0 until rows.length()).any { rows.getJSONObject(it).toString() == intent.toString() }) return
        require(rows.length() < 50) { "Notification-read outbox full; reconnect to reconcile" }
        rows.put(intent); save(state)
    }
    fun reads(): List<JSONObject> { val rows = load().getJSONArray("reads"); require(rows.length() <= 50); return (0 until rows.length()).map { rows.getJSONObject(it) } }
    fun removeRead(intent: JSONObject) {
        val state = load()
        state.put("reads", JSONArray(reads().filter { it.toString() != intent.toString() })); save(state)
    }
}
