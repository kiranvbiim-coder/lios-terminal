import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const connectionCenter = fs.readFileSync(new URL("../pages/DataConnectionCenter.tsx", import.meta.url), "utf8");
const masterAiSettings = fs.readFileSync(new URL("../components/settings/MasterAiSettings.tsx", import.meta.url), "utf8");

test("complete model discovery mismatch is wired into both Master AI and setup persistence", () => {
  assert.ok(connectionCenter.includes("resolveAiModelAccess"), "Connection Center must derive one canonical model-access state.");
  assert.ok(connectionCenter.includes('modelAccess={aiModelAccess}'), "Master AI must receive the canonical model-access state.");
  assert.ok(connectionCenter.includes("Boolean(aiProviderId) && aiModelBlocked"), "setup exits must fail closed while a complete discovery mismatch remains.");
  assert.ok(connectionCenter.includes("this setup cannot be saved"), "the mismatch must be actionable in the UI.");
  assert.ok(masterAiSettings.includes('modelAccess === "blocked"'), "Master AI must block a model rejected by complete discovery.");
  assert.ok(masterAiSettings.includes('saveMutation.mutate("off")'), "an already-enabled Master AI state must attempt to turn off when the selected model becomes blocked.");
  assert.ok(masterAiSettings.includes("forcedOffAttemptRef"), "forced-off recovery must be bounded to one attempt per blocked model, not a retry loop.");
  assert.ok(connectionCenter.includes("modelDiscoveryComplete") && connectionCenter.includes("verifiedAiModels ?? []"), "complete discovery must not fall back to curated models the provider did not return.");
});

test("partial model discovery remains non-authoritative for absent models", () => {
  assert.ok(connectionCenter.includes("modelDiscoveryPartial"), "Connection Center must preserve the partial-discovery distinction.");
  assert.ok(connectionCenter.includes("A model missing here is not evidence that this key lacks access"), "partial discovery must not be presented as a block.");
});
