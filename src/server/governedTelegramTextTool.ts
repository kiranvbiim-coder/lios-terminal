import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { sourceConnections } from "@shared/schema";
import { telegramTextInputSchema, telegramTextReviewSchema } from "@shared/telegramConnection";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import type { GovernedToolCall } from "./governedTools";
import { getDb } from "./db";
import { hashLedgerValue, appendLedgerEvent } from "./ledgerStore";
import { prepareTelegramOutboundConnection } from "./telegramConnectionService";
import { requestPinned, resolvePinnedPublicAddress } from "./p13PluginNetworkBroker";
import { isCredentialBearingOutboundText } from "./artifactMaintenance";

// Selected OpenClaw c074824a send-prepared.ts acceptance-before-observer and provider-thread-proof.ts
// identity mechanisms. LiOS keeps exact approvals, no-replay Ledger custody and Home-only credentials/egress.
// Copyright (c) 2026 OpenClaw Foundation. MIT grant retained in THIRD_PARTY_NOTICES.md.
const tenantSchema = z.object({ userId: z.number().int().positive(), organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();
const positiveId = z.number().int().positive().safe();
type TextInput = z.infer<typeof telegramTextInputSchema>;
type Access = Awaited<ReturnType<typeof prepareTelegramOutboundConnection>>;
export interface TelegramTextDependencies {
  resolveAddress?: typeof resolvePinnedPublicAddress;
  requester?: typeof requestPinned;
}
export interface TelegramTargetsCapture { text: string; sourceRefs: string[]; assertCurrent(currentCall: GovernedToolCall): Promise<void> }
const outputSchema = z.object({ output: z.unknown(), summary: z.string().max(2_000), deterministic: z.boolean(), sourceRefs: z.array(z.string()).max(100) }).strict().transform((value): ConversationToolResult => {
  if (value.output === undefined) throw new Error("Telegram tools require explicit output.");
  return { ...value, output: value.output };
});
function scope(call: GovernedToolCall) {
  const tenant = tenantSchema.parse(call.tenant);
  if (call.source !== "agent" || call.userId !== tenant.userId || !call.requestId || !call.projectId || !call.chatId || call.resourceTransmissionAllowed !== true || !["auto", "my_data"].includes(call.sourceScope ?? "auto")) throw new Error("Telegram text requires the authenticated connected Project Chat and permitted Project-reference source scope.");
  return { tenant, projectId: call.projectId, chatId: call.chatId };
}
const sourceRef = (id: number) => `source-connection:${id}`;
function sourceSelected(call: GovernedToolCall, id: number) {
  const policy = call.researchSourcePolicy;
  return !policy?.providerDeny?.includes("telegram") &&
    (!policy?.providerAllow?.length || policy.providerAllow.includes("telegram")) &&
    (policy?.mode !== "only_refs" || policy.allowedSourceRefs.includes(sourceRef(id)));
}
async function admit(rawInput: unknown, call: GovernedToolCall, signal: AbortSignal) {
  signal.throwIfAborted();
  const input = telegramTextInputSchema.parse(rawInput);
  if (isCredentialBearingOutboundText(input.text)) throw new Error("Credential-bearing text cannot be sent to a channel.");
  const { tenant, projectId, chatId } = scope(call);
  if (!sourceSelected(call, input.connectionId)) throw new Error("Telegram connection is outside the current selected source policy.");
  const access = await prepareTelegramOutboundConnection(tenant, input.connectionId, projectId, chatId);
  if (input.reviewBinding !== access.reviewBinding || !access.policy.allowedConversationIds.includes(input.recipientId) || signal.aborted) {
    access.close();
    throw new Error("Telegram recipient or current connection/consent changed. Inspect targets and review a fresh exact message.");
  }
  return { input, access, tenant, projectId, chatId };
}
/** Pure local admission after exact grant consumption, before the canonical L5 dispatch intent. */
export async function preflightTelegramText(rawInput: unknown, call: GovernedToolCall, signal: AbortSignal) {
  const { access } = await admit(rawInput, call, signal);
  access.close();
}
/** Populate only from the held server step after current scope/credential/content admission. */
export async function prepareTelegramTextReview(rawInput: unknown, call: GovernedToolCall, signal: AbortSignal) {
  const { input, access } = await admit(rawInput, call, signal);
  try { const { reviewBinding: _binding, ...display } = input; return telegramTextReviewSchema.parse(display); }
  finally { access.close(); }
}
class TelegramTextDispatchError extends Error {
  constructor(readonly noEffect: boolean, message: string) { super(message); }
}
const observedMessageSchema = z.object({
  message_id: positiveId,
  chat: z.object({ id: z.number().int().safe(), type: z.string().optional() }),
  message_thread_id: positiveId.optional(),
  direct_messages_topic: z.object({ topic_id: positiveId }).optional(),
  reply_to_message: z.object({ message_id: positiveId }).optional(),
});
async function dispatchText(input: TextInput, access: Access, signal: AbortSignal,
  observe: (message: z.infer<typeof observedMessageSchema>) => Promise<string>, deps: TelegramTextDependencies) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 20_000);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let entered = false;
  let removeAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    const onAbort = () => reject(new TelegramTextDispatchError(!entered, "Telegram sending stopped. If dispatch began, its outcome may be unknown; do not resend automatically."));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    removeAbort = () => controller.signal.removeEventListener("abort", onAbort);
    if (controller.signal.aborted) onAbort();
  });
  try {
    return await Promise.race([cancelled, (async () => {
      await access.assertCurrent();
      const address = await (deps.resolveAddress ?? resolvePinnedPublicAddress)("api.telegram.org");
      const token = await access.resolveBotToken();
      const fence = await access.assertCurrent();
      controller.signal.throwIfAborted();
      fence();
      const body = {
        chat_id: input.recipientId, text: input.text,
        // No parse mode, link fetch, target substitution, quote fallback or multi-part hidden send.
        link_preview_options: { is_disabled: true }, disable_notification: input.silent,
        ...(input.topic && (input.topic.kind === "private" || input.topic.kind === "forum" && input.topic.id !== 1) ? { message_thread_id: input.topic.id } : {}),
        ...(input.topic?.kind === "direct_messages" ? { direct_messages_topic_id: input.topic.id } : {}),
        ...(input.replyToMessageId ? { reply_parameters: { message_id: input.replyToMessageId, allow_sending_without_reply: false } } : {}),
      };
      entered = true;
      const response = await (deps.requester ?? requestPinned)({ url: new URL(`https://api.telegram.org/bot${token}/sendMessage`),
        address: address.address, family: address.family, method: "POST", headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify(body)), timeoutMs: 20_000, maxResponseBytes: 64 * 1024, signal: controller.signal });
      if (response.body.byteLength > 64 * 1024) throw new TelegramTextDispatchError(false, "Telegram response exceeded the bound; acceptance is unknown. Do not resend automatically.");
      let parsed: unknown;
      try { parsed = JSON.parse(response.body.toString("utf8")); } catch { throw new TelegramTextDispatchError(false, "Telegram returned no verifiable acceptance. Do not resend automatically."); }
      const envelope = z.object({ ok: z.boolean(), result: z.unknown().optional(), error_code: z.number().int().optional() }).safeParse(parsed);
      if (!envelope.success) throw new TelegramTextDispatchError(false, "Telegram returned no verifiable acceptance. Do not resend automatically.");
      if (!envelope.data.ok) throw new TelegramTextDispatchError(true, envelope.data.error_code === 429
        ? "Telegram refused this attempt due to its rate limit. Nothing is retried; inspect and explicitly review a later attempt."
        : "Telegram rejected this message. Nothing is retried or sent to another recipient.");
      const message = observedMessageSchema.safeParse(envelope.data.result);
      if (!message.success) throw new TelegramTextDispatchError(false, "Telegram accepted a request without a verifiable message identity. Do not resend automatically.");
      // Retain known provider acceptance BEFORE current-authority/output observers can fail or Stop wins.
      const evidenceRef = await observe(message.data);
      controller.signal.throwIfAborted();
      const release = await access.assertCurrent();
      release();
      return { message: message.data, evidenceRef };
    })()]);
  } catch (error) {
    if (error instanceof TelegramTextDispatchError) throw error;
    throw new TelegramTextDispatchError(!entered, entered
      ? "Telegram dispatch outcome is unknown. Inspect retained acceptance evidence; do not resend automatically."
      : "Telegram sending refused before network dispatch; inspect current connection, consent and recipient.");
  } finally {
    clearTimeout(timer); signal.removeEventListener("abort", abort); removeAbort?.(); controller.abort();
  }
}

