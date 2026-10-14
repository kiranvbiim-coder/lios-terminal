const DEFAULT_MAX_SECTIONS = 200;
const DEFAULT_MAX_TABLES = 100;
const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLUMNS = 40;
const DEFAULT_MAX_CELLS = 2_000;
const DEFAULT_MAX_UNIT_HINTS = 50;
const DEFAULT_MAX_RELATIONSHIPS = 500;
const DEFAULT_MAX_FINANCIAL_ROWS = 2_000;

export interface P7StructuredAnchor {
  pageNumber: number | null;
  bbox: { left: number; top: number; right: number; bottom: number } | null;
  lineRange: { start: number; end: number } | null;
}

export interface P7StructuredSection {
  id: string;
  kind: "title" | "section_header" | "heading" | "preamble";
  title: string;
  level: number;
  startLine: number;
  endLine: number;
  text: string;
  unitHints: string[];
  anchor: P7StructuredAnchor;
  donorRef: string | null;
}

export interface P7StructuredRelationship {
  kind: "explicit_tabular";
  relation: string;
  from: string;
  to: string;
  rowIndex: number;
  fromColumn: string;
  toColumn: string;
  relationColumn: string | null;
}

export interface P7StructuredDocumentRelationship {
  kind: "contains" | "parent";
  from: string;
  to: string;
}

export interface P7StructuredFinancialRow {
  metric: string;
  period: string | null;
  value: string;
  unit: string | null;
  currency: string | null;
  rowIndex: number;
  valueColumn: string;
}

export interface P7StructuredCell {
  text: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  columnHeader: boolean;
  rowHeader: boolean;
}

export type P7FinancialStructure = "income_statement" | "balance_sheet" | "cash_flow" | "unknown";

export interface P7StructuredTable {
  id: string;
  donorRef: string | null;
  sectionId: string | null;
  sectionTitle: string | null;
  startLine: number;
  endLine: number;
  headers: string[];
  rows: string[][];
  cells: P7StructuredCell[];
  rowCount: number;
  columnCount: number;
  markdown: string;
  unitHints: string[];
  relationships: P7StructuredRelationship[];
  financialRows: P7StructuredFinancialRow[];
  financialStructure: P7FinancialStructure;
  anchor: P7StructuredAnchor;
  truncated: boolean;
}

export interface P7StructuredUnit {
  kind: "currency" | "percent" | "basis_points" | "scale" | "per_share" | "physical";
  raw: string;
  normalized: string;
}

export interface P7StructuredTruncation {
  truncated: boolean;
  omitted: {
    sections: number;
    tables: number;
    cells: number;
    relationships: number;
    units: number;
    financialRows: number;
  };
}

export interface P7StructuredDocument {
  schemaVersion: "1";
  version: "1.0";
  sourceMode: "docling" | "text_fallback";
  incomplete: boolean;
  sections: P7StructuredSection[];
  tables: P7StructuredTable[];
  unitHints: string[];
  units: P7StructuredUnit[];
  documentRelationships: P7StructuredDocumentRelationship[];
  relationshipCount: number;
  documentRelationshipCount: number;
  financialRowCount: number;
  truncation: P7StructuredTruncation;
}

export interface P7StructuredExtractionOptions {
  incomplete?: boolean;
  maxSections?: number;
  maxTables?: number;
  maxCells?: number;
  maxRelationships?: number;
  maxUnits?: number;
  maxFinancialValues?: number;
}

function boundedPositive(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function limits(options: P7StructuredExtractionOptions) {
  return {
    maxSections: boundedPositive(options.maxSections, DEFAULT_MAX_SECTIONS, DEFAULT_MAX_SECTIONS),
    maxTables: boundedPositive(options.maxTables, DEFAULT_MAX_TABLES, DEFAULT_MAX_TABLES),
    maxCells: boundedPositive(options.maxCells, DEFAULT_MAX_CELLS, DEFAULT_MAX_CELLS),
    maxRelationships: boundedPositive(options.maxRelationships, DEFAULT_MAX_RELATIONSHIPS, DEFAULT_MAX_RELATIONSHIPS),
    maxUnits: boundedPositive(options.maxUnits, DEFAULT_MAX_UNIT_HINTS, DEFAULT_MAX_UNIT_HINTS),
    maxFinancialValues: boundedPositive(options.maxFinancialValues, DEFAULT_MAX_FINANCIAL_ROWS, DEFAULT_MAX_FINANCIAL_ROWS),
  };
}

function unique(values: string[], limit = DEFAULT_MAX_UNIT_HINTS): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

const CURRENCIES = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY", "RMB", "HKD",
  "SGD", "INR", "KWD", "SAR", "AED", "QAR", "BHD", "OMR",
]);

