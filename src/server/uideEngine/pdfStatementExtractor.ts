/**
 * UIDE -- PDF financial statement extraction (Table Extraction & Financial
 * Statement Viewer engine).
 *
 * Deterministic-first, same as domainClassifier.ts: every line item is
 * located by matching a known label (plus real-world synonyms) against the
 * PDF's own text, and the number sitting next to that label is parsed with
 * the same numeric conventions the rest of this codebase already trusts
 * (abbreviated "1.2M", accounting-negative "(1,250.00)", currency symbols --
 * see profiler.ts's toNumeric for the sibling implementation this mirrors).
 * A local LLM (Ollama) is consulted ONLY for line items no deterministic
 * label matched, and every LLM-sourced value is tagged confidence:"low" so
 * the review UI can visually flag it -- this module never silently commits
 * a number it isn't confident about. Nothing here is persisted; the route
 * layer decides what to do with the returned draft.
 *
 * The LLM step talks to Ollama ONLY -- never a cloud model. A statement PDF
 * a user uploads may be a private company's confidential accounts; sending
 * that text to Anthropic/OpenAI would violate the same local-processing
 * guarantee the rest of this app makes for sensitive data (see the
 * Economics domain's local-LLM confidentiality principle). If Ollama isn't
 * running, or the platform-wide AI kill switch (platformSettings, same one
 * domainClassifier.ts respects) is on, extraction just stays deterministic
 * -- an honest degrade, not a silent fallback to a cloud model.
 */
import { PDFParse } from "pdf-parse";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { platformSettings, PLATFORM_SETTING_AI_SUPPRESSED } from "@shared/schema";
import { CANONICAL_FIELDS, type StatementType, type CanonicalLineItem } from "@shared/financialFields";

export type { StatementType };

export interface ExtractedFieldValue {
  key: string;
  label: string;
  value: number | null;
  rawText: string | null;
  confidence: "high" | "low";
  sourceMethod: "deterministic" | "llm" | "unmatched";
}

export interface ExtractedPeriodReport {
  reportType: StatementType;
  periodLabel: string;
  fiscalYear: string;
  reportedCurrency: string | null;
  fields: ExtractedFieldValue[];
}

export interface BalanceIdentityCheck {
  periodLabel: string;
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
  diffPct: number;
  pass: boolean;
}

export interface PdfExtractionResult {
  fileName: string;
  pageCount: number;
  detectedStatementPages: Record<StatementType, number[]>;
  reports: ExtractedPeriodReport[];
  balanceIdentityChecks: BalanceIdentityCheck[];
  extractionMethod: "deterministic" | "deterministic+llm";
  warnings: string[];
}

// Canonical field keys/labels/synonyms now live in shared/financialFields.ts
// (the Canonical Financial Data Model) -- the UI, this extractor, and every
// statement provider all read the same registry instead of each keeping its
// own copy (they'd already drifted: this file used to return
// "trade and other receivables" as a display label for the field the UI
// calls "Accounts Receivable" -- fixed by using the canonical `label` here
// instead of a synonym).
type FieldDef = CanonicalLineItem;
const FIELD_DEFS = CANONICAL_FIELDS;

const SECTION_HEADING_PATTERNS: Record<StatementType, RegExp[]> = {
  balance: [/balance\s+sheets?/i, /statements?\s+of\s+financial\s+position/i],
  income: [/income\s+statements?/i, /statements?\s+of\s+(?:comprehensive\s+)?(?:profit\s+(?:and|&)\s+loss|profit\s+or\s+loss)/i, /profit\s+and\s+loss\s+account/i],
  cashflow: [/(?:statements?|statement)\s+of\s+cash\s+flows?/i, /cash\s+flow\s+statements?/i],
};

// ─── Numeric parsing (mirrors profiler.ts's toNumeric/classifyValue rules) ─

