import type { AdvancedQuantInputProvenance } from "@shared/quantModelRegistry";
import {
  P5_DCF_SENSITIVITY_PATH,
  P5_MANUAL_ASSUMPTIONS_LABEL,
  formatP5GuidedNumber,
  p5RequiredInputKeys,
} from "@shared/p5GuidedInputs";

/**
 * Deterministic plain-language extraction of explicit model assumptions.
 *
 * The extractor only reads numbers the user stated. It never supplies a default, never
 * converts units it cannot be sure about, and refuses (reports an issue) whenever the
 * wording could mean two things: a percentage without a percent marker, a scale suffix
 * such as "50m", thousands separators, conflicting repeats of one assumption, or a
 * value list that does not line up with the stated horizon. Complete and unambiguous
 * input becomes exactly the parameter object the JSON path would have supplied, with
 * manual provenance; anything else yields the precise list of what is missing or unclear.
 */

export interface P5PlainLanguageIssue {
  key: string;
  message: string;
}

export interface P5PlainLanguageGap {
  /** Required input keys that were not stated at all. */
  missing: string[];
  /** Inputs that were stated but are ambiguous or invalid; nothing was guessed for them. */
  issues: P5PlainLanguageIssue[];
  /** Understood values, rendered as text for form pre-fill. */
  provided: Record<string, string>;
  /** Extra context, for example a first-year cash flow that lacks its growth rate or horizon. */
  notes: string[];
}

export type P5PlainLanguageExtraction =
  | { status: "complete"; parameters: Record<string, unknown>; inputProvenance: AdvancedQuantInputProvenance }
  | { status: "incomplete"; gap: P5PlainLanguageGap };

const NUM = String.raw`[-+]?[$€£]?\d+(?:\.\d+)?`;
const NUM_PLAIN = String.raw`[-+]?\d+(?:\.\d+)?`;
const SCALE = String.raw`(?:\s?(?:k|mm|mn|m|bn|b|tn|thousand|million|billion|trillion)\b)?`;
const PCT_MARK = String.raw`(?:%|percent\b|per\s?cent\b|pct\b)`;
const FILLER = String.raw`(?:[\s:=]|\b(?:of|at|is|are|equals?|assumed|set to|to be|would be|projected|forecast|forecasted|expected|estimated)\b)*`;
const LIST_SEP = String.raw`\s*(?:,\s*and\b|,|;|\band\b|\bthen\b|/)\s*`;
const NUM_ITEM = `${NUM}${SCALE}`;
const NUM_LIST = `${NUM_ITEM}(?:${LIST_SEP}${NUM_ITEM})*`;
const PCT_ITEM = `${NUM_PLAIN}(?:\\s?${PCT_MARK})?`;
const PCT_LIST = `${PCT_ITEM}(?:${LIST_SEP}${PCT_ITEM})*`;
const WACC_KEY = String.raw`(?:wacc|weighted\s+average\s+cost\s+of\s+capital|discount\s+rate)`;
const TG_KEY = String.raw`(?:terminal|perpetual|perpetuity)\s+growth(?:\s+rate)?`;
const GRID_WORD = String.raw`(?:grid|range|values?|sensitivit(?:y|ies)|scenarios?|cases?)`;

/** Text right after a captured number that continues it as a range ("... to 11%"). */
const TRAILING_RANGE = /^\s*(?:to|through|until|-|–|—)\s*[-+]?\d/i;

const MAX_YEARS = 50;
const MAX_GRID = 25;
const TRANSFORMATION_CHUNK = 900;

interface SegmentResult {
  values: Map<string, unknown>;
  issues: P5PlainLanguageIssue[];
  notes: string[];
}

const RELATIVE_LABELS: Record<string, string> = {
  freeCashFlows: "free cash flows",
  waccPct: "WACC",
  terminalGrowthPct: "terminal growth",
  netDebt: "net debt",
  sharesOutstanding: "shares outstanding",
  waccGridPct: "WACC values to test",
  terminalGrowthGridPct: "terminal growth values to test",
};

function numberOf(raw: string): number {
  return Number(raw.replace(/[$€£+\s]/g, ""));
}

function scaleSuffix(raw: string | undefined): boolean {
  return Boolean(raw && raw.trim());
}

/** Masks consumed spans so later patterns cannot read the same words twice. */
class Scanner {
  constructor(public text: string) {}

