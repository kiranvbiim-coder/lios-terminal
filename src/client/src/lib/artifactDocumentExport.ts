import type { ArtifactContent, ArtifactExportPlan, RichArtifactBlock } from "@shared/artifactContracts";
import { chartArtifactContentSchema } from "@shared/artifactContracts";
import { readRecordedDocumentTable, readRichDocumentFormatting, recordedDocumentValue, type RichDocumentFormatting } from "@shared/richArtifactDocument";
import { readArtifactImage, ARTIFACT_IMAGE_LIMITS, type ArtifactImage } from "@shared/artifactImage";

export type ArtifactDocumentStyle = "title" | "heading1" | "heading2" | "body" | "quote" | "code" | "bullet" | "ordered" | "meta";
export interface ArtifactDocumentParagraph { text: string; style: ArtifactDocumentStyle; ordinal?: number }
export interface ArtifactDocumentNativeParagraph extends ArtifactDocumentParagraph {
  kind: "paragraph";
  block?: RichArtifactBlock;
  formatting?: RichDocumentFormatting;
  headingLevel?: number;
  listId?: string;
  listStart?: number;
}
export type ArtifactDocumentItem = ArtifactDocumentNativeParagraph | {
  kind: "table";
  block: RichArtifactBlock;
  table: Extract<ArtifactContent, { kind: "table" }>;
} | {
  kind: "chart";
  block: RichArtifactBlock;
  chart: Extract<ArtifactContent, { kind: "chart" }>;
} | {
  kind: "image";
  block: RichArtifactBlock;
  image: ArtifactImage;
};

export function isDocumentArtifact(content: ArtifactContent): content is Extract<ArtifactContent, { kind: "research" | "report" | "decision" | "thesis" }> {
  return content.kind === "research" || content.kind === "report" || content.kind === "decision" || content.kind === "thesis";
}

export function artifactExportFilename(plan: ArtifactExportPlan, extension: string): string {
  const stem = plan.filenameStem.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "LiOS-Artifact";
  return `${stem}-v${plan.version}.${extension}`;
}

export function validateArtifactDocumentExport(plan: ArtifactExportPlan, content: ArtifactContent, format: "md" | "pptx"): void {
  if (plan.kind !== content.kind) throw new Error(`Artifact export plan kind "${plan.kind}" does not match content kind "${content.kind}".`);
  if (!plan.formats.includes(format)) throw new Error(`${format.toUpperCase()} is not enabled in this Artifact export plan.`);
  if (!isDocumentArtifact(content)) throw new Error(`Professional Artifact ${format.toUpperCase()} publishing is not supported for kind "${content.kind}".`);
}

/** Shared client projection; P4 content and its explicit export plan remain the only authorities. */
export function artifactDocumentParagraphs(plan: ArtifactExportPlan, content: ArtifactContent): ArtifactDocumentParagraph[] {
  return projectArtifactDocument(plan, content, false);
}

/** Native layout preserves typed tables and coherent formatting in the same semantic order. */
export function artifactDocumentItems(plan: ArtifactExportPlan, content: ArtifactContent): ArtifactDocumentItem[] {
  return projectArtifactDocument(plan, content, true);
}