function unitKey(unit: P7StructuredUnit): string {
  return unit.kind + "\u0000" + unit.normalized.toLowerCase();
}

function uniqueUnits(units: P7StructuredUnit[], limit: number): P7StructuredUnit[] {
  const output: P7StructuredUnit[] = [];
  const seen = new Set<string>();
  for (const unit of units) {
    const key = unitKey(unit);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(unit);
    if (output.length >= limit) break;
  }
  return output;
}

export function explicitUnits(text: string): P7StructuredUnit[] {
  const units: P7StructuredUnit[] = [];
  for (const match of text.matchAll(/\b[A-Za-z]{3}\b/g)) {
    const currency = match[0].toUpperCase();
    if (CURRENCIES.has(currency)) units.push({ kind: "currency", raw: match[0], normalized: currency });
  }
  const percent = /%|\bpercent(?:age)?\b/i.exec(text);
  if (percent) units.push({ kind: "percent", raw: percent[0], normalized: "%" });
  const bps = /\bbps\b|\bbasis points?\b/i.exec(text);
  if (bps) units.push({ kind: "basis_points", raw: bps[0], normalized: "bps" });
  const thousand = /\bthousands?\b|\b000s\b|\b000's\b/i.exec(text);
  if (thousand) units.push({ kind: "scale", raw: thousand[0], normalized: "thousand" });
  const million = /\bmillions?\b/i.exec(text);
  if (million) units.push({ kind: "scale", raw: million[0], normalized: "million" });
  const billion = /\bbillions?\b/i.exec(text);
  if (billion) units.push({ kind: "scale", raw: billion[0], normalized: "billion" });
  const trillion = /\btrillions?\b/i.exec(text);
  if (trillion) units.push({ kind: "scale", raw: trillion[0], normalized: "trillion" });
  const perShare = /\bper share\b|\/share\b/i.exec(text);
  if (perShare) units.push({ kind: "per_share", raw: perShare[0], normalized: "per share" });
  const physicalMatchers: Array<[RegExp, string]> = [
    [/\bbbls?\b/i, "bbl"],
    [/\bboe\b/i, "boe"],
    [/\bmmbtu\b/i, "mmbtu"],
    [/\btonnes?\b|\bmetric tons?\b/i, "tonne"],
    [/\bkilograms?\b|\bkg\b/i, "kg"],
  ];
  for (const [pattern, normalized] of physicalMatchers) {
    const match = pattern.exec(text);
    if (match) units.push({ kind: "physical", raw: match[0], normalized });
  }
  return uniqueUnits(units, DEFAULT_MAX_UNIT_HINTS);
}

export function explicitUnitHints(text: string): string[] {
  return explicitUnits(text).map((unit) => unit.normalized);
}

function normalizeLineEndings(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

function parsePipeRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  return value.split("|").map((cell) => cell.replace(/\\\|/g, "|").trim()).slice(0, MAX_TABLE_COLUMNS);
}

function isSeparatorRow(line: string): boolean {
  const cells = parsePipeRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function markdownRow(cells: string[]): string {
  return "| " + cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ") + " |";
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[_/]+/g, " ").replace(/[^a-z0-9% ]+/g, " ").replace(/\s+/g, " ").trim();
}

function headerIndex(headers: string[], candidates: readonly string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const index = normalized.indexOf(candidate);
    if (index >= 0) return index;
  }
  return -1;
}

const RELATION_COLUMN_PAIRS: Array<readonly [string, string]> = [
  ["from", "to"],
  ["source", "target"],
  ["parent", "child"],
  ["parent", "subsidiary"],
  ["owner", "subsidiary"],
  ["acquirer", "target"],
  ["buyer", "seller"],
  ["lender", "borrower"],
  ["supplier", "customer"],
];

