import assert from "node:assert/strict";
import test from "node:test";
import type { TrustManifest } from "../shared/trustContracts";
import { ownershipMatches } from "../shared/identityContracts";
import { recordedBlockedArtifactSources } from "../shared/artifactExportRights";
import { conversationScopeSchema } from "../shared/conversationRuntime";
import { loadJourneyCases, runJourney } from "../evals/journeys";
import {
  WS64_SCENARIOS, assessWS64Scenario, sourceOnlyWS64Scorecard,
  type WS64ScenarioId,
} from "../evals/ws64ScenarioMatrix";
import { firstUseConnectionState, LIOS_FIRST_USE_CONTRACT } from "../client/src/lib/firstUseJourney";
import { starterPromptsForChatMode } from "../client/src/lib/projectExperienceVisualState";
import { artifactExportDisclosure } from "../client/src/lib/artifactExportDisclosure";
import { workspaceForShare, buildWorkspaceShareUrl, loadWorkspaceFromUrl } from "../client/src/lib/terminalWorkspace";
import { buildArtifactDependencyRefs, artifactReplayDraft } from "../client/src/lib/p4ArtifactWorkspace";
import { conversationSendAvailability, unconfirmedRunRecoveryNotice } from "../client/src/lib/conversationConnectionRecovery";
import { appendConversationPresentationEvent, selectConversationMessageWindow } from "../client/src/lib/conversationRenderBudget";
import { artifactRefreshSpecSchema } from "../shared/artifactContracts";
import type { ConversationRuntimeEvent } from "../shared/conversationRuntime";

const golden = loadJourneyCases();
const journey = (id: string) => {
  const item = golden.find((candidate) => candidate.id === id);
  assert.ok(item, `Missing canonical runtime journey ${id}`);
  return item;
};
const requirePass = async (id: string) => {
  const result = await runJourney(journey(id));
  assert.deepEqual(result.failures, [], `${id}: ${result.failures.join("; ")}`);
  assert.equal(result.passed, true, `${id} failed its real Runtime fixture checks`);
  return result;
};
const sourceStatus = (id: WS64ScenarioId) => assessWS64Scenario(id, {
  sourceVerified: true, installedGateIds: [], ownerSignedOff: false,
});

test("WS64-01 financial flagship: real fixture Runtime keeps receipts/conflicts and refuses invented valuation", async () => {
  const [research, noGuessedValuation] = [await requirePass("JR01"), await requirePass("JR02")];
  assert.ok(research.firstEventMs !== null);
  assert.ok(noGuessedValuation.firstEventMs !== null);
  assert.ok(journey("JR01").expect.trustManifest);
  assert.ok(journey("JR01").expect.minReceipts);
  assert.ok(journey("JR02").expect.textIncludes?.includes("did not invent assumptions"));
  // These fixtures are single-entity, not the live three-company WACC task.
  // A source test may NOT mark the full flagship accepted.
  const evidence = sourceStatus("WS64-01");
  assert.equal(evidence.accepted, false);
  assert.ok(evidence.missingInstalledGates.includes("live_three_entity_comparison"));
  assert.ok(evidence.missingInstalledGates.includes("governed_wacc_revision"));
});

test("WS64-02 domain-neutral first-use: helpful file-oriented AI without a finance-only entry gate", async () => {
  assert.equal(LIOS_FIRST_USE_CONTRACT.connectionsRequiredToEnter, false);
  assert.equal(LIOS_FIRST_USE_CONTRACT.primaryAction, "ask");
  assert.equal(firstUseConnectionState(0), "unconfigured");
  const starters = starterPromptsForChatMode("quick");
  assert.ok(starters.some((item) => /create something/i.test(item.label)));
  assert.ok(starters.some((item) => /explore/i.test(item.label)));
  // This is a genuinely non-financial prompt through the canonical Runtime,
  // with only the provider completion replaced by a labelled fixture. Never
  // use the portfolio/file case as evidence for a general writing experience.
  const result = await runJourney({
    id: "WS64-NONFINANCE",
    prompt: "Draft a friendly agenda for a volunteer community cleanup meeting. Include roles and next actions.",
    aiText: "Volunteer community cleanup meeting agenda: welcome, choose roles, agree on cleanup locations, and assign next actions.",
    expect: {
      textIncludes: ["volunteer community cleanup meeting agenda", "roles", "next actions"],
      forbidToolStarts: ["lios.market-data", "lios.company-intelligence", "lios.instrument-master"],
      artifactTypes: [],
      noErrorEvent: true,
      doneStatus: "completed",
    },
    maxMs: 5000,
    status: "must_pass",
  });
  assert.deepEqual(result.failures, [], `Non-finance Runtime gaps: ${result.failures.join("; ")}`);
  assert.equal(result.passed, true);
  assert.equal(sourceStatus("WS64-02").accepted, false);
});

test("WS64-03 connected sources: only labelled fixtures count as deterministic Runtime proof", async () => {
  const result = await requirePass("JR01");
  const required = journey("JR01").expect.toolStarts ?? [];
  assert.ok(required.includes("lios.market-data"));
  assert.ok(required.includes("lios.company-intelligence"));
  assert.ok(journey("JR01").expect.trustManifest);
  assert.ok(result.passed);
  assert.ok(sourceStatus("WS64-03").missingInstalledGates.includes("real_connected_source"));
});

test("WS64-04 file-to-insight: a missing private upload cannot silently start market-data tools", async () => {
  for (const id of ["JR04", "JR05"]) {
    const caseDef = journey(id);
    assert.ok(caseDef.expect.forbidToolStarts?.includes("lios.market-data"));
    await requirePass(id);
  }
  assert.ok(journey("JR05").expect.textIncludes?.some((value) => /select or attach/.test(value)));
  assert.equal(sourceStatus("WS64-04").accepted, false);
});

