import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { canonicalPluginPayload, liosPluginManifestV1Schema } from "@shared/pluginSdk";
import { RuntimeRegistry } from "@shared/runtimeRegistry";
import {
  FIRST_PARTY_SKILL_PLUGIN_ID,
  SkillBridgeError,
  firstPartySkillPluginManifest,
  skillManifestToPluginSkill,
} from "@shared/skillPluginBridge";
import { FIRST_PARTY_SKILL_PACKS } from "@shared/waveEContracts";
import { z } from "zod";
import { proposeGovernedToolOperation, resolveGovernedToolOperation, reviewGovernedToolOperation } from "./conversationGrantStore";
import { getConversationTool, registerConversationTool } from "./conversationRuntime";
import { GovernedToolApprovalRequiredError, type GovernedToolCall } from "./governedTools";
import { P13PluginManager } from "./p13PluginManager";
import { PluginTrustStore, computePluginPackageDigest, signPluginManifest } from "./p13PluginTrust";
import { SkillNotAvailableError, SkillToolNotDeclaredError, createSkillRunner } from "./skillRunner";

function trustedPackage(manifest: Record<string, unknown>) {
  const pair = crypto.generateKeyPairSync("ed25519");
  const trust = new PluginTrustStore();
  trust.trustKey("lios.release", pair.publicKey);
  const parsed = liosPluginManifestV1Schema.parse(manifest);
  const observedPackageDigest = computePluginPackageDigest(Buffer.from(parsed.id + "@" + parsed.version));
  return {
    trust,
    pkg: { manifest: signPluginManifest(parsed, "lios.release", pair.privateKey, observedPackageDigest), observedPackageDigest },
  };
}

/** The canonical authority refuses a forged, copied or mismatched authorization (ConversationGrantError) or requires a fresh one. */
const refused = (error: unknown): boolean => error instanceof GovernedToolApprovalRequiredError || (error instanceof Error && error.name === "ConversationGrantError");

const SAAS = "first-party.saas-valuation";

test("first-party Wave E skill packs bridge into a valid declarative P13 manifest with no implicit tool access", () => {
  const manifest = liosPluginManifestV1Schema.parse(firstPartySkillPluginManifest());
  assert.equal(manifest.id, FIRST_PARTY_SKILL_PLUGIN_ID);
  assert.equal(manifest.runtime.kind, "declarative");
  assert.deepEqual(manifest.permissions, []);
  assert.deepEqual(manifest.skills.map((skill) => skill.id), FIRST_PARTY_SKILL_PACKS.map((pack) => pack.id));
  for (const [index, skill] of manifest.skills.entries()) {
    const pack = FIRST_PARTY_SKILL_PACKS[index]!;
    assert.deepEqual(skill.requiredInputs, pack.requiredInputs);
    assert.deepEqual(skill.capabilities, pack.requiredCapabilities);
    assert.deepEqual(skill.supportedObjectKinds, pack.supportedObjectKinds);
    assert.deepEqual(skill.toolIds, [], "legacy capability labels must not be guessed into tool access");
  }
  const withTools = liosPluginManifestV1Schema.parse(firstPartySkillPluginManifest({ toolIdsBySkill: { [SAAS]: ["lios.market-data"] } }));
  assert.deepEqual(withTools.skills.find((skill) => skill.id === SAAS)?.toolIds, ["lios.market-data"]);
});

test("only approved first-party skills can be bridged", () => {
  const base = FIRST_PARTY_SKILL_PACKS[0]!;
  assert.throws(() => skillManifestToPluginSkill({ ...base, firstParty: false }), SkillBridgeError);
  assert.throws(() => skillManifestToPluginSkill({ ...base, approval: "pending" }), SkillBridgeError);
  assert.throws(() => skillManifestToPluginSkill({ ...base, approval: "blocked" }), SkillBridgeError);
});

test("skill contributions are validated like every other P13 contribution", () => {
  const base = firstPartySkillPluginManifest() as { skills: Array<Record<string, unknown>> };
  const duplicateTool = { ...base, skills: [{ ...base.skills[0], toolIds: ["lios.market-data", "lios.market-data"] }] };
  assert.throws(() => liosPluginManifestV1Schema.parse(duplicateTool), /unique/);
  const colliding = { ...base, skills: [base.skills[0], { ...base.skills[1], componentId: base.skills[0]!.componentId }] };
  assert.throws(() => liosPluginManifestV1Schema.parse(colliding), /componentIds must be globally unique/);
});

