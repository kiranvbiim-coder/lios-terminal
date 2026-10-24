import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resumableCheckpointView } from "./researchCheckpoint";
import ResearchCheckpointCard from "../components/terminal/ResearchCheckpointCard";
import ConversationRuntimeTrace from "../components/terminal/ConversationRuntimeTrace";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const noop = () => undefined;
const checkpoint = () => ({
  version: 2,
  requestId: ID,
  toolOutcome: "known_completed",
  steps: [
    { stepId: "fetch", status: "completed" },
    { stepId: "verify", status: "pending" },
    { stepId: "review", status: "waiting_approval" },
    { stepId: "write", status: "running" },
  ],
  evidenceRefs: ["provider:fred", "provider:fred", "provider:sec_edgar"],
});
const eligible = () => ({
  id: ID,
  status: "interrupted",
  resumable: true,
  checkpoint: checkpoint(),
});
const html = (value: ReturnType<typeof resumableCheckpointView>) => renderToStaticMarkup(
  createElement(ResearchCheckpointCard, { requestId: ID, checkpoint: value, onResume: noop }),
);

test("WS-32: only an exact Home-owned interrupted/resumable record yields a checkpoint view", () => {
  const matched = resumableCheckpointView([eligible()], ID);
  assert.deepEqual(matched, {
    requestId: ID,
    totalSteps: 4,
    completedSteps: 1,
    awaitingReviewSteps: 1,
    recordedReferenceCount: 2,
  });
  assert.equal(resumableCheckpointView([eligible()], OTHER), null);
  assert.equal(resumableCheckpointView([{ ...eligible(), resumable: false }], ID), null);
  for (const status of ["completed", "cancelled", "failed", "running", "waiting_approval", "denied"]) {
    assert.equal(resumableCheckpointView([{ ...eligible(), status }], ID), null);
  }
  assert.equal(resumableCheckpointView(null, ID), null);
  assert.equal(resumableCheckpointView([eligible()], "not-a-request"), null);
});

test("WS-32: untrusted checkpoint counts never become implied completed work", () => {
  const noCheckpoint = { ...eligible(), checkpoint: undefined };
  const badId = { ...eligible(), checkpoint: { ...checkpoint(), requestId: OTHER } };
  const staleVersion = { ...eligible(), checkpoint: { ...checkpoint(), version: 1 } };
  const unknownDispatch = { ...eligible(), checkpoint: { ...checkpoint(), toolOutcome: "outcome_unknown" } };
  const duplicateSteps = { ...eligible(), checkpoint: { ...checkpoint(), steps: [
    { stepId: "same", status: "completed" }, { stepId: "same", status: "completed" },
  ] } };
  const illegalStatus = { ...eligible(), checkpoint: { ...checkpoint(), steps: [{ stepId: "run", status: "success" }] } };
  for (const value of [noCheckpoint, badId, staleVersion, unknownDispatch, duplicateSteps, illegalStatus]) {
    const projection = resumableCheckpointView([value], ID);
    assert.equal(projection?.requestId, ID, "server resume flag remains the only eligibility authority");
    assert.equal(projection?.completedSteps, null);
    assert.equal(projection?.recordedReferenceCount, null);
    assert.match(html(projection), /Detailed checkpoint step counts are unavailable/);
    assert.doesNotMatch(html(projection), /Last saved checkpoint:/);
  }
});

test("WS-32: recorded pending and interrupted steps are never misrepresented as completed or running", () => {
  const summary = resumableCheckpointView([eligible()], ID);
  const markup = html(summary);
  assert.match(markup, /Interrupted research checkpoint/);
  assert.match(markup, /Last saved checkpoint: 1 of 4 steps recorded complete/);
  assert.match(markup, /1 step\(s\) were waiting for review when saved/);
  assert.match(markup, /2 reference\(s\) recorded, not independently verified/);
  assert.match(markup, /Any previous results are partial/);
  assert.match(markup, /Resume can be refused/);
  assert.match(markup, /data-testid="agent-run-resume"/);
  assert.match(markup, /data-request-id="11111111-1111-4111-8111-111111111111"/);
  assert.doesNotMatch(markup, /ETA|\d+%|verified conclusions|automatically resumed/);
});