function projectArtifactDocument(plan: ArtifactExportPlan, content: ArtifactContent, native: false): ArtifactDocumentParagraph[];
function projectArtifactDocument(plan: ArtifactExportPlan, content: ArtifactContent, native: true): ArtifactDocumentItem[];
function projectArtifactDocument(plan: ArtifactExportPlan, content: ArtifactContent, native: boolean): (ArtifactDocumentParagraph | ArtifactDocumentItem)[] {
  if (plan.kind !== content.kind) throw new Error(`Artifact export plan kind "${plan.kind}" does not match content kind "${content.kind}".`);
  if (!isDocumentArtifact(content)) throw new Error(`Professional Artifact publishing is not supported for kind "${content.kind}".`);
  const paragraphs: (ArtifactDocumentParagraph | ArtifactDocumentItem)[] = [];
  const sources = new Set(plan.sourceRefs);
  let characters = 0;
  let entries = 0;
  let imageBytes = 0;
  const count = (text: string) => {
    characters += text.length;
    if (characters > 4_000_000 || entries >= 50_000) throw new Error("Professional Artifact export exceeds the document layout limit; export JSON for the complete source.");
    entries += 1;
  };
  const add = (text: string, style: ArtifactDocumentStyle = "body", ordinal?: number, presentation: Omit<ArtifactDocumentNativeParagraph, "kind" | "text" | "style" | "ordinal"> = {}) => {
    count(text);
    paragraphs.push(native ? { kind: "paragraph", text, style, ordinal, ...presentation } : { text, style, ordinal });
  };
  const refs = (label: string, values: readonly string[], source = false) => {
    if (values.length) add(`${label}: ${values.join(", ")}`, "meta");
    if (source) values.forEach((value) => sources.add(value));
  };
  const list = (heading: string, values: readonly string[]) => {
    if (!values.length) return;
    add(heading, "heading1");
    values.forEach((value) => add(value, "bullet"));
  };
  const metadata = (label: string, values: Record<string, unknown>, nativeTable?: Extract<ArtifactContent, { kind: "table" }>) => {
    for (const key of Object.keys(values).sort()) {
      const text = `${label} · ${key}: ${recordedDocumentValue(values[key])}`;
      if (nativeTable && key === "table") {
        const { rows: _rows, ...tableMetadata } = nativeTable;
        count(text);
        paragraphs.push({ kind: "paragraph", text: `${label} · ${key}: ${recordedDocumentValue(tableMetadata)}`, style: "meta" });
      } else add(text, "meta");
    }
  };
  const block = (item: Extract<ArtifactContent, { kind: "research" | "report" }>["blocks"][number]) => {
    const style: ArtifactDocumentStyle = item.type === "heading" ? "heading1" : item.type === "quote" ? "quote" : item.type === "code" ? "code" : item.type === "callout" ? "heading2" : "body";
    const formatting = native ? readRichDocumentFormatting(item) : null;
    const presentation = native ? {
      block: item,
      ...(formatting ? { formatting } : {}),
      ...(item.type === "heading" ? { headingLevel: Number.isInteger(item.attrs.level) && (item.attrs.level as number) >= 1 && (item.attrs.level as number) <= 6 ? item.attrs.level as number : 2 } : {}),
    } : {};
    if (item.type === "bullet_list" || item.type === "ordered_list") {
      if (!native) item.text.split(/\r?\n/).filter(Boolean).forEach((text, index) => add(text, item.type === "bullet_list" ? "bullet" : "ordered", item.type === "ordered_list" ? index + 1 : undefined));
      else {
        const start = Number.isSafeInteger(item.attrs.start) && (item.attrs.start as number) > 0 ? item.attrs.start as number : 1;
        let offset = 0;
        let firstRun = 0;
        item.text.split("\n").forEach((text, index) => {
          if (item.type === "ordered_list" && !Number.isSafeInteger(start + index)) throw new Error("Invalid ordered list ordinal.");
          const end = offset + text.length;
          const runs: RichDocumentFormatting["runs"] = [];
          if (formatting) {
            while (firstRun < formatting.runs.length && formatting.runs[firstRun].to <= offset) firstRun += 1;
            for (let runIndex = firstRun; runIndex < formatting.runs.length && formatting.runs[runIndex].from < end; runIndex += 1) {
              const run = formatting.runs[runIndex];
              const from = Math.max(run.from, offset);
              const to = Math.min(run.to, end);
              if (from < to) runs.push({ from: from - offset, to: to - offset, marks: run.marks });
            }
          }
          add(text, item.type === "bullet_list" ? "bullet" : "ordered", item.type === "ordered_list" ? start + index : undefined, {
            block: item, listId: item.id, listStart: start,
            ...(formatting ? { formatting: { version: 1, text, runs } } : {}),
          });
          offset = end + 1;
        });
      }
    } else if (item.text || native) add(item.text, style, undefined, presentation);
    let nativeTable: Extract<ArtifactContent, { kind: "table" }> | undefined;
    if (item.type === "table") {
      const result = readRecordedDocumentTable(item.attrs);
      if (result.status === "recognized") {
        if (native) nativeTable = result.table;
        add(`Recorded table · ${item.id} · ${result.table.rows.length} rows`, "heading2");
        const columns = `Columns: ${result.table.columns.map(column => `${column.label} [${column.key}]`).join(" | ")}`;
        if (native) { count(columns); paragraphs.push({ kind: "table", block: item, table: result.table }); }
        else add(columns);
        result.table.rows.forEach((row, index) => {
          const text = `Row ${index + 1}: ${result.table.columns.map(column => `${column.label}: ${Object.hasOwn(row, column.key) ? recordedDocumentValue(row[column.key]) : "Not recorded"}`).join(" | ")}`;
          if (native) count(text);
          else add(text);
        });
      } else {
        const raw = item.attrs.table;
        if (native && raw && typeof raw === "object" && "kind" in raw && raw.kind === "table") throw new Error(`Invalid recorded table ${item.id}: ${result.reason}`);
        add(result.reason, "meta");
      }
    }
    let capturedImage: ArtifactImage | undefined;
    if (item.type === "image") {
      const image = readArtifactImage(item.attrs.image);
      capturedImage = image;
      imageBytes += image.byteLength;
      if (imageBytes > ARTIFACT_IMAGE_LIMITS.totalBytes) throw new Error("Professional Artifact images exceed the 3 MiB document bound.");
      if (native) paragraphs.push({ kind: "image", block: item, image });
      sources.add(image.sourceRef);
    }
    if (native && item.type === "chart_ref" && item.attrs.chart !== undefined) {
      const chart = chartArtifactContentSchema.parse(item.attrs.chart);
      paragraphs.push({ kind: "chart", block: item, chart });
    }
    // Citation blocks remain text, and their existing attributes are retained without inventing a citation schema.
    const attributes = { ...item.attrs };
    if (capturedImage) {
      const { dataBase64: _data, ...imageMetadata } = capturedImage;
      attributes.image = imageMetadata;
    }
    if (native && item.type === "chart_ref" && item.attrs.chart !== undefined) {
      const chart = chartArtifactContentSchema.parse(item.attrs.chart);
      attributes.chart = { ...chart, series: chart.series.map(({ points: _points, ...series }) => series) };
    }
    metadata(`Block ${item.id}`, attributes, nativeTable);
    if (typeof item.attrs.sourceRef === "string") sources.add(item.attrs.sourceRef);
  };
  const thesisItems = (heading: string, items: readonly { id: string; text: string; evidenceRefs: string[]; status?: string; triggered?: boolean; dueAt?: string | null; confidence?: number | null; counterEvidenceRefs?: string[]; updatedAt?: string | null }[]) => {
    if (!items.length) return;
    add(heading, "heading1");
    for (const item of items) {
      add(`[${item.status ?? (item.triggered ? "triggered" : "open")}] ${item.text}`, "bullet");
      add(`ID: ${item.id}`, "meta");
      if (item.confidence !== undefined && item.confidence !== null) add(`Confidence: ${item.confidence}`, "meta");
      if (item.dueAt) add(`Due: ${item.dueAt}`, "meta");
      if (item.updatedAt) add(`Updated: ${item.updatedAt}`, "meta");
      refs("Evidence", item.evidenceRefs);
      if (item.counterEvidenceRefs) refs("Counter-evidence", item.counterEvidenceRefs);
    }
  };

  add(plan.filenameStem, "title");
  if (content.kind === "research") {
    if (content.question) { add("Research question", "heading1"); add(content.question); }
    content.blocks.forEach(block);
    if (content.claims.length) add("Claims", "heading1");
    for (const claim of content.claims) {
      add(claim.text, "heading2");
      add(`Claim: ${claim.id} · Provenance: ${claim.provenance}`, "meta");
      refs("Sources", claim.sourceRefs, true);
    }
    if (content.evidence.length) add("Research evidence", "heading1");
    for (const evidence of content.evidence) {
      add(evidence.title, "heading2");
      if (evidence.snippet) add(evidence.snippet, "quote");
      add(`Evidence: ${evidence.id}`, "meta");
      refs("Source", [evidence.sourceRef], true);
      add(`Source type: ${evidence.sourceType}`, "meta");
      if (evidence.url) add(`URL: ${evidence.url}`, "meta");
      if (evidence.observedAt) add(`Observed: ${evidence.observedAt}`, "meta");
    }
    if (content.contradictions.length) add("Contradictions", "heading1");
    for (const item of content.contradictions) {
      add(`[${item.status}] ${item.summary}`, "bullet");
      add(`Contradiction: ${item.id}`, "meta");
      refs("Claims", item.claimRefs);
      refs("Evidence", item.evidenceRefs);
    }
    if (content.plan.steps.length) {
      add(`Research plan (${content.plan.status})`, "heading1");
      content.plan.steps.forEach((step) => { add(`[${step.status}] ${step.objective}`, "bullet"); add(`Step: ${step.id} · Source kinds: ${step.sourceKinds.join(", ")}`, "meta"); });
    }
    if (content.executionTrail.length) add("Execution trail", "heading1");
    for (const item of content.executionTrail) {
      add(`${item.at} · ${item.action}`);
      refs("Sources", item.sourceRefs, true);
      if (item.receiptId) add(`Receipt: ${item.receiptId}`, "meta");
    }
    add(`Source policy: ${content.sourcePolicy.mode}`, "meta");
    refs("Allowed sources", content.sourcePolicy.allowedSourceRefs, true);
    refs("Allowed providers", content.sourcePolicy.providerAllow);
    refs("Denied providers", content.sourcePolicy.providerDeny);
  } else if (content.kind === "report") {
    if (content.templateId) add(`Template: ${content.templateId}`, "meta");
    const rendered = new Set<string>();
    const blocksById = new Map(content.blocks.map((item) => [item.id, item]));
    for (const section of content.sections) {
      add(section.title, "heading1");
      for (const id of section.blockIds) {
        const item = blocksById.get(id);
        if (item) { block(item); rendered.add(id); }
        else add(`Block reference: ${id} (not present in this version)`, "meta");
      }
    }
    content.blocks.filter((item) => !rendered.has(item.id)).forEach(block);
  } else if (content.kind === "decision") {
    add("Objective", "heading1"); add(content.objective);
    list("What changed", content.whatChanged); list("Why", content.why);
    if (content.scenarios.length) add("Scenarios", "heading1");
    content.scenarios.forEach((item) => { add(`${item.label} (${item.kind})`, "heading2"); if (item.summary) add(item.summary); add(`Scenario: ${item.id}`, "meta"); if (item.artifactRef) add(`Artifact reference: ${item.artifactRef}`, "meta"); });
    list("Constraints", content.constraints);
    if (Object.keys(content.assumptions).length) { add("Assumptions", "heading1"); metadata("Assumption", content.assumptions); }
    if (content.alternatives.length) add("Alternatives", "heading1");
    content.alternatives.forEach((item) => {
      add(`${item.label}${item.id === content.selectedAlternativeId ? " (selected)" : ""}`, "heading2"); add(`Alternative: ${item.id}`, "meta");
      list("Expected outcomes", item.expectedOutcomes); list("Risks", item.risks); list("Tradeoffs", item.tradeoffs);
    });
    if (content.selectedAlternativeId) add(`Selected alternative: ${content.selectedAlternativeId}`, "meta");
    list("Uncertainties", content.uncertainties); list("Next actions", content.nextActions); list("Implementation", content.implementation); list("Monitoring", content.monitoring);
    if (content.recommendation) { add("Recommendation", "heading1"); add(content.recommendation); }
    list("Dissent", content.dissent ?? []);
    if (content.caseRef) add(`Decision case reference: ${content.caseRef} (reference only; current canonical approval must be inspected separately)`, "meta");
    if (content.actions?.length) add("Actions (authored tracking; not execution receipts)", "heading1");
    for (const item of content.actions ?? []) {
      add(item.description, "heading2");
      add(`Action: ${item.id} · ${item.status}${item.assignee ? ` · assignee ${item.assignee}` : ""}`, "meta");
      if (item.dueAt) add(`Due: ${item.dueAt}`, "meta");
      if (item.completedAt) add(`Recorded completed: ${item.completedAt}`, "meta");
      refs("Sources", item.sourceRefs, true); refs("Artifacts", item.artifactRefs);
    }
    if (content.outcome) {
      add("Outcome (authored observation)", "heading1"); add(content.outcome.summary);
      add(`Outcome status: ${content.outcome.status}`, "meta");
      if (content.outcome.observedAt) add(`Observed: ${content.outcome.observedAt}`, "meta");
      refs("Sources", content.outcome.sourceRefs, true); refs("Artifacts", content.outcome.artifactRefs);
    }
    if (content.followUp?.length) add("Follow-up", "heading1");
    for (const item of content.followUp ?? []) {
      add(item.description, "heading2"); add(`Follow-up: ${item.id} · ${item.status}`, "meta");
      if (item.dueAt) add(`Due: ${item.dueAt}`, "meta");
      if (item.completedAt) add(`Recorded completed: ${item.completedAt}`, "meta");
      refs("Sources", item.sourceRefs, true); refs("Artifacts", item.artifactRefs);
    }
    for (const key of Object.keys(content.linkedRefs).sort() as Array<keyof typeof content.linkedRefs>) refs(`Linked ${key}`, content.linkedRefs[key], key === "sources");
  } else {
    if (content.entityRef) add(`Entity: ${content.entityRef}`, "meta");
    add(`Status: ${content.status}`, "meta");
    if (content.summary) { add("Summary", "heading1"); add(content.summary); }
    thesisItems("Expected outcomes", content.expectedOutcomes); thesisItems("Claims", content.claims); thesisItems("Catalysts", content.catalysts); thesisItems("Risks", content.risks); thesisItems("Invalidation conditions", content.invalidationConditions); thesisItems("Open questions", content.openQuestions);
    if (content.refresh.lastRefreshedAt) add(`Last refreshed: ${content.refresh.lastRefreshedAt}`, "meta");
    if (content.refresh.snapshotId) add(`Snapshot: ${content.refresh.snapshotId}`, "meta");
    list("Refresh contradictions", content.refresh.contradictions); list("Refresh changes", content.refresh.changes);
    if (content.postmortems.length) add("Postmortems", "heading1");
    for (const item of content.postmortems) {
      add(`${item.outcome} · ${item.at}`, "heading2"); add(item.summary);
      list("What worked", item.whatWorked); list("What failed", item.whatFailed); refs("Evidence", item.evidenceRefs);
    }
  }
  add("Evidence & provenance", "heading1");
  add(`Artifact: ${plan.artifactId}`, "meta"); add(`Version: ${plan.version}`, "meta"); add(`Kind: ${plan.kind}`, "meta"); add(`Content hash: ${plan.contentHash}`, "meta");
  if (!sources.size) add("Sources: none recorded", "meta");
  else { add("Sources", "heading2"); [...sources].sort().forEach((source) => add(`Source: ${source}`, "meta")); }
  return paragraphs;
}
