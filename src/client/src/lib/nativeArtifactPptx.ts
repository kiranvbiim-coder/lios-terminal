import PptxGenJSImport from "pptxgenjs";
import type PptxGenJS from "pptxgenjs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { artifactExportPlanSchema, chartArtifactContentSchema } from "@shared/artifactContracts";
import type { ArtifactContent, ArtifactExportPlan } from "@shared/artifactContracts";
import { buildOfficeArtifactMetadataXml, type OfficeArtifactBinding, type OfficeArtifactTextSegment } from "@shared/officeArtifactRoundtrip";
import { readRecordedDocumentTable, recordedDocumentValue } from "@shared/richArtifactDocument";
import { readArtifactImage, artifactImageDataUri, ARTIFACT_IMAGE_LIMITS, type ArtifactImage } from "@shared/artifactImage";
import { artifactDocumentParagraphs, artifactExportFilename, isDocumentArtifact } from "./artifactDocumentExport";
import type { ArtifactDocumentParagraph } from "./artifactDocumentExport";
import { prepareArtifactChart } from "./artifactChartProjection";
import type { ArtifactChartProjection, ChartArtifactContent } from "./artifactChartProjection";
import type { GeneratedPptx } from "./exportPptx";
import { officeDocumentBindings } from "./nativeArtifactDocx";

const MAX_SLIDES = 200;
const MAX_CHARACTERS = 4_000_000;
// fflate stores local calendar fields, so choose the same DOS timestamp in every timezone.
const ZIP_MTIME = new Date(1980, 0, 1);
const FIXED_TIME = "1980-01-01T00:00:00Z";
const BODY_LINES = 14;
const COLUMNS_PER_PAGE = 8;
const TABLE_LINE_HEIGHT = 0.19;
const TABLE_HEIGHT = 5.7;
type DocumentTable = Extract<ArtifactContent, { kind: "table" }>;
type NativeBlock = ({ kind: "table"; id: string; table: DocumentTable } | { kind: "chart"; id: string; chart: ChartArtifactContent; projection: ArtifactChartProjection } | { kind: "image"; id: string; image: ArtifactImage }) & { path: (string | number)[] };
type PresentationItem = (ArtifactDocumentParagraph & { binding: OfficeArtifactBinding; editableUntil?: number }) | NativeBlock;

function xml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function validateTextTree(value: unknown): void {
  let characters = 0;
  const visit = (item: unknown, depth: number) => {
    if (depth > 50) throw new Error("Professional Artifact PPTX exceeds the metadata nesting limit.");
    if (typeof item === "string") {
      characters += item.length;
      if (characters > MAX_CHARACTERS) throw new Error("Professional Artifact export exceeds the document layout limit; export JSON for the complete source.");
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(item)) throw new Error("Professional Artifact PPTX contains text that is not valid Office XML.");
    } else if (typeof item === "number" && !Number.isFinite(item)) {
      throw new Error("Professional Artifact PPTX requires finite recorded numeric values.");
    } else if (item && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) { visit(key, depth + 1); visit(child, depth + 1); }
    }
  };
  visit(value, 0);
}

function projectChart(chart: ChartArtifactContent): ArtifactChartProjection {
  const parsed = chartArtifactContentSchema.safeParse(chart);
  if (!parsed.success) throw new Error("Professional Artifact PPTX requires a valid recorded chart payload.");
  const projection = prepareArtifactChart(chart);
  if (projection.status !== "ready") throw new Error(projection.message);
  if (projection.chartType === "scatter" && projection.xKind !== "number") throw new Error("Native scatter PPTX requires finite numeric x observations; categorical x cannot be inferred.");
  if (projection.series.length > 20 || projection.totalDistinctPoints > 10_000 || projection.series.length * projection.totalDistinctPoints > 100_000) {
    throw new Error("Native chart PPTX exceeds the series/point layout limit; export JSON for the complete source.");
  }
  return projection;
}