const PAREN_NEGATIVE_RE = /^\(\s*[$€£¥]?\s?[\d,]+(\.\d+)?\s?\)$/;
const ABBREVIATED_NUMBER_RE = /^[+-]?[$€£¥]?\s?[\d,]+(\.\d+)?\s?([KMBT])$/i;
const NUMERIC_RE = /^[+-]?[$€£¥]?\s?-?[\d,]+(\.\d+)?$/;
const ABBREVIATION_MULTIPLIER: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
const CURRENCY_SYMBOL_TO_CODE: Record<string, string> = { "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };

function parseNumericToken(raw: string): number | null {
  const str = raw.trim();
  if (str === "" || str === "-" || str === "—" || str === "–") return null;

  if (PAREN_NEGATIVE_RE.test(str)) {
    const inner = str.replace(/[()$€£¥\s]/g, "");
    const n = Number(inner.replace(/,/g, ""));
    return Number.isNaN(n) ? null : -n;
  }
  if (ABBREVIATED_NUMBER_RE.test(str)) {
    const cleaned = str.replace(/[$€£¥\s]/g, "");
    const unit = cleaned.slice(-1).toUpperCase();
    const numPart = cleaned.slice(0, -1).replace(/,/g, "");
    const n = Number(numPart);
    return Number.isNaN(n) ? null : n * (ABBREVIATION_MULTIPLIER[unit] ?? 1);
  }
  if (NUMERIC_RE.test(str)) {
    const cleaned = str.replace(/[$€£¥,\s]/g, "");
    if (cleaned === "" || cleaned === "-") return null;
    const n = Number(cleaned);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Extracts every plausible numeric token from a text line, left to right. */
function extractNumericTokens(line: string): { raw: string; value: number }[] {
  // Accounting-negative parens first (so "(1,250.00)" isn't split by the
  // plain-number pass below), then abbreviated and plain numeric tokens.
  const tokenRe = /\(\s*[$€£¥]?\s?[\d,]+(?:\.\d+)?\s?\)|[+-]?[$€£¥]?\s?[\d,]+(?:\.\d+)?\s?[KMBT]\b|[+-]?[$€£¥]?\s?[\d,]+(?:\.\d+)?/gi;
  const matches = line.match(tokenRe) ?? [];
  const out: { raw: string; value: number }[] = [];
  for (const m of matches) {
    const v = parseNumericToken(m.trim());
    if (v !== null) out.push({ raw: m.trim(), value: v });
  }
  return out;
}

function detectCurrency(pageText: string): string | null {
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOL_TO_CODE)) {
    if (pageText.includes(symbol)) return code;
  }
  const isoMatch = pageText.match(/\b(USD|GBP|EUR|INR|JPY|CAD|AUD)\b/);
  return isoMatch ? isoMatch[1] : null;
}

// ─── Period-column detection ────────────────────────────────────────────

const YEAR_RE = /\b(19|20)\d{2}\b/g;

/**
 * A statement page's numbers sit under column headers, usually two fiscal
 * years side by side ("2022  2021"). We don't attempt true column-position
 * reconstruction (pdf-parse's getText linearizes text, losing X-coordinates)
 * -- instead, the two most recent distinct years mentioned near the top of
 * the statement page become the period labels, and the Nth numeric token on
 * each matched line is assigned to the Nth period in left-to-right order.
 * This is a real simplification (irregular spacing/wrapped rows can misalign
 * columns) which is exactly why every extracted value carries rawText and
 * goes through a mandatory review step before being trusted.
 */
function detectPeriods(pageText: string): string[] {
  const headerRegion = pageText.slice(0, 600);
  const years = Array.from(new Set((headerRegion.match(YEAR_RE) ?? []).map(Number)))
    .sort((a, b) => b - a);
  if (years.length > 0) return years.slice(0, 2).map(String);

  const fallback = Array.from(new Set((pageText.match(YEAR_RE) ?? []).map(Number))).sort((a, b) => b - a);
  return fallback.slice(0, 2).map(String);
}

// ─── Deterministic label matching ───────────────────────────────────────

function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9&/]+/g, " ").trim();
}

/**
 * Finds the line in `lines` whose leading label text best matches the
 * field's canonical label or one of its real-world synonyms. Exact-ish
 * substring match, longest candidate wins (so "total current assets" isn't
 * matched by the shorter "current assets" substring first).
 */
function findFieldLine(lines: string[], field: FieldDef): { line: string; matchedSynonym: string } | null {
  const candidates = [field.label, ...(field.synonyms ?? [])];
  const sorted = candidates.sort((a, b) => b.length - a.length);
  for (const synonym of sorted) {
    const needle = normalizeLabel(synonym);
    for (const line of lines) {
      const hay = normalizeLabel(line);
      if (hay.startsWith(needle) || hay.includes(needle)) {
        return { line, matchedSynonym: synonym };
      }
    }
  }
  return null;
}

function extractFieldsFromPage(pageText: string, statementType: StatementType, periods: string[]): ExtractedFieldValue[][] {
  const lines = pageText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const perPeriodFields: ExtractedFieldValue[][] = periods.map(() => []);

  for (const field of FIELD_DEFS[statementType]) {
    const label = field.label;
    const found = findFieldLine(lines, field);
    if (!found) {
      periods.forEach((_, i) => {
        perPeriodFields[i].push({ key: field.key, label, value: null, rawText: null, confidence: "low", sourceMethod: "unmatched" });
      });
      continue;
    }
    const tokens = extractNumericTokens(found.line);
    periods.forEach((_, i) => {
      const tok = tokens[i];
      perPeriodFields[i].push({
        key: field.key,
        label,
        value: tok ? tok.value : null,
        rawText: tok ? tok.raw : null,
        confidence: tok ? "high" : "low",
        sourceMethod: tok ? "deterministic" : "unmatched",
      });
    });
  }

  return perPeriodFields;
}

