import { telegramConnectInputSchema, type TelegramConnectInput } from "@shared/telegramConnection";

export interface TelegramConnectForm {
  name: string;
  botToken: string;
  projectId: number | null;
  chatId: number | null;
  conversationIds: string;
  retentionDays: string;
  allowAiTransmission: boolean;
  allowOutbound: boolean;
  outboundConsent: boolean;
  autoRunEnabled: boolean;
  autoRunSenderRefs: string;
  autoRunMaxRunsPerHour: string;
  autoRunMaxRunsPerDay: string;
  autoRunMaxAiCalls: string;
  autoRunMaxSteps: string;
  autoRunMaxDurationSeconds: string;
  autoRunConsent: boolean;
  consent: boolean;
}

/** Returns a request only when every explicit requirement is met; the server remains the authority. */
export function buildTelegramConnectRequest(form: TelegramConnectForm): { request: TelegramConnectInput } | { error: string } {
  if (!form.consent) return { error: "Confirm the data-use statement to connect Telegram." };
  if (form.allowOutbound && !form.outboundConsent) return { error: "Confirm exact-reviewed outbound consent before enabling replies." };
  if (form.autoRunEnabled && !form.allowAiTransmission) return { error: "Allow AI model context before enabling automatic incoming work." };
  if (form.autoRunEnabled && !form.autoRunConsent) return { error: "Confirm separate incoming AI execution consent." };
  if (form.projectId === null || form.chatId === null) return { error: "Choose the Project and Project Chat that will receive imported messages." };
  const ids = form.conversationIds.split(/[\s,;]+/).filter(Boolean);
  if (!ids.length) return { error: "Enter at least one Telegram chat ID to allow." };
  const retentionDays = Number(form.retentionDays);
  const parsed = telegramConnectInputSchema.safeParse({
    name: form.name.trim(), botToken: form.botToken.trim(), projectId: form.projectId, chatId: form.chatId,
    allowedConversationIds: [...new Set(ids)], retentionDays: Number.isFinite(retentionDays) ? retentionDays : 0,
    // Import edits to allowed messages too; edits do not opt into AI execution or outbound replies.
    allowedUpdateTypes: ["message", "edited_message"],
    allowAiTransmission: form.allowAiTransmission, consent: true,
    allowOutbound: form.allowOutbound, outboundConsent: form.outboundConsent,
    autoRun: form.autoRunEnabled ? {
      enabled: true, allowedSenderRefs: [...new Set(form.autoRunSenderRefs.split(/[\s,;]+/).filter(Boolean))],
      maxRunsPerHour: Number(form.autoRunMaxRunsPerHour), maxRunsPerDay: Number(form.autoRunMaxRunsPerDay),
      maxAiCalls: Number(form.autoRunMaxAiCalls), maxSteps: Number(form.autoRunMaxSteps),
      maxDurationMs: Number(form.autoRunMaxDurationSeconds) * 1_000,
    } : undefined,
    autoRunConsent: form.autoRunEnabled && form.autoRunConsent,
  });
  return parsed.success ? { request: parsed.data } : { error: "Check the token format, name, chat IDs, retention (1–365 days), explicit user:/chat: actors and incoming work limits (hour 1–12, day 1–100, AI calls 1–4, steps 1–8, duration 1–120 seconds)." };
}
