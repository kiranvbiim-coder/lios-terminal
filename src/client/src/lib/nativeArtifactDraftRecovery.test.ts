import assert from "node:assert/strict";
import test from "node:test";
import { artifactContentSchema, spreadsheetArtifactContentSchema } from "@shared/artifactContracts";
import { fromUniverWorkbookSnapshot, toUniverWorkbookProjection } from "@shared/univerArtifact";
import { spreadsheetDraftHasChanges } from "./artifactSpreadsheetDraft";
import { matchesNativeArtifactDraft, nativeDraftRecoveryKey, shouldClearRevertedNativeDraft } from "./nativeArtifactDraftRecovery";

const context = {
  owner: "Owner@Example.com",
  artifactId: "artifact:12345678-1234-1234-1234-123456789abc",
  baseVersion: 3,
  contentHash: "b".repeat(64),
};
const content = artifactContentSchema.parse({ kind: "report", blocks: [] });
const snapshot = { baseVersion: 3, contentHash: context.contentHash, content };

test("native draft recovery only accepts a schema-valid exact immutable Artifact revision", () => {
  assert.equal(matchesNativeArtifactDraft(snapshot, context, "report"), true);
  assert.equal(matchesNativeArtifactDraft(snapshot, { ...context, baseVersion: 4 }, "report"), false);
  assert.equal(matchesNativeArtifactDraft(snapshot, { ...context, contentHash: "c".repeat(64) }, "report"), false);
  assert.equal(matchesNativeArtifactDraft(snapshot, context, "spreadsheet"), false);
  assert.equal(matchesNativeArtifactDraft({ ...snapshot, content: { kind: "report", blocks: [{ id: "", type: "bad", text: "" }] } }, context, "report"), false);
});

test("native draft mutation ordering partitions by canonical Artifact and signed-in owner", () => {
  const own = nativeDraftRecoveryKey(context);
  assert.equal(own, nativeDraftRecoveryKey({ ...context, owner: "owner@example.COM" }));
  assert.notEqual(own, nativeDraftRecoveryKey({ ...context, owner: "other@example.com" }));
  assert.notEqual(own, nativeDraftRecoveryKey({ ...context, artifactId: "artifact:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }));
});


test("only the editor that actually reverted unsaved content may clear its encrypted checkpoint", () => {
  assert.equal(shouldClearRevertedNativeDraft(true, false, true, false), true,
    "reverting all local changes removes the obsolete recovery prompt");
  assert.equal(shouldClearRevertedNativeDraft(false, false, true, false), false,
    "a clean second viewer must not erase another editor's local recovery");
  assert.equal(shouldClearRevertedNativeDraft(true, true, true, false), false,
    "still-dirty edits must retain the checkpoint");
  assert.equal(shouldClearRevertedNativeDraft(true, false, false, false), false,
    "no destructive cleanup before native recovery has been read");
  assert.equal(shouldClearRevertedNativeDraft(true, false, true, true), false,
    "an unresolved recovered candidate always requires an explicit user decision");
});


test("advanced Univer worksheet recovery retains formulas, formats, multiple sheets and canonical source fields", () => {
  const original = spreadsheetArtifactContentSchema.parse({
    kind: "spreadsheet", rendererPreference: "univer", activeSheetId: "model",
    sheets: [
      { id: "model", name: "Model", rowCount: 30, columnCount: 12, cells: {
        B4: { raw: "123.00", format: "0.00" },
        C4: { raw: "=B4*(1+0.15)", format: "0.00" },
      } },
      { id: "actuals", name: "Actuals", rowCount: 30, columnCount: 12, cells: {
        B4: { raw: "111.00", format: "0.00" },
      } },
    ],
  });
  const nativeSnapshot = toUniverWorkbookProjection(original);
  nativeSnapshot.sheets.model.cellData![3]![1]!.v = 456;
  nativeSnapshot.sheets.actuals.cellData![3]![1]!.v = 222;
  const localUnsaved = fromUniverWorkbookSnapshot(nativeSnapshot, original, "actuals");
  assert.equal(spreadsheetDraftHasChanges(original, localUnsaved), true);
  assert.equal(localUnsaved.activeSheetId, "actuals");
  assert.equal(localUnsaved.sheets[0].cells.B4.raw, "456");
  assert.equal(localUnsaved.sheets[0].cells.C4.raw, "=B4*(1+0.15)");
  assert.equal(localUnsaved.sheets[0].cells.B4.format, "0.00");
  assert.equal(localUnsaved.sheets[1].cells.B4.raw, "222");
  assert.equal(matchesNativeArtifactDraft({ baseVersion: 3, contentHash: context.contentHash, content: localUnsaved },
    context, "spreadsheet"), true);
  assert.deepEqual(fromUniverWorkbookSnapshot(toUniverWorkbookProjection(localUnsaved), localUnsaved, "actuals"),
    localUnsaved, "reopening the protected projection preserves the same unsaved formulas, values and worksheets");
});
