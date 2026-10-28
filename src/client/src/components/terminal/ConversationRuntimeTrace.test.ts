import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ConversationRuntimeTrace, { describeProposedChanges, trustCaveats } from "./ConversationRuntimeTrace";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import type { TrustManifest } from "@shared/trustContracts";

const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const noop = () => undefined;

function event(body: Record<string, unknown>): ConversationRuntimeEvent {
  return { requestId: REQUEST_ID, at: new Date().toISOString(), ...body } as unknown as ConversationRuntimeEvent;
}

function render(events: ConversationRuntimeEvent[], props: Partial<ComponentProps<typeof ConversationRuntimeTrace>> = {}): string {
  return renderToStaticMarkup(createElement(ConversationRuntimeTrace, {
    events,
    requestId: REQUEST_ID,
    busy: false,
    onCancel: noop,
    onApprove: noop,
    onDeny: noop,
    allowProjectApproval: true,
    onMutationApply: noop,
    onMutationCancel: noop,
    onOpenTerminal: noop,
    onFollowUp: noop,
    ...props,
  }));
}

const planEvent = event({
  type: "plan",
  plan: {
    schemaVersion: "1",
    requestId: REQUEST_ID,
    capabilities: [{ id: "company.research", label: "Company research", reason: "r", availability: "ready", permissionClass: "safe_auto", sourceScopeCompatible: true, missingInputs: [] }],
    steps: [{ id: "step-1", label: "Fetch filings", kind: "data", permissionClass: "safe_auto" }],
  },
});
const sourceResult = event({ type: "tool_result", stepId: "step-1", label: "Fetch filings", summary: "Fetched 4 filings", deterministic: true, sourceRefs: ["provider:sec_edgar"] });
const doneOk = event({ type: "done", status: "completed" });

function manifest(overrides: Partial<TrustManifest> = {}): TrustManifest {
  return {
    schemaVersion: "1",
    trustId: "33333333-3333-4333-8333-333333333333",
    requestId: REQUEST_ID,
    generatedAt: new Date().toISOString(),
    sourceScope: "connected_only",
    summary: { freshness: "current", quality: "high", confidence: "high", conflictState: "none", evidenceCoveragePct: 100, sourceCount: 1, receiptCount: 0, missingCount: 0 },
    evidence: [], claims: [], conflicts: [], methodology: [], assumptions: [], missing: [], warnings: [],
    ...overrides,
  } as unknown as TrustManifest;
}

