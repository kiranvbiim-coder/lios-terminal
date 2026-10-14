import type { ArtifactContent, ArtifactExportPlan } from "@shared/artifactContracts";
import type { OfficeArtifactBinding } from "@shared/officeArtifactRoundtrip";
import { readRecordedDocumentTable, recordedDocumentValue, type RichDocumentMark } from "@shared/richArtifactDocument";
import { artifactDocumentItems, artifactDocumentParagraphs, type ArtifactDocumentItem, type ArtifactDocumentParagraph } from "./artifactDocumentExport";
import { readArtifactImage, artifactImageBytes } from "@shared/artifactImage";
import { chartArtifactContentSchema } from "@shared/artifactContracts";
import { prepareArtifactChart } from "./artifactChartProjection";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const PAGE_BODY_WIDTH = 9360;
const MAX_TABLE_COLUMNS = 32;
const MAX_TABLE_CELLS = 100_000;
const MAX_CHARACTERS = 4_000_000;
const MAX_PARAGRAPHS = 50_000;

/** Invalid XML is rejected rather than silently changing canonical recorded text. */
export function docxXmlEscape(value: string): string {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if ((point < 32 && point !== 9 && point !== 10 && point !== 13) || (point >= 0xd800 && point <= 0xdfff) || point === 0xfffe || point === 0xffff) {
      throw new Error("Professional Artifact DOCX contains text that is not valid Office XML.");
    }
  }
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function textXml(text: string): string {
  // Word tabs and line breaks are elements, not characters embedded in w:t.
  return text.split(/(\r\n|\r|\n|\t)/).map(part => part === "\t" ? "<w:tab/>" : /^(?:\r\n|\r|\n)$/.test(part) ? "<w:br/>" : `<w:t xml:space="preserve">${docxXmlEscape(part)}</w:t>`).join("");
}

const paragraphStyle = (id: string, name: string, properties: string, runs: string) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr>${properties}</w:pPr><w:rPr>${runs}</w:rPr></w:style>`;
export const DOCX_STYLES_XML = `${XML_HEADER}<w:styles xmlns:w="${WORD_NS}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="334155"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl/><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:widowControl/><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:style>
${paragraphStyle("Title", "Title", '<w:keepNext/><w:keepLines/><w:spacing w:after="280" w:line="264" w:lineRule="auto"/>', '<w:b/><w:color w:val="0F172A"/><w:sz w:val="44"/>')}
${Array.from({ length: 6 }, (_, index) => paragraphStyle(`Heading${index + 1}`, `heading ${index + 1}`, `<w:keepNext/><w:keepLines/><w:spacing w:before="${index < 2 ? 280 : 200}" w:after="120" w:line="264" w:lineRule="auto"/><w:outlineLvl w:val="${index}"/>`, `<w:b/><w:color w:val="${index < 2 ? "0F172A" : "334155"}"/><w:sz w:val="${[32, 27, 24, 22, 22, 22][index]}"/>`)).join("")}
${paragraphStyle("Quote", "Quote", '<w:spacing w:before="120" w:after="200"/><w:ind w:left="360" w:right="360"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="12" w:color="94A3B8"/></w:pBdr>', '<w:i/><w:color w:val="475569"/>')}
${paragraphStyle("Code", "Code", '<w:spacing w:before="120" w:after="180" w:line="264" w:lineRule="auto"/><w:ind w:left="160" w:right="160"/><w:shd w:val="clear" w:fill="F1F5F9"/>', '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:color w:val="334155"/><w:sz w:val="20"/>')}
${paragraphStyle("Metadata", "Metadata", '<w:spacing w:after="80" w:line="264" w:lineRule="auto"/>', '<w:color w:val="64748B"/><w:sz w:val="19"/>')}
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2563EB"/><w:u w:val="single"/></w:rPr></w:style></w:styles>`;

type DocumentItem = ReturnType<typeof artifactDocumentItems>[number];
type Paragraph = Extract<DocumentItem, { kind: "paragraph" }>;
type NativeTable = Extract<DocumentItem, { kind: "table" }>;
type Numbering = { id: number; kind: "bullet" | "ordered"; start: number };