test("an empty skills list is not part of the signed form, so manifests signed before skills existed still verify", () => {
  const legacy = liosPluginManifestV1Schema.parse({
    apiVersion: "1", id: "com.example.legacy", name: "Legacy", version: "1.0.0", publisher: "Example",
    lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: null },
    runtime: { kind: "declarative", entrypoint: null },
  });
  assert.equal(canonicalPluginPayload(legacy).includes('"skills"'), false);
  const withSkills = liosPluginManifestV1Schema.parse(firstPartySkillPluginManifest());
  assert.equal(canonicalPluginPayload(withSkills).includes('"skills"'), true);
});

test("P13 installs skills only from a trusted publisher and registers declarative skill adapters", () => {
  const raw = firstPartySkillPluginManifest({ toolIdsBySkill: { [SAAS]: ["lios.market-data"] } });
  const unsigned = new P13PluginManager(new RuntimeRegistry(), new PluginTrustStore(), "1.0.0");
  assert.throws(() => unsigned.install({ manifest: raw }), /Skills require a trusted publisher/);

  const { trust, pkg } = trustedPackage(raw);
  const registry = new RuntimeRegistry();
  const manager = new P13PluginManager(registry, trust, "1.0.0");
  const snapshot = manager.install(pkg);
  assert.equal(snapshot.trust.state, "trusted");
  const descriptors = registry.list("skill");
  assert.deepEqual(descriptors.map((item) => item.id).sort(), FIRST_PARTY_SKILL_PACKS.map((pack) => pack.id).sort());
  for (const descriptor of descriptors) {
    assert.deepEqual(descriptor.executionScopes, ["declarative"]);
    assert.equal(descriptor.lifecycle, "external");
  }
  assert.equal(manager.remove(FIRST_PARTY_SKILL_PLUGIN_ID), true);
  assert.deepEqual(registry.list("skill"), []);
});

test("skill runner invokes only declared tools, only for installed skills, and delegates to the governed invoker", async () => {
  const { trust, pkg } = trustedPackage(firstPartySkillPluginManifest({ toolIdsBySkill: { [SAAS]: ["lios.market-data"] } }));
  const registry = new RuntimeRegistry();
  const manager = new P13PluginManager(registry, trust, "1.0.0");
  manager.install(pkg);
  const calls: Array<{ toolId: string; input: Record<string, unknown>; signal: AbortSignal }> = [];
  const trusted: GovernedToolCall = { source: "agent", requestId: "55555555-5555-4555-8555-555555555555", userId: 5, role: "internal_analyst" };
  const seenCalls: GovernedToolCall[] = [];
  const runner = createSkillRunner(registry, () => trusted, async (toolId, input, signal, call) => {
    calls.push({ toolId, input, signal });
    seenCalls.push(call);
    return { ok: true };
  });
  const signal = new AbortController().signal;

  assert.deepEqual(await runner.invokeSkillTool({ skillId: SAAS, toolId: "lios.market-data", input: { symbol: "X" }, signal }), { ok: true });
  assert.deepEqual(calls.map((call) => call.toolId), ["lios.market-data"]);
  assert.equal(calls[0]!.signal, signal);
  assert.equal(seenCalls[0], trusted, "the trusted call is server-injected; the skill supplies only tool and input");

  await assert.rejects(runner.invokeSkillTool({ skillId: SAAS, toolId: "lios.finance.technical", input: {}, signal }), SkillToolNotDeclaredError);
  await assert.rejects(runner.invokeSkillTool({ skillId: "first-party.reit", toolId: "lios.market-data", input: {}, signal }), SkillToolNotDeclaredError, "a descriptive skill can invoke nothing");
  await assert.rejects(runner.invokeSkillTool({ skillId: "not.installed", toolId: "lios.market-data", input: {}, signal }), SkillNotAvailableError);
  assert.equal(calls.length, 1);

  assert.equal(runner.getSkill(SAAS)?.definition.toolIds[0], "lios.market-data");
  assert.equal(runner.getSkill("lios.first-party-skills"), null, "the plugin component is not a skill");
  manager.remove(FIRST_PARTY_SKILL_PLUGIN_ID);
  await assert.rejects(runner.invokeSkillTool({ skillId: SAAS, toolId: "lios.market-data", input: {}, signal }), SkillNotAvailableError);
});