  each(pattern: RegExp, visit: (match: RegExpMatchArray, source: string) => void) {
    const source = this.text;
    const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
    const spans: Array<[number, number]> = [];
    for (const match of source.matchAll(new RegExp(pattern.source, flags))) {
      visit(match, source);
      spans.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
    }
    let masked = source;
    for (const [start, end] of spans) masked = masked.slice(0, start) + " ".repeat(end - start) + masked.slice(end);
    this.text = masked;
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

class Collector {
  private readonly found = new Map<string, unknown[]>();
  readonly issues: P5PlainLanguageIssue[] = [];
  readonly notes: string[] = [];

  add(field: string, value: unknown) {
    this.found.set(field, [...(this.found.get(field) ?? []), value]);
  }

  issue(field: string, message: string) {
    this.issues.push({ key: field, message });
  }

  has(field: string): boolean {
    return this.found.has(field);
  }

  /** The single stated value, or undefined (with an issue) when the user stated conflicting values. */
  single<T>(field: string): T | undefined {
    const values = this.found.get(field);
    if (!values?.length) return undefined;
    if (values.some((value) => !sameValue(value, values[0]))) {
      this.issue(field, "Conflicting values were stated for " + (RELATIVE_LABELS[field] ?? field) + ".");
      return undefined;
    }
    return values[0] as T;
  }
}

function percentValue(
  collector: Collector,
  field: string,
  label: string,
  raw: string,
  marker: string | undefined,
  after: string,
): number | null {
  if (!marker) {
    collector.issue(field, label + " \"" + raw.trim() + "\" has no percent sign. Write it as " + raw.trim() + "% or " + raw.trim() + " percent.");
    return null;
  }
  if (/^\s*(?:,|;|\band\b|\bor\b|\/)\s*[-+]?\d/i.test(after)) {
    collector.issue(field, label + " looks like a list of values. State one " + label + ", and use a values-to-test list for sensitivity values.");
    return null;
  }
  return numberOf(raw);
}

function amountList(raw: string): { values: number[]; scaled: boolean } {
  const values: number[] = [];
  let scaled = false;
  for (const item of raw.matchAll(new RegExp(`(${NUM})(${SCALE})`, "gi"))) {
    values.push(numberOf(item[1]));
    if (scaleSuffix(item[2])) scaled = true;
  }
  return { values, scaled };
}

function percentList(raw: string): { values: number[]; bare: boolean } {
  const values: number[] = [];
  let bare = false;
  for (const item of raw.matchAll(new RegExp(`(${NUM_PLAIN})(?:\\s?(${PCT_MARK}))?`, "gi"))) {
    values.push(numberOf(item[1]));
    if (!item[2]) bare = true;
  }
  return { values, bare };
}

const SCALE_MESSAGE = "uses a scale suffix such as k, m or bn. Write plain numbers in one consistent unit so LiOS never converts units for you.";

function stepGrid(start: number, end: number, step: number): number[] | null {
  const scale = 1e6;
  const [s, e, d] = [start, end, step].map((value) => Math.round(value * scale));
  if (![start, end, step].every((value) => Math.abs(Math.round(value * scale) / scale - value) < 1e-9)) return null;
  if (d <= 0 || e < s || (e - s) % d !== 0) return null;
  const count = (e - s) / d + 1;
  if (count > MAX_GRID) return null;
  return Array.from({ length: count }, (_, index) => (s + index * d) / scale);
}

function extractSegment(raw: string, allowShared: boolean): SegmentResult {
  const collector = new Collector();
  const scanner = new Scanner(raw);

  const STEP = `(?:\\s*,?\\s*(?:(?:in|with|using|at|by)\\s+)?(?:steps?|increments?)\\s*(?:of|=|:)?\\s*(${NUM_PLAIN})\\s*(${PCT_MARK})?|\\s*,?\\s*(?:in|with|using|at|by)\\s+(${NUM_PLAIN})\\s*(${PCT_MARK})?\\s*(?:steps?|increments?))?`;
  const gridRange = (key: string, field: string, label: string) => {
    // "from 9% to 11%" / "between 9% and 11%" with an explicit lead word, or "9% to 11%" without one.
    // A bare "and" is a list ("9% and 10%"), so it only counts as a range separator after "between".
    const forms = [
      `(?:(?:ranging\\s+)?from|between)\\s*(${NUM_PLAIN})\\s*(${PCT_MARK})?\\s*(?:to|and|through|until|-|–|—)\\s*(${NUM_PLAIN})\\s*(${PCT_MARK})?`,
      `(${NUM_PLAIN})\\s*(${PCT_MARK})?\\s*(?:to|through|until|-|–|—)\\s*(${NUM_PLAIN})\\s*(${PCT_MARK})?`,
    ];
    for (const form of forms) {
      const re = new RegExp(`(?:${key})(?:\\s+${GRID_WORD})?${FILLER}${form}${STEP}`, "gi");
      scanner.each(re, (match) => {
        const stepRaw = match[5] ?? match[7];
        const stepMark = match[5] ? match[6] : match[8];
        if (!match[2] || !match[4] || (stepRaw && !stepMark)) {
          collector.issue(field, label + " range needs a percent sign on every number.");
          return;
        }
        if (!stepRaw) {
          collector.issue(field, label + " range needs a step size (for example \"in steps of 1%\") or the explicit values.");
          return;
        }
        const values = stepGrid(numberOf(match[1]), numberOf(match[3]), numberOf(stepRaw));
        if (!values) {
          collector.issue(field, label + " range does not divide evenly by its step, has more than " + MAX_GRID + " values, or uses an unsupported step.");
          return;
        }
        collector.add(field, values);
        collector.notes.push(label + " range expanded to " + values.map((value) => formatP5GuidedNumber(value) + "%").join(", ") + ".");
      });
    }
  };

  const gridList = (key: string, field: string, label: string) => {
    scanner.each(new RegExp(`(?:${key})\\s+${GRID_WORD}${FILLER}(${PCT_LIST})`, "gi"), (match, source) => {
      const after = source.slice((match.index ?? 0) + match[0].length);
      const parsed = percentList(match[1]);
      if (TRAILING_RANGE.test(after)) collector.issue(field, label + " looks like a range. Write the explicit values (9%, 10%, 11%) or a range with a step (\"9% to 11% in steps of 1%\").");
      else if (parsed.bare) collector.issue(field, label + " must show a percent sign on every value (for example 9%, 10%, 11%).");
      else if (parsed.values.length > MAX_GRID) collector.issue(field, label + " supports at most " + MAX_GRID + " values.");
      else collector.add(field, parsed.values);
    });
  };

  const point = (key: string, field: string, label: string) => {
    scanner.each(new RegExp(`(?:${key})${FILLER}(${NUM_PLAIN})(?:\\s?(${PCT_MARK}))?`, "gi"), (match, source) => {
      const after = source.slice((match.index ?? 0) + match[0].length);
      if (TRAILING_RANGE.test(after)) { collector.issue(field, label + " looks like a range. State one value, or give sensitivity values as a values-to-test list."); return; }
      const value = percentValue(collector, field, label, match[1], match[2], after);
      if (value !== null) collector.add(field, value);
    });
  };

  // Sensitivity grids first, so "WACC grid 9%, 10%, 11%" is never read as one WACC.
  gridRange(TG_KEY, "terminalGrowthGridPct", "Terminal growth values to test");
  gridRange(WACC_KEY, "waccGridPct", "WACC values to test");
  gridList(TG_KEY, "terminalGrowthGridPct", "Terminal growth values to test");
  gridList(WACC_KEY, "waccGridPct", "WACC values to test");
  point(TG_KEY + "|\\btgr\\b", "terminalGrowthPct", "Terminal growth");
  point(WACC_KEY, "waccPct", "WACC");

  scanner.each(new RegExp(`\\bnet\\s+(debt|cash)${FILLER}(${NUM})(${SCALE})`, "gi"), (match) => {
    if (scaleSuffix(match[3])) { collector.issue("netDebt", "Net debt " + SCALE_MESSAGE); return; }
    const value = numberOf(match[2]);
    collector.add("netDebt", match[1].toLowerCase() === "cash" ? (value === 0 ? 0 : -value) : value);
    if (match[1].toLowerCase() === "cash") collector.notes.push("Net cash of " + formatP5GuidedNumber(value) + " was entered as net debt of " + formatP5GuidedNumber(value === 0 ? 0 : -value) + ".");
  });

  const shareValue = (rawNumber: string, scale: string | undefined) => {
    if (scaleSuffix(scale)) { collector.issue("sharesOutstanding", "Shares outstanding " + SCALE_MESSAGE); return; }
    const value = numberOf(rawNumber);
    if (!(value > 0)) { collector.issue("sharesOutstanding", "Shares outstanding must be above 0."); return; }
    collector.add("sharesOutstanding", value);
  };
  scanner.each(
    new RegExp(`(?:shares?\\s+outstanding|diluted\\s+shares?(?:\\s+outstanding)?|share\\s+count|number\\s+of\\s+shares)${FILLER}(${NUM_PLAIN})(${SCALE})`, "gi"),
    (match) => shareValue(match[1], match[2]),
  );
  scanner.each(
    new RegExp(`(${NUM_PLAIN})(${SCALE})\\s+(?:diluted\\s+)?shares?(?:\\s+outstanding)?\\b`, "gi"),
    (match) => shareValue(match[1], match[2]),
  );

  // First-year cash flow with growth and horizon is an alternative to listing every year.
  const firstYear: number[] = [];
  const firstYearHandler = (rawNumber: string, scale: string | undefined) => {
    if (scaleSuffix(scale)) { collector.issue("freeCashFlows", "Free cash flow " + SCALE_MESSAGE); return; }
    firstYear.push(numberOf(rawNumber));
  };
  scanner.each(
    new RegExp(`(?:first[- ]year|year[- ]?(?:1|one))\\s+(?:free\\s+cash\\s+flow|fcf)s?${FILLER}(${NUM})(${SCALE})`, "gi"),
    (match) => firstYearHandler(match[1], match[2]),
  );
  scanner.each(
    new RegExp(`(?:free\\s+cash\\s+flow|fcf)s?${FILLER}(${NUM})(${SCALE})\\s+(?:in|for)\\s+(?:the\\s+)?(?:first\\s+year|year\\s*(?:1|one))\\b`, "gi"),
    (match) => firstYearHandler(match[1], match[2]),
  );

  const growths: number[] = [];
  scanner.each(
    new RegExp(`\\b(?:grow(?:s|ing)?|growth(?:\\s+rate)?)\\b(?:[\\s:=]|\\b(?:of|at|is|are|equals?|by|to|assumed)\\b)*(${NUM_PLAIN})(?:\\s?(${PCT_MARK}))?`, "gi"),
    (match, source) => {
      if (!firstYear.length) {
        collector.issue("freeCashFlows", "Cash-flow growth was stated without a first-year cash flow and complete forecast. Review the intended forecast before running.");
        return;
      }
      const after = source.slice((match.index ?? 0) + match[0].length);
      const value = percentValue(collector, "cashFlowGrowth", "Cash flow growth", match[1], match[2], after);
      if (value !== null) growths.push(value);
    },
  );

  const horizons: number[] = [];
  for (const pattern of [
    /\b(?:for|over|across|during)\s+(\d{1,3})\s+years?\b/gi,
    /\b(\d{1,3})[- ]year\b/gi,
    /\bhorizon\s*(?:of|is|=|:)?\s*(\d{1,3})\s*years?\b/gi,
  ]) {
    for (const match of scanner.text.matchAll(pattern)) horizons.push(Number(match[1]));
  }
  if (horizons.length && !firstYear.length && !/\b(?:free\s+cash\s+flows?|fcfs?|cash\s+flows?)\b/i.test(scanner.text)) {
    collector.issue("freeCashFlows", "A forecast horizon was stated without yearly cash flows. Review the intended forecast before running.");
  }

  const lists: number[][] = [];
  scanner.each(
    new RegExp(`(?:free\\s+cash\\s+flows?|fcfs?|cash\\s+flows?)${FILLER}(${NUM_LIST})`, "gi"),
    (match) => {
      const parsed = amountList(match[1]);
      if (parsed.scaled) collector.issue("freeCashFlows", "Free cash flows " + SCALE_MESSAGE);
      else lists.push(parsed.values);
    },
  );

  resolveFreeCashFlows(collector, lists, firstYear, growths, horizons);

  if (!allowShared) {
    for (const field of ["netDebt", "sharesOutstanding", "waccGridPct", "terminalGrowthGridPct"]) {
      if (collector.has(field)) collector.issue(field, (RELATIVE_LABELS[field] ?? field) + " applies to every case. State it once outside the bear/bull case lines.");
    }
  }

  const values = new Map<string, unknown>();
  for (const field of Object.keys(RELATIVE_LABELS)) {
    const value = collector.single<unknown>(field);
    if (value !== undefined) values.set(field, value);
  }
  return { values, issues: collector.issues, notes: collector.notes };
}

function resolveFreeCashFlows(collector: Collector, lists: number[][], firstYear: number[], growths: number[], horizons: number[]) {
  const distinctHorizons = [...new Set(horizons)];
  const distinctGrowths = [...new Set(growths)];
  const distinctFirst = [...new Set(firstYear)];
  for (const list of lists) collector.add("freeCashFlows", list);

  if (lists.length) {
    if (firstYear.length) {
      collector.issue("freeCashFlows", "Free cash flows were given both as a list and as a first-year figure with growth. State only one.");
      return;
    }
    const explicit = collector.single<number[]>("freeCashFlows");
    if (!explicit) return;
    if (explicit.length < 2) collector.issue("freeCashFlows", "Only one free cash flow figure was given. State every forecast year, or a first-year figure with a growth rate and horizon.");
    else if (explicit.length > MAX_YEARS) collector.issue("freeCashFlows", "At most " + MAX_YEARS + " forecast years are supported.");
    else if (distinctHorizons.length === 1 && distinctHorizons[0] !== explicit.length) {
      collector.issue("freeCashFlows", "The horizon (" + distinctHorizons[0] + " years) does not match the " + explicit.length + " cash flows listed.");
    }
    return;
  }
  if (!firstYear.length) return;
  if (distinctFirst.length > 1 || distinctGrowths.length > 1 || distinctHorizons.length > 1) {
    collector.issue("freeCashFlows", "Conflicting first-year cash flow, growth or horizon values were stated.");
    return;
  }
  if (distinctGrowths.length !== 1 || distinctHorizons.length !== 1) {
    collector.notes.push("A first-year free cash flow was stated, but it needs both a growth rate (with %) and a horizon in years to build the yearly cash flows.");
    return;
  }
  const years = distinctHorizons[0];
  if (!Number.isInteger(years) || years < 2 || years > MAX_YEARS) {
    collector.issue("freeCashFlows", "The horizon must be between 2 and " + MAX_YEARS + " years.");
    return;
  }
  const first = distinctFirst[0];
  const growth = distinctGrowths[0] / 100;
  const built = Array.from({ length: years }, (_, index) => Number((first * (1 + growth) ** index).toFixed(10)));
  collector.add("freeCashFlows", built);
  collector.notes.push(
    "Free cash flows built from a first-year figure of " + formatP5GuidedNumber(first) + " growing " + formatP5GuidedNumber(distinctGrowths[0]) + "% a year for " + years + " years: " + built.join(", ") + ".",
  );
}

function transformationChunks(message: string): string[] {
  const parts: string[] = [];
  for (let offset = 0; offset < message.length; offset += TRANSFORMATION_CHUNK) parts.push(message.slice(offset, offset + TRANSFORMATION_CHUNK));
  return parts.map((part, index) => "Verbatim assumptions you wrote (part " + (index + 1) + " of " + parts.length + "): " + part);
}

function normalise(message: string): string {
  return message.replace(/\u2212/g, "-").replace(/\u00a0/g, " ").replace(/\uff05/g, "%");
}

const CASE_LABEL = /\b(bear|bull)\s+(?:case|scenario)\b\s*[:\-–—]?/gi;

function splitCases(text: string): { base: string; cases: Record<"bear" | "bull", string[]> } {
  const labels = [...text.matchAll(CASE_LABEL)];
  const cases: Record<"bear" | "bull", string[]> = { bear: [], bull: [] };
  let base = text;
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    const label = labels[index];
    const start = label.index ?? 0;
    const bodyStart = start + label[0].length;
    const nextLabel = labels[index + 1]?.index ?? text.length;
    const newline = text.indexOf("\n", bodyStart);
    const end = Math.min(nextLabel, newline === -1 ? text.length : newline);
    cases[label[1].toLowerCase() as "bear" | "bull"].unshift(text.slice(bodyStart, end));
    base = base.slice(0, start) + " ".repeat(end - start) + base.slice(end);
  }
  return { base, cases };
}

const BASE_KEYS = ["freeCashFlows", "waccPct", "terminalGrowthPct", "netDebt", "sharesOutstanding", "waccGridPct", "terminalGrowthGridPct"] as const;
const CASE_KEYS = ["freeCashFlows", "waccPct", "terminalGrowthPct"] as const;

function renderForForm(value: unknown): string {
  return Array.isArray(value) ? (value as number[]).map(formatP5GuidedNumber).join(", ") : formatP5GuidedNumber(value as number);
}

function extractDcfSensitivity(rawMessage: string): P5PlainLanguageExtraction {
  const message = normalise(rawMessage);
  const generalIssues: P5PlainLanguageIssue[] = [];
  if (/[$€£]|\b(?:USD|EUR|GBP|CAD|AUD|SGD|JPY|INR|CHF|CNY)\b/i.test(message)) {
    generalIssues.push({ key: "_general", message: "Currency-marked assumptions need explicit unit reconciliation. Provide all monetary amounts in one declared consistent unit without currency markers; LiOS does not silently convert or discard currency identity." });
  }
  if (/\d,\d{3}(?!\d)/.test(message)) {
    generalIssues.push({
      key: "_general",
      message: "Numbers written with commas such as \"1,000\" or \"100,110\" are ambiguous. Write plain numbers like 1000 and separate list items with a comma and a space.",
    });
  }
  const { base, cases } = splitCases(message);
  const baseResult = extractSegment(base, true);
  const issues: P5PlainLanguageIssue[] = [...generalIssues, ...baseResult.issues];
  const notes = [...baseResult.notes];
  const values = new Map<string, unknown>();
  for (const [key, value] of baseResult.values) values.set(key, value);

  for (const scenario of ["bear", "bull"] as const) {
    const prefix = scenario + "Case";
    const segments = cases[scenario];
    if (segments.length > 1) {
      issues.push({ key: prefix + ".freeCashFlows", message: "The " + scenario + " case is described more than once. Describe it once." });
      continue;
    }
    if (!segments.length) continue;
    const segment = extractSegment(segments[0], false);
    for (const issue of segment.issues) issues.push({ key: prefix + "." + issue.key, message: scenario + " case: " + issue.message });
    for (const note of segment.notes) notes.push(scenario + " case: " + note);
    for (const key of CASE_KEYS) {
      const value = segment.values.get(key);
      if (value !== undefined) values.set(prefix + "." + key, value);
    }
  }

  // cashFlowGrowth is only a building block for freeCashFlows; surface its issues under the cash-flow field.
  const remappedIssues = issues.map((issue) => (issue.key === "cashFlowGrowth"
    ? { ...issue, key: "freeCashFlows" }
    : issue.key.endsWith(".cashFlowGrowth") ? { ...issue, key: issue.key.replace("cashFlowGrowth", "freeCashFlows") } : issue));

  const required = p5RequiredInputKeys(P5_DCF_SENSITIVITY_PATH);
  const flagged = new Set(remappedIssues.map((issue) => issue.key));
  const missing = required.filter((key) => !values.has(key) && !flagged.has(key));
  const provided: Record<string, string> = {};
  for (const key of required) {
    const value = values.get(key);
    if (value !== undefined) provided[key] = renderForForm(value);
  }

  if (remappedIssues.length || missing.length) {
    return { status: "incomplete", gap: { missing, issues: dedupeIssues(remappedIssues), provided, notes } };
  }

  const baseParameters = BASE_KEYS.reduce<Record<string, unknown>>((acc, key) => ({ ...acc, [key]: values.get(key) }), {});
  const caseParameters = (prefix: string) => ({
    freeCashFlows: values.get(prefix + ".freeCashFlows"),
    waccPct: values.get(prefix + ".waccPct"),
    terminalMethod: "gordon_growth",
    terminalGrowthPct: values.get(prefix + ".terminalGrowthPct"),
  });
  const parameters: Record<string, unknown> = {
    freeCashFlows: baseParameters.freeCashFlows,
    waccPct: baseParameters.waccPct,
    terminalMethod: "gordon_growth",
    terminalGrowthPct: baseParameters.terminalGrowthPct,
    netDebt: baseParameters.netDebt,
    sharesOutstanding: baseParameters.sharesOutstanding,
    waccGridPct: baseParameters.waccGridPct,
    terminalGrowthGridPct: baseParameters.terminalGrowthGridPct,
    bearCase: caseParameters("bearCase"),
    bullCase: caseParameters("bullCase"),
  };
  const inputProvenance: AdvancedQuantInputProvenance = {
    dataClassification: "manual",
    transformations: [
      P5_MANUAL_ASSUMPTIONS_LABEL + ". LiOS added no default values.",
      ...transformationChunks(rawMessage),
      "Terminal method set to gordon_growth because terminal growth rates were stated; the sensitivity grid always uses Gordon growth.",
      ...notes,
    ].slice(0, 100),
    manualInputs: parameters,
  };
  return { status: "complete", parameters, inputProvenance };
}

function dedupeIssues(issues: P5PlainLanguageIssue[]): P5PlainLanguageIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const id = issue.key + "\u0000" + issue.message;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Returns null when the model path has no plain-language grammar (the JSON path remains the only input route). */
export function extractP5PlainLanguageInputs(message: string, modelPath: string): P5PlainLanguageExtraction | null {
  if (modelPath !== P5_DCF_SENSITIVITY_PATH) return null;
  return extractDcfSensitivity(message);
}