type BindingPath = (string | number)[];

/**
 * Walk the existing narrative projection in its semantic order, never locate fields by
 * coincidental text equality. Every generated heading/receipt/metadata interval is bound
 * read-only so an Office edit cannot disappear behind the source snapshot.
 */
export function officeDocumentBindings(plan: ArtifactExportPlan, content: ArtifactContent, native: boolean, items: readonly (ArtifactDocumentItem | ArtifactDocumentParagraph)[] = native ? artifactDocumentItems(plan, content) : artifactDocumentParagraphs(plan, content)): OfficeArtifactBinding[] {
  const bindings: OfficeArtifactBinding[] = [];
  let cursor = 0;
  const sources = new Set(plan.sourceRefs);
  const add = (text: string, path?: BindingPath, prefix = "", suffix = "", textOffset?: number) => {
    const item = items[cursor];
    if (!item || ("kind" in item && item.kind !== "paragraph") || item.text !== text) {
      throw new Error("Office document binding does not match the canonical narrative projection.");
    }
    bindings.push({ id: `lios_${String(++cursor).padStart(6, "0")}`, kind: "text", path: path ?? [], text, editable: !!path, ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}), ...(textOffset !== undefined ? { textOffset } : {}) });
  };
  const refs = (label: string, values: readonly string[], source = false) => {
    if (values.length) add(`${label}: ${values.join(", ")}`);
    if (source) values.forEach(value => sources.add(value));
  };
  const list = (heading: string, values: readonly string[], path: BindingPath) => {
    if (!values.length) return;
    add(heading);
    values.forEach((value, index) => add(value, [...path, index]));
  };
  const metadata = (label: string, values: Record<string, unknown>, table?: NativeTable["table"]) => {
    const { rows: _rows, ...withoutRows } = table ?? { rows: [] };
    for (const key of Object.keys(values).sort()) {
      add(`${label} · ${key}: ${recordedDocumentValue(table && key === "table" ? withoutRows : values[key])}`);
    }
  };
  const block = (index: number) => {
    if (content.kind !== "report" && content.kind !== "research") return;
    const value = content.blocks[index];
    const path: BindingPath = ["blocks", index, "text"];
    if (value.type === "bullet_list" || value.type === "ordered_list") {
      let offset = 0;
      const lines = native ? value.text.split("\n") : value.text.split(/\r?\n/).filter(Boolean);
      lines.forEach(text => {
        // The non-native legacy projection filters empty lines; retain original offsets.
        if (!native) offset = value.text.indexOf(text, offset);
        add(text, path, "", "", offset);
        offset += text.length + 1;
      });
    } else if (value.text || native) add(value.text, path);
    let table: NativeTable["table"] | undefined;
    if (value.type === "table") {
      const result = readRecordedDocumentTable(value.attrs);
      if (result.status === "recognized") {
        table = native ? result.table : undefined;
        add(`Recorded table · ${value.id} · ${result.table.rows.length} rows`);
        if (native) {
          const item = items[cursor];
          if (!item || !("kind" in item) || item.kind !== "table" || item.block !== value) throw new Error("Office table binding does not match its canonical block.");
          bindings.push({ id: `lios_${String(++cursor).padStart(6, "0")}`, kind: "table", path: ["blocks", index, "attrs", "table"], editable: true });
        } else {
          add(`Columns: ${result.table.columns.map(column => `${column.label} [${column.key}]`).join(" | ")}`);
          result.table.rows.forEach((row, rowIndex) => add(`Row ${rowIndex + 1}: ${result.table.columns.map(column => `${column.label}: ${Object.hasOwn(row, column.key) ? recordedDocumentValue(row[column.key]) : "Not recorded"}`).join(" | ")}`));
        }
      } else add(result.reason);
    }
    if (value.type === "image") {
      const image = readArtifactImage(value.attrs.image);
      sources.add(image.sourceRef);
      if (native) {
        const item = items[cursor];
        if (!item || !("kind" in item) || item.kind !== "image" || item.block !== value) throw new Error("Office image binding does not match its canonical block.");
        bindings.push({ id: `lios_${String(++cursor).padStart(6, "0")}`, kind: "image", path: ["blocks", index, "attrs", "image"], editable: false, mediaSha256: image.sha256 });
      }
    }
    if (native && value.type === "chart_ref" && value.attrs.chart !== undefined) {
      const item = items[cursor];
      if (!item || !("kind" in item) || item.kind !== "chart" || item.block !== value) throw new Error("Office chart binding does not match its canonical block.");
      bindings.push({ id: `lios_${String(++cursor).padStart(6, "0")}`, kind: "chart", path: ["blocks", index, "attrs", "chart"], editable: false });
    }
    const attrs = { ...value.attrs };
    if (value.type === "image") {
      const { dataBase64: _data, ...metadata } = readArtifactImage(value.attrs.image);
      attrs.image = metadata;
    }
    if (native && value.type === "chart_ref" && value.attrs.chart !== undefined) {
      const chart = chartArtifactContentSchema.parse(value.attrs.chart);
      attrs.chart = { ...chart, series: chart.series.map(({ points: _points, ...series }) => series) };
    }
    metadata(`Block ${value.id}`, attrs, table);
    if (typeof value.attrs.sourceRef === "string") sources.add(value.attrs.sourceRef);
  };
  const thesisItems = (heading: string, values: readonly { id: string; text: string; evidenceRefs: string[]; status?: string; triggered?: boolean; dueAt?: string | null; confidence?: number | null; counterEvidenceRefs?: string[]; updatedAt?: string | null }[], path: BindingPath) => {
    if (!values.length) return;
    add(heading);
    values.forEach((value, index) => {
      const prefix = `[${value.status ?? (value.triggered ? "triggered" : "open")}] `;
      add(`${prefix}${value.text}`, [...path, index, "text"], prefix);
      add(`ID: ${value.id}`);
      if (value.confidence !== undefined && value.confidence !== null) add(`Confidence: ${value.confidence}`);
      if (value.dueAt) add(`Due: ${value.dueAt}`);
      if (value.updatedAt) add(`Updated: ${value.updatedAt}`);
      refs("Evidence", value.evidenceRefs);
      if (value.counterEvidenceRefs) refs("Counter-evidence", value.counterEvidenceRefs);
    });
  };
  add(plan.filenameStem);
  if (content.kind === "research") {
    if (content.question) { add("Research question"); add(content.question, ["question"]); }
    content.blocks.forEach((_, index) => block(index));
    if (content.claims.length) add("Claims");
    content.claims.forEach((claim, index) => {
      add(claim.text, ["claims", index, "text"]);
      add(`Claim: ${claim.id} · Provenance: ${claim.provenance}`);
      refs("Sources", claim.sourceRefs, true);
    });
    if (content.evidence.length) add("Research evidence");
    content.evidence.forEach(evidence => {
      add(evidence.title);
      if (evidence.snippet) add(evidence.snippet);
      add(`Evidence: ${evidence.id}`); refs("Source", [evidence.sourceRef], true); add(`Source type: ${evidence.sourceType}`);
      if (evidence.url) add(`URL: ${evidence.url}`);
      if (evidence.observedAt) add(`Observed: ${evidence.observedAt}`);
    });
    if (content.contradictions.length) add("Contradictions");
    content.contradictions.forEach((value, index) => {
      const prefix = `[${value.status}] `;
      add(`${prefix}${value.summary}`, ["contradictions", index, "summary"], prefix);
      add(`Contradiction: ${value.id}`); refs("Claims", value.claimRefs); refs("Evidence", value.evidenceRefs);
    });
    if (content.plan.steps.length) {
      add(`Research plan (${content.plan.status})`);
      content.plan.steps.forEach((value, index) => {
        const prefix = `[${value.status}] `;
        add(`${prefix}${value.objective}`, ["plan", "steps", index, "objective"], prefix);
        add(`Step: ${value.id} · Source kinds: ${value.sourceKinds.join(", ")}`);
      });
    }
    if (content.executionTrail.length) add("Execution trail");
    content.executionTrail.forEach((value, index) => {
      const prefix = `${value.at} · `;
      add(`${prefix}${value.action}`, ["executionTrail", index, "action"], prefix);
      refs("Sources", value.sourceRefs, true);
      if (value.receiptId) add(`Receipt: ${value.receiptId}`);
    });
    add(`Source policy: ${content.sourcePolicy.mode}`); refs("Allowed sources", content.sourcePolicy.allowedSourceRefs, true); refs("Allowed providers", content.sourcePolicy.providerAllow); refs("Denied providers", content.sourcePolicy.providerDeny);
  } else if (content.kind === "report") {
    if (content.templateId) add(`Template: ${content.templateId}`);
    const rendered = new Set<string>();
    const blockIndices = new Map(content.blocks.map((value, index) => [value.id, index]));
    content.sections.forEach((section, index) => {
      add(section.title, ["sections", index, "title"]);
      section.blockIds.forEach(id => {
        const blockIndex = blockIndices.get(id);
        if (blockIndex !== undefined) { block(blockIndex); rendered.add(id); }
        else add(`Block reference: ${id} (not present in this version)`);
      });
    });
    content.blocks.forEach((value, index) => { if (!rendered.has(value.id)) block(index); });
  } else if (content.kind === "decision") {
    add("Objective"); add(content.objective, ["objective"]); list("What changed", content.whatChanged, ["whatChanged"]); list("Why", content.why, ["why"]);
    if (content.scenarios.length) add("Scenarios");
    content.scenarios.forEach((value, index) => {
      add(`${value.label} (${value.kind})`, ["scenarios", index, "label"], "", ` (${value.kind})`);
      if (value.summary) add(value.summary, ["scenarios", index, "summary"]);
      add(`Scenario: ${value.id}`); if (value.artifactRef) add(`Artifact reference: ${value.artifactRef}`);
    });
    list("Constraints", content.constraints, ["constraints"]);
    if (Object.keys(content.assumptions).length) { add("Assumptions"); metadata("Assumption", content.assumptions); }
    if (content.alternatives.length) add("Alternatives");
    content.alternatives.forEach((value, index) => {
      const suffix = value.id === content.selectedAlternativeId ? " (selected)" : "";
      add(`${value.label}${suffix}`, ["alternatives", index, "label"], "", suffix); add(`Alternative: ${value.id}`);
      list("Expected outcomes", value.expectedOutcomes, ["alternatives", index, "expectedOutcomes"]); list("Risks", value.risks, ["alternatives", index, "risks"]); list("Tradeoffs", value.tradeoffs, ["alternatives", index, "tradeoffs"]);
    });
    if (content.selectedAlternativeId) add(`Selected alternative: ${content.selectedAlternativeId}`);
    for (const [heading, key] of [["Uncertainties", "uncertainties"], ["Next actions", "nextActions"], ["Implementation", "implementation"], ["Monitoring", "monitoring"]] as const) list(heading, content[key], [key]);
    if (content.recommendation) { add("Recommendation"); add(content.recommendation, ["recommendation"]); }
    list("Dissent", content.dissent ?? [], ["dissent"]);
    if (content.caseRef) add(`Decision case reference: ${content.caseRef} (reference only; current canonical approval must be inspected separately)`);
    if (content.actions?.length) add("Actions (authored tracking; not execution receipts)");
    (content.actions ?? []).forEach((value, index) => {
      add(value.description, ["actions", index, "description"]);
      add(`Action: ${value.id} · ${value.status}${value.assignee ? ` · assignee ${value.assignee}` : ""}`);
      if (value.dueAt) add(`Due: ${value.dueAt}`);
      if (value.completedAt) add(`Recorded completed: ${value.completedAt}`);
      refs("Sources", value.sourceRefs, true); refs("Artifacts", value.artifactRefs);
    });
    if (content.outcome) {
      add("Outcome (authored observation)"); add(content.outcome.summary, ["outcome", "summary"]);
      add(`Outcome status: ${content.outcome.status}`);
      if (content.outcome.observedAt) add(`Observed: ${content.outcome.observedAt}`);
      refs("Sources", content.outcome.sourceRefs, true); refs("Artifacts", content.outcome.artifactRefs);
    }
    if (content.followUp?.length) add("Follow-up");
    (content.followUp ?? []).forEach((value, index) => {
      add(value.description, ["followUp", index, "description"]); add(`Follow-up: ${value.id} · ${value.status}`);
      if (value.dueAt) add(`Due: ${value.dueAt}`);
      if (value.completedAt) add(`Recorded completed: ${value.completedAt}`);
      refs("Sources", value.sourceRefs, true); refs("Artifacts", value.artifactRefs);
    });
    for (const key of Object.keys(content.linkedRefs).sort() as Array<keyof typeof content.linkedRefs>) refs(`Linked ${key}`, content.linkedRefs[key], key === "sources");
  } else if (content.kind === "thesis") {
    if (content.entityRef) add(`Entity: ${content.entityRef}`); add(`Status: ${content.status}`);
    if (content.summary) { add("Summary"); add(content.summary, ["summary"]); }
    for (const [heading, key] of [["Expected outcomes", "expectedOutcomes"], ["Claims", "claims"], ["Catalysts", "catalysts"], ["Risks", "risks"], ["Invalidation conditions", "invalidationConditions"], ["Open questions", "openQuestions"]] as const) thesisItems(heading, content[key], [key]);
    if (content.refresh.lastRefreshedAt) add(`Last refreshed: ${content.refresh.lastRefreshedAt}`);
    if (content.refresh.snapshotId) add(`Snapshot: ${content.refresh.snapshotId}`);
    list("Refresh contradictions", content.refresh.contradictions, ["refresh", "contradictions"]); list("Refresh changes", content.refresh.changes, ["refresh", "changes"]);
    if (content.postmortems.length) add("Postmortems");
    content.postmortems.forEach((value, index) => {
      add(`${value.outcome} · ${value.at}`); add(value.summary, ["postmortems", index, "summary"]);
      list("What worked", value.whatWorked, ["postmortems", index, "whatWorked"]); list("What failed", value.whatFailed, ["postmortems", index, "whatFailed"]); refs("Evidence", value.evidenceRefs);
    });
  }
  add("Evidence & provenance"); add(`Artifact: ${plan.artifactId}`); add(`Version: ${plan.version}`); add(`Kind: ${plan.kind}`); add(`Content hash: ${plan.contentHash}`);
  if (!sources.size) add("Sources: none recorded");
  else { add("Sources"); [...sources].sort().forEach(source => add(`Source: ${source}`)); }
  if (cursor !== items.length) throw new Error("Office document binding must cover the entire canonical narrative.");
  return bindings;
}

