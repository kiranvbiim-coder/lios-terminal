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
  const failed = render([event({ type: "error", code: "ai_provider_failed", message: "The provider rejected the API key." }), event({ type: "done", status: "failed" })], { onRetry: noop, onRecoveryAction: noop });
  assert.match(failed, /data-testid="trace-error"/);
  assert.match(failed, /role="alert"/);
  assert.match(failed, /The provider rejected the API key\./);
  assert.match(failed, /data-testid="trace-error-retry"/);
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

test("an unsaved draft offers Keep in Project; a saved one adds no chrome", () => {
  const draft = { artifactType: "research_brief", title: "Q3 brief", persistence: "draft", sourceRefs: [] };
  const unsaved = render([event({ type: "artifact", artifact: draft }), doneOk], { onKeepArtifact: noop });
  assert.match(unsaved, /Keep in Project/);
  assert.doesNotMatch(unsaved, /research_brief|research brief/i, "internal artifact type is not shown");
  const saved = render([event({ type: "artifact", artifact: draft, persistedArtifact: { id: "artifact:66666666-6666-4666-8666-666666666666", version: 2 } }), doneOk], { onKeepArtifact: noop });
  assert.doesNotMatch(saved, /Keep in Project|Q3 brief/);
});

test("an unsaved draft never silently disappears when saving is unavailable", () => {
  const draft = { artifactType: "research_brief", title: "Q3 brief", persistence: "draft", sourceRefs: [] };
  const markup = render([event({ type: "artifact", artifact: draft }), doneOk], { onKeepArtifact: undefined });
  assert.match(markup, /data-testid="trace-keep-artifact"/);
  assert.match(markup, /Q3 brief/);
  assert.match(markup, /Not saved — saving isn’t available in this chat/);
  assert.doesNotMatch(markup, /Keep in Project/);
});

test("Quick Chat candidate offers retention in the same Chat and Temporary results offer none", () => {
  const draft = { artifactType: "research_brief", title: "Retained Quick analysis", persistence: "chat_candidate", sourceRefs: [] };
  const unsaved = render([event({ type: "artifact", artifact: draft }), doneOk], { onKeepArtifact: noop });
  assert.match(unsaved, /Keep in Chat/);
  assert.doesNotMatch(unsaved, /Keep in Project/);
  const saved = render([event({ type: "artifact", artifact: draft, persistedArtifact: { id: "artifact:66666666-6666-4666-8666-666666666666", version: 4 } }), doneOk], { onKeepArtifact: noop });
  assert.doesNotMatch(saved, /Keep in Chat|Keep in Project|Not saved yet/);
  const temporary = render([event({ type: "artifact", artifact: { ...draft, persistence: "ephemeral" } }), doneOk], { onKeepArtifact: undefined });
  assert.doesNotMatch(temporary, /Keep in Chat|Keep in Project/);
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

test("a stopped run that can resume shows a Resume control, and nothing renders for an empty idle chat", () => {
  const stopped = render([], { resumableRequestId: REQUEST_ID, onResume: noop });
  assert.match(stopped, /Stopped/);
  assert.match(stopped, /data-testid="agent-run-resume"/);
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