/** Keep the common narrative/evidence projection, replacing only recognized payloads with native objects. */
function presentationItems(plan: ArtifactExportPlan, content: ArtifactContent): PresentationItem[] {
  if (content.kind === "chart") {
    const projection = projectChart(content);
    return [
      { style: "title", text: plan.filenameStem, binding: { id: "", kind: "text", path: [], text: plan.filenameStem, editable: false } },
      { kind: "chart", id: plan.artifactId, chart: content, projection, path: [] },
      ...[{ style: "meta" as const, text: `Chart options (recorded): ${recordedDocumentValue(content.options)}` },
        ...content.series.map(series => ({ style: "meta" as const, text: `Series: ${series.id} · ${series.label}` })),
        ...evidenceParagraphs(plan)].map(item => ({ ...item, binding: { id: "", kind: "text" as const, path: [], text: item.text, editable: false } })),
    ];
  }
  if (!isDocumentArtifact(content)) throw new Error(`Professional Artifact PPTX publishing is not supported for kind "${content.kind}".`);
  if (content.kind !== "report" && content.kind !== "research") {
    const paragraphs = artifactDocumentParagraphs(plan, content);
    const bindings = officeDocumentBindings(plan, content, false, paragraphs);
    return paragraphs.map((paragraph, index) => ({ ...paragraph, binding: bindings[index] }));
  }
  const native = new Map<string, NativeBlock>();
  let imageBytes = 0;
  // A control-character sentinel cannot occur in recorded Office text (validated above).
  const blocks = content.blocks.map((block, index) => {
    let payload: NativeBlock | undefined;
    const attrs = { ...block.attrs };
    if (block.type === "table" && Object.hasOwn(attrs, "table")) {
      const result = readRecordedDocumentTable(attrs);
      if (result.status !== "recognized") throw new Error(`Native table ${block.id}: ${result.reason}`);
      if (!result.table.columns.length || result.table.columns.length * Math.max(1, result.table.rows.length) > 100_000) throw new Error("Native table PPTX exceeds the column/cell layout limit.");
      payload = { kind: "table", id: block.id, table: result.table, path: ["blocks", index, "attrs", "table"] };
      const { rows: _rows, columns, ...metadata } = result.table;
      attrs.tableMetadata = { ...metadata, columns };
      delete attrs.table;
    } else if (block.type === "chart_ref") {
      if (Object.hasOwn(attrs, "chart")) {
        const chart = attrs.chart as ChartArtifactContent;
        payload = { kind: "chart", id: block.id, chart, projection: projectChart(chart), path: ["blocks", index, "attrs", "chart"] };
        attrs.chartMetadata = { chartType: chart.chartType, options: chart.options, series: chart.series.map(({ points: _points, ...series }) => series) };
        delete attrs.chart;
      } else {
        return { ...block, type: "paragraph" as const, text: `${block.text}${block.text ? "\n" : ""}Chart reference ${block.id}: recorded chart payload unavailable in this version; no remote content fetched.` };
      }
    } else if (block.type === "image") {
      const image = readArtifactImage(attrs.image);
      imageBytes += image.byteLength;
      if (imageBytes > ARTIFACT_IMAGE_LIMITS.totalBytes) throw new Error("Professional Artifact images exceed the 3 MiB document bound.");
      payload = { kind: "image", id: block.id, image, path: ["blocks", index, "attrs", "image"] };
      const { dataBase64: _data, ...metadata } = image;
      attrs.imageMetadata = metadata;
      delete attrs.image;
    }
    if (!payload) return block;
    const marker = `\u0001LIOS_NATIVE_${index}\u0001`;
    native.set(marker, payload);
    return { ...block, type: "paragraph" as const, text: `${block.text}${block.text ? "\n" : ""}${marker}`, attrs };
  });
  const projectedContent = { ...content, blocks };
  const paragraphs = artifactDocumentParagraphs(plan, projectedContent);
  const bindings = officeDocumentBindings(plan, projectedContent, false, paragraphs);
  const items: PresentationItem[] = [];
  paragraphs.forEach((paragraph, index) => {
    for (const part of paragraph.text.split(/(\u0001LIOS_NATIVE_\d+\u0001)/)) {
      const payload = native.get(part);
      if (payload) items.push(payload);
      else if (part) {
        const text = part.replace(/\n$/, "");
        const binding = { ...bindings[index], text };
        // The sentinel is only a layout device, never part of canonical block text.
        // Missing chart-reference notices remain read-only intervals after the real caption.
        let editableUntil: number | undefined;
        if (binding.path[0] === "blocks" && binding.path[2] === "text" && binding.textOffset === undefined) {
          const original = content.blocks[binding.path[1] as number];
          binding.textOffset = 0;
          if (text.startsWith(original.text) && text !== original.text) editableUntil = original.text.length;
          else if (!original.text.startsWith(text)) binding.editable = false;
        }
        items.push({ ...paragraph, text, binding, ...(editableUntil !== undefined ? { editableUntil } : {}) });
      }
    }
  });
  return items;
}