/** Native read-only chart caches contain exact recorded observations; no workbook or remote asset. */
export function buildNativeDocxChart(chart: Extract<ArtifactContent, { kind: "chart" }>): { xml: string; sourceIndices: number[][] } {
  const projection = prepareArtifactChart(chart);
  if (projection.status !== "ready") throw new Error(projection.message);
  if (projection.chartType === "scatter" && projection.xKind !== "number") throw new Error("Native scatter DOCX requires numeric x observations.");
  if (projection.series.length > 20 || projection.totalDistinctPoints > 10_000 || projection.series.length * projection.totalDistinctPoints > 100_000) throw new Error("Native DOCX chart exceeds series/point bounds.");
  const literal = (kind: "str" | "num", values: (string | null)[]) => `<c:${kind}Lit>${kind === "num" ? "<c:formatCode>General</c:formatCode>" : ""}<c:ptCount val="${values.length}"/>${values.map((value, index) => value === null ? "" : `<c:pt idx="${index}"><c:v>${docxXmlEscape(value)}</c:v></c:pt>`).join("")}</c:${kind}Lit>`;
  const labels = projection.xValues.map(recordedDocumentValue);
  const colors = ["2563EB", "DC2626", "059669", "7C3AED", "D97706", "0891B2"];
  const series = projection.series.map((series, index) => {
    const values = projection.xValues.map(x => { const point = series.points.get(x); return point ? recordedDocumentValue(point.y) : null; });
    const scatter = projection.chartType === "scatter";
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${docxXmlEscape(series.label)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${colors[index % colors.length]}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${colors[index % colors.length]}"/></a:solidFill></a:ln></c:spPr>${projection.chartType === "line" || scatter ? '<c:marker><c:symbol val="circle"/><c:size val="4"/></c:marker>' : ""}<c:${scatter ? "xVal" : "cat"}>${literal(scatter ? "num" : "str", labels)}</c:${scatter ? "xVal" : "cat"}><c:${scatter ? "yVal" : "val"}>${literal("num", values)}</c:${scatter ? "yVal" : "val"}></c:ser>`;
  }).join("");
  const tag = `${projection.chartType}Chart`;
  const options = projection.chartType === "bar" ? '<c:barDir val="col"/><c:grouping val="clustered"/>' : projection.chartType === "scatter" ? '<c:scatterStyle val="lineMarker"/>' : '<c:grouping val="standard"/>';
  const axes = (id: number, cross: number, position: "b" | "l", value: boolean) => `<c:${value ? "valAx" : "catAx"}><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${position}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/>${value ? '<c:crossBetween val="between"/>' : '<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>'}</c:${value ? "valAx" : "catAx"}>`;
  return {
    sourceIndices: projection.series.map(series => projection.xValues.map(x => series.points.get(x)?.sourcePointIndex ?? -1)),
    xml: `${XML_HEADER}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/><c:${tag}>${options}${series}<c:axId val="1"/><c:axId val="2"/></c:${tag}>${axes(1, 2, "b", projection.chartType === "scatter")}${axes(2, 1, "l", true)}</c:plotArea><c:legend><c:legendPos val="b"/><c:layout/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`,
  };
}

export function buildNativeDocxDocument(plan: ArtifactExportPlan, content: ArtifactContent): { documentXml: string; relationshipsXml: string; numberingXml: string; bindings: OfficeArtifactBinding[]; media: Record<string, Uint8Array>; contentTypes: string } {
  const items = artifactDocumentItems(plan, content);
  const bindings = officeDocumentBindings(plan, content, true, items);
  const links = new Map<string, string>();
  const lists: Numbering[] = [];
  const media: Record<string, Uint8Array> = {};
  const mediaRelationships: string[] = [];
  const mediaTypes = new Map<string, string>();
  let drawingId = 0;
  let characters = 0;
  let paragraphs = 0;
  let previousList: Numbering | undefined;
  let previousListKey: string | undefined;
  let previousStyle: Paragraph["style"] | undefined;
  const consume = (text: string) => {
    characters += text.length;
    if (characters > MAX_CHARACTERS || ++paragraphs > MAX_PARAGRAPHS) throw new Error("Professional Artifact DOCX exceeds the document layout limit; export JSON for the complete source.");
  };
  const run = (text: string, marks: readonly RichDocumentMark[] = [], header = false): string => {
    const inlineCode = marks.some(mark => mark.type === "code");
    const props = `${inlineCode ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' : ""}${header || marks.some(mark => mark.type === "bold") ? "<w:b/>" : ""}${header ? '<w:color w:val="FFFFFF"/>' : ""}${marks.some(mark => mark.type === "italic") ? "<w:i/>" : ""}${marks.some(mark => mark.type === "strike") ? "<w:strike/>" : ""}${marks.some(mark => mark.type === "underline") ? '<w:u w:val="single"/>' : ""}${inlineCode ? '<w:shd w:val="clear" w:fill="F1F5F9"/>' : ""}`;
    const href = marks.find(mark => mark.type === "link")?.attrs?.href;
    const body = `<w:r>${props || href ? `<w:rPr>${href ? '<w:rStyle w:val="Hyperlink"/>' : ""}${props}</w:rPr>` : ""}${textXml(text)}</w:r>`;
    if (!href) return body;
    if (href.startsWith("#")) return `<w:hyperlink w:anchor="${docxXmlEscape(href.slice(1))}">${body}</w:hyperlink>`;
    let id = links.get(href);
    if (!id) { id = `rId${links.size + 3}`; links.set(href, id); }
    return `<w:hyperlink r:id="${id}">${body}</w:hyperlink>`;
  };
  const numbering = (item: Paragraph): Numbering | undefined => {
    if (item.style !== "bullet" && item.style !== "ordered") { previousList = undefined; previousStyle = item.style; return undefined; }
    const start = item.listStart ?? item.ordinal ?? 1;
    if (!Number.isInteger(start) || start < 1 || start > 2_147_483_647 || (item.ordinal !== undefined && item.ordinal > 2_147_483_647)) throw new Error("Professional Artifact DOCX list start exceeds the native numbering limit.");
    let entry = previousStyle === item.style && (item.listId ? previousListKey === item.listId : !previousListKey && (item.style === "bullet" || item.ordinal !== 1)) ? previousList : undefined;
    if (!entry) {
      entry = { id: lists.length + 1, kind: item.style, start };
      lists.push(entry);
    }
    previousStyle = item.style; previousList = entry; previousListKey = item.listId;
    return entry;
  };
  const paragraph = (item: Paragraph): string => {
    consume(item.text);
    const style = item.headingLevel ? `Heading${item.headingLevel}` : item.style === "title" ? "Title" : item.style === "heading1" ? "Heading1" : item.style === "heading2" ? "Heading2" : item.style === "quote" ? "Quote" : item.style === "code" ? "Code" : item.style === "meta" ? "Metadata" : "Normal";
    const list = numbering(item);
    let cursor = 0;
    const runs: string[] = [];
    for (const format of item.formatting?.runs ?? []) {
      if (format.from > cursor) runs.push(run(item.text.slice(cursor, format.from)));
      runs.push(run(item.text.slice(format.from, format.to), format.marks));
      cursor = format.to;
    }
    if (cursor < item.text.length || !runs.length) runs.push(run(item.text.slice(cursor)));
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${list ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${list.id}"/></w:numPr>` : ""}</w:pPr>${runs.join("")}</w:p>`;
  };
  const nativeTable = (item: NativeTable): string => {
    previousList = undefined; previousStyle = undefined;
    const { table } = item;
    if (!table.columns.length || table.columns.length > MAX_TABLE_COLUMNS || table.columns.length * (table.rows.length + 1) > MAX_TABLE_CELLS) throw new Error(`Native table ${item.block.id}: DOCX exceeds the 32-column/100000-cell layout limit; export JSON for the complete source.`);
    const width = Math.floor(PAGE_BODY_WIDTH / table.columns.length);
    const widths = table.columns.map((_, index) => width + (index < PAGE_BODY_WIDTH % table.columns.length ? 1 : 0));
    const row = (values: readonly string[], header = false, rowIndex = 0): string => `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ""}${values.map((text, index) => {
      consume(text);
      if (text.length > 200_000) throw new Error(`Native table ${item.block.id}: DOCX cell exceeds the text layout limit.`);
      const type = table.columns[index].type;
      const numeric = type === "number" || type === "currency" || type === "percent";
      const fill = header ? "334155" : rowIndex % 2 === 0 ? "FFFFFF" : "F1F5F9";
      return `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/><w:shd w:val="clear" w:fill="${fill}"/><w:vAlign w:val="top"/></w:tcPr><w:p><w:pPr><w:pStyle w:val="Normal"/><w:spacing w:after="0" w:line="264" w:lineRule="auto"/><w:jc w:val="${numeric ? "right" : "left"}"/></w:pPr>${run(text, [], header)}</w:p></w:tc>`;
    }).join("")}</w:tr>`;
    return `<w:tbl><w:tblPr><w:tblW w:w="${PAGE_BODY_WIDTH}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(edge => `<w:${edge} w:val="single" w:sz="4" w:color="CBD5E1"/>`).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(value => `<w:gridCol w:w="${value}"/>`).join("")}</w:tblGrid>${row(table.columns.map(column => column.label), true)}${table.rows.map((value, index) => row(table.columns.map(column => Object.hasOwn(value, column.key) ? recordedDocumentValue(value[column.key]) : "Not recorded"), false, index)).join("")}</w:tbl>`;
  };
  const drawing = (item: Extract<DocumentItem, { kind: "image" | "chart" }>, binding: OfficeArtifactBinding): string => {
    previousList = undefined; previousStyle = undefined;
    const id = ++drawingId;
    const relationship = `rIdMedia${id}`;
    let graphic: string;
    let width: number;
    let height: number;
    if (item.kind === "image") {
      const extension = item.image.mimeType === "image/png" ? "png" : "jpeg";
      const part = `word/media/image${id}.${extension}`;
      media[part] = artifactImageBytes(item.image);
      mediaTypes.set(extension, `<Default Extension="${extension}" ContentType="${item.image.mimeType}"/>`);
      mediaRelationships.push(`<Relationship Id="${relationship}" Type="${REL_NS}/image" Target="media/image${id}.${extension}"/>`);
      binding.mediaPart = part;
      binding.mediaSha256 = item.image.sha256;
      const scale = Math.min(5943600 / item.image.width, 5943600 / item.image.height, 9525);
      width = Math.round(item.image.width * scale);
      height = Math.round(item.image.height * scale);
      graphic = `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${binding.id}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationship}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData>`;
    } else {
      const part = `word/charts/chart${id}.xml`;
      const chart = buildNativeDocxChart(item.chart);
      media[part] = new TextEncoder().encode(chart.xml);
      binding.chartPart = part;
      binding.sourceIndices = chart.sourceIndices;
      mediaTypes.set(part, `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
      mediaRelationships.push(`<Relationship Id="${relationship}" Type="${REL_NS}/chart" Target="charts/chart${id}.xml"/>`);
      width = 5943600; height = 3657600;
      graphic = `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${relationship}"/></a:graphicData>`;
    }
    binding.part = "word/document.xml";
    binding.geometry = { x: 0, y: 0, cx: width, cy: height };
    return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${id}" name="${binding.id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic>${graphic}</a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  };
  const body = items.map((item, index) => {
    const binding = bindings[index];
    if (item.kind === "paragraph" && binding.editable) {
      const runs: NonNullable<OfficeArtifactBinding["formatting"]>["runs"] = [];
      for (const format of item.formatting?.runs ?? []) {
        const marks = format.marks.map((mark): RichDocumentMark => mark.type === "link" ? { type: mark.type, attrs: { href: mark.attrs!.href, target: "_blank" } } : { type: mark.type }).sort((a, b) => a.type.localeCompare(b.type));
        const previous = runs[runs.length - 1];
        if (previous && previous.to === format.from && JSON.stringify(previous.marks) === JSON.stringify(marks)) previous.to = format.to;
        else runs.push({ from: format.from, to: format.to, marks });
      }
      binding.formatting = { version: 1, text: item.text, runs };
    }
    const start = `<w:bookmarkStart w:id="${index + 1}" w:name="${binding.id}"/>`;
    const end = `<w:bookmarkEnd w:id="${index + 1}"/>`;
    const rendered = item.kind === "table" ? nativeTable(item) : item.kind === "paragraph" ? paragraph(item) : drawing(item, binding);
    return item.kind === "table" ? `${start}${rendered}${end}` : rendered.replace("</w:pPr>", `</w:pPr>${start}`).replace(/<\/w:p>$/, `${end}</w:p>`);
  }).join("");
  const abstract = (id: number, kind: "bullet" | "ordered") => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${kind === "bullet" ? "bullet" : "decimal"}"/><w:lvlText w:val="${kind === "bullet" ? "•" : "%1."}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>`;
  return {
    bindings,
    media,
    contentTypes: [...mediaTypes.values()].join(""),
    documentXml: `${XML_HEADER}<w:document xmlns:w="${WORD_NS}" xmlns:r="${REL_NS}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    relationshipsXml: `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${REL_NS}/numbering" Target="numbering.xml"/><Relationship Id="rIdLiosArtifact" Type="${REL_NS}/customXml" Target="../customXml/liosArtifact.xml"/>${mediaRelationships.join("")}${[...links].map(([href, id]) => `<Relationship Id="${id}" Type="${REL_NS}/hyperlink" Target="${docxXmlEscape(href)}" TargetMode="External"/>`).join("")}</Relationships>`,
    numberingXml: `${XML_HEADER}<w:numbering xmlns:w="${WORD_NS}">${abstract(0, "bullet")}${abstract(1, "ordered")}${lists.map(list => `<w:num w:numId="${list.id}"><w:abstractNumId w:val="${list.kind === "bullet" ? 0 : 1}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${list.start}"/></w:lvlOverride></w:num>`).join("")}</w:numbering>`,
  };
}