test("an ordinary finished run is quiet: no Terminal button, no plan, no counts, no source chips, no IDs", () => {
  const markup = render([planEvent, sourceResult, doneOk]);
  assert.doesNotMatch(markup, /Terminal/i);
  assert.doesNotMatch(markup, /trace-open-terminal|sandbox/i);
  assert.doesNotMatch(markup, /Fetch filings|Resolved capabilities|Company research/);
  assert.doesNotMatch(markup, /\b1 step\b|\b1 source\b|SEC EDGAR|Run 2222/);
  assert.doesNotMatch(markup, /border-border\/60 bg-\[#080808\]/, "no per-run diagnostic card chrome");
  assert.match(markup, /data-testid="trace-show-work"[^>]*>Show work/);
  assert.match(markup, /aria-expanded="false"/);
});

test("an ordinary busy run shows only Working and Stop", () => {
  const markup = render([], { busy: true });
  assert.match(markup, /role="status"[^>]*>[\s\S]*Working/);
  assert.match(markup, /data-testid="agent-run-cancel"[^>]*>[\s\S]*Stop/);
  assert.doesNotMatch(markup, /Terminal|LiOS is working|Details/);
  assert.doesNotMatch(markup, /trace-show-work/, "nothing to disclose before a plan or source exists");
});

test("Show work reveals the plan, steps, sources, IDs and the optional Terminal, and nothing else changes", () => {
  const markup = render([planEvent, sourceResult, doneOk], { defaultShowWork: true });
  assert.match(markup, /Resolved capabilities/);
  assert.match(markup, /Company research/);
  assert.match(markup, /Fetch filings/);
  assert.match(markup, /1 step/);
  assert.match(markup, /data-testid="trace-sources"[\s\S]*SEC EDGAR/);
  assert.match(markup, /Run 22222222-2222-4222-8222-222222222222/);
  assert.match(markup, /data-testid="trace-open-terminal"[^>]*>Open sandbox Terminal/);
  assert.match(markup, /aria-expanded="true"/);
});

test("approvals stay visible by default, and only the approval decisions are offered", () => {
  const legacy = render([event({ type: "approval_required", action: "RunValuation", actionRequest: {}, choices: ["allow_once", "allow_project", "deny"], message: "Run the valuation model with your assumptions?" })], { busy: true });
  assert.match(legacy, /Approval required/);
  assert.match(legacy, /Run the valuation model with your assumptions\?/);
  assert.match(legacy, />Allow once</);
  assert.match(legacy, />Allow for Project</);
  assert.match(legacy, /Deny/);
  assert.match(legacy, /Waiting for your approval/);
  assert.doesNotMatch(legacy, /Terminal/);

  const governed = render([event({
    type: "governed_tool_approval_required",
    reviewId: "44444444-4444-4444-8444-444444444444",
    label: "Send the summary email",
    permissionClass: "user_confirm",
    choices: ["allow_once", "deny"],
    expiresAt: null,
    message: "This sends an email on your behalf.",
  })], { busy: true, onGovernedToolReview: async () => true });
  assert.match(governed, /data-testid="governed-tool-approval"/);
  assert.match(governed, /Approval required · Send the summary email/);
  assert.match(governed, /data-testid="governed-tool-allow-once"/);
  assert.doesNotMatch(governed, /Allow for Project/, "a choice the server did not offer is not shown");
});

test("errors and data gaps are always visible, with recovery actions, without opening Show work", () => {
  const failed = render([event({ type: "error", code: "ai_provider_failed", message: "The provider rejected the API key." }), event({ type: "done", status: "failed" })], { onRetry: noop, onRecoveryAction: noop, onFollowUp: noop });
  assert.match(failed, /data-testid="trace-error"/);
  assert.match(failed, /role="alert"/);
  assert.match(failed, /The provider rejected the API key\./);
  assert.match(failed, /data-testid="c08-reconcile-run"/);
  assert.match(failed, /data-testid="trace-error-connect"/);
  assert.doesNotMatch(failed, /Terminal/);

  const gap = render([event({
    type: "data_gap",
    gap: { field: "revenue", message: "No filing is connected for this company.", reason: "not_connected", providersChecked: ["sec_edgar"], nextActions: ["Connect SEC EDGAR"] },
  }), event({ type: "done", status: "failed" })], { onRecoveryAction: noop });
  assert.match(gap, /Data unavailable — no value invented/);
  assert.match(gap, /No filing is connected for this company\./);
  assert.match(gap, />Connect SEC EDGAR</);
  assert.doesNotMatch(gap, /sec_edgar/, "provider diagnostics stay under Show work");
  assert.doesNotMatch(gap, /Couldn.t complete/, "a governed gap is not presented as a failure");
});

test("source limitations from the trust manifest are visible by default; the full trust panel is not", () => {
  const limited = manifest({
    summary: { freshness: "snapshot", quality: "low", confidence: "low", conflictState: "material", evidenceCoveragePct: 40, sourceCount: 1, receiptCount: 0, missingCount: 1 },
    missing: [{ field: "free_cash_flow", reason: "The filing has no cash-flow statement.", recoveryActions: ["Connect a financial statements source"] }],
    conflicts: [{ field: "revenue", state: "material", sourceRefs: ["a", "b"], relativeDifference: 0.2, summary: "Two sources disagree by 20%." }],
    warnings: ["Figures are as of the last filing."],
  });
  const markup = render([planEvent, event({ type: "trust", manifest: limited }), doneOk], { onRecoveryAction: noop });
  assert.match(markup, /data-testid="trace-source-caveats"/);
  assert.match(markup, /Source limitations/);
  assert.match(markup, /free cash flow is unavailable: The filing has no cash-flow statement\./);
  assert.match(markup, /Two sources disagree by 20%\./);
  assert.match(markup, /Figures are as of the last filing\./);
  assert.match(markup, />Connect a financial statements source</);
  assert.doesNotMatch(markup, /data-p3-trust-manifest/, "the detailed trust panel is Show work only");

  const clean = render([planEvent, event({ type: "trust", manifest: manifest() }), doneOk]);
  assert.doesNotMatch(clean, /Source limitations/, "a clean manifest adds no chrome");
  assert.equal(trustCaveats(manifest()), null);

  const opened = render([planEvent, event({ type: "trust", manifest: limited }), doneOk], { defaultShowWork: true });
  assert.match(opened, /data-p3-trust-manifest/);
});

test("source-free interpretation does not invent a supporting-data warning or hide actual missing evidence", () => {
  const generated = manifest({
    summary: { freshness: "ai_generated", quality: "low", confidence: "low", conflictState: "not_evaluated_single_source", evidenceCoveragePct: 0, sourceCount: 0, receiptCount: 1, missingCount: 0 },
    evidence: [{ sourceRef: `ai-output:${REQUEST_ID}`, providerLabel: "Configured BYOAI", kind: "ai" }] as TrustManifest["evidence"],
    warnings: ["Generated interpretation has not been verified as an observed fact."],
  });
  assert.deepEqual(trustCaveats(generated), { lines: generated.warnings, recoveryActions: [] });
  const rendered = render([event({ type: "trust", manifest: generated })]);
  assert.doesNotMatch(rendered, /Supporting evidence is marked low quality|Review.*figures/i);
  assert.match(rendered, /Generated interpretation has not been verified/);
  const incomplete = { ...generated, missing: [{ field: "source_document", reason: "The selected file was revoked.", recoveryActions: ["Select a permitted file"] }] };
  const caveats = trustCaveats(incomplete);
  assert.deepEqual(caveats?.recoveryActions, ["Select a permitted file"]);
  assert.ok(caveats?.lines.some(line => line.includes("The selected file was revoked.")));
  const revokedMarkup = render([event({ type: "trust", manifest: incomplete })]);
  assert.match(revokedMarkup, /The selected file was revoked/);
});

test("a proposed change needing review shows readable rows, never raw JSON", () => {
  const markup = render([event({
    type: "mutation_review",
    choices: ["review", "apply", "cancel"],
    proposal: { mutationId: "55555555-5555-4555-8555-555555555555", action: "ChangeAssumption", summary: "Change the discount rate.", reversible: true, before: { discountRate: 0.09, label: "Base" }, after: { discountRate: 0.1, label: "Base" } },
  })]);
  assert.match(markup, /Review proposed change/);
  assert.match(markup, /aria-label="Proposed changes"/, "the changes are visible before Apply, not behind a toggle");
  assert.match(markup, /discount Rate<\/span>: 0\.09 → 0\.1/);
  assert.match(markup, />Apply</);
  assert.match(markup, />Cancel</);
  const summaryOnly = markup.slice(0, markup.indexOf("<details"));
  assert.doesNotMatch(summaryOnly, /<pre|\{"/);
  assert.match(markup, /<details[^>]*>\s*<summary[^>]*>Exact before and after values/);
});

test("proposed changes diff the union of keys, name nested edits, report removals and count what is capped", () => {
  assert.deepEqual(describeProposedChanges(
    { discountRate: 0.09, label: "Base", gone: 3, nested: { a: 1, b: 2 }, list: ["x"] },
    { discountRate: 0.1, label: "Base", nested: { a: 2, b: 2 }, tags: ["x", "y"], bigger: [1, 2, 3, 4, 5, 6] },
  ), {
    hidden: 0,
    rows: [
      { label: "discount Rate", before: "0.09", after: "0.1" },
      { label: "gone", before: "3", after: "removed" },
      { label: "nested › a", before: "1", after: "2" },
      { label: "list", before: "x", after: "removed" },
      { label: "tags", before: "none", after: "x, y" },
      { label: "bigger", before: "none", after: "6 items" },
    ],
  });
  const many = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, i]));
  const capped = describeProposedChanges(null, many);
  assert.equal(capped.rows.length, 12);
  assert.equal(capped.hidden, 3);
  const markup = render([event({ type: "mutation_review", choices: ["review", "apply", "cancel"], proposal: { mutationId: "55555555-5555-4555-8555-555555555555", action: "ChangeAssumption", summary: "Bulk edit.", reversible: true, before: null, after: many } })]);
  assert.match(markup, /\+3 more changes/);
});

test("every proposed change stays exactly inspectable: long arrays, nested records and >12 fields appear verbatim", () => {
  const list = Array.from({ length: 10 }, (_, i) => 1000 + i);
  const many = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`field${i}`, `value-${i}-exact`]));
  const after = { ...many, list, nested: { inner: { rate: 0.0937 } } };
  const markup = render([event({ type: "mutation_review", choices: ["review", "apply", "cancel"], proposal: { mutationId: "55555555-5555-4555-8555-555555555555", action: "ChangeAssumption", summary: "Big edit.", reversible: true, before: { list: [1], nested: { inner: { rate: 0.09 } } }, after } })]);
  assert.match(markup, /<details/);
  const exact = markup.slice(markup.indexOf("trace-mutation-exact-before"));
  for (let i = 0; i < 14; i++) assert.ok(exact.includes(`value-${i}-exact`));
  for (let i = 0; i < 10; i++) assert.ok(exact.includes(String(1000 + i)));
  assert.ok(exact.includes("0.0937") && exact.includes("0.09"));
});

