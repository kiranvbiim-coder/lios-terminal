import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ARTIFACT_REVISION_POLICY,
  OBSERVATION_TRUTH_POLICY,
  PROACTIVITY_POLICY,
  TERMINAL_CONVERGENCE_LOOP,
  WORKING_CONTEXT_POLICY,
  artifactRevisionPolicySchema,
  proactivityPolicySchema,
  workingContextPolicySchema,
  CONVERSATION_SCOPE_POLICIES,
  cloudTransmissionConsentSchema,
  conversationScopePolicySchema,
  citedAssertionSchema,
  memoryItemSchema,
  pendingSetupContinuationSchema,
} from "../../../shared/terminalConvergenceContracts";

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.resolve(clientRoot, "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
const uiSources = [...walk(path.join(clientRoot, "components")), ...walk(path.join(clientRoot, "pages"))]
  .map((file) => ({ file: path.relative(srcRoot, file), text: fs.readFileSync(file, "utf8") }));

const shell = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const projectHome = read("client/src/components/terminal/ProjectHome.tsx");
const roadmap = read("../docs/LIOS_EXECUTION_ROADMAP.md");

test("TC-01 loop: PROJECT → CHAT → INTENT → ROUTE → COMPUTE → EXPLAIN → ARTIFACT → NEXT ACTION matches the canonical roadmap", () => {
  const loop = TERMINAL_CONVERGENCE_LOOP.map((stage) => stage.replace("_", " ").toUpperCase()).join(" → ");
  assert.ok(roadmap.includes(loop), `roadmap §0.0.1 must state the locked loop: ${loop}`);
});


test("TC-01 hidden Working Context and no required active-entity selector", () => {
  assert.equal(WORKING_CONTEXT_POLICY.userVisibleInspector, false);
  assert.equal(WORKING_CONTEXT_POLICY.activeEntitySelector, false);
  assert.throws(() => workingContextPolicySchema.parse({ ...WORKING_CONTEXT_POLICY, userVisibleInspector: true }));
  for (const { file, text } of uiSources) {
    assert.doesNotMatch(text, />[^<{]*Working Context[^<{]*</i, `${file} must not render a Working Context inspector`);
    assert.doesNotMatch(text, /aria-label="(Active|Select) (entity|security|ticker)"|>\s*Active (entity|security)\s*</i, `${file} must not render a required active-entity selector`);
  }
});

test("TC-01 one LiOS identity: specialist agents never appear as visible personalities", () => {
  for (const { file, text } of uiSources) {
    assert.doesNotMatch(text, /\b(Valuation|Research|Portfolio|Risk|Data|Macro|Quant) (Agent|Analyst Bot|Copilot)\b/, `${file} exposes a specialist agent persona`);
  }
  assert.match(shell, /aria-label="Ask LiOS"/, "the conversation entry must address LiOS");
});

test("TC-01 Project Home is the rich adaptive surface; global/new chat stays minimal", () => {
  for (const module of ["What changed", "Recent chats", "Artifacts"]) {
    assert.match(projectHome, new RegExp(module, "i"), `Project Home missing rich module: ${module}`);
  }
  assert.doesNotMatch(projectHome, /Decision (area|board|center)/i, "Project Home must not add a permanent Decision area");
  assert.match(shell, /entrySurface === "project-home" && home \? \(\s*<ProjectHome/, "rich home renders only through the explicit entry-surface rule (see projectEntry.test.ts)");
});

// TC-06 owns the minimal composer. These controls exist today and may only be
// removed or moved behind progressive disclosure; adding a new permanent
// composer control fails this ratchet.
const COMPOSER_TC06_DEBT = [
  'title="Add Project resource"',
  'title="Save Session"',
  'title="Expand this conversation into the professional analytical workspace"',
  'title={speakRepliesEnabled ? "Speak replies: on" : "Speak replies: off"}',
  "title={activeSymbol ? `Ask LiOS about ${activeSymbol}",
  'title="Conversation execution mode"',
];
const COMPOSER_ALLOWED = [
  'aria-label="Ask LiOS"',
  'title={chatMode === "project" && selection.projectId ? "Attach Project files (up to five)" : "Attachments are available in Project chats"}',
  'aria-label="Tools"',
  "title={voiceInputHint}",
  'aria-label={voiceInputAvailable ? (voiceRecorder.isRecording ? "Stop voice recording" : "Speak to LiOS") : "Set up voice input"}',
  'aria-label="Send"',
];

test("TC-01 progressive disclosure: composer controls may only shrink toward Tools/Ask/Voice/Send", () => {
  const start = shell.indexOf('aria-label="Ask LiOS"');
  const end = shell.indexOf('aria-label="Send"', start);
  assert.ok(start >= 0 && end > start, "composer region markers missing");
  const region = shell.slice(start, end + 'aria-label="Send"'.length);
  const controls = [...region.matchAll(/(aria-label|title)=(\{[^}]*\}|"[^"]*")/g)].map((match) => match[0]);
  for (const control of controls) {
    assert.ok(COMPOSER_ALLOWED.includes(control) || COMPOSER_TC06_DEBT.includes(control), `new permanent composer control: ${control}`);
  }
  assert.ok((region.match(/<select/g) ?? []).length <= 1, "composer must not gain more permanent selectors");
  assert.match(shell, /QUICK_COMMANDS/, "advanced operations must stay reachable through command discovery");
});

test("TC-01 high proactivity stays inside permission, budget and governance limits", () => {
  assert.equal(PROACTIVITY_POLICY.level, "high");
  assert.equal(PROACTIVITY_POLICY.consequentialActionsSilent, false);
  assert.equal(PROACTIVITY_POLICY.brokerageExecution, false);
  assert.throws(() => proactivityPolicySchema.parse({ ...PROACTIVITY_POLICY, backgroundByoaiRequiresBudget: false }));
  assert.match(read("shared/p9AutomationContracts.ts"), /cooldownMinutes/, "automation must retain cooldown controls");
});

test("TC-01 living Artifacts append immutable revisions and keep the trust triad", () => {
  assert.equal(ARTIFACT_REVISION_POLICY.overwriteHistory, false);
  assert.throws(() => artifactRevisionPolicySchema.parse({ ...ARTIFACT_REVISION_POLICY, overwriteHistory: true }));
  assert.match(read("shared/schemaProjects.ts"), /parentVersionId: text\("parent_version_id"\)/);
  for (const file of fs.readdirSync(path.join(srcRoot, "server")).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
    assert.doesNotMatch(read(`server/${file}`), /\.update\(projectArtifactVersions\)/, `server/${file} must not mutate an Artifact version in place`);
  }
  const artifactPane = read("client/src/components/terminal/ArtifactPane.tsx");
  assert.match(artifactPane, /Show Work/);
  assert.match(artifactPane, /executionReceiptIds/);
});

test("TC-01 no fabricated observations: data gaps are structured and the public preview is non-executable", () => {
  assert.equal(OBSERVATION_TRUTH_POLICY.inventedValues, false);
  assert.match(read("shared/conversationRuntime.ts"), /type: z\.literal\("data_gap"\)/);
  assert.match(read("server/conversationRuntime.ts"), /LiOS did not invent the missing observations/);
  assert.match(read("client/src/components/terminal/ConversationRuntimeTrace.tsx"), /Data unavailable — no value invented/);
  const preview = read("client/src/pages/PublicProductPreview.tsx");
  assert.doesNotMatch(preview, /fetch\(|Math\.random/);
  assert.match(preview, /Not a live calculation or\s+source receipt/);
});

// Roadmap §0.0.12 reconciliation: interfaces TC-02 and later tasks implement against.
test("§0.0.12 scope: Quick and Project retrieve across permitted sources; Temporary never inherits or remembers", () => {
  assert.equal(CONVERSATION_SCOPE_POLICIES.quick.retrieval, "all_permitted_sources");
  assert.equal(CONVERSATION_SCOPE_POLICIES.project.retrieval, "all_permitted_sources");
  for (const policy of Object.values(CONVERSATION_SCOPE_POLICIES)) {
    assert.equal(policy.crossTenant, false);
    assert.equal(policy.mutateOtherProjects, false);
    assert.equal(policy.explicitExclusionsAuthoritative, true);
  }
  const temporary = CONVERSATION_SCOPE_POLICIES.temporary;
  for (const leak of [{ durableMemory: true }, { inheritsPrivateContext: true }, { retrieval: "all_permitted_sources" }]) {
    assert.equal(conversationScopePolicySchema.safeParse({ ...temporary, ...leak }).success, false, JSON.stringify(leak));
  }
});

const memory = {
  id: "m1", origin: "inferred", scope: "project", projectId: 7, sourceConversationScope: "project", kind: "assumption",
  content: "Prefers a 9% WACC for European industrials.", confidence: 0.6, revision: 1, createdAt: "2026-10-02T09:00:00Z", financialEvidence: false,
};

test("§0.0.12 memory: never from Temporary chats, never evidence, never a secret, Project-bound when Project-scoped", () => {
  assert.equal(memoryItemSchema.safeParse(memory).success, true);
  assert.equal(memoryItemSchema.safeParse({ ...memory, sourceConversationScope: "temporary" }).success, false);
  assert.equal(memoryItemSchema.safeParse({ ...memory, financialEvidence: true }).success, false);
  assert.equal(memoryItemSchema.safeParse({ ...memory, projectId: null }).success, false);
  assert.equal(memoryItemSchema.safeParse({ ...memory, scope: "user" }).success, false);
  for (const secret of ["key sk-abcdefghijklmnopqrstuv", "api_key=abc123", "AKIAABCDEFGHIJKLMNOP", "Authorization: Bearer abcdefghijklmnopqrstu"]) {
    assert.equal(memoryItemSchema.safeParse({ ...memory, content: secret }).success, false, secret);
  }
});

test("§0.0.12 consent: initial consent covers relevant excerpts without routine prompts and cannot be revoked before grant", () => {
  const consent = { consentId: "c1", grantedAt: "2026-10-02T09:00:00Z", scope: "relevant_excerpts", approvedProviders: ["anthropic"], sourceRestrictionsOverride: true, routinePrompting: false };
  assert.equal(cloudTransmissionConsentSchema.safeParse(consent).success, true);
  assert.equal(cloudTransmissionConsentSchema.safeParse({ ...consent, sourceRestrictionsOverride: false }).success, false);
  assert.equal(cloudTransmissionConsentSchema.safeParse({ ...consent, revokedAt: "2026-10-01T09:00:00Z" }).success, false);
});

test("§0.0.12 evidence: a supported assertion must cite evidence", () => {
  assert.equal(citedAssertionSchema.safeParse({ text: "Revenue grew 4.1%.", kind: "fact", evidenceIds: [], supportState: "supported" }).success, false);
  assert.equal(citedAssertionSchema.safeParse({ text: "Revenue grew 4.1%.", kind: "fact", evidenceIds: ["e1"], supportState: "supported" }).success, true);
  assert.equal(citedAssertionSchema.safeParse({ text: "Margins will recover.", kind: "ai_interpretation", evidenceIds: [], supportState: "not_checked" }).success, true);
});

test("§0.0.12 setup continuation: a pending request resumes exactly once and only when ready", () => {
  const pending = { requestId: "r1", conversationScope: "quick", chatId: 3, prompt: "Compare MSFT and GOOGL", requiredCapability: "ai.completion", capabilityState: "finish_setup", createdAt: "2026-10-02T09:00:00Z", resumeCount: 0 };
  assert.equal(pendingSetupContinuationSchema.safeParse(pending).success, true);
  assert.equal(pendingSetupContinuationSchema.safeParse({ ...pending, resumeCount: 1, resumedAt: "2026-10-02T09:01:00Z" }).success, false);
  assert.equal(pendingSetupContinuationSchema.safeParse({ ...pending, capabilityState: "ready", resumeCount: 1, resumedAt: "2026-10-02T09:01:00Z" }).success, true);
  assert.equal(pendingSetupContinuationSchema.safeParse({ ...pending, capabilityState: "ready", resumeCount: 2, resumedAt: "2026-10-02T09:01:00Z" }).success, false);
  assert.equal(pendingSetupContinuationSchema.safeParse({ ...pending, chatId: null }).success, false);
});
