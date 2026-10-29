import { z } from "zod";

export const TELEGRAM_CONNECTOR_ID = "telegram" as const;
export const TELEGRAM_CONNECTION_CONSENT_VERSION = "telegram-channel-data/1";
export const TELEGRAM_OUTBOUND_CONSENT_VERSION = "telegram-reviewed-outbound/1";
const uuid = z.string().uuid();
const conversationId = z.string().regex(/^-?[1-9][0-9]{0,19}$/);

/** Source-connection metadata only; neither this policy nor a worker message grants execution or AI rights. */
export const telegramConnectionPolicySchema = z.object({
  version: z.literal("lios-telegram-connection/1"),
  accountBindingId: uuid,
  enabled: z.boolean(),
  projectId: z.number().int().positive().safe(),
  chatId: z.number().int().positive().safe(),
  allowedConversationIds: z.array(conversationId).min(1).max(100),
  allowedUpdateTypes: z.array(z.string().regex(/^[a-z][a-z_]{0,63}$/)).min(1).max(64),
  retentionDays: z.number().int().min(1).max(365),
  // Additional current source/AI and exact-operation checks remain mandatory before transmission/effects.
  allowAiTransmission: z.boolean().default(false),
  allowOutbound: z.boolean().default(false),
}).strict().superRefine((policy, ctx) => {
  for (const key of ["allowedConversationIds", "allowedUpdateTypes"] as const) {
    if (new Set(policy[key]).size !== policy[key].length) ctx.addIssue({ code: "custom", path: [key], message: "Entries must be unique." });
  }
});
export type TelegramConnectionPolicy = z.infer<typeof telegramConnectionPolicySchema>;

const storedConfig = z.object({
  endpoint: z.literal("https://api.telegram.org"),
  // Existing source_connections.config admits scalar values; keep the structured policy in this bounded field.
  channelPolicy: z.string().max(16_384),
}).strict();

export function telegramSourceConfig(policy: TelegramConnectionPolicy): Record<string, string> {
  const channelPolicy = JSON.stringify(telegramConnectionPolicySchema.parse(policy));
  return storedConfig.parse({ endpoint: "https://api.telegram.org", channelPolicy });
}

export function parseTelegramSourceConfig(config: unknown): TelegramConnectionPolicy {
  const stored = storedConfig.parse(config);
  return telegramConnectionPolicySchema.parse(JSON.parse(stored.channelPolicy));
}

export function telegramCredentialName(userId: number, accountBindingId: string): string {
  z.number().int().positive().safe().parse(userId);
  return `channel.telegram.${userId}.${uuid.parse(accountBindingId)}`;
}

export function telegramConsentScope(accountBindingId: string): string {
  return `channel:telegram:${uuid.parse(accountBindingId)}:ingress`;
}
export function telegramOutboundConsentScope(accountBindingId: string): string {
  return `channel:telegram:${uuid.parse(accountBindingId)}:outbound`;
}

/** Adoption-time AI opt-in is necessary, not sufficient: Home must also admit current source/consent/work policy. */
export function channelMessageExcludedFromAi(metadata: unknown): boolean {
  if (typeof metadata !== "object" || metadata === null) return false;
  const channel = (metadata as Record<string, unknown>).channelIngress;
  if (channel === undefined) return false;
  return typeof channel !== "object" || channel === null || (channel as Record<string, unknown>).aiTransmissionAllowed !== true;
}

export const TELEGRAM_UPDATE_TYPES = ["message", "edited_message", "channel_post", "edited_channel_post"] as const;
/** Shared by the setup form and server; the server remains the sole authority and re-validates everything. */
export const telegramConnectInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  // Held only for one request, then moved into the protected vault; never stored in source config or returned.
  botToken: z.string().regex(/^[0-9]{1,20}:[A-Za-z0-9_-]{1,256}$/),
  projectId: z.number().int().positive().safe(),
  chatId: z.number().int().positive().safe(),
  allowedConversationIds: z.array(conversationId).min(1).max(100),
  allowedUpdateTypes: z.array(z.enum(TELEGRAM_UPDATE_TYPES)).min(1).max(TELEGRAM_UPDATE_TYPES.length).default(["message"]),
  retentionDays: z.number().int().min(1).max(365).default(30),
  allowAiTransmission: z.boolean().default(false),
  allowOutbound: z.boolean().default(false),
  outboundConsent: z.boolean().optional(),
  // Explicit, versioned data-use consent: Telegram content imported into this Chat, optionally AI-visible per policy.
  consent: z.literal(true),
}).strict().superRefine((value, ctx) => {
  if (value.allowOutbound && value.outboundConsent !== true) ctx.addIssue({ code: "custom", path: ["outboundConsent"], message: "Reviewed outbound use requires explicit consent." });
});
export type TelegramConnectInput = z.infer<typeof telegramConnectInputSchema>;

const positiveMessageId = z.number().int().positive().safe();
/** Model input is still only a proposal; the canonical exact grant and current connection are mandatory. */
export const telegramTextInputSchema = z.object({
  connectionId: positiveMessageId,
  reviewBinding: z.string().regex(/^[a-f0-9]{64}$/),
  recipientId: conversationId,
  text: z.string().min(1).max(4_096).refine(text => Boolean(text.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text), "Plain text must be nonempty and contain no control characters."),
  topic: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("forum"), id: positiveMessageId }).strict(),
    z.object({ kind: z.literal("private"), id: positiveMessageId }).strict(),
    z.object({ kind: z.literal("direct_messages"), id: positiveMessageId }).strict(),
  ]).optional(),
  replyToMessageId: positiveMessageId.optional(),
  silent: z.boolean().default(false),
}).strict();
/** Safe owner-only display of the exact reviewed message, never generic tool arguments or credentials. */
export const telegramTextReviewSchema = telegramTextInputSchema.omit({ reviewBinding: true });
