import { z } from "zod";

export const TELEGRAM_CONNECTION_CONSENT_VERSION = "telegram-channel-data/1";
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

/** Imported channel text is never model input unless its source policy explicitly allowed AI transmission when adopted. */
export function channelMessageExcludedFromAi(metadata: unknown): boolean {
  if (typeof metadata !== "object" || metadata === null) return false;
  const channel = (metadata as Record<string, unknown>).channelIngress;
  if (channel === undefined) return false;
  return typeof channel !== "object" || channel === null || (channel as Record<string, unknown>).aiTransmissionAllowed !== true;
}
