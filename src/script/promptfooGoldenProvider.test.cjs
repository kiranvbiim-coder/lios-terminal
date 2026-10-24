const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const Provider = require("../evals/promptfoo/golden-provider.cjs");
const { runGoldenProbe } = Provider;

const good = (id = "R02") => ({ status: 0, signal: null, stdout: JSON.stringify({
  caseId: id, passed: true, failures: [], capabilities: ["company.research"], entities: ["apple"],
}) });

test("rejects unreviewed IDs before launching any process", async () => {
  let called = false;
  const blocked = runGoldenProbe("../../server/secrets", () => { called = true; });
  assert.match(blocked.error, /Invalid golden case ID/);
  assert.equal(called, false);
  assert.match((await new Provider().callApi("ignored", { vars: { caseId: "$(whoami)" } })).error, /Invalid/);
});

test("executes only the bounded planner command with no shell", () => {
  let args;
  const result = runGoldenProbe("R02", (...parts) => { args = parts; return good(); });
  assert.equal(JSON.parse(result.output).passed, true);
  assert.equal(args[0], process.execPath);
  assert.deepEqual(args[1], ["--import", "tsx", "evals/promptfoo/golden_probe.ts", "R02"]);
  assert.equal(args[2].shell, false);
  assert.equal(args[2].timeout, 15000);
});

test("fails closed on crash, invalid JSON, wrong case, and failing assertions", () => {
  assert.match(runGoldenProbe("R02", () => ({ status: 1, stdout: "" })).error, /unavailable/);
  assert.match(runGoldenProbe("R02", () => ({ status: 0, stdout: "not json" })).error, /Invalid JSON/);
  assert.match(runGoldenProbe("R02", () => good("R03")).error, /Invalid golden planner output/);
  assert.match(runGoldenProbe("R02", () => ({ ...good(), stdout: JSON.stringify({
    caseId: "R02", passed: false, failures: ["wrong entity"], capabilities: [], entities: [],
  }) })).error, /assertion failed/);
  assert.match(runGoldenProbe("R02", () => ({ status: 0, stdout: JSON.stringify({ caseId: "R02", passed: true }) })).error, /Invalid golden planner output/);
});

test("Promptfoo config only references review-owned must-pass cases", () => {
  const root = path.resolve(__dirname, "..");
  const yaml = fs.readFileSync(path.join(root, "evals/promptfoo/promptfooconfig.yaml"), "utf8");
  const cases = JSON.parse(fs.readFileSync(path.join(root, "evals/golden/routing.json"), "utf8")).cases;
  const ids = [...yaml.matchAll(/caseId:\s*([A-Z][A-Z0-9]+)/g)].map(match => match[1]);
  assert.deepEqual(ids, ["R01", "R02", "R03", "R09", "R10"]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.equal(cases.find(item => item.id === id)?.status, "must_pass");
  assert.match(yaml, /file:\/\/evals\/promptfoo\/golden-provider.cjs/);
});

test("real LiOS planner golden probe passes for lowercase company routing", {
  skip: !fs.existsSync(path.resolve(__dirname, "../node_modules/tsx")) && "tsx not installed in this environment",
}, () => {
  const result = runGoldenProbe("R02");
  assert.equal(result.error, undefined, result.error);
  assert.equal(JSON.parse(result.output).passed, true);
});