function explicitRelationships(headers: string[], rows: string[][]): P7StructuredRelationship[] {
  const normalized = headers.map(normalizeHeader);
  const relationIndex = headerIndex(headers, ["relationship", "relation", "relationship type", "relation type", "type"]);
  let pair: { left: number; right: number } | null = null;
  for (const [leftName, rightName] of RELATION_COLUMN_PAIRS) {
    const left = normalized.indexOf(leftName);
    const right = normalized.indexOf(rightName);
    if (left >= 0 && right >= 0 && left !== right) {
      pair = { left, right };
      break;
    }
  }
  if (!pair) return [];

  const output: P7StructuredRelationship[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const from = row[pair.left]?.trim() ?? "";
    const to = row[pair.right]?.trim() ?? "";
    if (!from || !to) continue;
    const explicitRelation = relationIndex >= 0 ? row[relationIndex]?.trim() ?? "" : "";
    output.push({
      kind: "explicit_tabular",
      relation: explicitRelation || `${normalizeHeader(headers[pair.left])}_to_${normalizeHeader(headers[pair.right])}`.replace(/\s+/g, "_"),
      from,
      to,
      rowIndex,
      fromColumn: headers[pair.left],
      toColumn: headers[pair.right],
      relationColumn: relationIndex >= 0 ? headers[relationIndex] : null,
    });
  }
  return output;
}

function looksLikePeriod(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return /^(?:fy\s*)?\d{4}[ae]?$/.test(normalized)
    || /^q[1-4]\s*[-/]?\s*\d{2,4}[ae]?$/.test(normalized)
    || /^[1-4]q\s*[-/]?\s*\d{2,4}[ae]?$/.test(normalized)
    || /^h[12]\s*[-/]?\s*\d{2,4}[ae]?$/.test(normalized)
    || /^(?:ttm|ltm)$/.test(normalized);
}

function looksLikeNumericValue(value: string): boolean {
  const normalized = value.trim();
  if (!normalized || /^(?:n\/?a|na|nm|—|-|–)$/i.test(normalized)) return false;
  return /^[-+]?[$€£¥₹]?\(?\d[\d,\s]*(?:\.\d+)?\)?(?:%|x)?(?:\s+(?:thousand|million|billion|trillion))?$/i.test(normalized);
}

function currencyHint(text: string): string | null {
  return explicitUnits(text).find((unit) => unit.kind === "currency")?.normalized ?? null;
}

function nonCurrencyUnit(hints: string[]): string | null {
  return hints.find((hint) => !CURRENCIES.has(hint)) ?? null;
}

function unambiguousHint(hints: string[], predicate: (hint: string) => boolean): string | null {
  const values = [...new Set(hints.filter(predicate))];
  return values.length === 1 ? values[0] : null;
}

function explicitFinancialRows(
  headers: string[],
  rows: string[][],
  tableUnitHints: string[],
): P7StructuredFinancialRow[] {
  const metricIndex = headerIndex(headers, ["metric", "line item", "item", "account", "kpi", "measure", "description"]);
  const valueIndex = headerIndex(headers, ["value", "amount", "actual", "reported value", "reported"]);
  const periodIndex = headerIndex(headers, ["period", "fiscal period", "quarter", "year", "date"]);
  const unitIndex = headerIndex(headers, ["unit", "units", "scale"]);
  const currencyIndex = headerIndex(headers, ["currency", "ccy"]);
  const output: P7StructuredFinancialRow[] = [];

  if (metricIndex >= 0 && valueIndex >= 0) {
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const metric = row[metricIndex]?.trim() ?? "";
      const value = row[valueIndex]?.trim() ?? "";
      if (!metric || !value || !looksLikeNumericValue(value)) continue;
      const explicitUnit = unitIndex >= 0 ? row[unitIndex]?.trim() || null : null;
      const explicitCurrency = currencyIndex >= 0 ? row[currencyIndex]?.trim().toUpperCase() || null : null;
      const valueHints = explicitUnitHints([headers[valueIndex], value, explicitUnit ?? "", explicitCurrency ?? ""].join(" "));
      const valueUnit = explicitUnit ?? nonCurrencyUnit(valueHints);
      const tableUnit = unambiguousHint(tableUnitHints, (hint) => !CURRENCIES.has(hint));
      const valueIsRate = valueUnit === "%" || valueUnit === "bps";
      const tableCurrency = unambiguousHint(tableUnitHints, (hint) => CURRENCIES.has(hint));
      output.push({
        metric,
        period: periodIndex >= 0 ? row[periodIndex]?.trim() || null : null,
        value,
        unit: valueUnit ?? tableUnit,
        currency: explicitCurrency ?? (valueIsRate ? null : currencyHint([headers[valueIndex], value].join(" ")) ?? tableCurrency),
        rowIndex,
        valueColumn: headers[valueIndex],
      });
    }
    return output;
  }

  const firstHeader = headers[0]?.trim() ?? "";
  const periodColumns = headers
    .map((header, index) => ({ header, index }))
    .filter(({ index, header }) => index > 0 && looksLikePeriod(header));
  if (!firstHeader || !periodColumns.length) return output;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const metric = rows[rowIndex][0]?.trim() ?? "";
    if (!metric) continue;
    for (const { header, index } of periodColumns) {
      const value = rows[rowIndex][index]?.trim() ?? "";
      if (!looksLikeNumericValue(value)) continue;
      const valueHints = explicitUnitHints([header, value].join(" "));
      const valueUnit = nonCurrencyUnit(valueHints);
      const tableUnit = unambiguousHint(tableUnitHints, (hint) => !CURRENCIES.has(hint));
      const valueIsRate = valueUnit === "%" || valueUnit === "bps";
      const tableCurrency = unambiguousHint(tableUnitHints, (hint) => CURRENCIES.has(hint));
      output.push({
        metric,
        period: header,
        value,
        unit: valueUnit ?? tableUnit,
        currency: valueIsRate ? null : currencyHint([header, value].join(" ")) ?? tableCurrency,
        rowIndex,
        valueColumn: header,
      });
    }
  }
  return output;
}

