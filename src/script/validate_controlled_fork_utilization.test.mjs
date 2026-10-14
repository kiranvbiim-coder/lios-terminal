import assert from "node:assert/strict";
import test from "node:test";
import { loadControlledForkInputs, validateControlledForkUtilization } from "./validate_controlled_fork_utilization.mjs";

const original = loadControlledForkInputs();
const copy = () => structuredClone(original);

test("recorded forks preserve the canonical baseline and never treat observed fork HEADs as approved pins", () => {
  const result = validateControlledForkUtilization(copy());
  assert.equal(result.baselineDonors, 92);
  assert.equal(result.pinnedMirrors, 0);
});

test("rejects duplicate identity and non-SHA fork observations", () => {
  const data = copy();
  data.inventory.mirrors[1].forkRepository = data.inventory.mirrors[0].forkRepository;
  assert.throws(() => validateControlledForkUtilization(data), /Duplicate fork repository/);
  const short = copy();
  short.inventory.mirrors[0].observedCommit = "HEAD";
  assert.throws(() => validateControlledForkUtilization(short), /regular expression/);
});

test("unregistered fork cannot pretend to be imported or runtime-qualified", () => {
  const data = copy();
  const finGpt = data.inventory.mirrors.find((x) => x.id === "FinGPT");
  finGpt.status = "partially_integrated_pinned_paths";
  assert.throws(() => validateControlledForkUtilization(data), /Unregistered mirror cannot claim/);
});

test("rejects unrelated upstream substitution (dexter-js is not virattt/dexter)", () => {
  const data = copy();
  const fork = data.inventory.mirrors.find((x) => x.id === "dexter-js");
  fork.baselineDonorId = "dexter";
  assert.throws(() => validateControlledForkUtilization(data), /Mirror upstream cannot be substituted/);
});

test("rejects false baseline evidence or donor-integration claim", () => {
  const wrongCount = copy();
  wrongCount.inventory.baselineDonorCount = 93;
  assert.throws(() => validateControlledForkUtilization(wrongCount), /92-donor baseline/);
  const wrongUse = copy();
  const qlibComponent = wrongUse.components.components.find((component) => component.id === "qlib");
  qlibComponent.commitSha = "0".repeat(40);
  assert.throws(() => validateControlledForkUtilization(wrongUse), /exact approved pin/);
});

test("unplanned phases cannot be silently mapped to SI-05", () => {
  const wrong = copy();
  wrong.inventory.mirrors[0].si05Workstreams = ["SI-05.99"];
  assert.throws(() => validateControlledForkUtilization(wrong), /Unknown SI-05 workstream/);
});

test("supplemental imports require exact upstream component, path and pin evidence without expanding the baseline", () => {
  const data = copy();
  const component = data.components.components.find((entry) => entry.id === "FinRobot");
  component.repository = "unrelated/FinRobot";
  assert.throws(() => validateControlledForkUtilization(data), /exact supplemental component/);
  const missingPaths = copy();
  missingPaths.components.components.find((entry) => entry.id === "FinRobot").destinationPaths = [];
  assert.throws(() => validateControlledForkUtilization(missingPaths), /exact supplemental component/);
});