export const telegramTargetsTool: ConversationToolDefinition = {
  id: "lios.channel.telegram.targets", label: "Inspect permitted reviewed Telegram text targets in this Project Chat",
  kind: "retrieve", permissionClass: "safe_auto", access: "read", sideEffect: "none", replaySafe: true, cancel: null,
  inputSchema: z.object({}).strict(), outputSchema,
  invoke: async (_input, signal, call) => {
    const { tenant, projectId, chatId } = scope(call);
    const sources = await getDb().select({ id: sourceConnections.id, name: sourceConnections.name }).from(sourceConnections).where(and(
      eq(sourceConnections.userId, tenant.userId), eq(sourceConnections.connectorId, "telegram"))).limit(101);
    if (sources.length > 100) throw new Error("Review Telegram connections in Connections before selecting a bounded target set.");
    const targets: Array<{ connectionId: number; name: string; reviewBinding: string; recipientIds: string[] }> = [];
    for (const source of sources) {
      signal.throwIfAborted();
      if (!sourceSelected(call, source.id)) continue;
      let access: Access | undefined;
      try {
        access = await prepareTelegramOutboundConnection(tenant, source.id, projectId, chatId);
        targets.push({ connectionId: source.id, name: source.name, reviewBinding: access.reviewBinding, recipientIds: access.policy.allowedConversationIds });
      } catch { /* Disabled, foreign, missing-secret or unconsented sources are not usable outbound targets. */ }
      finally { access?.close(); }
    }
    signal.throwIfAborted();
    const sourceRefs = targets.map(target => sourceRef(target.connectionId));
    const text = JSON.stringify({ targets, automaticReplies: false }).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    if (Buffer.byteLength(text, "utf8") > 32 * 1024) throw new Error("Telegram target metadata exceeds the bounded review; reduce configured recipient lists.");
    if (targets.length && call.recordTelegramTargets) call.recordTelegramTargets({
      text, sourceRefs,
      assertCurrent: async currentCall => {
        signal.throwIfAborted();
        const currentScope = scope(currentCall);
        if (currentScope.tenant.userId !== tenant.userId || currentScope.tenant.organizationId !== tenant.organizationId ||
            currentScope.projectId !== projectId || currentScope.chatId !== chatId ||
            hashLedgerValue(currentCall.researchSourcePolicyBinding ?? null) !== hashLedgerValue(call.researchSourcePolicyBinding ?? null)) {
          throw new Error("Telegram target source policy or scope changed before provider use.");
        }
        for (const target of targets) {
          if (!sourceSelected(currentCall, target.connectionId)) throw new Error("Telegram target is excluded by the current source policy.");
          const current = await prepareTelegramOutboundConnection(tenant, target.connectionId, projectId, chatId);
          try { if (current.reviewBinding !== target.reviewBinding) throw new Error("Telegram target metadata changed before provider use."); }
          finally { current.close(); }
        }
        signal.throwIfAborted();
      },
    });
    return { output: { targets, automaticReplies: false }, summary: targets.length
      ? "Recorded bounded Telegram target metadata for current private AI review. It grants no send permission; after restart inspect the targets again."
      : "No permitted outbound Telegram target is available in this Chat. Review explicit outbound consent in Connections; importing alone never enables replies.", deterministic: true,
      sourceRefs };
  },
};
export function createTelegramTextTool(dependencies: TelegramTextDependencies = {}): ConversationToolDefinition {
  return {
    id: "lios.channel.telegram.send_text", label: "Send one exact-reviewed plain-text Telegram message or reply",
    planningHint: "The initial plan must contain only lios.channel.telegram.targets for Telegram work, NOT send_text: the reviewBinding does not exist in planner context yet. After target inspection executes, revise the plan using the exact recipientId and reviewBinding from the fresh UNTRUSTED_CHANNEL_TARGET_METADATA observation. dependsOn does not fill future inputs; never invent a placeholder hash. One plain-text message, maximum4096characters. An optional exact forum/private/direct_messages topic and replyToMessageId cannot fall back to another destination. Private bot topics and channel direct-message topics are distinct; never infer them from the sign of a chat ID. Ask for exact approval; no automatic reply, retry, splitting, HTML, media or broad Project grant. Provider acceptance is not delivery/read.",
    kind: "calculate", permissionClass: "user_confirm", access: "write", sideEffect: "external", replaySafe: false, allowProjectApproval: false,
    inputSchema: telegramTextInputSchema, outputSchema, maxOutputBytes: 16 * 1024, cancel: null,
    invoke: async (rawInput, signal, call): Promise<ConversationToolResult> => {
      if (!call.idempotencyKey || !call.beforeExternalDispatch || !call.afterExternalDispatchCommitted) throw new Error("Telegram sending requires canonical exact approval and durable dispatch custody.");
      let admitted: Awaited<ReturnType<typeof admit>>;
      try { admitted = await admit(rawInput, call, signal); }
      catch { await call.markExternalDispatchNoEffect?.(); throw new Error("Telegram sending refused before network entry. Review current exact target and consent."); }
      const { input, access, tenant, projectId, chatId } = admitted;
      try {
        const result = await dispatchText(input, access, signal, async message => {
          const event = await appendLedgerEvent(tenant, { projectId, chatId, eventType: "execution.receipt", actorType: "provider", requestId: call.requestId,
            correlationId: call.idempotencyKey, payload: { kind: "channel_outbound_provider_acceptance", provider: "telegram", connectionId: input.connectionId,
              accountBindingId: access.binding.accountBindingId, toolCallId: call.toolCallId, exactInputHash: hashLedgerValue(input), textHash: hashLedgerValue(input.text),
              requestedRecipientId: input.recipientId, observedRecipientId: String(message.chat.id), providerMessageId: message.message_id,
              requestedTopic: input.topic ?? null, observedForumTopicId: message.message_thread_id ?? null,
              observedDirectTopicId: message.direct_messages_topic?.topic_id ?? null, requestedReplyId: input.replyToMessageId ?? null,
              observedReplyId: message.reply_to_message?.message_id ?? null, delivery: "unknown", read: "unknown" } });
          return `project-ledger-event:${event.id}`;
        }, dependencies);
        const observedTopic = input.topic?.kind === "direct_messages" ? result.message.direct_messages_topic?.topic_id
          : result.message.message_thread_id ?? (result.message.chat.type === "supergroup" && input.topic?.kind === "forum" && input.topic.id === 1 ? 1 : undefined);
        const destinationVerified = String(result.message.chat.id) === input.recipientId && (!input.topic || observedTopic === input.topic.id) &&
          (!input.replyToMessageId || result.message.reply_to_message?.message_id === input.replyToMessageId);
        return { output: { provider: "telegram", acceptance: "accepted", providerMessageId: result.message.message_id,
          recipientId: String(result.message.chat.id), destinationVerified, delivery: "unknown", read: "unknown", evidenceRef: result.evidenceRef },
          summary: destinationVerified ? "Telegram accepted the exact reviewed message. Acceptance evidence retained; recipient delivery/read are unknown."
            : "Telegram accepted a message, but its returned destination/reply facts did not fully verify the reviewed target. Acceptance evidence retained; inspect it and do not resend automatically.",
          deterministic: false, sourceRefs: [result.evidenceRef, sourceRef(input.connectionId)] };
      } catch (error) {
        if (error instanceof TelegramTextDispatchError && error.noEffect) await call.markExternalDispatchNoEffect?.();
        throw error instanceof TelegramTextDispatchError ? new Error(error.message) : new Error("Telegram outcome or acceptance persistence is uncertain. Inspect the Ledger; do not resend automatically.");
      } finally { access.close(); }
    },
  };
}