function countSignals(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function classifyFinancialStructure(headers: string[], rows: string[][], sectionTitle: string | null): P7FinancialStructure {
  const labels = [
    sectionTitle ?? "",
    ...headers,
    ...rows.slice(0, 50).map((row) => row[0] ?? ""),
  ].join(" ").toLowerCase();

  const income = countSignals(labels, [
    /\brevenue\b|\bsales\b/,
    /\bgross profit\b/,
    /\boperating (?:income|profit|margin)\b|\bebitda\b|\bebit\b/,
    /\bnet income\b|\bnet profit\b|\bearnings\b/,
  ]);
  const balance = countSignals(labels, [
    /\bassets?\b/,
    /\bliabilit(?:y|ies)\b/,
    /\bequity\b/,
    /\breceivables?\b|\binventor(?:y|ies)\b/,
    /\bdebt\b/,
  ]);
  const cashFlow = countSignals(labels, [
    /\boperating cash flow\b|\bcash from operations\b/,
    /\binvesting activities\b|\bcash from investing\b/,
    /\bfinancing activities\b|\bcash from financing\b/,
    /\bcapital expenditures?\b|\bcapex\b/,
    /\bfree cash flow\b/,
  ]);

  const best = Math.max(income, balance, cashFlow);
  if (best < 2) return "unknown";
  const leaders = [
    ["income_statement", income],
    ["balance_sheet", balance],
    ["cash_flow", cashFlow],
  ] as const;
  const winners = leaders.filter(([, score]) => score === best);
  return winners.length === 1 ? winners[0][0] : "unknown";
}

function textAnchor(start: number, end: number): P7StructuredAnchor {
  return { pageNumber: null, bbox: null, lineRange: { start, end } };
}

function emptyAnchor(): P7StructuredAnchor {
  return { pageNumber: null, bbox: null, lineRange: null };
}

function buildSections(lines: string[], maxSections: number): { sections: P7StructuredSection[]; rawCount: number } {
  const headings: Array<{ line: number; level: number; title: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[index].trim());
    if (match) headings.push({ line: index, level: match[1].length, title: match[2].trim() });
  }
  if (!headings.length) return { sections: [], rawCount: 0 };

  const sections: P7StructuredSection[] = [];
  const preamble = lines.slice(0, headings[0].line).join("\n").trim();
  const rawCount = headings.length + (preamble ? 1 : 0);
  if (preamble && sections.length < maxSections) {
    const end = headings[0].line;
    sections.push({
      id: "s0",
      kind: "preamble",
      title: "Preamble",
      level: 0,
      startLine: 1,
      endLine: end,
      text: preamble,
      unitHints: explicitUnitHints(preamble),
      anchor: textAnchor(1, end),
      donorRef: null,
    });
  }

  for (let index = 0; index < headings.length && sections.length < maxSections; index += 1) {
    const heading = headings[index];
    const nextLine = headings[index + 1]?.line ?? lines.length;
    const text = lines.slice(heading.line + 1, nextLine).join("\n").trim();
    const startLine = heading.line + 1;
    const endLine = nextLine;
    sections.push({
      id: `s${index + 1}`,
      kind: "heading",
      title: heading.title,
      level: heading.level,
      startLine,
      endLine,
      text,
      unitHints: explicitUnitHints([heading.title, text].join("\n")),
      anchor: textAnchor(startLine, endLine),
      donorRef: null,
    });
  }
  return { sections, rawCount };
}

