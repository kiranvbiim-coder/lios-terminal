import test from "node:test";
import assert from "node:assert/strict";
import type { ArtifactDetail } from "./useArtifacts";
import {
  initialModelArtifactSaveState,
  isDisplayedModelSaved,
  modelArtifactSaveNotice,
  modelArtifactSaveReducer,
  selectedModelArtifactProject,
} from "./integratedModelArtifactSave";
import type { ModelArtifactSaveRequest } from "./integratedModelArtifactSave";

const request: ModelArtifactSaveRequest = { id: 1, runId: "completed-run-a", projectId: 7, projectName: "Valuation research" };
const detail: ArtifactDetail = {
  artifact: {
    id: "canonical-workbook-a", projectId: 7, ownerUserId: 11, organizationId: null,
    kind: "spreadsheet", title: "Retained engine workbook", status: "active", origin: "engine", headVersion: 3,
    forkedFromArtifactId: null, forkedFromVersion: null, createdAt: "2026-10-07T12:00:00.000Z", updatedAt: "2026-10-07T12:00:00.000Z",
    archivedAt: null, trashedAt: null, trashedByProjectId: null, trashedFromStatus: null,
  },
  version: {
    id: "canonical-version-a", artifactId: "canonical-workbook-a", version: 3, parentVersionId: "canonical-version-2",
    adapterId: "lios.spreadsheet", contentHash: "a".repeat(64),
    content: { kind: "spreadsheet", sheets: [{ id: "recorded-sheet", name: "Recorded output", cells: {}, names: {}, rowCount: 10, columnCount: 5 }], activeSheetId: "recorded-sheet", rendererPreference: "builtin", calculationMode: "automatic" },
    sourceRefs: [], executionReceiptIds: [], assumptionRefs: [], trustManifest: null, dependencyRefs: [], refreshSpec: null,
    note: null, createdByUserId: 11, createdAt: "2026-10-07T12:00:00.000Z",
  },
};

test("saving requires an explicit available Project, never the first or remembered Project", () => {
  const projects = [{ id: 7, name: "Valuation research" }, { id: 8, name: "Risk review" }];
  assert.equal(selectedModelArtifactProject("", projects), null);
  assert.equal(selectedModelArtifactProject("missing", projects), null);
  assert.equal(selectedModelArtifactProject("9", projects), null);
  assert.equal(selectedModelArtifactProject("8", projects), projects[1]);
  assert.equal(selectedModelArtifactProject("8", projects.slice(0, 1)), null);
});

test("in-flight status identifies its captured run and Project when the displayed model changes", () => {
  const saving = modelArtifactSaveReducer(initialModelArtifactSaveState, { type: "started", request });
  assert.match(modelArtifactSaveNotice(saving, request.runId)!, /Saving completed run completed-run-a to Valuation research/);
  assert.doesNotMatch(modelArtifactSaveNotice(saving, request.runId)!, /earlier run/);
  assert.match(modelArtifactSaveNotice(saving, "completed-run-b")!, /earlier run, not the displayed result/);
  assert.equal(isDisplayedModelSaved(saving.saved, request.runId, 7), false);
});

test("success exposes canonical server identity and version, not a client-generated workbook", () => {
  const saving = modelArtifactSaveReducer(initialModelArtifactSaveState, { type: "started", request });
  const saved = modelArtifactSaveReducer(saving, { type: "saved", request, detail });
  assert.equal(saved.pending, null);
  assert.equal(saved.saved?.detail, detail);
  assert.equal(isDisplayedModelSaved(saved.saved, request.runId, 7), true);
  assert.equal(isDisplayedModelSaved(saved.saved, request.runId, 8), false);
  assert.equal(isDisplayedModelSaved(saved.saved, request.runId, null), false);
  assert.match(modelArtifactSaveNotice(saved, request.runId)!, /Displayed run completed-run-a saved to Valuation research/);
  assert.match(modelArtifactSaveNotice(saved, request.runId)!, /Artifact canonical-workbook-a · v3/);
});