function findStatementPages(pages: { num: number; text: string }[]): Record<StatementType, number[]> {
  const result: Record<StatementType, number[]> = { balance: [], income: [], cashflow: [] };
  for (const page of pages) {
    for (const [type, patterns] of Object.entries(SECTION_HEADING_PATTERNS) as [StatementType, RegExp[]][]) {
      if (patterns.some((re) => re.test(page.text))) result[type].push(page.num);
    }
  }
  return result;
}

function computeBalanceIdentityChecks(reports: ExtractedPeriodReport[]): BalanceIdentityCheck[] {
  const checks: BalanceIdentityCheck[] = [];
  for (const report of reports) {
    if (report.reportType !== "balance") continue;
    const byKey = new Map(report.fields.map((f) => [f.key, f.value]));
    const totalAssets = byKey.get("totalAssets");
    const totalLiabilities = byKey.get("totalLiabilities");
    const totalEquity = byKey.get("totalStockholdersEquity");
    if (totalAssets == null || (totalLiabilities == null && totalEquity == null)) continue;

    const liabsPlusEquity = (totalLiabilities ?? 0) + (totalEquity ?? 0);
    const diff = Math.abs(totalAssets - liabsPlusEquity);
    const diffPct = totalAssets !== 0 ? diff / Math.abs(totalAssets) : 1;
    checks.push({
      periodLabel: report.periodLabel,
      totalAssets,
      totalLiabilitiesAndEquity: liabsPlusEquity,
      diffPct,
      pass: diffPct < 0.01,
    });
  }
  return checks;
}

// ─── LLM-assisted fallback (Ollama only, see module comment) ──────────────

const OLLAMA_MODEL = "llama3.2:3b";
const OLLAMA_CHAT_URL = "http://localhost:11434/api/chat";
const PAGE_TEXT_LLM_LIMIT = 8000; // bounds prompt size on dense real-world filing pages

async function isAiSuppressed(): Promise<boolean> {
  try {
    const db = getDb();
    const [row] = await db.select().from(platformSettings)
      .where(eq(platformSettings.key, PLATFORM_SETTING_AI_SUPPRESSED)).limit(1);
    return row?.value === true;
  } catch {
    // Same fail-safe-toward-not-calling-the-LLM contract as domainClassifier.ts.
    return true;
  }
}

/**
 * Asks Ollama to find values for the specific line items the deterministic
 * pass couldn't match, on this one page, for these specific periods. Scoped
 * narrowly (a fixed field list, not "extract everything") so the model's
 * job is verification-shaped -- find this label, report this number -- not
 * open-ended interpretation. Returns null on ANY failure (Ollama not
 * running, bad response, malformed JSON) so the caller can fall back to
 * leaving those fields blank exactly as before this function existed.
 */
async function refineUnmatchedFieldsWithLlm(
  pageText: string,
  periods: string[],
  unmatchedFields: FieldDef[],
): Promise<Record<string, unknown> | null> {
  if (unmatchedFields.length === 0) return null;

  const fieldList = unmatchedFields.map((f) => `${f.key}: ${f.label}`).join("\n");
  const prompt = `You are extracting numeric line items from one page of a company's financial statement. The page text below was extracted from a PDF and may have imperfect column alignment.

PAGE TEXT:
"""
${pageText.slice(0, PAGE_TEXT_LLM_LIMIT)}
"""

Periods present on this page, in left-to-right column order: ${periods.join(", ")}.

For EACH line item below, find its value for EACH period above, in that same left-to-right order. If a line item genuinely does not appear on this page, use null for every period rather than guessing or estimating. A value shown in parentheses like "(1,250)" means negative -- report it as -1250. Strip commas and currency symbols; report plain numbers only.

LINE ITEMS (key: label):
${fieldList}

Respond with ONLY a JSON object, no prose, no markdown fences, in this exact shape:
{"<key>": [valueForPeriod0OrNull, valueForPeriod1OrNull, ...]}`;

  try {
    const res = await fetch(OLLAMA_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: "user", content: prompt }],
        format: "json",
        stream: false,
      }),
    });
    if (!res.ok) return null;
    const data: { message?: { content?: string } } = await res.json();
    const content = data.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** Merges LLM results into perPeriodFields, only ever filling a slot that's
 * still null -- a field the deterministic pass already found a number for
 * is never overwritten, no matter what the LLM returns for it. */