function sectionForLine(sections: P7StructuredSection[], lineNumber: number): P7StructuredSection | null {
  const candidates = sections.filter((section) =>
    section.anchor.lineRange
    && section.anchor.lineRange.start <= lineNumber
    && section.anchor.lineRange.end >= lineNumber
  );
  return candidates.sort((a, b) =>
    (b.anchor.lineRange?.start ?? 0) - (a.anchor.lineRange?.start ?? 0)
    || b.level - a.level
  )[0] ?? null;
}

function cellsFromGrid(headers: string[], rows: string[][]): P7StructuredCell[] {
  const output: P7StructuredCell[] = [];
  for (let column = 0; column < headers.length; column += 1) {
    output.push({
      text: headers[column] ?? "",
      startRow: 0,
      endRow: 1,
      startColumn: column,
      endColumn: column + 1,
      columnHeader: true,
      rowHeader: false,
    });
  }
  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < headers.length; column += 1) {
      output.push({
        text: rows[row][column] ?? "",
        startRow: row + 1,
        endRow: row + 2,
        startColumn: column,
        endColumn: column + 1,
        columnHeader: false,
        rowHeader: column === 0,
      });
    }
  }
  return output;
}

function buildFallbackTables(
  lines: string[],
  sections: P7StructuredSection[],
  maxTables: number,
  maxCells: number,
  maxFinancialValues: number,
): { tables: P7StructuredTable[]; rawTableCount: number; rawCellCount: number; rawFinancialCount: number } {
  const tables: P7StructuredTable[] = [];
  let rawTableCount = 0;
  let rawCellCount = 0;
  let rawFinancialCount = 0;
  let remainingCells = maxCells;
  let remainingFinancial = maxFinancialValues;

  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (!lines[index].includes("|") || !isSeparatorRow(lines[index + 1])) continue;
    rawTableCount += 1;
    const headers = parsePipeRow(lines[index]);
    if (!headers.length) continue;

    const rows: string[][] = [];
    let cursor = index + 2;
    let rowOverflow = false;
    while (cursor < lines.length && lines[cursor].trim() && lines[cursor].includes("|")) {
      if (rows.length < MAX_TABLE_ROWS) {
        const parsed = parsePipeRow(lines[cursor]);
        rows.push(Array.from({ length: headers.length }, (_, cell) => parsed[cell] ?? ""));
      } else {
        rowOverflow = true;
      }
      cursor += 1;
    }
    rawCellCount += headers.length * (rows.length + 1);

    if (tables.length < maxTables) {
      const startLine = index + 1;
      const endLine = Math.max(index + 2, cursor);
      const section = sectionForLine(sections, startLine);
      const nearby = [
        section?.title ?? "",
        lines[Math.max(0, index - 2)] ?? "",
        lines[Math.max(0, index - 1)] ?? "",
        ...headers,
      ].join(" ");
      const unitHints = explicitUnitHints(nearby);
      const relationships = explicitRelationships(headers, rows);
      const allFinancialRows = explicitFinancialRows(headers, rows, unitHints);
      rawFinancialCount += allFinancialRows.length;
      const financialRows = allFinancialRows.slice(0, Math.max(0, remainingFinancial));
      remainingFinancial -= financialRows.length;
      const allCells = cellsFromGrid(headers, rows);
      const cells = allCells.slice(0, Math.max(0, remainingCells));
      remainingCells -= cells.length;
      const markdown = [
        markdownRow(headers),
        markdownRow(headers.map(() => "---")),
        ...rows.map(markdownRow),
      ].join("\n");

      tables.push({
        id: `t${tables.length + 1}`,
        donorRef: null,
        sectionId: section?.id ?? null,
        sectionTitle: section?.title ?? null,
        startLine,
        endLine,
        headers,
        rows,
        cells,
        rowCount: rows.length + 1,
        columnCount: headers.length,
        markdown,
        unitHints,
        relationships,
        financialRows,
        financialStructure: classifyFinancialStructure(headers, rows, section?.title ?? null),
        anchor: textAnchor(startLine, endLine),
        truncated: rowOverflow || cells.length < allCells.length || financialRows.length < allFinancialRows.length,
      });
    }
    index = Math.max(index, cursor - 1);
  }
  return { tables, rawTableCount, rawCellCount, rawFinancialCount };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function refOf(value: unknown): string | null {
  const record = asRecord(value);
  return record ? asString(record.$ref) : null;
}

