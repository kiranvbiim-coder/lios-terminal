import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { artifactContentSchema, artifactExportPlanSchema } from "@shared/artifactContracts";
import { hasUnsupportedStandardPdfGlyph, requiresChromiumUnicodePdf,
  projectUnicodePdfItems, exportUnicodeArtifactPdf } from "./artifactUnicodePdf";

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
      sourceRef: "project:source:research-1", contentHash: hash,
    } },
  ],
  sections: [{ id: "findings", title: "Evidence", blockIds: ["title", "record"] }],
});

test("SI-04 Tamil, Hindi and other complex scripts route to local desktop shaping", () => {
  assert.equal(hasUnsupportedStandardPdfGlyph("123.45 Revenue € and “quotes”"), false);
  assert.equal(hasUnsupportedStandardPdfGlyph("தமிழ் அறிக்கை"), true);
  assert.equal(hasUnsupportedStandardPdfGlyph("हिंदी"), true);
  assert.equal(hasUnsupportedStandardPdfGlyph("₹"), true);
  assert.equal(requiresChromiumUnicodePdf(plan, report("தமிழ் சான்று ௧")), true);
  assert.equal(requiresChromiumUnicodePdf(plan, report("Recorded revenue €1.5m")), false);
});

test("Unicode exporter sends canonical source-linked text to desktop, never a URL", async () => {
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
    assert.ok(received.items.some((p: { text: string }) => p.text?.includes("project:source:research-1")));
  } finally { nativeWindow.window = old; }
});

test("Unicode PDF projects a complete verified local image instead of dropping it", () => {
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l5cAAAAASUVORK5CYII=";
  const buffer = Buffer.from(b64, "base64");
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const image = {
    mimeType: "image/png", dataBase64: b64, sha256,
    byteLength: buffer.length, width: 1, height: 1,
    sourceRef: "project:source:research-1",
  };
  const content = artifactContentSchema.parse({
    kind: "report",
    blocks: [
      { id: "text", type: "paragraph", text: "தமிழ்: recorded photograph" },
      { id: "photo", type: "image", text: "Recorded village pond image",
        attrs: { image } },
    ],
    sections: [{ id: "photos", title: "Village photos", blockIds: ["text","photo"] }],
  });
  const items = projectUnicodePdfItems(plan, content);
  const figure = items.find(item => item.kind === "image");
  assert.ok(figure?.kind === "image");
  assert.equal(figure.sha256, sha256);
  assert.equal(figure.dataBase64, b64);
  assert.equal(figure.byteLength, buffer.length);
  assert.equal(figure.sourceRef, image.sourceRef);

  const tampered = artifactContentSchema.parse({
    ...content,
    blocks: content.kind === "report" ? content.blocks.map(block => block.type === "image"
      ? { ...block, attrs: { image: { ...image,sha256:"f".repeat(64) } } } : block) : [],
  });
  assert.throws(() => projectUnicodePdfItems(plan, tampered), /integrity mismatch/);
});

test("Unicode PDF plots governed source points and keeps missing series observations absent", () => {
  const chart = artifactContentSchema.parse({
    kind: "report",
    blocks: [{
      id: "chart", type: "chart_ref", text: "Tamil yield trend",
      attrs: {
        sourceRef: "project:source:research-1",
        chart: {
          kind: "chart", chartType: "line", series: [
            { id: "a", label: "சாகுபடி", points: [{ x:"வாரம் 1",y:3 }, { x:"வாரம் 3",y:5 }] },
            { id: "b", label: "Control", points: [{ x:"வாரம் 2",y:2 }] },
          ],
        },
      },
    }],
    sections: [{ id: "chart-section", title: "Harvest", blockIds: ["chart"] }],
  });
  const items = projectUnicodePdfItems(plan, chart);
  const projected = items.find(item => item.kind === "chart");
  assert.ok(projected?.kind === "chart");
  assert.equal(projected.sourceRef, "project:source:research-1");
  assert.equal(projected.windows[0]?.series[0]?.label, "சாகுபடி");
  assert.equal(projected.windows[0]?.series.reduce((count, s) => count + s.points.length, 0), 3);
  const values = projected.windows[0]?.xValues;
  assert.deepEqual(values, ["வாரம் 1","வாரம் 3","வாரம் 2"]);
  const missing = projected.windows[0]?.series[0]?.points.map(x => x.xIndex);
  assert.deepEqual(missing, [0,1]);
  const duplicate = artifactContentSchema.parse({
    kind:"report",blocks:[{ id:"chart",type:"chart_ref",text:"bad",attrs:{
      chart:{kind:"chart",chartType:"line",series:[{id:"a",label:"bad",points:[
        {x:1,y:1},{x:1,y:2},
      ]}]},
    }}],sections:[{id:"sec",title:"Bad",blockIds:["chart"]}],
  });
  assert.throws(() => projectUnicodePdfItems(plan,duplicate), /Duplicate x values cannot be plotted/);
});

test("Without installed desktop runtime Unicode fails rather than rendering garbled standard PDF", async () => {
  const nativeWindow = globalThis as unknown as { window?: unknown };
  const old = nativeWindow.window;
  nativeWindow.window = {};
  try {
    await assert.rejects(exportUnicodeArtifactPdf(plan, report("தமிழ் மேற்கோள்")),
      /requires the installed LiOS desktop app/);
  } finally { nativeWindow.window = old; }
});
