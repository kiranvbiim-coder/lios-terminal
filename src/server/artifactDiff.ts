import { initialTerminalScreenState } from "@shared/terminalArtifact";
import {
  artifactContentSchema,
  artifactComparisonSchema,
  spreadsheetArtifactContentSchema,
  spreadsheetCellDiffSchema,
  type ArtifactComparison,
  type ArtifactContent,
  type SpreadsheetCellDiff,
} from "@shared/artifactContracts";
import {
  artifactSemanticComparisonSchema,
  type ArtifactSemanticCollectionDelta,
  type ArtifactSemanticComparabilityFlag,
  type ArtifactSemanticComparison,
  type ArtifactSemanticNumericDelta,
} from "@shared/artifactSemanticDiffContracts";
import type { ConversationArtifactDraft } from "@shared/conversationRuntime";
import { hashLedgerValue } from "./ledgerStore";
import { compareRecordedFieldCaliber, isSignFlipSensitiveField } from "./finrobotFieldCaliber";
import { projectReportSections } from "./reportSectionProjection";
import type { ReportSection } from "./reportEngine";

const SEMANTIC_MATERIALITY_PCT = 0.03;
const NUMERIC_EPSILON = 1e-12;
const SEMANTIC_KINDS = new Set<ArtifactContent["kind"]>(["valuation", "portfolio", "research", "decision", "thesis"]);

export type ArtifactComparisonWithSemantic = ArtifactComparison & {
  semantic: ArtifactSemanticComparison | null;
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function topLevelChangedKeys(left: ArtifactContent, right: ArtifactContent): string[] {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].filter((key) => hashLedgerValue((left as any)[key]) !== hashLedgerValue((right as any)[key])).sort();
}

function stableNumber(value: number): number {
  const normalized = Number(value.toPrecision(12));
  return Object.is(normalized, -0) ? 0 : normalized;
}

function collectFiniteNumbers(
  target: Map<string, number>,
  prefix: string,
  value: unknown,
  depth = 0,
): void {
  if (depth > 3 || value === null || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    // Recorded caliber tags are metadata, not financial metrics. Reject
    // accidental number-shaped currency/period labels as numeric evidence.
    if (["quoteCurrency", "quote_currency", "reportingCurrency", "reporting_currency",
      "reportingPeriod", "reporting_period", "fiscalPeriod", "fiscal_period"].includes(key)) continue;
    const nested = (value as Record<string, unknown>)[key];
    const path = `${prefix}.${key}`;
    if (typeof nested === "number" && Number.isFinite(nested)) {
      target.set(path, nested);
      continue;
    }
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      collectFiniteNumbers(target, path, nested, depth + 1);
    }
  }
}

function semanticNumbers(content: ArtifactContent): Map<string, number> {
  const values = new Map<string, number>();
  if (content.kind === "valuation") {
    collectFiniteNumbers(values, "assumptions", content.assumptions);
    collectFiniteNumbers(values, "outputs", content.outputs);
    collectFiniteNumbers(values, "summary", content.summary);
  } else if (content.kind === "portfolio") {
    collectFiniteNumbers(values, "summary", content.summary);
    collectFiniteNumbers(values, "risk", content.risk);
  } else if (content.kind === "decision") {
    collectFiniteNumbers(values, "assumptions", content.assumptions);
  }
  return values;
}

function collectionAtPath(content: ArtifactContent, path: string): unknown[] | null {
  let value: unknown = content;
  for (const segment of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    value = (value as Record<string, unknown>)[segment];
  }
  return Array.isArray(value) ? value : null;
}

function semanticCollectionPaths(kind: ArtifactContent["kind"]): readonly string[] {
  if (kind === "thesis") {
    return ["expectedOutcomes", "claims", "catalysts", "risks", "invalidationConditions", "openQuestions"];
  }
  if (kind === "decision") return ["actions", "followUp", "scenarios", "alternatives"];
  if (kind === "research") return ["plan.steps", "claims", "evidence", "contradictions"];
  return [];
}

function keyedCollection(
  items: unknown[],
  path: string,
  comparability: ArtifactSemanticComparabilityFlag[],
): Map<string, unknown> | null {
  const keyed = new Map<string, unknown>();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      comparability.push({
        kind: "collection_identity",
        path,
        message: `Semantic collection ${path} contains an item without a stable object identity.`,
        blocksAttribution: false,
      });
      return null;
    }
    const id = (item as Record<string, unknown>).id;
    if (typeof id !== "string" || id.trim().length === 0 || keyed.has(id)) {
      comparability.push({
        kind: "collection_identity",
        path,
        message: `Semantic collection ${path} requires unique stable string ids.`,
        blocksAttribution: false,
      });
      return null;
    }
    keyed.set(id, item);
  }
  return keyed;
}

