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
  const adapter = source("./WatchroomRecordedRunTimeline.tsx");
  assert.match(adapter, /watchroomRecordedHistory\(projectId, workflowId, runs\)/);
  assert.match(adapter, /date: run\.startedAt/);
  assert.match(adapter, /run\.sourceRefs\.length/);
  assert.match(adapter, /run\.executionReceiptIds\.length/);
  assert.match(adapter, /"Running" : "Skipped"/);
  assert.match(adapter, /if \(history\.length < 2\) return null/);
  assert.doesNotMatch(adapter, /fetch\(|useQuery\(|createP9Workflow\(|setInterval\(|Math\.random\(/);
});

test("existing Watchrooms own a single lazy imported timeline and an explicit control", () => {
  const shell = source("./ProjectWatchroomDesk.tsx");
  assert.match(shell, /React\.lazy\(\(\) => import\("\.\/WatchroomRecordedRunTimeline"\)\)/);
  assert.match(shell, /recordedRuns\.length > 1/);
  assert.match(shell, /Explore run timeline/);
  assert.match(shell, /aria-expanded=\{timelineWorkflowId === room\.workflow\.id\}/);
  assert.match(shell, /setTimelineWorkflowId\(null\)/);
  assert.match(shell, /<WatchroomRecordedRunTimeline projectId=\{projectId\}/);
  assert.doesNotMatch(shell, /<BeuiTimeline|from ["']motion\/react/);
  const adapter = source("./WatchroomRecordedRunTimeline.tsx");
  assert.match(adapter, /from "\.\.\/vendor\/beui\/BeuiTimeline"/);
  assert.match(adapter, /defaultValue=\{events\[events\.length - 1\]\.id\}/);
  const parsed = ts.transpileModule(adapter, {
    fileName: "WatchroomRecordedRunTimeline.tsx", reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  });
  assert.deepEqual((parsed.diagnostics ?? []).filter(x => x.category === ts.DiagnosticCategory.Error)
    .map(x => ts.flattenDiagnosticMessageText(x.messageText, " ")), []);
});