test("a proposal with no field-level difference says so instead of offering Apply on an empty list", () => {
  const markup = render([event({ type: "mutation_review", choices: ["review", "apply", "cancel"], proposal: { mutationId: "55555555-5555-4555-8555-555555555555", action: "ChangeAssumption", summary: "Re-run with the same inputs.", reversible: true, before: { a: 1 }, after: { a: 1 } } })]);
  assert.match(markup, /No field-level differences were reported/);
  assert.doesNotMatch(markup, /aria-label="Proposed changes"/);
  assert.match(markup, />Apply</);
});

test("C06 unsaved valid draft requires review before Project save; a saved one adds no duplicate save chrome", () => {
  const draft = { schemaVersion: "1", artifactId:"66666666-6666-4666-8666-666666666666", artifactType: "research_brief", title: "Q3 brief", projectId: 7, persistence: "project_candidate", sourceRefs: [], executionReceiptIds:[], data:{} };
  const unsaved = render([event({ type: "artifact", artifact: draft }), doneOk], { onKeepArtifact: noop });
  assert.match(unsaved, /data-testid="c06-artifact-save-review"/);
  assert.match(unsaved, /Request save to Project/);
  assert.match(unsaved, /disabled=""/);
  assert.doesNotMatch(unsaved, /research_brief|research brief/i, "internal artifact type is not shown");
  const saved = render([event({ type: "artifact", artifact: draft, persistedArtifact: { id: "artifact:66666666-6666-4666-8666-666666666666", version: 2 } }), doneOk], { onKeepArtifact: noop });
  assert.doesNotMatch(saved, /Request save to Project|Q3 brief/);
});