function diffKeyedCollection(
  path: string,
  left: unknown[],
  right: unknown[],
  comparability: ArtifactSemanticComparabilityFlag[],
): ArtifactSemanticCollectionDelta | null {
  const before = keyedCollection(left, path, comparability);
  const after = keyedCollection(right, path, comparability);
  if (!before || !after) return null;
  const beforeIds = new Set(before.keys());
  const afterIds = new Set(after.keys());
  const addedIds = [...afterIds].filter((id) => !beforeIds.has(id)).sort();
  const removedIds = [...beforeIds].filter((id) => !afterIds.has(id)).sort();
  const changedIds = [...beforeIds]
    .filter((id) => afterIds.has(id) && hashLedgerValue(before.get(id)) !== hashLedgerValue(after.get(id)))
    .sort();
  if (addedIds.length === 0 && removedIds.length === 0 && changedIds.length === 0) return null;
  return { path, addedIds, removedIds, changedIds };
}

function numericDeltas(
  left: ArtifactContent,
  right: ArtifactContent,
  comparable: boolean,
  comparability: ArtifactSemanticComparabilityFlag[],
): ArtifactSemanticNumericDelta[] {
  const before = semanticNumbers(left);
  const after = semanticNumbers(right);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const deltas: ArtifactSemanticNumericDelta[] = [];
  for (const path of paths) {
    const oldValue = before.get(path);
    const newValue = after.get(path);
    const caliberIssues = compareRecordedFieldCaliber(left, right, path);
    for (const issue of caliberIssues) {
      comparability.push({ kind: issue.kind, path, message: issue.message, blocksAttribution: true });
    }
    // The values may be numerically equal while their currency/accounting
    // basis changed. That still blocks a like-for-like comparison.
    if (oldValue === newValue) continue;
    if (oldValue === undefined || newValue === undefined) {
      comparability.push({
        kind: "missing_value",
        path,
        message: `Semantic numeric value ${path} is present in only one Artifact version.`,
        blocksAttribution: false,
      });
      deltas.push({
        path,
        before: oldValue ?? null,
        after: newValue ?? null,
        absoluteChange: null,
        percentChange: null,
        direction: oldValue === undefined ? "added" : "removed",
        comparable: false,
      });
      continue;
    }
    const rawChange = newValue - oldValue;
    if (Math.abs(rawChange) <= NUMERIC_EPSILON) continue;
    // No P11 re-pricing or implicit FX/period conversion: retain both
    // recorded numbers but withhold change math when caliber differs.
    const finiteChange = Number.isFinite(rawChange);
    if (!finiteChange) comparability.push({
      kind: "method", path,
      message: "Numeric change exceeds finite arithmetic bounds; change magnitude is unavailable.",
      blocksAttribution: true,
    });
    const pathComparable = comparable && caliberIssues.length === 0 && finiteChange;
    const absoluteChange = pathComparable ? stableNumber(rawChange) : null;
    const signFlip = isSignFlipSensitiveField(path) &&
      ((oldValue < 0 && newValue > 0) || (oldValue > 0 && newValue < 0));
    const ratio = rawChange / Math.abs(oldValue);
    const percentChange = pathComparable && !signFlip &&
      Math.abs(oldValue) > NUMERIC_EPSILON && Number.isFinite(ratio)
      ? stableNumber(ratio)
      : null;
    deltas.push({
      path,
      before: oldValue,
      after: newValue,
      absoluteChange,
      percentChange,
      direction: rawChange > 0 ? "up" : "down",
      comparable: pathComparable,
    });
  }
  return deltas;
}

