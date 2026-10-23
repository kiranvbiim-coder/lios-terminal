import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const matrixPath = "docs/ux/LIOS_UI_UX_WS01_WS02_GAP_MATRIX_2026-10-23.md";
const planPath = "docs/ux/LIOS_ADAPTIVE_EXPERIENCE_EXECUTION_PLAN_2026-10-23.md";
const knownStates = new Set(["audit-complete", "pr-review-pending", "source-present-unqualified", "gap-confirmed", "needs-runtime-evidence"]);
const knownFindingStates = new Set(["gap-confirmed","pr-only","source-fixed-unqualified","needs-source-followup","needs-rendered-audit","needs-user-journey","intentional-optional"]);

/** The audit matrix is an annex. It must not silently lose a mapped workstream or misstate a missing file as main evidence. */
export function validateUiGapMatrix(matrix, plan, root = repositoryRoot) {
  const extract = (input, prefix) => input.split("\n").filter(line => line.startsWith("| " + prefix));
  const rows = extract(matrix, "WS-").map(line => line.split("|").slice(1, -1).map(value => value.trim()));
  const canonical = extract(plan, "**WS-").map(line => line.split("|")[1].trim().replace(/\*/g,""));
  assert.equal(canonical.length, 65, "Master plan must contain exactly 65 numbered UX workstreams");
  assert.equal(rows.length, canonical.length, "Audit must cover every canonical UX workstream exactly once");
  for (let i = 0; i < canonical.length; i++) {
    const [id, priority, state, evidence, pr, acceptance] = rows[i];
    assert.equal(id, canonical[i], "Workstream numbers/order must exactly match the canonical master plan");
    assert.match(priority, /^P[012]$/);
    assert.ok(knownStates.has(state), "Unknown evidence status: " + state);
    assert.ok(evidence?.startsWith("`src/") || evidence?.startsWith("`docs/"), "Source must cite actual in-tree path for " + id);
    const filepath = evidence.slice(1, -1);
    assert.ok(fs.existsSync(path.join(root, filepath)), "Unverifiable main source path: " + filepath);
    assert.ok(pr && (/^(?:—|#\d+)/.test(pr)), "Missing PR-only evidence field for " + id);
    assert.ok(acceptance?.length >= 12, "Missing acceptance requirement for " + id);
  }
  const issues = extract(matrix, "UX-A").map(line => line.split("|").slice(1, -1).map(value => value.trim()));
  assert.equal(issues.length, 18, "Every UX-A01..UX-A18 finding needs current-main disposition");
  for (let i = 0; i < issues.length; i++) {
    const [id,state,,summary,source] = issues[i];
    assert.equal(id, "UX-A" + String(i+1).padStart(2,"0"), "Finding IDs must be unique and ordered");
    assert.ok(knownFindingStates.has(state), "Unknown finding status: " + state);
    assert.ok(summary?.length >= 18, "Missing finding evidence: " + id);
    assert.match(source, /^`(?:src|docs)\/.+`$/);
    assert.ok(fs.existsSync(path.join(root, source.slice(1,-1))), "Missing original-audit evidence path: " + source);
  }
  assert.match(matrix, /Main SHA:[^\n]{0,8}`[0-9a-f]{40}`/);
  assert.match(matrix, /not a rendered UI test/i);
  return {workstreams:rows.length,findings:issues.length};
}

export function checkCheckedInUiGapMatrix(root = repositoryRoot) {
  return validateUiGapMatrix(
    fs.readFileSync(path.join(root,matrixPath), "utf8"),
    fs.readFileSync(path.join(root,planPath), "utf8"),
    root
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const counts=checkCheckedInUiGapMatrix();
  process.stdout.write("LIOS UX audit: " + counts.workstreams + " workstreams and " + counts.findings + " reconciled historical findings. Source consistency only; native acceptance NOT_RUN.\n");
}
