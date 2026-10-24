import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot, matrixPath, checkCheckedInUiGapMatrix, validateUiGapMatrix } from "./validate_ui_gap_matrix.mjs";

const matrix = fs.readFileSync(path.join(repositoryRoot,matrixPath),"utf8");
const plan = fs.readFileSync(path.join(repositoryRoot,"docs/ux/LIOS_ADAPTIVE_EXPERIENCE_EXECUTION_PLAN_2026-10-23.md"),"utf8");
test("WS-01/02 is a full source-backed 65-workstream matrix and reconciles every historical finding",()=>{
  assert.deepEqual(checkCheckedInUiGapMatrix(), {workstreams:65,findings:18});
});
test("duplicate or missing workstream IDs cannot pass the audit gate",()=>{
  assert.throws(()=>validateUiGapMatrix(matrix.replace("| WS-02 |","| WS-01 |"),plan),/Workstream numbers\/order/);
  assert.throws(()=>validateUiGapMatrix(matrix.replace(/^\| WS-65 \|.*$/m,""),plan),/every canonical UX workstream/);
});
test("a fabricated main source path or unsupported status cannot pass",()=>{
  assert.throws(()=>validateUiGapMatrix(matrix.replace("| WS-01 | P0 | audit-complete | `src/client/src/App.tsx`", "| WS-01 | P0 | audit-complete | `src/client/src/NotARealPage.tsx`"),plan),/Unverifiable main source path/);
  assert.throws(()=>validateUiGapMatrix(matrix.replace("| WS-28 | P0 | gap-confirmed |","| WS-28 | P0 | shipped |"),plan),/Unknown evidence status/);
});
test("historical UX fixes cannot disappear from reconciliation",()=>{
  assert.throws(()=>validateUiGapMatrix(matrix.replace(/^\| UX-A15 \|.*$/m,""),plan),/18/);
});