test("late successful retention of an earlier run remains openable without claiming the current result was saved", async () => {
  let state = modelArtifactSaveReducer(initialModelArtifactSaveState, { type: "started", request });
  let complete!: (value: ArtifactDetail) => void;
  const response = new Promise<ArtifactDetail>((resolve) => { complete = resolve; });
  const applying = response.then((value) => { state = modelArtifactSaveReducer(state, { type: "saved", request, detail: value }); });
  const currentRunId = "completed-run-b";
  complete(detail);
  await applying;
  assert.equal(state.saved?.detail.artifact.id, "canonical-workbook-a");
  assert.equal(isDisplayedModelSaved(state.saved, currentRunId, 7), false);
  assert.match(modelArtifactSaveNotice(state, currentRunId)!, /Earlier run completed-run-a saved/);
  assert.match(modelArtifactSaveNotice(state, currentRunId)!, /displayed result has not been saved by this request/);
  assert.doesNotMatch(modelArtifactSaveNotice(state, currentRunId)!, /Displayed run completed-run-b saved/);
});

test("a stale response cannot replace a newer pending save or its canonical target", () => {
  const next = { ...request, id: 2, runId: "completed-run-b", projectId: 8, projectName: "Risk review" };
  const saving = modelArtifactSaveReducer(initialModelArtifactSaveState, { type: "started", request: next });
  assert.equal(modelArtifactSaveReducer(saving, { type: "saved", request, detail }), saving);
  assert.equal(modelArtifactSaveReducer(saving, { type: "failed", request, message: "old failure" }), saving);
  const nextDetail: ArtifactDetail = { ...detail, artifact: { ...detail.artifact, id: "canonical-workbook-b", projectId: 8 }, version: { ...detail.version, artifactId: "canonical-workbook-b" } };
  const saved = modelArtifactSaveReducer(saving, { type: "saved", request: next, detail: nextDetail });
  assert.equal(saved.saved?.detail, nextDetail);
  assert.equal(isDisplayedModelSaved(saved.saved, next.runId, 8), true);
  assert.equal(modelArtifactSaveReducer(saved, { type: "saved", request, detail }), saved);
});

test("failed saving leaves prior canonical work available and reports the failed run, not a success", () => {
  const saving = modelArtifactSaveReducer(initialModelArtifactSaveState, { type: "started", request });
  const saved = modelArtifactSaveReducer(saving, { type: "saved", request, detail });
  const next = { ...request, id: 2, runId: "completed-run-b" };
  const pending = modelArtifactSaveReducer(saved, { type: "started", request: next });
  const failed = modelArtifactSaveReducer(pending, { type: "failed", request: next, message: "Project access changed" });
  assert.equal(failed.saved?.detail, detail);
  assert.equal(failed.pending, null);
  assert.equal(isDisplayedModelSaved(failed.saved, next.runId, 7), false);
  assert.match(modelArtifactSaveNotice(failed, next.runId)!, /Could not save run completed-run-b to Valuation research: Project access changed/);
  assert.match(modelArtifactSaveNotice(failed, next.runId)!, /displayed model result is unchanged/);
  assert.doesNotMatch(modelArtifactSaveNotice(failed, next.runId)!, /saved to/);
});

test("retrying the same run clears the visible failure and ignores late first-attempt errors", () => {
  const saving = modelArtifactSaveReducer(initialModelArtifactSaveState, { type: "started", request });
  const failed = modelArtifactSaveReducer(saving, { type: "failed", request, message: "Network interrupted" });
  const retry = { ...request, id: 2 };
  const retrying = modelArtifactSaveReducer(failed, { type: "started", request: retry });
  assert.equal(retrying.failure, null);
  assert.match(modelArtifactSaveNotice(retrying, retry.runId)!, /Saving completed run/);
  assert.equal(modelArtifactSaveReducer(retrying, { type: "failed", request, message: "late error" }), retrying);
  const saved = modelArtifactSaveReducer(retrying, { type: "saved", request: retry, detail });
  assert.equal(isDisplayedModelSaved(saved.saved, retry.runId, retry.projectId), true);
});