function applyLlmResults(
  perPeriodFields: ExtractedFieldValue[][],
  unmatchedFields: FieldDef[],
  llmResult: Record<string, unknown> | null,
  periods: string[],
): number {
  if (!llmResult) return 0;
  let filledCount = 0;
  for (const field of unmatchedFields) {
    const values = llmResult[field.key];
    if (!Array.isArray(values)) continue;
    periods.forEach((_, i) => {
      const raw = values[i];
      if (typeof raw !== "number" || !Number.isFinite(raw)) return;
      const fieldEntry = perPeriodFields[i].find((f) => f.key === field.key);
      if (fieldEntry && fieldEntry.value === null) {
        fieldEntry.value = raw;
        fieldEntry.rawText = String(raw);
        fieldEntry.confidence = "low";
        fieldEntry.sourceMethod = "llm";
        filledCount++;
      }
    });
  }
  return filledCount;
}

export async function extractStatementsFromPdf(buffer: Buffer, fileName: string): Promise<PdfExtractionResult> {
  const parser = new PDFParse({ data: buffer });
  let textResult;
  try {
    textResult = await parser.getText();
  } finally {
    await parser.destroy();
  }

  const pages = textResult.pages;
  const detectedStatementPages = findStatementPages(pages);
  const warnings: string[] = [];
  const reports: ExtractedPeriodReport[] = [];

  const aiSuppressed = await isAiSuppressed();
  let llmAttempted = false;
  let llmFilledAnything = false;

  const statementTypes: StatementType[] = ["balance", "income", "cashflow"];
  for (const type of statementTypes) {
    const pageNums = detectedStatementPages[type];
    if (pageNums.length === 0) {
      warnings.push(`No page matched a "${type}" statement heading -- that statement was not extracted.`);
      continue;
    }
    // A statement can spill onto a second page; use the first match as the
    // primary page (most filed statements fit the whole table on one page).
    const page = pages.find((p) => p.num === pageNums[0])!;
    const periods = detectPeriods(page.text);
    if (periods.length === 0) {
      warnings.push(`Could not detect fiscal-year columns on the "${type}" statement page (page ${page.num}).`);
      continue;
    }

    const currency = detectCurrency(page.text);
    const perPeriodFields = extractFieldsFromPage(page.text, type, periods);

    // Only ask the LLM about fields still missing in at least one period --
    // a field the deterministic pass already found for every period needs
    // no help. See applyLlmResults for why an existing value is never
    // overwritten even if the LLM disagrees with it.
    const unmatchedFieldDefs = FIELD_DEFS[type].filter((f) =>
      perPeriodFields.some((pf) => pf.find((x) => x.key === f.key)?.value === null),
    );
    if (unmatchedFieldDefs.length > 0 && !aiSuppressed) {
      llmAttempted = true;
      const llmResult = await refineUnmatchedFieldsWithLlm(page.text, periods, unmatchedFieldDefs);
      const filled = applyLlmResults(perPeriodFields, unmatchedFieldDefs, llmResult, periods);
      if (filled > 0) llmFilledAnything = true;
    }

    periods.forEach((periodLabel, i) => {
      reports.push({
        reportType: type,
        periodLabel: `FY${periodLabel}`,
        fiscalYear: periodLabel,
        reportedCurrency: currency,
        fields: perPeriodFields[i],
      });
    });
  }

  const llmFilledCount = reports.reduce((sum, r) => sum + r.fields.filter((f) => f.sourceMethod === "llm").length, 0);
  if (llmFilledCount > 0) {
    warnings.push(`${llmFilledCount} line item(s) filled via local LLM assist (${OLLAMA_MODEL}) -- these are AI-read, not deterministically confirmed. Verify against the source PDF before importing.`);
  }
  if (llmAttempted && !llmFilledAnything && llmFilledCount === 0) {
    warnings.push(`Local LLM (Ollama) assist was unavailable or found nothing -- unmatched fields left blank. Start Ollama for AI-assisted extraction of the remaining fields.`);
  }

  const unmatchedCount = reports.reduce((sum, r) => sum + r.fields.filter((f) => f.sourceMethod === "unmatched").length, 0);
  if (unmatchedCount > 0) {
    warnings.push(`${unmatchedCount} line item(s) across all periods had no matching label found in the document -- left blank rather than guessed.`);
  }

  const balanceIdentityChecks = computeBalanceIdentityChecks(reports);
  for (const check of balanceIdentityChecks) {
    if (!check.pass) {
      warnings.push(`Balance sheet identity check failed for ${check.periodLabel}: assets ${check.totalAssets.toLocaleString()} vs liabilities+equity ${check.totalLiabilitiesAndEquity.toLocaleString()} (${(check.diffPct * 100).toFixed(1)}% off). Review extracted values before importing.`);
    }
  }

  return {
    fileName,
    pageCount: pages.length,
    detectedStatementPages,
    reports,
    balanceIdentityChecks,
    extractionMethod: llmFilledAnything ? "deterministic+llm" : "deterministic",
    warnings,
  };
}
