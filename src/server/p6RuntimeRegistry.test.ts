import test from "node:test";
import assert from "node:assert/strict";
import {
  P6_RUNTIME_CANDIDATES,
  activeP6RuntimeCandidates,
  assertNoOptionalRuntimeLockIn,
  p6RuntimeCandidate,
} from "./p6RuntimeRegistry";

test("P6 keeps a built-in deterministic backtest path", () => {
  const core = p6RuntimeCandidate("lios.backtest.core-v1");
  assert.ok(core);
  assert.equal(core.lifecycle, "builtin");
  assert.equal(core.bundled, true);
  assert.equal(core.active, true);
});

test("P6 represents packaged EdgarTools as managed bundled", () => {
  const edgar = p6RuntimeCandidate("edgartools");
  assert.ok(edgar);
  assert.equal(edgar.lifecycle, "managed_bundled");
  assert.equal(edgar.bundled, true);
  assert.equal(edgar.active, true);
  assert.ok(activeP6RuntimeCandidates().some((candidate) => candidate.id === "edgartools"));
});

test("P6 optional and research donor runtimes never become base dependencies", () => {
  const optional = P6_RUNTIME_CANDIDATES.filter((candidate) =>
    candidate.lifecycle === "qualified_optional" || candidate.lifecycle === "research_only"
  );
  assert.ok(optional.length > 0);
  assert.ok(optional.every((candidate) => candidate.bundled === false));
  assert.doesNotThrow(() => assertNoOptionalRuntimeLockIn());
});