test("an unsaved draft never silently disappears when saving is unavailable", () => {
  const draft = { schemaVersion: "1", artifactId:"66666666-6666-4666-8666-666666666666", artifactType: "research_brief", title: "Q3 brief", projectId: 7, persistence: "project_candidate", sourceRefs: [], executionReceiptIds:[], data:{} };
  const markup = render([event({ type: "artifact", artifact: draft }), doneOk], { onKeepArtifact: undefined });
  assert.match(markup, /data-testid="trace-keep-artifact"/);
  assert.match(markup, /Q3 brief/);
  assert.match(markup, /Not saved — saving isn’t available in this chat/);
  assert.doesNotMatch(markup, /Request save to Project/);
});

test("C06 Quick Chat save is reviewed; temporary results cannot be saved", () => {
  const draft = { schemaVersion:"1", artifactId:"66666666-6666-4666-8666-666666666666",artifactType: "research_brief", title: "Retained Quick analysis", projectId:null,persistence: "chat_candidate",sourceRefs: [],executionReceiptIds:[],data:{} };
  const unsaved = render([event({ type: "artifact", artifact: draft }), doneOk], { onKeepArtifact: noop });
  assert.match(unsaved, /Request save to Chat/);
  assert.doesNotMatch(unsaved, /Request save to Project/);
  const saved = render([event({ type: "artifact", artifact: draft, persistedArtifact: { id: "artifact:66666666-6666-4666-8666-666666666666", version: 4 } }), doneOk], { onKeepArtifact: noop });
  assert.doesNotMatch(saved, /Request save to Chat|Request save to Project|Not saved yet/);
  const temporary = render([event({ type: "artifact", artifact: { ...draft, persistence: "ephemeral" } }), doneOk], { onKeepArtifact: undefined });
  assert.doesNotMatch(temporary, /Request save to Chat|Request save to Project/);
  assert.match(temporary, /Not saved/);
});

test("a failed or stopped run with no error card still shows a visible status line", () => {
  const failed = render([planEvent, event({ type: "done", status: "failed" })]);
  assert.match(failed, /role="status"[^>]*data-testid="trace-run-status"[^>]*data-run-status="failed"/);
  const cancelled = render([planEvent, event({ type: "done", status: "cancelled" })]);
  assert.match(cancelled, /data-run-status="cancelled"/);
  assert.match(cancelled, /stopped before it finished/);
  assert.doesNotMatch(render([planEvent, doneOk]), /trace-run-status/);
  assert.doesNotMatch(render([event({ type: "error", code: "x", message: "Boom." }), event({ type: "done", status: "failed" })]), /trace-run-status/, "an error card already explains it");
});

test("source limitation rows have unique keys even when two limitations read the same", () => {
  const same = manifest({ warnings: ["Figures are delayed.", "Figures are delayed."] });
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try { render([planEvent, event({ type: "trust", manifest: same }), doneOk]); } finally { console.error = original; }
  assert.equal(errors.some((args) => JSON.stringify(args).includes("same key")), false);
});

test("an eligible interrupted run shows the guarded checkpoint resume card, not an invented live status", () => {
  const stopped = render([], { resumableRequestId: REQUEST_ID, onResume: noop });
  assert.match(stopped, /Interrupted research checkpoint/);
  assert.match(stopped, /trace-resumable-checkpoint/);
  assert.match(stopped, /Detailed checkpoint step counts are unavailable/);
  assert.match(stopped, /data-testid="agent-run-resume"/);
  assert.match(stopped, /Resume can be refused/);
  assert.equal(render([]), "");
});