export function buildArtifactSemanticComparison(
  left: ArtifactContent,
  right: ArtifactContent,
): ArtifactSemanticComparison | null {
  if (!SEMANTIC_KINDS.has(left.kind) && !SEMANTIC_KINDS.has(right.kind)) return null;

  const comparability: ArtifactSemanticComparabilityFlag[] = [];
  let likeForLike = left.kind === right.kind;
  if (!likeForLike) {
    comparability.push({
      kind: "kind",
      path: null,
      message: `Artifact kind changed from ${left.kind} to ${right.kind}; semantic values are not like-for-like.`,
      blocksAttribution: true,
    });
  }

  if (left.kind === "valuation" && right.kind === "valuation" && left.modelId !== right.modelId) {
    likeForLike = false;
    comparability.push({
      kind: "model",
      path: "modelId",
      message: `Valuation model changed from ${left.modelId} to ${right.modelId}; numeric moves are not like-for-like.`,
      blocksAttribution: true,
    });
  }

  const numeric = left.kind === right.kind
    ? numericDeltas(left, right, likeForLike, comparability)
    : [];
  const collectionDeltas: ArtifactSemanticCollectionDelta[] = [];
  if (left.kind === right.kind) {
    for (const path of semanticCollectionPaths(left.kind)) {
      const before = collectionAtPath(left, path) ?? [];
      const after = collectionAtPath(right, path) ?? [];
      const delta = diffKeyedCollection(path, before, after, comparability);
      if (delta) collectionDeltas.push(delta);
    }
  }

  const materialNumeric = numeric.some((item) => {
    if (item.direction === "added" || item.direction === "removed") return true;
    if (!item.comparable) return false;
    if (item.percentChange !== null) return Math.abs(item.percentChange) >= SEMANTIC_MATERIALITY_PCT;
    return item.absoluteChange !== null && Math.abs(item.absoluteChange) > NUMERIC_EPSILON;
  });
  const materialChange = comparability.some((flag) => flag.blocksAttribution)
    || collectionDeltas.length > 0
    || materialNumeric;

  return artifactSemanticComparisonSchema.parse({
    materialChange,
    numericDeltas: numeric,
    collectionDeltas,
    comparability,
    attribution: {
      available: false,
      reason: "authoritative_p11_contributions_not_supplied",
      items: [],
      totalChange: null,
      residual: null,
    },
  });
}

export function diffSpreadsheetContent(left: ArtifactContent, right: ArtifactContent): SpreadsheetCellDiff[] {
  if (left.kind !== "spreadsheet" || right.kind !== "spreadsheet") return [];
  const leftSheets = new Map(left.sheets.map((sheet) => [sheet.id, sheet]));
  const rightSheets = new Map(right.sheets.map((sheet) => [sheet.id, sheet]));
  const sheetIds = new Set([...leftSheets.keys(), ...rightSheets.keys()]);
  const diffs: SpreadsheetCellDiff[] = [];
  for (const sheetId of [...sheetIds].sort()) {
    const a = leftSheets.get(sheetId);
    const b = rightSheets.get(sheetId);
    const refs = new Set([...Object.keys(a?.cells ?? {}), ...Object.keys(b?.cells ?? {})]);
    for (const ref of [...refs].sort()) {
      const before = a?.cells[ref] ?? null;
      const after = b?.cells[ref] ?? null;
      if (hashLedgerValue(before) === hashLedgerValue(after)) continue;
      diffs.push(spreadsheetCellDiffSchema.parse({ sheetId, ref, before, after }));
    }
  }
  return diffs;
}

export function compareArtifactContents(input: {
  artifactId: string;
  leftVersion: number;
  rightVersion: number;
  left: ArtifactContent;
  right: ArtifactContent;
}): ArtifactComparisonWithSemantic {
  const base = artifactComparisonSchema.parse({
    artifactId: input.artifactId,
    leftVersion: input.leftVersion,
    rightVersion: input.rightVersion,
    leftHash: hashLedgerValue(input.left),
    rightHash: hashLedgerValue(input.right),
    changed: hashLedgerValue(input.left) !== hashLedgerValue(input.right),
    topLevelChangedKeys: topLevelChangedKeys(input.left, input.right),
    spreadsheetDiffs: diffSpreadsheetContent(input.left, input.right),
  });
  return {
    ...base,
    semantic: buildArtifactSemanticComparison(input.left, input.right),
  };
}

export function applySpreadsheetDiffs(base: ArtifactContent, diffs: SpreadsheetCellDiff[]): ArtifactContent {
  const parsed = spreadsheetArtifactContentSchema.parse(base);
  const next = cloneJson(parsed);
  const sheets = new Map(next.sheets.map((sheet) => [sheet.id, sheet]));
  for (const raw of diffs) {
    const diff = spreadsheetCellDiffSchema.parse(raw);
    const sheet = sheets.get(diff.sheetId);
    if (!sheet) throw new Error(`Spreadsheet diff references unknown sheet ${diff.sheetId}.`);
    if (diff.after === null) delete sheet.cells[diff.ref];
    else sheet.cells[diff.ref] = diff.after;
  }
  return spreadsheetArtifactContentSchema.parse(next);
}

export function applyArtifactPatch(base: ArtifactContent, patch: Record<string, unknown>): ArtifactContent {
  const next = { ...cloneJson(base), ...cloneJson(patch), kind: base.kind };
  return artifactContentSchema.parse(next);
}

