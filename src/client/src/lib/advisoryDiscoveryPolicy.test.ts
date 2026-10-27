import test from "node:test";
import assert from "node:assert/strict";
import { mayShowQuietAdvisoryInvite, ADVISORY_SERVICE_EXPLANATIONS, ADVISORY_SERVICE_STEPS } from "./advisoryDiscoveryPolicy";

const eligible = { audience: "client" as const, surface: "project-home" as const, dismissedInSession: false };

test("Phase 4 advisory stays opt-in and only appears for entitled client Project home", () => {
  assert.equal(mayShowQuietAdvisoryInvite(eligible), true);
  assert.equal(mayShowQuietAdvisoryInvite({ ...eligible, audience: "trial" }), false);
  assert.equal(mayShowQuietAdvisoryInvite({ ...eligible, audience: "internal" }), false);
  assert.equal(mayShowQuietAdvisoryInvite({ ...eligible, surface: "chat" }), false);
  assert.equal(mayShowQuietAdvisoryInvite({ ...eligible, surface: "workbench" }), false);
});

test("Phase 4 client opt-out and intense reading/unsaved-work modes always suppress promotion", () => {
  assert.equal(mayShowQuietAdvisoryInvite({ ...eligible, dismissedInSession: true }), false);
  assert.equal(mayShowQuietAdvisoryInvite({ ...eligible, focusMode: true }), false);
  assert.equal(mayShowQuietAdvisoryInvite({ ...eligible, presentationMode: true }), false);
  assert.equal(mayShowQuietAdvisoryInvite({ ...eligible, projectBusy: true }), false);
});

test("Phase 4 service copy references actual current consulting request templates without performance or pricing claims", () => {
  assert.deepEqual(Object.keys(ADVISORY_SERVICE_EXPLANATIONS).sort(),
    ["investment_decision", "market_entry", "ma_intelligence"].sort());
  assert.equal(ADVISORY_SERVICE_STEPS.length, 3);
  assert.match(ADVISORY_SERVICE_STEPS[0], /choose to submit/);
  assert.match(ADVISORY_SERVICE_STEPS[1], /quote and turnaround before accepting/);
  const claims = Object.values(ADVISORY_SERVICE_EXPLANATIONS).join(" ");
  assert.doesNotMatch(claims, /guarantee|ranked|top-rated|discount|limited time|free consultation/i);
});
