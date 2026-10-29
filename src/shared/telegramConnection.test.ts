import assert from "node:assert/strict";
import test from "node:test";
import { channelMessageExcludedFromAi, parseTelegramSourceConfig, telegramAutoRunPolicySchema, telegramConnectInputSchema, telegramConnectionPolicySchema, telegramExecutionConsentScope, telegramSourceConfig, TELEGRAM_EXECUTION_CONSENT_VERSION } from "./telegramConnection";

test("imported channel text is model input only with explicit adoption-time AI permission", () => {
  assert.equal(channelMessageExcludedFromAi({}), false, "ordinary Chat history is unchanged");
  assert.equal(channelMessageExcludedFromAi({ channelIngress: { aiTransmissionAllowed: true } }), false);
  for (const metadata of [{ channelIngress: {} }, { channelIngress: { aiTransmissionAllowed: false } }, { channelIngress: { aiTransmissionAllowed: "true" } }, { channelIngress: null }, { channelIngress: "x" }]) {
    assert.equal(channelMessageExcludedFromAi(metadata), true, JSON.stringify(metadata));
  }
});

test("saved Telegram source metadata is strict and contains no credential material", () => {
  const policy = { version: "lios-telegram-connection/1" as const, accountBindingId: crypto.randomUUID(), enabled: true, projectId: 1, chatId: 2, allowedConversationIds: ["123"], allowedUpdateTypes: ["message"], retentionDays: 7, allowAiTransmission: false, allowOutbound: false };
  assert.deepEqual(Object.keys(telegramSourceConfig(policy)).sort(), ["channelPolicy", "endpoint"]);
  assert.throws(() => telegramSourceConfig({ ...policy, token: "123:secret" } as never));
  assert.throws(() => telegramSourceConfig({ ...policy, allowedConversationIds: ["123", "123"] }));
});

test("incoming execution is off for legacy policies and has explicit actors and bounded defaults", () => {
  const policy = { version: "lios-telegram-connection/1" as const, accountBindingId: crypto.randomUUID(), enabled: true, projectId: 1, chatId: 2, allowedConversationIds: ["123"], allowedUpdateTypes: ["message"], retentionDays: 7, allowAiTransmission: false, allowOutbound: false };
  assert.equal(parseTelegramSourceConfig(telegramSourceConfig(policy)).autoRun, undefined);
  const autoRun = telegramAutoRunPolicySchema.parse({ enabled: true, allowedSenderRefs: ["user:7", "chat:-42"] });
  assert.deepEqual(autoRun, { enabled: true, allowedSenderRefs: ["user:7", "chat:-42"], maxRunsPerHour: 2, maxRunsPerDay: 10, maxAiCalls: 2, maxSteps: 4, maxDurationMs: 60_000 });
  assert.equal(TELEGRAM_EXECUTION_CONSENT_VERSION, "telegram-incoming-execution/1");
  assert.equal(telegramExecutionConsentScope(policy.accountBindingId), `channel:telegram:${policy.accountBindingId}:execution`);
  for (const patch of [{ allowedSenderRefs: [] }, { allowedSenderRefs: ["user:0"] }, { allowedSenderRefs: ["chat:0"] }, { allowedSenderRefs: ["user:-1"] }, { allowedSenderRefs: ["user:7", "user:7"] }, { maxRunsPerHour: 13 }, { maxRunsPerDay: 101 }, { maxAiCalls: 5 }, { maxSteps: 9 }, { maxDurationMs: 999 }, { maxDurationMs: 120_001 }]) {
    assert.equal(telegramAutoRunPolicySchema.safeParse({ ...autoRun, ...patch }).success, false, JSON.stringify(patch));
  }
  assert.equal(telegramConnectionPolicySchema.safeParse({ ...policy, autoRun }).success, false, "AI visibility is a prerequisite, not an implicit grant");
  const input = { name: "Bot", botToken: "123:synthetic", projectId: 1, chatId: 2, allowedConversationIds: ["123"], consent: true, allowAiTransmission: true, autoRun };
  assert.equal(telegramConnectInputSchema.safeParse(input).success, false, "import consent is not execution consent");
  assert.equal(telegramConnectInputSchema.safeParse({ ...input, autoRunConsent: true }).success, true);
  assert.equal(telegramConnectInputSchema.safeParse({ ...input, autoRunConsent: true, allowAiTransmission: false }).success, false);
});