/** Adapt unknown conversation payloads to the existing report projector, not a second document format. */
function projectConversationDocument(draft: ConversationArtifactDraft, data: Record<string, unknown>) {
  const label = (key: string) => {
    const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  };
  const title = typeof data.title === "string" && data.title.trim() ? data.title : draft.title;
  const sections: ReportSection[] = [{ type: "title", title, content: title, order: 0 }];
  const append = (name: string, content: unknown) => {
    sections.push({ type: "text", title: name, content, order: sections.length });
  };
  for (const [key, value] of Object.entries(data)) {
    if (["kind", "title", "templateId", "editorPreference"].includes(key)) continue;
    if (key === "sections" && Array.isArray(value)) {
      value.forEach((section, index) => {
        if (section && typeof section === "object" && !Array.isArray(section)) {
          const record = section as Record<string, unknown>;
          if (typeof record.title === "string" && record.title.trim() && Object.hasOwn(record, "content")) {
            const extra = Object.fromEntries(Object.entries(record).filter(([name]) =>
              !["title", "content", "type", "order"].includes(name)));
            append(record.title, Object.keys(extra).length ? { content: record.content, ...extra } : record.content);
            return;
          }
        }
        append(`Section ${index + 1}`, section);
      });
    } else append(label(key), value);
  }
  return projectReportSections({
    id: draft.artifactId,
    templateId: typeof data.templateId === "string" ? data.templateId : "",
    title,
    generatedAt: "",
    sections,
    metadata: { passportIds: [], outputHash: hashLedgerValue(data) },
  }, {
    attrs: { sourceRefs: draft.sourceRefs, executionReceiptIds: draft.executionReceiptIds },
    // The readable blocks are only a projection. Retain the complete original
    // payload once, including unrecognized rights, provenance and custody fields.
    firstBlockAttrs: { conversationDraftData: data, conversationArtifactType: draft.artifactType },
  });
}

export function normalizeConversationDraft(draft: ConversationArtifactDraft): ArtifactContent {
  const type = draft.artifactType.toLowerCase();
  const data = cloneJson(draft.data);
  const canonical = artifactContentSchema.safeParse(data);
  if (canonical.success) return canonical.data;
  if (type === "analysis.technical" || type === "analysis.security-overview") {
    const symbol = typeof data.symbol === "string" ? data.symbol : null;
    const scope = data.sourceScope === "web" ? "web" : data.sourceScope === "my_data" ? "my_data" : data.sourceScope === "files" ? "files" : "auto";
    return artifactContentSchema.parse({
      kind: "screen", view: type === "analysis.technical" ? "chart" : "entity", symbol,
      state: { terminal: initialTerminalScreenState(symbol, scope), recordedAnalysis: data },
    });
  }
  if (type.includes("valuation")) {
    return artifactContentSchema.parse({
      kind: "valuation",
      symbol: typeof data.symbol === "string" ? data.symbol : null,
      modelId: typeof data.modelId === "string" ? data.modelId : draft.artifactType,
      assumptions: typeof data.assumptions === "object" && data.assumptions ? data.assumptions : {},
      outputs: data,
      summary: {},
    });
  }
  if (type.includes("portfolio")) {
    return artifactContentSchema.parse({ kind: "portfolio", portfolioRef: null, holdings: [], summary: data, risk: {} });
  }
  if (type.includes("report") || type.includes("research")) {
    const projected = projectConversationDocument(draft, data);
    if (type.includes("report")) {
      return artifactContentSchema.parse({
        kind: "report",
        templateId: typeof data.templateId === "string" && data.templateId.trim().length <= 200 ? data.templateId : null,
        ...projected,
        editorPreference: "builtin",
      });
    }
    return artifactContentSchema.parse({
      kind: "research",
      question: typeof data.question === "string" ? data.question : "",
      blocks: projected.blocks,
      claims: [],
      editorPreference: "builtin",
    });
  }
  if (type.includes("table")) {
    const rows = Array.isArray((data as any).rows) ? (data as any).rows : [];
    const columns = rows.length && typeof rows[0] === "object"
      ? Object.keys(rows[0]).map((key) => ({ key, label: key, type: "string" as const }))
      : [];
    return artifactContentSchema.parse({ kind: "table", columns, rows });
  }
  if (type.includes("chart")) {
    return artifactContentSchema.parse({ kind: "chart", rendererPreference: "recharts", chartType: "line", series: [], options: data });
  }
  return artifactContentSchema.parse({
    kind: "screen",
    view: draft.artifactType,
    symbol: typeof data.symbol === "string" ? data.symbol : null,
    state: data,
  });
}