function evidenceParagraphs(plan: ArtifactExportPlan): ArtifactDocumentParagraph[] {
  return [
    { style: "heading1", text: "Evidence & provenance" },
    ...[`Artifact: ${plan.artifactId}`, `Version: ${plan.version}`, `Kind: ${plan.kind}`, `Content hash: ${plan.contentHash}`].map(text => ({ style: "meta" as const, text })),
    ...(plan.sourceRefs.length ? [...new Set(plan.sourceRefs)].sort().map(source => ({ style: "meta" as const, text: `Source: ${source}` })) : [{ style: "meta" as const, text: "Sources: none recorded" }]),
  ];
}

function splitText(text: string, width: number): string[] {
  return text.split(/\r?\n/).flatMap(line => {
    const chunks: string[] = [];
    let offset = 0;
    do {
      let end = Math.min(line.length, offset + width);
      if (end < line.length && /[\uDC00-\uDFFF]/.test(line[end])) end--;
      chunks.push(line.slice(offset, end));
      offset = end;
    } while (offset < line.length);
    return chunks;
  });
}

function paragraphOptions(item: ArtifactDocumentParagraph): PptxGenJS.TextPropsOptions {
  const heading = item.style === "heading1" || item.style === "heading2";
  return {
    fontFace: item.style === "code" ? "Courier New" : "Arial",
    fontSize: item.style === "title" ? 22 : item.style === "heading1" ? 20 : item.style === "heading2" ? 18 : item.style === "meta" ? 12 : 16,
    bold: item.style === "title" || heading,
    italic: item.style === "quote",
    color: item.style === "meta" ? "64748B" : item.style === "quote" ? "475569" : heading || item.style === "title" ? "0F172A" : "334155",
    lineSpacingMultiple: 1.15,
    paraSpaceAfter: item.style === "meta" ? 2 : 3,
  };
}

