import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactExportFormatSchema,
  artifactExportFormatsForKind,
} from "./artifactContracts";

test("SI-04.13 exposes DOCX only for the bounded document-like Artifact kinds", () => {
  assert.equal(
    artifactExportFormatSchema.safeParse("docx").success,
    true,
    "docx must be a canonical Artifact export format",
  );

  for (const kind of ["research", "report", "decision", "thesis"] as const) {
    assert.ok(
      artifactExportFormatsForKind(kind).includes("docx" as never),
      `${kind} should support DOCX export`,
    );
  }

  for (const kind of [
    "chart",
    "table",
    "screen",
    "valuation",
    "portfolio",
    "spreadsheet",
    "data",
    "backtest",
    "strategy",
    "timeline",
  ] as const) {
    assert.equal(
      artifactExportFormatsForKind(kind).includes("docx" as never),
      false,
      `${kind} must not claim DOCX fidelity in SI-04.13`,
    );
  }
});