test("a structured input gap is rendered once while unrelated source warnings remain visible", () => {
  const message = "Valuation requires explicit deterministic model inputs. Missing: structured_model_inputs_or_active_artifact.";
  const markup = render([
    event({ type: "data_gap", gap: { field: "professional_model_inputs", message, reason: "unavailable", providersChecked: [], nextActions: [] } }),
    event({ type: "error", code: "REQUEST_FAILED", message }),
    event({ type: "trust", manifest: manifest({
      missing: [{ field: "professional_model_inputs", reason: message, recoveryActions: [] }] as TrustManifest["missing"],
      warnings: ["Independent source is stale"],
    }) }),
    event({ type: "done", status: "failed" }),
  ]);
  assert.equal((markup.match(/data-testid="trace-data-gap"/g) ?? []).length, 1);
  assert.equal((markup.match(/Valuation requires explicit deterministic/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /data-testid="trace-error"|REQUEST_FAILED/);
  assert.match(markup, /Independent source is stale/);
});

test("completion without a receipt cannot borrow another request's receipt", () => {
  const foreign = event({ type: "receipt", requestId: "99999999-9999-4999-8999-999999999999", receipt: {} });
  const missing = render([foreign, planEvent, doneOk]);
  assert.doesNotMatch(missing, /data-testid="trace-receipt"/);
  assert.match(missing, /data-testid="trace-receipt-missing"/);
  const actual = render([planEvent, event({ type: "receipt", receipt: {} }), doneOk]);
  assert.match(actual, /data-testid="trace-receipt"/);
  assert.doesNotMatch(actual, /trace-receipt-missing/);
});

test("unsettled idle observation stays visibly interrupted and pending Stop cannot be repeated", () => {
  assert.match(render([planEvent, sourceResult]), /role="alert" data-testid="trace-interrupted"/);
  const pending = render([planEvent], { busy: true, cancelPending: true });
  assert.match(pending, /disabled="" aria-label="Requesting Stop"/);
  const acknowledged = render([planEvent], { busy: true, stopRequested: true });
  assert.match(acknowledged, /disabled="" aria-label="Stop requested"/);
});

test("WS-50: actual run receipts are disclosed under Show work but not mistaken for automatic approval", () => {
  const receipt = {
    id: "88888888-8888-4888-8888-888888888888",
    requestId: REQUEST_ID, componentId: "quant.risk", operation: "risk_run", status: "completed",
    startedAt: "2026-10-24T10:00:00.000Z", completedAt: "2026-10-24T10:00:02.000Z",
    deterministic: true, aiDerived: false, inputHash: "a".repeat(64), outputHash: "b".repeat(64),
    sourceRefs: ["private-source-uri:do-not-render"], warnings: ["PRIVATE WARNING"],
    inputEvidence: { apiKey: "PRIVATE KEY" }, outputEvidence: { raw: "PRIVATE RAW" },
  };
  const collapsed = render([event({ type: "receipt", receipt }), doneOk]);
  assert.match(collapsed, /data-testid="trace-show-work"/);
  assert.doesNotMatch(collapsed, /trace-agent-receipts|quant.risk|risk_run|88888888/);
  const open = render([event({ type: "receipt", receipt }), doneOk], { defaultShowWork: true });
  assert.match(open, /data-testid="trace-agent-receipts"/);
  assert.match(open, /data-testid="trace-receipt-count"/);
  assert.match(open, /1 recorded execution receipt/);
  assert.match(open, /quant.risk · risk run/);
  assert.match(open, /data-receipt-status="completed"/, "real matching receipt drives visual status");
  assert.match(open, /1 completed · 0 failed · 0 cancelled/);
  assert.match(open, /Receipts do not grant approval or prove an external action occurred/);
  assert.match(open, /88888888-8888-4888-8888-888888888888/);
  assert.match(open, /Input SHA-256/);
  assert.doesNotMatch(open, /PRIVATE KEY|PRIVATE RAW|PRIVATE WARNING|private-source-uri:do-not-render/);
});

test("WS-50: failed, cancelled and foreign-run receipts warn even while Show work is collapsed", () => {
  const makeReceipt = (id: string, status: string, innerRequest = REQUEST_ID) => event({
    type: "receipt", receipt: {
      id, requestId: innerRequest, componentId: "risk.engine", operation: "run",
      status, startedAt: "2026-10-24T10:00:00Z", completedAt: "2026-10-24T10:00:01Z",
      deterministic: true, aiDerived: false, inputHash: null, outputHash: null,
      sourceRefs: [], warnings: [], inputEvidence: null, outputEvidence: null,
    },
  });
  const failed = render([
    makeReceipt("11111111-1111-4111-8111-111111111111", "failed"),
    makeReceipt("22222222-2222-4222-8222-222222222222", "cancelled"),
    makeReceipt("33333333-3333-4333-8333-333333333333", "completed", "99999999-9999-4999-8999-999999999999"),
    doneOk,
  ]);
  assert.match(failed, /role="alert"[^>]*data-testid="trace-agent-receipt-warning"/);
  assert.match(failed, /1 failed, 1 cancelled, 1 ignored/);
  assert.match(failed, /Do not assume these operations completed/);
  assert.doesNotMatch(failed, /trace-agent-receipts|risk.engine/);
  const full = render([makeReceipt("11111111-1111-4111-8111-111111111111", "failed"), doneOk], { defaultShowWork: true });
  assert.match(full, /1 recorded execution receipt/);
  assert.match(full, /0 completed · 1 failed · 0 cancelled/);
});


test("WS-51: privileged approval displays exact run-bound hashed input, side effect, scope and no secret arguments", () => {
  const review = event({
    type: "governed_tool_approval_required",
    reviewId: "99999999-9999-4999-8999-999999999999",
    label: "Email send",
    permissionClass: "user_confirm",
    sideEffect: "external",
    replaySafe: false,
    externalSideEffect: true,
    blastRadius: "May send a message to another provider.",
    choices: ["allow_once", "allow_project", "deny"],
    expiresAt: "2099-10-25T12:00:00.000Z",
    message: "Send this message?",
    reviewBinding: {
      toolId: "email.send", stepId: "step-1", toolCallId: "call-1",
      inputSha256: "a".repeat(64), planSha256: "b".repeat(64),
      chatId: 15, projectId: 4,
    },
  });
  const markup = render([review], { busy: true, onGovernedToolReview: async () => true });
  assert.match(markup, /data-testid="governed-review-risk"/);
  assert.match(markup, /External side effect/);
  assert.match(markup, /Project 4 · Chat 15/);
  assert.match(markup, /Input SHA-256/);
  assert.match(markup, /Plan SHA-256/);
  assert.match(markup, /May send a message to another provider/);
  assert.match(markup, /data-testid="governed-review-risk-ack"/);
  assert.match(markup, /data-testid="governed-tool-allow-once"[^>]*disabled/);
  assert.match(markup, /Allow for Project/);
  assert.match(markup, /Raw input and external target are NOT exposed/);
  assert.doesNotMatch(markup, /secretToken|apiKey|accessKey/);
});

test("WS-51: expired or missing exact bindings fail closed, but denial remains possible", () => {
  const base = {
    type: "governed_tool_approval_required",
    reviewId: "99999999-9999-4999-8999-999999999999",
    label: "Send email", permissionClass: "admin_confirm",
    sideEffect: "external", externalSideEffect: true, replaySafe: false,
    choices: ["allow_once", "deny"],
    expiresAt: "2020-01-01T00:00:00.000Z", message: "Review this external write.",
  };
  const missing = render([event(base)], { busy: true, onGovernedToolReview: async () => true });
  assert.match(missing, /lacks a current exact server binding or has expired/);
  assert.match(missing, /data-testid="governed-tool-allow-once"[^>]*disabled/);
  assert.match(missing, /\bDeny<\/button>/);
  assert.doesNotMatch(missing, /Allow for Project/);
  const validBinding = { toolId: "email.send", stepId: "s1", toolCallId: "c1",
    inputSha256: "a".repeat(64), planSha256: "b".repeat(64), chatId: 7, projectId: null };
  const expired = render([event({ ...base, reviewBinding: validBinding })], { busy: true, onGovernedToolReview: async () => true });
  assert.match(expired, /expired: allow disabled/);
  assert.match(expired, /\bDeny<\/button>/);
});

test("WS-51: legacy action review shows exact target, offered scope and hides approvals after terminal result", () => {
  const action = event({
    type: "approval_required", action: "RunBacktest",
    actionRequest: { componentId: "finance.backtest", targetRef: "portfolio:15",
      externalSideEffect: false, reversible: true, permissionClass: "user_confirm" },
    choices: ["allow_once", "deny"], message: "Run the model?",
  });
  const open = render([action], { busy: true });
  assert.match(open, /data-testid="legacy-approval-risk"/);
  assert.match(open, /Target: portfolio:15/);
  assert.match(open, /Legacy review; exact server input fingerprint is not included/);
  assert.doesNotMatch(open, /Allow for Project/);
  const completed = render([action, doneOk]);
  assert.doesNotMatch(completed, /data-testid="trace-approval"/);
});


test("Phase 1 approval presentation labels only pending server-governed review, without changing allowed decisions", () => {
  const base = event({
    type: "governed_tool_approval_required",
    reviewId: "99999999-9999-4999-8999-999999999999",
    label: "Refresh research", message: "Read an additional source?",
    permissionClass: "user_confirm", sideEffect: "none",
    externalSideEffect: false, replaySafe: true,
    expiresAt: "2099-10-25T12:00:00.000Z",
    choices: ["allow_once", "deny"],
    reviewBinding: {
      toolId: "source.read", stepId: "s1", toolCallId: "call1",
      inputSha256: "a".repeat(64), planSha256: "b".repeat(64),
      projectId: null, chatId: 5,
    },
  });
  const markup = render([base], { busy: true, onGovernedToolReview: async () => true });
  assert.match(markup, /role="group" aria-label="Governed tool approval" aria-busy="false"/);
  assert.match(markup, /Your decision needed|Allow unavailable/);
  assert.match(markup, /data-testid="governed-review-risk"/);
  assert.match(markup, /data-testid="governed-tool-allow-once"/);
  assert.match(markup, /Allow once/);
  assert.match(markup, /Deny/);
  assert.doesNotMatch(markup, /Allow for Project/);
  assert.doesNotMatch(markup, /Submitting review|Accepted by server|Action completed/);
});

test("Sprint A live AI activity reports only observed work, not an inferred execution success", () => {
  const markup = render([planEvent, event({ type: "tool_start", stepId: "step-1" })], { busy: true });
  assert.match(markup, /data-testid="trace-observed-progress"/);
  assert.match(markup, /1 observed step of 1 planned/);
  assert.match(markup, /0 tool results recorded/);
  assert.doesNotMatch(markup, /1 successful|1 completed|100% complete/);
  assert.match(markup, /data-testid="agent-run-cancel"/);
  assert.match(markup, /data-testid="trace-show-work"/);
});

test("C04 Show work distinguishes a recorded action from an unconfirmed action without disclosing tool summaries", () => {
  const unconfirmed = render([planEvent, sourceResult, doneOk], { defaultShowWork: true });
  assert.match(unconfirmed, /data-testid="c04-agent-step-activity"/);
  assert.match(unconfirmed, /data-step-state="unconfirmed"/);
  assert.match(unconfirmed, /No confirmed result/);
  assert.match(unconfirmed, /not execution receipts/);
  const reported = render([planEvent, event({
    type: "tool_result", stepId: "step-1", label: "Fetch filings",
    summary: "PRIVATE_TOOL_PAYLOAD_NEVER_IN_STEP", deterministic: true,
    sourceRefs: [], outcome: "completed",
  }), doneOk], { defaultShowWork: true });
  assert.match(reported, /data-step-state="reported_complete"/);
  assert.match(reported, /Reported complete/);
  assert.doesNotMatch(reported.split('data-testid="c04-agent-step-activity"')[1]?.split("</section>")[0] ?? "", /PRIVATE_TOOL_PAYLOAD_NEVER_IN_STEP/);
  const denied = render([planEvent, event({
    type: "tool_result", stepId: "step-1", label: "Fetch filings",
    summary: "", deterministic: false, sourceRefs: [], outcome: "denied",
  }), doneOk], { defaultShowWork: true });
  assert.match(denied, /data-step-state="denied"/);
  assert.match(denied, /Denied/);
  assert.doesNotMatch(denied, /data-step-state="reported_complete"/);
});
test("C04 Stop request never renders as confirmed cancellation before server reports it", () => {
  const pending = render([planEvent, event({
    type: "tool_start", stepId: "step-1", label: "Fetch filings", componentId: "research",
  })], { busy: true, stopRequested: true, defaultShowWork: true });
  assert.match(pending, /data-step-state="cancel_requested"/);
  assert.match(pending, /Stop requested — not confirmed/);
  const stopped = render([planEvent, event({type:"done", status:"cancelled"})], { defaultShowWork: true });
  assert.match(stopped, /data-step-state="cancelled"/);
});

test("C06 save flow requires explicit acknowledgement, no P4 writes or silent success",()=>{
  const draft={schemaVersion:"1",artifactId:"66666666-6666-4666-8666-666666666666",
    artifactType:"research_brief",title:"Recorded analysis",projectId:3,persistence:"project_candidate",
    sourceRefs:["private:source"],executionReceiptIds:[],data:{confidence:"not verified"}};
  const html=render([event({type:"artifact",artifact:draft}),doneOk],{onKeepArtifact:noop});
  assert.match(html,/data-testid="c06-artifact-save-review"/);
  assert.match(html,/I reviewed the saved destination/);
  assert.match(html,/disabled=""/);
  assert.match(html,/Recorded source references are not proof of current entitlement/);
  assert.doesNotMatch(html,/confidence:"not verified"|private:source/);
});

test("C08 errors and interrupted runs only offer read-only reconciliation, never blind resend",()=>{
  const failed=render([planEvent,event({type:"error",code:"TIMEOUT",message:"The outcome is unconfirmed."}),
    event({type:"done",status:"failed"})],{onRetry:noop,onFollowUp:noop});
  assert.match(failed,/data-testid="c08-reconcile-run"/);
  assert.match(failed,/No automatic retry/);
  assert.doesNotMatch(failed,/data-testid="trace-error-retry"/);
  const interrupted=render([planEvent,sourceResult],{onRetry:noop,onFollowUp:noop});
  assert.match(interrupted,/data-testid="c08-reconcile-interrupted"/);
  assert.match(interrupted,/Home may have received the original run/);
  const inspectOnly=render([planEvent,sourceResult],{onRetry:noop,onFollowUp:undefined});
  assert.match(inspectOnly,/data-testid="c08-inspect-interrupted"/);
  const noSource=render([event({type:"error",code:"TIMEOUT",message:"Outcome unknown"}),
    event({type:"done",status:"failed"})],{onRetry:noop,onFollowUp:undefined});
  assert.doesNotMatch(noSource,/data-testid="c08-reconcile-run"|data-testid="trace-error-retry"/);
});

test("C08 completed Chat does not obscure unresolved tool reports or offer a blind retry", () => {
  const denied = render([
    planEvent,
    event({ type: "tool_result", stepId: "step-1", label: "Fetch filings",
      summary: "PRIVATE_TOOL_OUTPUT", deterministic: false, sourceRefs: [], outcome: "denied" }),
    doneOk,
  ], { onRetry: noop, onFollowUp: noop });
  assert.match(denied, /data-testid="c08-recorded-action-recovery"/);
  assert.match(denied, /1 denied/);
  assert.match(denied, /Overall run completion does not override/);
  assert.match(denied, /data-testid="c08-review-recorded-actions"/);
  assert.match(denied, /data-testid="c08-reconcile-partial-actions"/);
  assert.doesNotMatch(denied, /PRIVATE_TOOL_OUTPUT|trace-error-retry/);

  const unfinished = render([
    planEvent, event({ type: "tool_start", stepId: "step-1",
      label: "Fetch filings", componentId: "research" }), doneOk,
  ]);
  assert.match(unfinished, /1 started tool action/);
  assert.match(unfinished, /c08-recorded-action-recovery/);

  const completed = render([
    planEvent, event({ type: "tool_result", stepId: "step-1", label: "Fetch filings",
      summary: "", deterministic: true, sourceRefs: [], outcome: "completed" }), doneOk,
  ]);
  assert.doesNotMatch(completed, /c08-recorded-action-recovery/);
});

test("C08 partial reconciliation is only a read-only draft and never offers an automatic tool replay", () => {
  const output = render([
    planEvent, event({ type: "tool_result", stepId: "step-1", label: "Fetch filings",
      summary: "", deterministic: true, sourceRefs: [], outcome: "failed" }), doneOk,
  ], { onFollowUp: undefined, onRetry: noop });
  assert.match(output, /data-testid="c08-review-recorded-actions"/);
  assert.doesNotMatch(output, /data-testid="c08-reconcile-partial-actions"|data-testid="trace-error-retry"/);
  assert.match(output, /No automatic retry, tool execution or permission grant is performed/);
});

test("C06 exact P4 reopen is visible only for saved versions when current Chat provides the handler", () => {
  const draft = {
    artifactType: "research_brief", title: "Recorded filing analysis",
    projectId: 12, persistence: "project_candidate", sourceRefs: [],
  };
  const saved = event({ type: "artifact", artifact: draft,
    persistedArtifact: { id: "artifact:66666666-6666-4666-8666-666666666666", version: 4 } });
  const shown = render([saved, doneOk], { onOpenSavedArtifact: noop });
  assert.match(shown, /data-testid="c06-open-recorded-artifact"/);
  assert.match(shown, /data-testid="c06-open-exact-saved-version"/);
  assert.match(shown, /Open saved v4/);
  assert.match(shown, /Saved in Project · exact v4/);
  assert.match(shown, /P4 rechecks permissions when opened/);
  assert.doesNotMatch(shown, /Keep in Project/);

  const unavailable = render([saved, doneOk], { onOpenSavedArtifact: undefined });
  assert.doesNotMatch(unavailable, /c06-open-recorded-artifact|Open saved v4/);
  const unsaved = render([event({ type: "artifact", artifact: draft }), doneOk],
    { onOpenSavedArtifact: noop });
  assert.doesNotMatch(unsaved, /c06-open-recorded-artifact/);
});