function addNativeTable(block: Extract<NativeBlock, { kind: "table" }>, newSlide: (title: string) => PptxGenJS.Slide, bind: (binding: Omit<OfficeArtifactBinding, "id" | "part">) => string): void {
  const { table } = block;
  // Explicit vertical and horizontal pagination: every recorded cell remains editable and literal.
  for (let startColumn = 0; startColumn < table.columns.length; startColumn += COLUMNS_PER_PAGE) {
    const columns = table.columns.slice(startColumn, startColumn + COLUMNS_PER_PAGE);
    const charsPerLine = Math.max(8, Math.floor(72 / columns.length));
    const headers = columns.map(column => column.label);
    const height = (cells: string[]) => Math.max(...cells.map(cell => splitText(cell, charsPerLine).length)) * TABLE_LINE_HEIGHT + 0.12;
    const headerHeight = height(headers);
    if (headerHeight > TABLE_HEIGHT / 2) throw new Error("Native table PPTX header exceeds the cell layout limit.");
    let rows: string[][] = [];
    let heights: number[] = [];
    let used = headerHeight;
    let page = 0;
    let rowStart = 0;
    const flush = () => {
      const slide = newSlide(`Recorded table · ${block.id} · columns ${startColumn + 1}–${startColumn + columns.length} · page ${++page}`);
      const objectName = bind({ kind: "table", path: block.path, editable: true, rowStart, rowCount: rows.length, columnStart: startColumn, columnCount: columns.length });
      slide.addTable([headers, ...rows].map((row, index) => row.map((text, columnIndex) => ({
        text,
        options: {
          bold: index === 0,
          color: index === 0 ? "FFFFFF" : "334155",
          fill: { color: index === 0 ? "334155" : (rowStart + index - 1) % 2 === 0 ? "FFFFFF" : "F1F5F9" },
          align: columns[columnIndex].type === "number" || columns[columnIndex].type === "currency" || columns[columnIndex].type === "percent" ? "right" : "left",
        },
      }))), {
        objectName, x: 0.55, y: 1.05, w: 12.23, h: used, colW: columns.map(() => 12.23 / columns.length), rowH: [headerHeight, ...heights],
        fontFace: "Arial", fontSize: 11, color: "334155", margin: [4, 5, 4, 5], breakLine: false,
        border: { type: "solid", color: "CBD5E1", pt: 0.5 }, valign: "top", autoPage: false,
      });
      rowStart += rows.length;
      rows = []; heights = []; used = headerHeight;
    };
    for (const row of table.rows) {
      const cells = columns.map(column => Object.hasOwn(row, column.key) ? recordedDocumentValue(row[column.key]) : "Not recorded");
      const rowHeight = height(cells);
      if (rowHeight + headerHeight > TABLE_HEIGHT) throw new Error("Native table PPTX cell exceeds the cell layout limit; export JSON for the complete source.");
      if (used + rowHeight > TABLE_HEIGHT) flush();
      rows.push(cells); heights.push(rowHeight); used += rowHeight;
    }
    if (rows.length || !table.rows.length) flush();
  }
}

function addNativeChart(block: Extract<NativeBlock, { kind: "chart" }>, slide: PptxGenJS.Slide, bind: (binding: Omit<OfficeArtifactBinding, "id" | "part">) => string): void {
  const { projection } = block;
  if (!projection.totalSourcePoints) {
    const text = "No chart observations recorded in this version.";
    slide.addText(text, { objectName: bind({ kind: "text", path: [], text, editable: false }), x: 0.55, y: 1.2, w: 12.23, h: 1, fontSize: 18 });
    return;
  }
  const labels = projection.xValues.map(recordedDocumentValue);
  // PptxGenJS 4.0.1 uses `value || ''` in categorical XLSX serialization. Literal numeric
  // strings retain genuine zero/-zero without converting missing observations into zeros.
  // addChart accepts any[]; its numeric XML serializer writes these exact finite literals.
  const data = projection.series.map(series => ({
    name: series.label, labels: [...labels],
    values: projection.xValues.map(x => { const point = series.points.get(x); return point ? recordedDocumentValue(point.y) : ""; }),
  }));
  if (projection.chartType === "scatter") data.unshift({ name: "X observations", labels: [...labels], values: [...labels] });
  const colors = ["2563EB", "DC2626", "059669", "7C3AED", "D97706", "0891B2"];
  const objectName = bind({
    kind: "chart", path: block.path, editable: true,
    sourceIndices: projection.series.map(series => projection.xValues.map(x => series.points.get(x)?.sourcePointIndex ?? -1)),
  });
  slide.addChart(projection.chartType, data, {
    objectName, x: 0.55, y: 1.05, w: 12.23, h: 5.7, displayBlanksAs: "gap", showLegend: true, showLabel: false,
    showTitle: false, showValue: false, showSerName: false,
    chartColors: Array.from({ length: projection.series.length + 1 }, (_, index) => colors[index % colors.length]),
    lineDataSymbol: "circle", lineDataSymbolSize: 4,
    catAxisLabelFontSize: 11, valAxisLabelFontSize: 11, legendFontSize: 11,
    // Omit catLabelFormatCode: the donor treats ANY supplied value as numeric/date categories.
    valLabelFormatCode: "General",
  });
}