test("WS-32: server-owned checkpoint is not confused with live Chat trace or another run", () => {
  const card = html({ ...resumableCheckpointView([eligible()], ID)!, requestId: OTHER });
  assert.match(card, /Detailed checkpoint step counts are unavailable/);
  assert.doesNotMatch(card, /1 of 4 steps/);

  const common = {
    events: [], requestId: OTHER, busy: false,
    onCancel: noop, onApprove: noop, onDeny: noop,
    allowProjectApproval: false,
    onMutationApply: noop, onMutationCancel: noop,
  };
  const hidden = renderToStaticMarkup(createElement(ConversationRuntimeTrace, { ...common, resumableRequestId: ID, checkpointView: resumableCheckpointView([eligible()], ID) }));
  assert.doesNotMatch(hidden, /agent-run-resume|trace-resumable-checkpoint/, "without a server-wired handler no local resume is offered");

  const visible = renderToStaticMarkup(createElement(ConversationRuntimeTrace, { ...common,
    resumableRequestId: ID, checkpointView: resumableCheckpointView([eligible()], ID), onResume: noop,
  }));
  assert.match(visible, /trace-resumable-checkpoint/);
  assert.match(visible, /1 of 4 steps recorded complete/);
  assert.match(visible, /Resume from checkpoint/);
  assert.doesNotMatch(visible, /trace-observed-progress/, "no fabricated live progress from the saved checkpoint");

  const whileBusy = renderToStaticMarkup(createElement(ConversationRuntimeTrace, { ...common,
    busy: true, resumableRequestId: ID, checkpointView: resumableCheckpointView([eligible()], ID), onResume: noop,
  }));
  assert.doesNotMatch(whileBusy, /agent-run-resume|trace-resumable-checkpoint/);
});

test("WS-32: no prompt, credentials, raw tool inputs or authorization grants are leaked by checkpoint display", () => {
  const row = eligible();
  const withSensitive = [{ ...row, checkpoint: { ...checkpoint(), continuation: {
    steps: [{ input: { password: "NEVER_SHOW_PASSWORD" }, label: "Sensitive tool input" }],
  }, authorization: { token: "NEVER_SHOW_TOKEN" } } }];
  const markup = html(resumableCheckpointView(withSensitive, ID));
  assert.doesNotMatch(markup, /NEVER_SHOW_PASSWORD|NEVER_SHOW_TOKEN|Sensitive tool input/);
  assert.match(markup, /recorded complete/);
});

test("WS-32: failed history lookup is visible and recoverable without an unauthorized resume action", () => {
  const common = {
    events: [], requestId: null, busy: false,
    onCancel: noop, onApprove: noop, onDeny: noop,
    allowProjectApproval: false, onMutationApply: noop, onMutationCancel: noop,
  };
  const failure = renderToStaticMarkup(createElement(ConversationRuntimeTrace, {
    ...common, checkpointLookupError: true, onRetryCheckpointLookup: noop,
  }));
  assert.match(failure, /role="alert"/);
  assert.match(failure, /Saved checkpoint eligibility could not be checked/);
  assert.match(failure, /Retry checkpoint check/);
  assert.doesNotMatch(failure, /agent-run-resume|Resume from checkpoint/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(ConversationRuntimeTrace, common)), /checkpoint/);

  const busy = renderToStaticMarkup(createElement(ConversationRuntimeTrace, {
    ...common, checkpointLookupError: true, onRetryCheckpointLookup: noop, busy: true,
  }));
  assert.doesNotMatch(busy, /trace-checkpoint-lookup-error/);
});
