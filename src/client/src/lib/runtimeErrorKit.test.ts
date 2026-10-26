import assert from "node:assert/strict";
import test from "node:test";
import { presentRuntimeError } from "./runtimeErrorKit";

test("quota and rate limit errors point to Connect first", () => {
  const view = presentRuntimeError("runtime_failed", "OpenAI could not answer (openai: rate_limited 429).");
  assert.equal(view.kind, "rate_limit");
  assert.equal(view.recoveries[0], "connect");
});

test("provider key problems offer Connect and retry", () => {
  const view = presentRuntimeError("runtime_failed", "Invalid API key for the selected provider");
  assert.equal(view.kind, "ai_provider");
  assert.deepEqual(view.recoveries, ["connect", "retry"]);
});

test("deterministic valuation input gaps ask for inputs, not AI credentials or an unchanged retry", () => {
  const message = "Valuation requires explicit deterministic model inputs. Missing: structured_model_inputs_or_active_artifact. LiOS did not invent assumptions.";
  for (const code of ["request_failed", "runtime_failed"]) {
    const view = presentRuntimeError(code, message);
    assert.equal(view.kind, "input_required");
    assert.deepEqual(view.recoveries, []);
  }
});

test("structured and delegated deterministic input gaps retain request guidance", () => {
  for (const code of ["professional_model_inputs", "deterministic_engine_inputs"]) {
    assert.equal(presentRuntimeError(code, "Inputs are unavailable.").kind, "input_required");
  }
  assert.equal(presentRuntimeError("request_failed", "Missing: structured_model_inputs_or_active_artifact.").kind, "input_required");
  assert.equal(presentRuntimeError("runtime_failed", "Valuation requires explicit deterministic model inputs. LiOS did not invent assumptions.").kind, "input_required");
  const delegated = presentRuntimeError("request_failed", "DCF is the authoritative calculation path, but the explicit model inputs needed to run it safely are not available in this request. LiOS did not invent assumptions.");
  assert.equal(delegated.kind, "input_required");
  assert.deepEqual(delegated.recoveries, []);
});

test("genuine AI provider and model failures still offer Connect and retry", () => {
  for (const message of [
    "The AI provider could not answer.",
    "The selected AI model is not configured.",
    "The provider rejected the request: unauthorized (401).",
    "The selected model is unavailable.",
  ]) {
    const view = presentRuntimeError("runtime_failed", message);
    assert.equal(view.kind, "ai_provider");
    assert.deepEqual(view.recoveries, ["connect", "retry"]);
  }
});

test("budget, network, storage and unknown errors are distinct and never headline the raw code", () => {
  assert.equal(presentRuntimeError("budget_exceeded", "Step limit reached").kind, "budget");
  assert.equal(presentRuntimeError("request_failed", "fetch failed").kind, "network");
  assert.equal(presentRuntimeError("runtime_failed", "Could not save because the database is unavailable").kind, "storage");
  const unknown = presentRuntimeError("runtime_failed", "boom");
  assert.equal(unknown.kind, "unknown");
  assert.doesNotMatch(unknown.title, /runtime_failed/);
});

test("unconfirmed run outcomes and permission denials never offer an automatic retry", () => {
  for (const message of [
    "The Home restarted before this run's outcome was confirmed.",
    "The Home connection was lost before the run outcome was confirmed.",
  ]) {
    const view = presentRuntimeError("request_failed", message);
    assert.equal(view.kind, "unconfirmed");
    assert.deepEqual(view.recoveries, []);
  }
  const denied = presentRuntimeError("runtime_failed", "Source access revoked by its owner");
  assert.equal(denied.kind, "permission");
  assert.deepEqual(denied.recoveries, []);
  assert.equal(presentRuntimeError("runtime_failed", "The provider rejected the request: forbidden (403).").kind, "ai_provider");
  assert.doesNotMatch(presentRuntimeError("runtime_failed", "database unavailable").hint, /Nothing was lost/);
});