/** Normalize serialization metadata and package-local donor IDs, never the recorded payload. */
function deterministicPackage(bytes: Uint8Array, plan?: ArtifactExportPlan, content?: ArtifactContent, bindings?: OfficeArtifactBinding[]): Uint8Array {
  const serialized = unzipSync(bytes);
  // PptxGenJS uses a module-global chart counter. Canonicalize real part names by this
  // presentation's chart order, including its actual workbook and OPC references.
  const chartIds = Object.keys(serialized).flatMap(path => {
    const match = path.match(/^ppt\/charts\/chart(\d+)\.xml$/);
    return match ? [Number(match[1])] : [];
  }).sort((a, b) => a - b);
  const partNames = new Map<string, string>();
  const filenames = new Map<string, string>();
  chartIds.forEach((id, index) => {
    const oldChart = `chart${id}.xml`;
    const chart = `chart${index + 1}.xml`;
    const oldWorkbook = `Microsoft_Excel_Worksheet${id}.xlsx`;
    const workbook = `Microsoft_Excel_Worksheet${index + 1}.xlsx`;
    partNames.set(`ppt/charts/${oldChart}`, `ppt/charts/${chart}`);
    partNames.set(`ppt/charts/_rels/${oldChart}.rels`, `ppt/charts/_rels/${chart}.rels`);
    partNames.set(`ppt/embeddings/${oldWorkbook}`, `ppt/embeddings/${workbook}`);
    filenames.set(oldChart, chart);
    filenames.set(oldWorkbook, workbook);
  });
  const files: Record<string, Uint8Array> = {};
  for (const [serializedPath, serializedBytes] of Object.entries(serialized)) {
    const path = partNames.get(serializedPath) ?? serializedPath;
    let data = serializedBytes;
    if (path.endsWith(".xlsx")) data = deterministicPackage(data);
    if (path.endsWith(".xml") || path.endsWith(".rels")) {
      let text = strFromU8(data);
      if (filenames.size) text = text.replace(/\b(Target|PartName)="([^"]+)"/g, (attribute, name: string, target: string) => {
        const slash = target.lastIndexOf("/");
        const canonical = filenames.get(target.slice(slash + 1));
        return canonical ? `${name}="${target.slice(0, slash + 1)}${canonical}"` : attribute;
      });
      if (path.endsWith("docProps/core.xml")) {
        text = text.replace(/(<dcterms:(?:created|modified)\b[^>]*>)[^<]*(<\/dcterms:(?:created|modified)>)/g, `$1${FIXED_TIME}$2`);
        if (plan) text = text.replace("</cp:coreProperties>", `<dc:identifier>${xml(plan.artifactId)}</dc:identifier><cp:keywords>${xml(plan.contentHash)}</cp:keywords></cp:coreProperties>`);
      } else if (/^ppt\/charts\/chart\d+\.xml$/.test(path)) {
        // Numeric cache blanks are absent indexed points; string category blanks stay exact.
        text = text.replace(/<c:numCache>[\s\S]*?<\/c:numCache>/g, cache => cache.replace(/<c:pt idx="\d+"><c:v><\/c:v><\/c:pt>/g, ""));
      } else if (/^ppt\/slides\/slide\d+\.xml$/.test(path)) {
        // The donor table counter can collide with ordinary shape IDs. Numeric Office
        // IDs are package-local; names carry the canonical binding identity.
        let shapeId = 0;
        text = text.replace(/<p:cNvPr\b[^>]*>/g, element => element.replace(/\bid="\d+"/, `id="${++shapeId}"`));
      }
      data = strToU8(text);
    }
    files[path] = data;
  }
  if (plan && content && bindings) {
    // Resolve chart/workbook identities only after donor counters have been normalized.
    for (const binding of bindings) {
      if (binding.kind === "image" && binding.part) {
        const slide = strFromU8(files[binding.part]);
        const picture = slide.match(new RegExp(`<p:pic\\b[\\s\\S]*?<p:cNvPr\\b[^>]*\\bname="${binding.id}"[\\s\\S]*?<a:blip\\b[^>]*\\br:embed="([^"]+)"[\\s\\S]*?</p:pic>`));
        if (!picture) throw new Error("Native image is missing its Office binding.");
        const slideRels = binding.part.replace("/slides/", "/slides/_rels/") + ".rels";
        const target = strFromU8(files[slideRels]).match(new RegExp(`<Relationship\\b(?=[^>]*\\bId="${picture[1]}")(?=[^>]*\\bTarget="([^"]+)")[^>]*/>`))?.[1];
        if (!target || !/^\.\.\/media\/[A-Za-z0-9_.-]+$/.test(target)) throw new Error("Native image binding has no package-local media relationship.");
        binding.mediaPart = `ppt/${target.slice(3)}`;
        if (!files[binding.mediaPart]) throw new Error("Native image media part is missing.");
        const offset = slide.match(/<a:off x="(\d+)" y="(\d+)"\/>/g)?.at(-1)?.match(/x="(\d+)" y="(\d+)"/);
        const extent = slide.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/g)?.at(-1)?.match(/cx="(\d+)" cy="(\d+)"/);
        if (!offset || !extent) throw new Error("Native image geometry is missing.");
        binding.geometry = { x: Number(offset[1]), y: Number(offset[2]), cx: Number(extent[1]), cy: Number(extent[2]) };
      }
      if (binding.kind !== "chart" || !binding.part) continue;
      const slide = strFromU8(files[binding.part]);
      const frame = slide.match(new RegExp(`<p:graphicFrame\\b[\\s\\S]*?<p:cNvPr\\b[^>]*\\bname="${binding.id}"[\\s\\S]*?<c:chart\\b[^>]*\\br:id="([^"]+)"[\\s\\S]*?</p:graphicFrame>`));
      if (!frame) throw new Error("Native chart is missing its Office binding.");
      const slideRels = binding.part.replace("/slides/", "/slides/_rels/") + ".rels";
      const relationship = strFromU8(files[slideRels]).match(new RegExp(`<Relationship\\b(?=[^>]*\\bId="${frame[1]}")(?=[^>]*\\bTarget="([^"]+)")[^>]*/>`));
      const chartName = relationship?.[1].match(/(?:^|\/)(chart\d+\.xml)$/)?.[1];
      if (!chartName) throw new Error("Native chart binding has no package-local chart relationship.");
      binding.chartPart = `ppt/charts/${chartName}`;
      const chartRels = strFromU8(files[`ppt/charts/_rels/${chartName}.rels`]);
      const workbookName = chartRels.match(/Target="[^"]*\/(Microsoft_Excel_Worksheet\d+\.xlsx)"/)?.[1];
      if (!workbookName) throw new Error("Native chart binding has no package-local workbook relationship.");
      binding.workbookPart = `ppt/embeddings/${workbookName}`;
    }
    files["customXml/liosArtifact.xml"] = strToU8(buildOfficeArtifactMetadataXml(plan, content, "pptx", bindings));
    files["[Content_Types].xml"] = strToU8(strFromU8(files["[Content_Types].xml"]).replace("</Types>", '<Override PartName="/customXml/liosArtifact.xml" ContentType="application/xml"/></Types>'));
    files["ppt/_rels/presentation.xml.rels"] = strToU8(strFromU8(files["ppt/_rels/presentation.xml.rels"]).replace("</Relationships>", '<Relationship Id="rIdLiosArtifact" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/liosArtifact.xml"/></Relationships>'));
  }
  return zipSync(Object.fromEntries(Object.keys(files).sort().map(path => [path, files[path]])), { level: 6, mtime: ZIP_MTIME });
}