test("WS64-05 denial: recorded revocation, tenant ownership and share URL are fail closed", () => {
  const manifest = { evidence: [{
    evidenceId: "frozen-denied", access: { state: "revoked", entitlementRequired: false },
  }] } as unknown as TrustManifest;
  assert.equal(recordedBlockedArtifactSources(manifest), 1);
  const refusal = artifactExportDisclosure(manifest, ["provider:revoked"]);
  assert.equal(refusal.blocked, true);
  assert.match(refusal.note, /Export is blocked/);
  assert.equal(ownershipMatches({ ownerUserId: 2, organizationId: 90 }, { ownerUserId: 2, organizationId: 91 }), false);
  assert.equal(ownershipMatches({ ownerUserId: 2, organizationId: 90 }, { ownerUserId: 3, organizationId: 90 }), false);
  const privateArtifactId = "artifact:123e4567-e89b-42d3-a456-426614174000";
  const workspace = {
    primary: { view: "artifact" as const, symbol: "MSFT", artifact: { projectId: 5, chatId: 7, artifactId: privateArtifactId, version: 9 } },
    secondary: null, focusedPane: "primary" as const,
  };
  const safe = workspaceForShare(workspace);
  assert.deepEqual(safe.primary, { view: "market", symbol: "MSFT" });
  const url = buildWorkspaceShareUrl(workspace, "https://lios.example.test/org/secret?token=private#/chat/7");
  assert.equal(url.includes(privateArtifactId), false);
  assert.equal(url.includes("secret"), false);
  assert.deepEqual(loadWorkspaceFromUrl(new URL(url).search), safe);
  assert.equal(sourceStatus("WS64-05").accepted, false);
});

test("WS64-06 continuity: governed replay retains canonical source scope and never invents a new Artifact", () => {
  const spec = artifactRefreshSpecSchema.parse({
    kind: "conversation",
    sourceScope: "my_data",
    executionMode: "deterministic_first",
    capabilityIds: ["finance.dcf"],
    message: "Recheck this Artifact using the recorded financial source after I review assumptions.",
  });
  const sourceRefs = ["provider:sec_edgar", "artifact:123e4567-e89b-42d3-a456-426614174000@v2"];
  const dependencies = buildArtifactDependencyRefs({ sourceRefs, capabilityIds: spec.capabilityIds });
  assert.ok(sourceRefs.every((source) => dependencies.includes(source)));
  assert.ok(dependencies.includes("capability:finance.dcf"));
  const replay = artifactReplayDraft("Saved valuation", spec);
  assert.equal(replay.sourceScope, "my_data");
  assert.equal(replay.executionMode, "deterministic_first");
  assert.equal(replay.message, spec.message);
  // The separate real DB lifecycle suite flagshipArtifactPersistence.test.ts
  // covers same-ID and v2 reopen across closeDb/initDb; required in WS-64 gate.
  assert.ok(sourceStatus("WS64-06").missingInstalledGates.includes("real_installed_restart"));
});

test("WS64-07 disconnect + Temporary Chat: no auto replay, no cross-scope or growing text snapshots", () => {
  assert.deepEqual(conversationScopeSchema.options, ["project", "quick", "temporary"]);
  assert.equal(conversationSendAvailability(false, "ready").canSubmit, false);
  assert.equal(conversationSendAvailability(true, "reconnecting").canSubmit, false);
  assert.equal(conversationSendAvailability(true, "ready").canSubmit, true);
  assert.match(unconfirmedRunRecoveryNotice(), /Nothing was retried automatically/);
  assert.ok(starterPromptsForChatMode("temporary").every((item) => !/this saved Chat/.test(item.prompt)));
  const at = "2026-10-25T00:00:00.000Z";
  let events: ConversationRuntimeEvent[] = [];
  for (const text of ["draft", "draft preserved", "draft preserved after reconnect"]) {
    events = appendConversationPresentationEvent(events, { type: "text", requestId: "known-run", at, text, label: "deterministic" });
  }
  events = appendConversationPresentationEvent(events, {
    type: "done", requestId: "known-run", at, status: "completed",
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].type === "text" ? events[0].text : null, "draft preserved after reconnect");
  assert.deepEqual(selectConversationMessageWindow(Array.from({ length: 1_000 }, (_, i) => i)).messages.length, 80);
  assert.equal(sourceStatus("WS64-07").accepted, false);
});

test("WS64 negative control: source proof alone, missing installed steps or missing owner sign-off cannot release", () => {
  assert.equal(WS64_SCENARIOS.length, 7);
  assert.equal(new Set(WS64_SCENARIOS.map((item) => item.id)).size, 7);
  assert.ok(WS64_SCENARIOS.every((item) => item.requiredManual.length >= 3));
  const ids = WS64_SCENARIOS.map((item) => item.id);
  const allSourcePass = Object.fromEntries(ids.map((id) => [id, true])) as Record<WS64ScenarioId, boolean>;
  assert.ok(sourceOnlyWS64Scorecard(allSourcePass).every((entry) => !entry.accepted && entry.missingInstalledGates.length >= 3));
  const one = WS64_SCENARIOS[0];
  assert.equal(assessWS64Scenario(one.id, { sourceVerified: false, installedGateIds: one.requiredManual, ownerSignedOff: true }).accepted, false);
  assert.equal(assessWS64Scenario(one.id, { sourceVerified: true, installedGateIds: one.requiredManual, ownerSignedOff: false }).accepted, false);
  assert.equal(assessWS64Scenario(one.id, { sourceVerified: true, installedGateIds: one.requiredManual, ownerSignedOff: true }).accepted, true);
});
