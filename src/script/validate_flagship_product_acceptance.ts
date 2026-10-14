import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readQualificationWorkflow } from "./source_distribution";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.resolve(root, file), "utf8");

const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
const smoke = read("script/live_ai_product_smoke.ts");
const persistence = read("server/flagshipArtifactPersistence.test.ts");
const providerVerification = read("server/aiProviderVerification.ts");
const liveFlagship = read("script/live_flagship_service_journey.ts");
const packagedFlagship = read("script/validate_packaged_flagship_evidence.ts");
const packagedFlagshipSchema = read("shared/flagshipReleaseEvidence.ts");
const docs = read("../docs/technical/LIVE_AI_PRODUCT_ACCEPTANCE.md");
const quality = readQualificationWorkflow(path.resolve(root, ".."), "lios-hardening.yml");

for (const scope of ["temporary", "quick", "project"]) {
  assert.ok(smoke.includes(`scope: "${scope}"`), "Live flagship smoke is missing scope " + scope + ".");
}
assert.ok(smoke.includes("verifyAIProviderConnection"), "Live flagship smoke must verify the selected provider/model first.");
assert.ok(smoke.includes("verifyConversationScope(scopeCase, verification)"), "Live flagship smoke must execute the governed Conversation Runtime after verification.");
assert.ok(smoke.includes("receipts.length, scopes.length"), "Live flagship smoke must account for every requested scope receipt.");
assert.ok(smoke.includes("LIVE_AI_SERVICE_SMOKE: PASS"), "Live flagship smoke needs a stable success marker.");
assert.ok(providerVerification.includes("dataClassification: \"public\""), "Connectivity verification must remain public-data only.");
assert.ok(providerVerification.includes("maxTokens: 16"), "Connectivity verification must remain a tiny bounded request.");
for (const required of [
  "verifyAIProviderConnection",
  "preferredProvider: verification.provider",
  "keepConversationDraft",
  "getArtifactExportPlan",
  "reopenedMessages",
  "reopenedArtifact",
  "LIVE_FLAGSHIP_SERVICE_JOURNEY: PASS",
]) {
  assert.ok(liveFlagship.includes(required), "Combined live flagship service journey is missing " + required + ".");
}

for (const marker of [
  "keepConversationDraft",
  "decideArtifactProposal",
  "getArtifactExportPlan",
  "await closeDb();",
  "await initDb();",
  "reopenedArtifact",
]) {
  assert.ok(persistence.includes(marker), "Offline flagship lifecycle proof missing " + marker + ".");
}

assert.match(docs, /service-smoke-only pass does not satisfy live AI product acceptance/i);
assert.match(docs, /packaged desktop build must prove/i);
assert.ok(packageJson.scripts["smoke:ai:live"], "smoke:ai:live command is missing.");
assert.ok(packageJson.scripts["test:flagship"], "test:flagship command is missing.");
assert.ok(packageJson.scripts["acceptance:flagship"], "acceptance:flagship command is missing.");
assert.ok(packageJson.scripts["acceptance:flagship:live-service"], "combined live flagship service command is missing.");
assert.ok(packageJson.scripts["acceptance:flagship:packaged"], "packaged flagship release evidence command is missing.");
for (const marker of [
  "realUserOwnedAiCredential",
  "nativeSecretCustody",
  "realUserControlledDataSource",
  "deterministicExecutionObserved",
  "aiSynthesisObserved",
  "executionReceiptInspected",
  "provenanceInspected",
  "artifactRevisionApplied",
  "desktopRelaunchCompleted",
  "revokedAccessFailsClosed",
  "serviceOnlyExecution",
  "mockOrFixtureDataUsed",
  "developerInterventionRequired",
]) {
  assert.ok(packagedFlagshipSchema.includes(marker), "Packaged flagship schema is missing " + marker + ".");
}
assert.ok(packagedFlagship.includes("PACKAGED_FLAGSHIP_RELEASE_EVIDENCE: PASS"), "Packaged flagship validator needs a stable success marker.");
assert.ok(packagedFlagship.includes('category: "flagship"'), "Packaged flagship validator must emit the existing P14 flagship evidence category.");
assert.ok(quality.includes("npm run acceptance:flagship"), "Authoritative Quality Gate must retain flagship source acceptance.");

console.log(JSON.stringify({
  program: "LiOS Flagship Product Journey",
  sourceControlledProof: "PASS",
  liveAIServiceSmoke: "MANUAL_REAL_KEY_REQUIRED",
  combinedLiveServiceJourney: "MANUAL_REAL_KEY_REQUIRED",
  packagedDesktopFlagship: "STRICT_MULTI_PLATFORM_RELEASE_REPORT_REQUIRED",
  requiredLiveScopes: ["temporary", "quick", "project"],
  offlineLifecycle: ["conversation", "artifact_keep", "review_edit", "export_plan", "restart_reopen", "tenant_isolation"],
}, null, 2));
