import assert from "node:assert/strict";
import test from "node:test";
import { artifactContentSchema, artifactExportPlanSchema } from "@shared/artifactContracts";
import { hasUnsupportedStandardPdfGlyph, requiresChromiumUnicodePdf,
  exportUnicodeArtifactPdf } from "./artifactUnicodePdf";

const hash = "a".repeat(64);
const plan = artifactExportPlanSchema.parse({
  artifactId: "artifact:local-unicode-report", version: 3, kind: "report",
  formats: ["pdf", "docx", "md"], filenameStem: "Research Report",
  contentHash: hash, sourceRefs: ["project:source:research-1"],
});
const report = (text: string) => artifactContentSchema.parse({
  kind: "report",
  templateId: "research_evidence_report",
  blocks: [
    { id: "title", type: "heading", text: "Research evidence" },
    { id: "record", type: "quote", text, attrs: {
      sourceRef: "project:source:research-1",
      contentHash: hash, excerptSha256: hash,
    } },
  ],
  sections: [{
    id: "findings", title: "Evidence", blockIds: ["title", "record"],
  }],
});

test("SI-04 Tamil, Hindi and other complex scripts route to local desktop shaping", () => {
  assert.equal(hasUnsupportedStandardPdfGlyph("123.45 Revenue € and “quotes”"), false);
  assert.equal(hasUnsupportedStandardPdfGlyph("தமிழ் அறிக்கை"), true);
  assert.equal(hasUnsupportedStandardPdfGlyph("हिंदी"), true);
  assert.equal(hasUnsupportedStandardPdfGlyph("₹"), true);
  assert.equal(requiresChromiumUnicodePdf(plan, report("தமிழ் சான்று ௧")), true);
  assert.equal(requiresChromiumUnicodePdf(plan, report("Recorded revenue €1.5m")), false);
});

test("Unicode exporter sends canonical source-linked text, not raw HTML or a remote URL", async () => {
  const nativeWindow = globalThis as unknown as { window?: {
    limuriaDesktop: { exportUnicodePdf: (input: any) => Promise<{ saved: boolean }> },
  } };
  const old = nativeWindow.window;
  let received: any = null;
  nativeWindow.window = {
    limuriaDesktop: { exportUnicodePdf: async input => { received = input; return { saved: true }; } },
  };
  try {
    await exportUnicodeArtifactPdf(plan, report("தமிழ் மேற்கோள்"));
    assert.equal(received.artifactId, plan.artifactId);
    assert.equal(received.contentHash, plan.contentHash);
    assert.equal(received.version, 3);
    assert.equal(received.filename, "Research Report-v3.pdf");
    assert.ok(received.paragraphs.some((p: { text: string }) => p.text.includes("தமிழ் மேற்கோள்")));
    assert.ok(received.paragraphs.some((p: { text: string }) => p.text.includes("project:source:research-1")));
    assert.equal(received.paragraphs.some((p: { text: string }) => p.text.includes("<iframe")), false);
  } finally { nativeWindow.window = old; }
});

test("Without installed desktop runtime Unicode fails clearly; it never degrades to garbled jsPDF", async () => {
  const nativeWindow = globalThis as unknown as { window?: unknown };
  const old = nativeWindow.window;
  nativeWindow.window = {};
  try {
    await assert.rejects(
      exportUnicodeArtifactPdf(plan, report("தமிழ் மேற்கோள்")),
      /requires the installed LiOS desktop app/,
    );
  } finally { nativeWindow.window = old; }
});

test("Unicode PDF refuses a recorded native chart rather than dropping it silently", async () => {
  const chart = artifactContentSchema.parse({
    kind: "report",
    blocks: [{ id: "chart", type: "chart_ref", text: "Chart", attrs: {
      chart: {
        kind: "chart", chartType: "line", series: [{
          id: "one", label: "Recorded", points: [{ x: 1, y: 5 }],
        }],
      },
    } }],
    sections: [{ id: "one", title: "Data", blockIds: ["chart"] }],
  });
  await assert.rejects(exportUnicodeArtifactPdf(plan, chart), /embedded charts or images/);
});
