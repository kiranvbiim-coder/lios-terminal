import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as ts from "typescript";
import type { P9RunRecord } from "@/lib/useP9Automation";
import { watchroomRecordedHistory } from "@/lib/phase2ProjectPresentation";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
const run = (id: string, projectId: number, workflowId: string, status: P9RunRecord["status"], when: string): P9RunRecord => ({
  id, projectId, workflowId, status, triggerType: "manual", startedAt: when,
  completedAt: status === "running" ? null : when, summary: status, changed: status === "succeeded",
  conditionMet: false, relevanceScore: 0, sourceRefs: ["recorded:one"], engineRefs: [],
  artifactRefs: [], executionReceiptIds: ["receipt:one"], output: {}, error: status === "failed" ? "Recorded error" : null,
});

test("Watchroom visual chronology is based on observed P9 runs, not scheduled intentions", () => {
  const runs = [
    run("run:b", 5, "owned", "failed", "2026-10-27T11:00:00Z"),
    run("run:c", 6, "owned", "succeeded", "2026-10-27T12:00:00Z"),
    run("run:d", 5, "foreign", "succeeded", "2026-10-27T13:00:00Z"),
    run("run:a", 5, "owned", "skipped", "2026-10-27T09:00:00Z"),
  ];
  assert.deepEqual(watchroomRecordedHistory(5, "owned", runs).map(item => item.id), ["run:a", "run:b"]);
  assert.deepEqual(watchroomRecordedHistory(5, "owned", [runs[2]]), []);
});

test("Watchroom recorded timeline is parseable TSX", () => {
  const adapter = source("./WatchroomRecordedRunTimeline.tsx");
  const parsed = ts.transpileModule(adapter, {
    fileName: "WatchroomRecordedRunTimeline.tsx", reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  });
  assert.deepEqual((parsed.diagnostics ?? []).filter(x => x.category === ts.DiagnosticCategory.Error)
    .map(x => ts.flattenDiagnosticMessageText(x.messageText, " ")), []);
});