export async function buildNativeArtifactPptx(plan: ArtifactExportPlan, content: ArtifactContent): Promise<GeneratedPptx> {
  artifactExportPlanSchema.parse(plan);
  if (plan.kind !== content.kind) throw new Error(`Artifact export plan kind "${plan.kind}" does not match content kind "${content.kind}".`);
  if (!plan.formats.includes("pptx")) throw new Error("PPTX is not enabled in this Artifact export plan.");
  validateTextTree([plan, content]);
  const items = presentationItems(plan, content);
  // The donor package maps `import` to ESM syntax in a .js file without `type: module`.
  // Vite exposes its class directly; Node+tsx exposes that ESM default through a CJS default.
  // Narrow this observed module boundary once, without changing either serializer or runtime.
  const donorModule: unknown = PptxGenJSImport;
  const constructor = typeof donorModule === "function"
    ? donorModule
    : donorModule && typeof donorModule === "object" && "default" in donorModule
      ? donorModule.default
      : undefined;
  if (typeof constructor !== "function") throw new Error("PptxGenJS did not expose its presentation constructor.");
  const Presentation = constructor as typeof PptxGenJS;
  const pptx = new Presentation();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "LiOS Intelligence Terminal";
  pptx.company = "LiOS";
  pptx.title = plan.filenameStem;
  pptx.subject = `${plan.kind} Artifact v${plan.version}`;
  pptx.revision = String(plan.version);
  pptx.theme = { headFontFace: "Arial", bodyFontFace: "Arial" };
  let slideCount = 0;
  const bindings: OfficeArtifactBinding[] = [];
  const bind = (value: Omit<OfficeArtifactBinding, "id" | "part">): string => {
    const id = `lios_${String(bindings.length + 1).padStart(6, "0")}`;
    bindings.push({ ...value, id, part: `ppt/slides/slide${slideCount}.xml` });
    return id;
  };
  const newSlide = (title: string) => {
    if (slideCount >= MAX_SLIDES) throw new Error("Professional Artifact PPTX exceeds the 200-slide layout limit; export Markdown or JSON for the complete source.");
    const slide = pptx.addSlide();
    slideCount++;
    slide.addText(title, { objectName: bind({ kind: "text", path: [], text: title, editable: false }), x: 0.55, y: 0.25, w: 12.23, h: 0.65, fontSize: 22, bold: true, color: "0F172A", margin: 0, fit: "shrink" });
    const footer = `${plan.artifactId} · v${plan.version} · ${slideCount}`;
    slide.addText(footer, { objectName: bind({ kind: "text", path: [], text: footer, editable: false }), x: 0.55, y: 7.03, w: 12.23, h: 0.25, fontSize: 9, color: "64748B", margin: 0 });
    return slide;
  };
  let title = `${plan.kind[0].toUpperCase()}${plan.kind.slice(1)} Artifact`;
  let lines: PptxGenJS.TextProps[] = [];
  let segments: OfficeArtifactTextSegment[] = [];
  let lineCount = 0;
  const flush = () => {
    if (!lines.length) return;
    const slide = newSlide(title);
    // Explicit paragraph boundaries preserve literal text and bound trailing blank lines.
    const last = lines[lines.length - 1];
    if (last.options) last.options.breakLine = false;
    slide.addText(lines, { objectName: bind({ kind: "text", path: [], editable: false, segments }), x: 0.55, y: 1.05, w: 12.23, h: 5.7, fontSize: 16, fontFace: "Arial", color: "334155", margin: 0, breakLine: false, valign: "top", paraSpaceAfter: 0 });
    lines = [];
    segments = [];
    lineCount = 0;
  };
  for (const item of items) {
    if ("kind" in item) {
      flush();
      if (item.kind === "table") addNativeTable(item, newSlide, bind);
      else if (item.kind === "image") {
        const slide = newSlide(`Captured image · ${item.id}`);
        const scale = Math.min(12.23 / item.image.width, 5.7 / item.image.height, 1 / 96);
        const width = item.image.width * scale;
        const height = item.image.height * scale;
        slide.addImage({ data: artifactImageDataUri(item.image), objectName: bind({ kind: "image", path: item.path, editable: false, mediaSha256: item.image.sha256 }), x: 0.55 + (12.23 - width) / 2, y: 1.05 + (5.7 - height) / 2, w: width, h: height });
      } else addNativeChart(item, newSlide(`Recorded chart · ${item.id} · ${item.projection.chartType}`), bind);
      continue;
    }
    if (item.style === "heading1") { flush(); title = item.text.length <= 100 ? item.text : "Section"; }
    const decoration = item.style === "bullet" ? "• " : item.style === "ordered" ? `${item.ordinal}. ` : "";
    const text = decoration + item.text;
    const options = paragraphOptions(item);
    const nativeMarks: NonNullable<OfficeArtifactTextSegment["formatting"]>["runs"][number]["marks"] = options.bold
      ? [{ type: "bold" }]
      : options.italic ? [{ type: "italic" }] : item.style === "code" ? [{ type: "code" }] : [];
    if (item.style === "title" || item.style === "heading1" || item.style === "heading2") {
      const headingLines = splitText(text, 520).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 40)), 0);
      if (lineCount + Math.min(BODY_LINES - 1, headingLines) + 1 > BODY_LINES) flush();
    }
    let offset = 0;
    for (const line of splitText(text, 520)) {
      const visualLines = Math.max(1, Math.ceil(line.length / 40));
      if (lineCount + visualLines > BODY_LINES) flush();
      const original = item.binding;
      // Bound Office paragraphs retain the exact source UTF-16 interval. Decorative
      // prefixes/suffixes may straddle wrapping boundaries, but never become source text.
      const canonicalStart = decoration.length + (original.prefix?.length ?? 0);
      const canonicalEnd = item.editableUntil === undefined ? text.length - (original.suffix?.length ?? 0) : decoration.length + item.editableUntil;
      const lineEnd = offset + line.length;
      const editable = original.editable && offset <= canonicalEnd && lineEnd >= canonicalStart;
      const prefix = editable && offset < canonicalStart ? text.slice(offset, Math.min(lineEnd, canonicalStart)) : "";
      const suffix = editable && lineEnd > canonicalEnd ? text.slice(Math.max(offset, canonicalEnd), lineEnd) : "";
      segments.push({
        path: editable ? original.path : [], text: line, editable,
        // Bind the emitted semantic typography as the native baseline, not a source edit.
        formatting: { version: 1, text: line, runs: line.length && nativeMarks.length ? [{ from: 0, to: line.length, marks: nativeMarks }] : [] },
        paragraphStart: lines.length, paragraphCount: 1,
        ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}),
        ...(editable ? { textOffset: (original.textOffset ?? 0) + Math.max(0, offset - canonicalStart) } : {}),
      });
      lines.push({ text: line, options: { ...options, breakLine: true } });
      lineCount += visualLines;
      offset += line.length;
      if (text[offset] === "\n") offset++;
      else if (text.slice(offset, offset + 2) === "\r\n") offset += 2;
    }
  }
  flush();
  const written = await pptx.write({ outputType: "uint8array", compression: false });
  if (!(written instanceof Uint8Array)) throw new Error("Native presentation serializer did not return PPTX bytes.");
  return { filename: artifactExportFilename(plan, "pptx"), bytes: deterministicPackage(written, plan, content, bindings), slideCount };
}