test("a skill cannot widen approval: a confirm-class tool needs a canonical GM-11a grant and a live authorization cannot be forged, copied or widened", async () => {
  const toolId = "test.skill.confirm-tool";
  let ran = 0;
  registerConversationTool({
    id: toolId,
    label: "Skill confirm test tool",
    kind: "calculate",
    permissionClass: "user_confirm",
    access: "write",
    sideEffect: "internal_write",
    replaySafe: false,
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ output: z.unknown(), summary: z.string(), deterministic: z.boolean(), sourceRefs: z.array(z.string()) }).strict(),
    cancel: null,
    invoke: async () => {
      ran += 1;
      return { output: "done", summary: "done", deterministic: true, sourceRefs: [] };
    },
  });
  const { trust, pkg } = trustedPackage(firstPartySkillPluginManifest({ toolIdsBySkill: { [SAAS]: [toolId] } }));
  const registry = new RuntimeRegistry();
  new P13PluginManager(registry, trust, "1.0.0").install(pkg);
  const requestId = "66666666-6666-4666-8666-666666666666";
  const tenant = { userId: 5, organizationId: null, role: "internal_analyst" as const };
  const grantUser = { id: 5, organizationId: null, role: "internal_analyst" as const };
  const stepId = "skill-step";
  const toolCallId = "skill-step-call";
  const planHash = "c".repeat(64);
  const runController = new AbortController();
  let authorization: GovernedToolCall["authorization"];
  const base = (): GovernedToolCall => ({
    source: "agent", requestId, userId: 5, projectId: null, chatId: null, stepId, toolCallId, planHash, runSignal: runController.signal,
    tenant, ...(authorization ? { authorization } : {}),
  });
  const runner = createSkillRunner(registry, () => base());
  const signal = new AbortController().signal;

  await assert.rejects(runner.invokeSkillTool({ skillId: SAAS, toolId, input: {}, signal }), GovernedToolApprovalRequiredError, "no grant");
  assert.equal(ran, 0);

  const policy = { permissionClass: "user_confirm" as const, policyRevision: "d".repeat(64) };
  const proposal = await proposeGovernedToolOperation({
    user: grantUser, projectId: null, chatId: null, requestId, stepId, toolCallId, toolId, input: {},
    descriptor: getConversationTool(toolId)!, planHash, policy, currentPolicy: () => policy, runSignal: runController.signal,
  });
  await reviewGovernedToolOperation({ user: grantUser, requestId, reviewId: proposal.reviewId, allow: true, scope: "once" });
  const live = await resolveGovernedToolOperation({ user: grantUser, requestId, reviewId: proposal.reviewId });
  assert.ok(live);

  authorization = { ...live };
  await assert.rejects(runner.invokeSkillTool({ skillId: SAAS, toolId, input: {}, signal }), refused, "a copied authorization is not live");

  const otherRequest = createSkillRunner(registry, () => ({ ...base(), requestId: "77777777-7777-4777-8777-777777777777", authorization: live }));
  await assert.rejects(otherRequest.invokeSkillTool({ skillId: SAAS, toolId, input: {}, signal }), refused, "bound to its request");
  const otherUser = createSkillRunner(registry, () => ({ ...base(), userId: 6, tenant: { ...tenant, userId: 6 }, authorization: live }));
  await assert.rejects(otherUser.invokeSkillTool({ skillId: SAAS, toolId, input: {}, signal }), refused, "bound to its user");
  assert.equal(ran, 0);

  authorization = live;
  const result = await runner.invokeSkillTool({ skillId: SAAS, toolId, input: {}, signal }) as { summary: string };
  assert.equal(result.summary, "done");
  assert.equal(ran, 1);
  await assert.rejects(runner.invokeSkillTool({ skillId: SAAS, toolId, input: {}, signal }), refused, "single use");
  assert.equal(ran, 1);
});