function donorAnchor(value: unknown): P7StructuredAnchor {
  const record = asRecord(value);
  const prov = asArray(record?.prov);
  for (const candidate of prov) {
    const item = asRecord(candidate);
    if (!item) continue;
    const pageNumber = typeof item.page_no === "number" && Number.isFinite(item.page_no) ? item.page_no : null;
    const bbox = asRecord(item.bbox);
    const left = typeof bbox?.l === "number" ? bbox.l : null;
    const top = typeof bbox?.t === "number" ? bbox.t : null;
    const right = typeof bbox?.r === "number" ? bbox.r : null;
    const bottom = typeof bbox?.b === "number" ? bbox.b : null;
    return {
      pageNumber,
      bbox: left !== null && top !== null && right !== null && bottom !== null
        ? { left, top, right, bottom }
        : null,
      lineRange: null,
    };
  }
  return emptyAnchor();
}

function donorSections(input: Record<string, unknown>, maxSections: number): { sections: P7StructuredSection[]; rawCount: number } {
  const candidates = asArray(input.texts).flatMap((raw, index) => {
    const item = asRecord(raw);
    if (!item) return [];
    const label = asString(item.label);
    if (label !== "title" && label !== "section_header") return [];
    const kind: Extract<P7StructuredSection["kind"], "title" | "section_header"> = label;
    const text = asString(item.text);
    if (!text) return [];
    return [{
      item,
      index,
      kind,
      text,
      donorRef: asString(item.self_ref),
    }];
  });
  const sections = candidates.slice(0, maxSections).map(({ item, index, kind, text, donorRef }, outputIndex): P7StructuredSection => ({
    id: `s${outputIndex + 1}`,
    kind,
    title: text,
    level: kind === "title" ? 0 : 1,
    startLine: 0,
    endLine: 0,
    text,
    unitHints: explicitUnitHints(text),
    anchor: donorAnchor(item),
    donorRef: donorRef ?? `#/texts/${index}`,
  }));
  return { sections, rawCount: candidates.length };
}

function donorGroupNames(input: Record<string, unknown>): Map<string, string> {
  const names = new Map<string, string>();
  for (const raw of asArray(input.groups)) {
    const group = asRecord(raw);
    if (!group) continue;
    const ref = asString(group.self_ref);
    const name = asString(group.name);
    if (ref && name) names.set(ref, name);
  }
  return names;
}

function donorDocumentRelationships(input: Record<string, unknown>): P7StructuredDocumentRelationship[] {
  const output: P7StructuredDocumentRelationship[] = [];
  for (const raw of asArray(input.groups)) {
    const group = asRecord(raw);
    if (!group) continue;
    const from = asString(group.self_ref);
    if (!from) continue;
    for (const child of asArray(group.children)) {
      const to = refOf(child);
      if (to) output.push({ kind: "contains", from, to });
    }
  }
  for (const collectionName of ["texts", "tables"] as const) {
    for (const raw of asArray(input[collectionName])) {
      const item = asRecord(raw);
      if (!item) continue;
      const from = asString(item.self_ref);
      const to = refOf(item.parent);
      if (from && to) output.push({ kind: "parent", from, to });
    }
  }
  return [...new Map(output.map((edge) => [edge.kind + "\u0000" + edge.from + "\u0000" + edge.to, edge])).values()];
}

