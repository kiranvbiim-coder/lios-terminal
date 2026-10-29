import { telegramConnectInputSchema, type TelegramConnectInput } from "@shared/telegramConnection";

export interface TelegramConnectForm {
  name: string;
  botToken: string;
  projectId: number | null;
  chatId: number | null;
  conversationIds: string;
  retentionDays: string;
  allowAiTransmission: boolean;
  consent: boolean;
}

/** Returns a request only when every explicit requirement is met; the server remains the authority. */
export function buildTelegramConnectRequest(form: TelegramConnectForm): { request: TelegramConnectInput } | { error: string } {
  if (!form.consent) return { error: "Confirm the data-use statement to connect Telegram." };
  if (form.projectId === null || form.chatId === null) return { error: "Choose the Project and Project Chat that will receive imported messages." };
  const ids = form.conversationIds.split(/[\s,;]+/).filter(Boolean);
  if (!ids.length) return { error: "Enter at least one Telegram chat ID to allow." };
  const retentionDays = Number(form.retentionDays);
  const parsed = telegramConnectInputSchema.safeParse({
    name: form.name.trim(), botToken: form.botToken.trim(), projectId: form.projectId, chatId: form.chatId,
    allowedConversationIds: [...new Set(ids)], retentionDays: Number.isFinite(retentionDays) ? retentionDays : 0,
    allowAiTransmission: form.allowAiTransmission, consent: true,
  });
  return parsed.success ? { request: parsed.data } : { error: "Check the bot token format, name, chat IDs (non-zero integers) and retention (1–365 days)." };
}
