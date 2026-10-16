package com.lios.nativeclient

// Adapted OpenClaw ChatCommandOutbox bounded, attempt-owned, ambiguous-delivery
// and no-auto-reconnect mechanisms. Only LiOS decision_review drafts are stored.
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

class ReviewOutbox(private val store: ProtectedStore) {
    companion object {
        private val authority = listOf("homeId", "userId", "deviceId", "decisionId", "receiptVersionId", "snapshotHash", "decisionHead", "policyDigest")
        private val credentials = Regex("""(?:\b(?:api[_\s-]?key|access[_\s-]?token|refresh[_\s-]?token|password|secret|private[_\s-]?key)\b\s*[:=]\s*\S+|\bbearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)""", RegexOption.IGNORE_CASE)
        fun sameAuthority(a: JSONObject, b: JSONObject) = authority.all { a.get(it) == b.get(it) }
        fun validateBinding(value: JSONObject) {
            require(value.keys().asSequence().toSet() == (authority + listOf("issuedAt", "expiresAt")).toSet())
            UUID.fromString(value.getString("homeId"))
            require(value.getInt("userId") > 0 && value.getInt("decisionId") > 0 && value.getInt("receiptVersionId") > 0)
            require(value.getString("deviceId").matches(Regex("[a-f0-9]{32}")))
            listOf("snapshotHash", "decisionHead", "policyDigest").forEach { require(value.getString(it).matches(Regex("[a-f0-9]{64}"))) }
            val issued = Instant.parse(value.getString("issuedAt"))
            val expires = Instant.parse(value.getString("expiresAt"))
            require(expires.isAfter(issued) && expires.toEpochMilli() - issued.toEpochMilli() <= 86_400_000)
            require(issued.toEpochMilli() <= System.currentTimeMillis() + 120_000)
        }
        fun validateText(value: String, max: Int) { require(value.trim().length in 1..max && !credentials.containsMatchIn(value)) { "Empty, overlong or credential-bearing review text refused" } }
    }
    private var rows = JSONArray(store.text("review.outbox") ?: "[]")
    init {
        require(rows.length() <= 50)
        for (i in 0 until rows.length()) {
            val row = rows.getJSONObject(i)
            require(row.getInt("schemaVersion") == 1 && row.getString("kind") == "decision_review")
            val submission = row.getJSONObject("submission")
            UUID.fromString(submission.getString("requestId"))
            validateBinding(submission.getJSONObject("binding"))
            validateText(submission.getString("finalDecision"), 5000)
            validateText(submission.getString("rationale"), 10000)
            require(submission.getString("outcome") in listOf("approved", "rejected"))
            require(row.getString("status") in listOf("pending", "sending", "unconfirmed", "submitted", "refused"))
            if (row.getString("status") == "sending") row.put("status", "unconfirmed").put("error", "App stopped during dispatch; release explicitly to reconcile the same request")
        }
        persist()
    }
    @Synchronized private fun persist() {
        val text = rows.toString()
        require(text.toByteArray(Charsets.UTF_8).size <= 1_000_000) { "Review outbox storage full" }
        store.text("review.outbox", text)
    }
    @Synchronized fun list(): List<JSONObject> = (0 until rows.length()).map { JSONObject(rows.getJSONObject(it).toString()) }
    @Synchronized fun enqueue(binding: JSONObject, outcome: String, finalDecision: String, rationale: String): String {
        require(rows.length() < 50) { "Outbox full; remove retained items explicitly" }
        validateBinding(binding)
        require(Instant.parse(binding.getString("expiresAt")).isAfter(Instant.now())) { "Review expired; reconnect and read current receipt" }
        require(outcome in listOf("approved", "rejected"))
        validateText(finalDecision, 5000); validateText(rationale, 10000)
        val id = UUID.randomUUID().toString()
        val submission = JSONObject().put("requestId", id).put("binding", JSONObject(binding.toString())).put("outcome", outcome)
            .put("finalDecision", finalDecision.trim()).put("rationale", rationale.trim())
        val row = JSONObject().put("schemaVersion", 1).put("kind", "decision_review").put("submission", submission)
            .put("createdAt", Instant.now().toString()).put("status", "pending").put("error", JSONObject.NULL).put("approvalId", JSONObject.NULL)
        val candidate = JSONArray(rows.toString()).put(row)
        require(candidate.toString().toByteArray(Charsets.UTF_8).size <= 1_000_000) { "Outbox storage full" }
        rows = candidate; persist(); return id
    }
    @Synchronized fun delete(id: String) {
        val row = find(id)
        require(row.getString("status") != "sending") { "Cannot remove a request during dispatch" }
        rows = JSONArray(list().filter { it.getJSONObject("submission").getString("requestId") != id })
        persist()
    }
    private fun find(id: String): JSONObject = (0 until rows.length()).map { rows.getJSONObject(it) }
        .first { it.getJSONObject("submission").getString("requestId") == id }
    @Synchronized fun release(id: String, gateway: HomeGateway, deviceId: String, done: (Result<JSONObject>) -> Unit) {
        val row = find(id)
        require(row.getString("status") in listOf("pending", "unconfirmed")) { "Draft is not releasable" }
        require(gateway.connected) { "Reconnect before releasing" }
        val submission = JSONObject(row.getJSONObject("submission").toString())
        val binding = submission.getJSONObject("binding")
        require(binding.getString("homeId") == gateway.home?.homeId && binding.getString("deviceId") == deviceId) { "Draft belongs to another Home/device" }
        if (!Instant.parse(binding.getString("expiresAt")).isAfter(Instant.now())) {
            row.put("status", "refused").put("error", "Expired; read current receipt and author a new review")
            persist(); done(Result.failure(GatewayFailure("FORBIDDEN", "Draft expired"))); return
        }
        val epoch = gateway.epoch
        val reconciling = row.getString("status") == "unconfirmed"
        // Claim before the asynchronous current-state read, so two taps cannot dispatch twice.
        row.put("status", "sending").put("error", JSONObject.NULL); persist()
        gateway.request("decision.review.read", JSONObject().put("decisionId", binding.getInt("decisionId"))) { current ->
            current.fold(onSuccess = { review ->
                val fresh = review.getJSONObject("binding")
                val approval = review.optJSONObject("approval")
                val decision = review.getJSONObject("decision")
                val exactPriorSubmission = reconciling &&
                    authority.filter { it != "decisionHead" }.all { binding.get(it) == fresh.get(it) } &&
                    approval != null && approval.optString("reviewRequestId") == id &&
                    approval.optInt("receiptVersionId") == binding.getInt("receiptVersionId") &&
                    approval.optString("snapshotHash") == binding.getString("snapshotHash") &&
                    approval.optString("outcome") == submission.getString("outcome") &&
                    decision.optString("finalDecision") == submission.getString("finalDecision") &&
                    decision.optString("decisionRationale") == submission.getString("rationale")
                val freshReview = sameAuthority(binding, fresh) && review.getBoolean("canReview")
                if (epoch != gateway.epoch || (!freshReview && !exactPriorSubmission)) {
                    finish(id, "refused", "Authority, receipt, policy or decision head changed; reread and author a new review", null)
                    done(Result.failure(GatewayFailure("FORBIDDEN", "Stale review authority")))
                } else {
                    gateway.request("decision.review.submit", submission) { reply ->
                        reply.fold(onSuccess = { receipt ->
                            if (receipt.getString("requestId") != id || receipt.getString("snapshotHash") != binding.getString("snapshotHash")) {
                                finish(id, "unconfirmed", "Receipt mismatch; reconcile on Home", null)
                                done(Result.failure(GatewayFailure("INVALID_REQUEST", "Receipt mismatch")))
                            } else { finish(id, "submitted", null, receipt.getInt("approvalId")); done(Result.success(receipt)) }
                        }, onFailure = { error ->
                            val refused = error is GatewayFailure && error.code in listOf("FORBIDDEN", "UNAUTHORIZED", "INVALID_REQUEST", "NOT_FOUND")
                            finish(id, if (refused) "refused" else "unconfirmed", error.message, null); done(Result.failure(error))
                        })
                    }
                }
            }, onFailure = { error -> finish(id, "unconfirmed", error.message, null); done(Result.failure(error)) })
        }
    }
    @Synchronized private fun finish(id: String, status: String, error: String?, approvalId: Int?) {
        val row = find(id)
        // Only the claimed row may be completed by its exact dispatch callback.
        if (row.getString("status") != "sending") return
        row.put("status", status).put("error", error?.take(1000) ?: JSONObject.NULL).put("approvalId", approvalId ?: JSONObject.NULL)
        persist()
    }
}