function donorCells(table: Record<string, unknown>): { cells: P7StructuredCell[]; rawCount: number; rowCount: number; columnCount: number } {
  const data = asRecord(table.data) ?? {};
  const rawCells = asArray(data.table_cells);
  const declaredRows = asInteger(data.num_rows) ?? 0;
  const declaredColumns = asInteger(data.num_cols) ?? 0;
  const cells = rawCells.flatMap((raw): P7StructuredCell[] => {
    const cell = asRecord(raw);
    if (!cell) return [];
    const text = typeof cell.text === "string" ? cell.text : "";
    const startRow = asInteger(cell.start_row_offset_idx);
    const endRow = asInteger(cell.end_row_offset_idx);
    const startColumn = asInteger(cell.start_col_offset_idx);
    const endColumn = asInteger(cell.end_col_offset_idx);
    if (startRow === null || endRow === null || startColumn === null || endColumn === null) return [];
    return [{
      text,
      startRow,
      endRow,
      startColumn,
      endColumn,
      columnHeader: cell.column_header === true,
      rowHeader: cell.row_header === true,
    }];
  });
  const inferredRows = cells.reduce((max, cell) => Math.max(max, cell.endRow), 0);
  const inferredColumns = cells.reduce((max, cell) => Math.max(max, cell.endColumn), 0);
  return {
    cells,
    rawCount: rawCells.length,
    rowCount: Math.min(MAX_TABLE_ROWS, Math.max(declaredRows, inferredRows)),
    columnCount: Math.min(MAX_TABLE_COLUMNS, Math.max(declaredColumns, inferredColumns)),
  };
}

function gridFromCells(cells: P7StructuredCell[], rowCount: number, columnCount: number): { headers: string[]; rows: string[][] } {
  const grid = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ""));
  for (const cell of cells) {
    if (cell.startRow < rowCount && cell.startColumn < columnCount) {
      grid[cell.startRow][cell.startColumn] = cell.text;
    }
  }
  const headers = grid[0] ?? [];
  return { headers, rows: grid.slice(1) };
}

function donorTables(
  input: Record<string, unknown>,
  maxTables: number,
  maxCells: number,
  maxFinancialValues: number,
): {
  tables: P7StructuredTable[];
  rawTableCount: number;
  rawCellCount: number;
  rawFinancialCount: number;
} {
  const rawTables = asArray(input.tables);
  const groups = donorGroupNames(input);
  const tables: P7StructuredTable[] = [];
  let rawCellCount = 0;
  let rawFinancialCount = 0;
  let remainingCells = maxCells;
  let remainingFinancial = maxFinancialValues;

  for (let index = 0; index < rawTables.length; index += 1) {
    const rawTable = asRecord(rawTables[index]);
    if (!rawTable) continue;
    const parsed = donorCells(rawTable);
    rawCellCount += parsed.rawCount;
    if (tables.length >= maxTables) continue;

    const allCells = parsed.cells;
    const cells = allCells.slice(0, Math.max(0, remainingCells));
    remainingCells -= cells.length;
    const grid = gridFromCells(cells, parsed.rowCount, parsed.columnCount);
    const parentRef = refOf(rawTable.parent);
    const sectionTitle = parentRef ? groups.get(parentRef) ?? null : null;
    const unitHints = explicitUnitHints([
      sectionTitle ?? "",
      ...cells.filter((cell) => cell.columnHeader).map((cell) => cell.text),
    ].join(" "));
    const relationships = explicitRelationships(grid.headers, grid.rows);
    const allFinancialRows = explicitFinancialRows(grid.headers, grid.rows, unitHints);
    rawFinancialCount += allFinancialRows.length;
    const financialRows = allFinancialRows.slice(0, Math.max(0, remainingFinancial));
    remainingFinancial -= financialRows.length;
    const markdown = grid.headers.length
      ? [
          markdownRow(grid.headers),
          markdownRow(grid.headers.map(() => "---")),
          ...grid.rows.map(markdownRow),
        ].join("\n")
      : cells.map((cell) => cell.text).filter(Boolean).join("\n");

    tables.push({
      id: `t${tables.length + 1}`,
      donorRef: asString(rawTable.self_ref) ?? `#/tables/${index}`,
      sectionId: parentRef,
      sectionTitle,
      startLine: 0,
      endLine: 0,
      headers: grid.headers,
      rows: grid.rows,
      cells,
      rowCount: parsed.rowCount,
      columnCount: parsed.columnCount,
      markdown,
      unitHints,
      relationships,
      financialRows,
      financialStructure: classifyFinancialStructure(grid.headers, grid.rows, sectionTitle),
      anchor: donorAnchor(rawTable),
      truncated: cells.length < allCells.length || financialRows.length < allFinancialRows.length,
    });
  }
  return { tables, rawTableCount: rawTables.length, rawCellCount, rawFinancialCount };
}

