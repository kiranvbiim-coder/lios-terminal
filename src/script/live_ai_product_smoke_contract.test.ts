import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smoke = fs.readFileSync(path.join(srcRoot, "script", "live_ai_product_smoke.ts"), "utf8");
const persistence = fs.readFileSync(path.join(srcRoot, "server", "flagshipArtifactPersistence.test.ts"), "utf8");
const liveFlagship = fs.readFileSync(path.join(srcRoot, "script", "live_flagship_service_journey.ts"), "utf8");
const docs = fs.readFileSync(path.join(srcRoot, "..", "docs", "technical", "LIVE_AI_PRODUCT_ACCEPTANCE.md"), "utf8");

test("live AI service acceptance cannot pass after provider verification alone", () => {
  assert.match(smoke, /verifyAIProviderConnection/);
  assert.match(smoke, /for \(const \[index, scopeCase\] of scopes\.entries\(\)\)/);
  assert.match(smoke, /verifyConversationScope\(scopeCase, verification\)/);
  assert.match(smoke, /assert\.equal\(receipts\.length, scopes\.length\)/);
  assert.match(smoke, /temporary/);
  assert.match(smoke, /quick/);
  assert.match(smoke, /project/);
  const passIndex = smoke.lastIndexOf("LIVE_AI_SERVICE_SMOKE: PASS");
  const loopIndex = smoke.indexOf("verifyConversationScope(scopeCase, verification)");
  assert.ok(loopIndex >= 0 && passIndex > loopIndex, "PASS marker must occur only after governed conversation scopes execute.");
});

test("live AI acceptance pins Conversation Runtime to verified provider and model", () => {
  assert.match(smoke, /preferredProvider: verification\.provider/);
  assert.match(smoke, /preferredModel: verification\.model/);
  assert.match(smoke, /sourceRefs\.includes\("ai-provider:" \+ verification\.provider\)/);
  assert.match(smoke, /resultEvent\.summary/);
  assert.match(smoke, /projectInstructionsTransmittedOnlyInProjectScope: true/);
  assert.match(smoke, /credentialMaterialLogged: false/);
});

test("offline flagship proof covers Artifact lifecycle and restart recovery", () => {
  for (const marker of [
    "keepConversationDraft",
    "decideArtifactProposal",
    "getArtifactExportPlan",
    "await closeDb();",
    "await initDb();",
    "reopenedProject",
    "reopenedArtifact",
    "otherTenant",
  ]) {
    assert.ok(persistence.includes(marker), "offline flagship persistence proof missing: " + marker);
  }
});

test("documentation does not overclaim service smoke as packaged acceptance", () => {
  assert.match(docs, /does not.*packaged Electron app/is);
  assert.match(docs, /does not satisfy live AI product acceptance/i);
  assert.match(docs, /real user-controlled credential/i);
});


test("combined live flagship service journey links real AI to durable Project work", () => {
  for (const marker of [
    "verifyAIProviderConnection",
    "preferredProvider: verification.provider",
    "preferredModel: verification.model",
    "keepConversationDraft",
    "getArtifactExportPlan",
    "await closeDb();",
    "await initDb();",
    "reopenedMessages",
    "reopenedArtifact",
    "LIVE_FLAGSHIP_SERVICE_JOURNEY: PASS",
  ]) {
    assert.ok(liveFlagship.includes(marker), "combined live flagship proof missing: " + marker);
  }
  assert.match(liveFlagship, /credentialMaterialLogged: false/);
});