function finalizeDocument(input: {
  sourceMode: P7StructuredDocument["sourceMode"];
  sections: P7StructuredSection[];
  rawSectionCount: number;
  tables: P7StructuredTable[];
  rawTableCount: number;
  rawCellCount: number;
  rawFinancialCount: number;
  unitsSource: string;
  documentRelationships: P7StructuredDocumentRelationship[];
  options: P7StructuredExtractionOptions;
}): P7StructuredDocument {
  const bounded = limits(input.options);
  const allUnits = explicitUnits(input.unitsSource);
  const units = uniqueUnits(allUnits, bounded.maxUnits);
  const unitHints = units.map((unit) => unit.normalized);
  const relationships = input.documentRelationships.slice(0, bounded.maxRelationships);
  const tableRelationships = input.tables.reduce((sum, table) => sum + table.relationships.length, 0);
  const financialRows = input.tables.reduce((sum, table) => sum + table.financialRows.length, 0);
  const retainedCells = input.tables.reduce((sum, table) => sum + table.cells.length, 0);
  const omitted = {
    sections: Math.max(0, input.rawSectionCount - input.sections.length),
    tables: Math.max(0, input.rawTableCount - input.tables.length),
    cells: Math.max(0, input.rawCellCount - retainedCells),
    relationships: Math.max(0, input.documentRelationships.length - relationships.length),
    units: Math.max(0, allUnits.length - units.length),
    financialRows: Math.max(0, input.rawFinancialCount - financialRows),
  };
  const truncated = Object.values(omitted).some((count) => count > 0)
    || input.tables.some((table) => table.truncated);
  return {
    schemaVersion: "1",
    version: "1.0",
    sourceMode: input.sourceMode,
    incomplete: Boolean(input.options.incomplete) || truncated,
    sections: input.sections,
    tables: input.tables,
    unitHints,
    units,
    documentRelationships: relationships,
    relationshipCount: tableRelationships,
    documentRelationshipCount: relationships.length,
    financialRowCount: financialRows,
    truncation: { truncated, omitted },
  };
}

export function extractStructuredDocument(
  text: string,
  options: P7StructuredExtractionOptions = {},
): P7StructuredDocument {
  const bounded = limits(options);
  const lines = normalizeLineEndings(text);
  const sectionResult = buildSections(lines, bounded.maxSections);
  const tableResult = buildFallbackTables(
    lines,
    sectionResult.sections,
    bounded.maxTables,
    bounded.maxCells,
    bounded.maxFinancialValues,
  );
  return finalizeDocument({
    sourceMode: "text_fallback",
    sections: sectionResult.sections,
    rawSectionCount: sectionResult.rawCount,
    tables: tableResult.tables,
    rawTableCount: tableResult.rawTableCount,
    rawCellCount: tableResult.rawCellCount,
    rawFinancialCount: tableResult.rawFinancialCount,
    unitsSource: text,
    documentRelationships: [],
    options,
  });
}

/**
 * Projects Docling's donor-native export into bounded LiOS-owned structure.
 * The raw donor object is never treated as canonical product state.
 */
export function buildP7StructuredExtraction(
  donorDocument: unknown,
  options: P7StructuredExtractionOptions = {},
): P7StructuredDocument {
  const bounded = limits(options);
  const input = asRecord(donorDocument) ?? {};
  const sectionResult = donorSections(input, bounded.maxSections);
  const tableResult = donorTables(
    input,
    bounded.maxTables,
    bounded.maxCells,
    bounded.maxFinancialValues,
  );
  const documentRelationships = donorDocumentRelationships(input);
  const unitsSource = [
    ...asArray(input.texts).map((value) => asString(asRecord(value)?.text) ?? ""),
    ...asArray(input.tables).flatMap((value) => {
      const table = asRecord(value);
      const data = asRecord(table?.data);
      return asArray(data?.table_cells).map((cell) => asString(asRecord(cell)?.text) ?? "");
    }),
  ].join("\n");
  return finalizeDocument({
    sourceMode: "docling",
    sections: sectionResult.sections,
    rawSectionCount: sectionResult.rawCount,
    tables: tableResult.tables,
    rawTableCount: tableResult.rawTableCount,
    rawCellCount: tableResult.rawCellCount,
    rawFinancialCount: tableResult.rawFinancialCount,
    unitsSource,
    documentRelationships,
    options,
  });
}
