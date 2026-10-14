/**
 * UIDE Phase 2 -- domain classification.
 *
 * Deterministic-first, LLM-second (see priority list discussed with the
 * user): a keyword/heuristic scorer runs on every file for free and
 * produces a ranked candidate list immediately. The LLM is only consulted
 * when the heuristic signal is weak or ambiguous, and its job is to REORDER
 * the same candidate set, not invent new domains out of nothing -- keeps
 * the model's job narrow and checkable instead of open-ended guessing.
 *
 * Always returns top-3 candidates with confidence, never a silent single
 * guess -- a wrong domain silently committed poisons every downstream
 * phase (quality checks, completion, expert reasoning).
 *
 * Reuses the shared BYOAI registry and routing policy instead of a provider-
 * specific client. If the call fails for any reason (no provider configured,
 * network error, rate limit), this falls back to the heuristic-only result
 * rather than throwing -- same honest-degrade contract as fredData.ts's "no
 * live feed configured" behavior, just applied to reasoning instead of a
 * missing market-data key.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { platformSettings, PLATFORM_SETTING_AI_SUPPRESSED } from "@shared/schema";
import type { WorkbookProfile } from "./profiler";
import { invokeAIRoutedCompletion } from "../byoaiTransport";

/**
 * Same platform-wide AI kill-switch the publish workflow already respects
 * (contentRoutes.ts/clientRoutes.ts) -- when an admin suppresses AI
 * platform-wide, UIDE's LLM refinement must not run either, not just
 * already-published AI content getting filtered out.
 */
async function isAiSuppressed(): Promise<boolean> {
  try {
    const db = getDb();
    const [row] = await db.select().from(platformSettings)
      .where(eq(platformSettings.key, PLATFORM_SETTING_AI_SUPPRESSED)).limit(1);
    return row?.value === true;
  } catch {
    // If the settings read itself fails, fail safe toward NOT calling the
    // LLM rather than silently ignoring an intended suppression.
    return true;
  }
}

export interface DomainCandidate {
  slug: string;
  name: string;
  confidence: number; // 0-1
  matchedSignals: string[];
}

export interface ClassificationResult {
  candidates: DomainCandidate[];
  reasoningSource: "heuristic" | "llm";
  classifiedAt: string;
}

// Mirrors Limuria's own `domains` table where a vertical already exists
// there (finance, economics_policy, supply_chain, environment_sustainability,
// marketing_pr, tourism_hospitality use the exact same slugs on purpose --
// see the "domain registry unification" principle from Phase 1). The rest
// are UIDE-only for now: no Limuria vertical exists yet, so a match here
// just can't carry a domainId until one does.
const DOMAIN_TAXONOMY: { slug: string; name: string; keywords: string[] }[] = [
  { slug: "finance", name: "Finance", keywords: [
    "ticker", "price", "close", "open", "volume", "pe_ratio", "eps", "market_cap",
    "dividend", "yield", "revenue", "ebitda", "valuation", "portfolio", "equity",
    "asset", "liability", "balance", "cash_flow", "interest_rate", "wacc", "irr",
    "npv", "share", "stock", "bond", "coupon", "maturity", "fund", "nav",
  ] },
  { slug: "economics_policy", name: "Economics & Public Policy", keywords: [
    "gdp", "cpi", "inflation", "unemployment", "indicator", "series_id", "fred",
    "fiscal", "monetary", "trade_balance", "policy", "budget_utilization",
    "welfare", "governance", "sdg", "census", "payrolls", "interest_rate",
  ] },
  { slug: "supply_chain", name: "Operations & Supply Chain", keywords: [
    "shipment", "warehouse", "inventory", "reorder_point", "safety_stock", "eoq",
    "vendor", "procurement", "logistics", "freight", "carrier", "route",
    "delivery", "lead_time", "sku", "fulfillment", "distribution",
  ] },
  { slug: "manufacturing", name: "Manufacturing", keywords: [
    "machine_id", "downtime", "scrap", "defect", "yield_rate", "oee", "shift",
    "production_line", "units_produced", "batch", "maintenance", "throughput",
    "cycle_time", "quality_control",
  ] },
  { slug: "healthcare", name: "Healthcare", keywords: [
    "patient", "diagnosis", "admission", "discharge", "bed", "clinical",
    "icd", "provider", "physician", "hospital", "readmission", "mortality",
    "treatment", "prescription", "insurance_claim",
  ] },
  { slug: "hr", name: "Human Resources", keywords: [
    "employee", "attrition", "headcount", "salary", "compensation", "tenure",
    "recruit", "hire_date", "termination", "performance_rating", "department",
    "manager", "job_title", "training_hours",
  ] },
  { slug: "marketing_pr", name: "Marketing, PR & Communications", keywords: [
    "campaign", "impression", "click_through", "ctr", "conversion", "cohort",
    "churn", "customer_segment", "clv", "funnel", "engagement", "sentiment_score",
    "media_mention", "reach",
  ] },
  { slug: "government", name: "Government", keywords: [
    "citizen", "tax", "taxpayer", "welfare_scheme", "public_procurement",
    "infrastructure", "constituency", "census_tract", "voter", "municipal",
  ] },
  { slug: "environment_sustainability", name: "Environment & Sustainability", keywords: [
    "emission", "carbon", "co2", "energy_use", "renewable", "esg_score",
    "sustainability", "waste", "water_usage", "climate", "temperature",
  ] },
  { slug: "tourism_hospitality", name: "Tourism & Hospitality", keywords: [
    "occupancy", "adr", "revpar", "booking", "checkin", "checkout", "guest",
    "reservation", "hotel", "room_type", "itinerary",
  ] },
  { slug: "retail", name: "Retail", keywords: [
    "basket", "sku", "transaction_id", "store_id", "pos", "footfall",
    "markdown", "promotion", "sales_channel", "loyalty",
  ] },
  { slug: "insurance", name: "Insurance", keywords: [
    "policyholder", "premium", "claim_amount", "underwriting", "deductible",
    "loss_ratio", "actuarial", "coverage", "policy_number",
  ] },
];

const CATEGORICAL_HINT_TYPES = new Set(["currency", "percentage", "date"]);

function normalizeToken(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

/**
 * A workbook's domain is one thing even when it's organized across many
 * tabs (a 7-tab valuation model is one Finance document, not seven
 * separately-classified fragments) -- so classification runs on the
 * combined signal across every sheet: tabular sheets contribute column
 * names, layout/model sheets contribute their row labels (e.g. "Revenue",
 * "WACC"), which are just as domain-indicative as a column header.
 */
function collectSignalTokens(profile: WorkbookProfile): { tokens: string[]; hintCount: number } {
  const tokens: string[] = [];
  let hintCount = 0;

  for (const sheet of profile.sheets) {
    if (sheet.tabular) {
      for (const col of sheet.tabular.columns) {
        tokens.push(normalizeToken(col.name));
        if (CATEGORICAL_HINT_TYPES.has(col.inferredType)) hintCount++;
      }
    }
    if (sheet.layout) {
      for (const label of sheet.layout.labels) tokens.push(normalizeToken(label));
    }
  }

  return { tokens, hintCount };
}

function scoreHeuristically(profile: WorkbookProfile): DomainCandidate[] {
  const { tokens, hintCount } = collectSignalTokens(profile);

  const scored = DOMAIN_TAXONOMY.map((domain) => {
    const matched: string[] = [];
    for (const keyword of domain.keywords) {
      const hit = tokens.some((token) => token.includes(keyword));
      if (hit) matched.push(keyword);
    }
    // Small bonus for currency/percentage/date-heavy profiles matching
    // finance/economics -- a real signal (financial models are dense with
    // currency and percentage columns) beyond pure keyword overlap.
    let bonus = 0;
    if (domain.slug === "finance" || domain.slug === "economics_policy") {
      bonus = Math.min(hintCount * 0.02, 0.1);
    }
    const rawScore = matched.length / Math.max(domain.keywords.length * 0.15, 1) + bonus;
    return { slug: domain.slug, name: domain.name, rawScore, matched };
  });

  // Deliberately NOT normalized relative to the top score -- confidence
  // must stay absolute. Renormalizing (rawScore / maxScore) would stretch
  // whichever domain scored least-negligibly up to 100%, even when every
  // domain matched nothing (e.g. a generic id/date/value/category file).
  // A real per-domain keyword-match density is a meaningful confidence on
  // its own; a comparison against other equally-weak scores is not.
  return scored
    .map((s) => ({
      slug: s.slug,
      name: s.name,
      confidence: Math.max(0, Math.min(s.rawScore, 1)),
      matchedSignals: s.matched,
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

/** Ambiguous when the top two candidates are close, or the top signal is weak. */
function isAmbiguous(candidates: DomainCandidate[]): boolean {
  if (candidates.length < 2) return false;
  const [top, second] = candidates;
  if (top.confidence < 0.35) return true;
  if (top.confidence - second.confidence < 0.15) return true;
  return false;
}

function summarizeSheetsForPrompt(profile: WorkbookProfile): string {
  return profile.sheets.map((sheet) => {
    if (sheet.shape === "empty") return `Sheet "${sheet.sheetName}": empty`;
    if (sheet.tabular) {
      const cols = sheet.tabular.columns
        .map((c) => `${c.name} (${c.inferredType}, samples: ${c.sampleValues.slice(0, 3).join(", ") || "n/a"})`)
        .join("; ");
      return `Sheet "${sheet.sheetName}" (tabular, ${sheet.tabular.rowCount} rows): ${cols}`;
    }
    if (sheet.layout) {
      return `Sheet "${sheet.sheetName}" (layout/model${sheet.layout.detectedModelType ? `, looks like ${sheet.layout.detectedModelType}` : ""}): labels: ${sheet.layout.labels.slice(0, 20).join(", ")}`;
    }
    return `Sheet "${sheet.sheetName}": unrecognized`;
  }).join("\n");
}

async function refineWithLLM(profile: WorkbookProfile, heuristicCandidates: DomainCandidate[]): Promise<DomainCandidate[] | null> {
  const sheetSummary = summarizeSheetsForPrompt(profile);

  const candidateList = heuristicCandidates.map((c) => `${c.slug} (${c.name})`).join(", ");
  const allSlugs = DOMAIN_TAXONOMY.map((d) => d.slug).join(", ");

  const prompt = `A workbook was uploaded with no domain hint. Here is its sheet-by-sheet profile (never the raw row data):

File: ${profile.fileName} (${profile.sheetNames.length} sheet${profile.sheetNames.length === 1 ? "" : "s"}: ${profile.sheetNames.join(", ")})
${sheetSummary}

A single workbook is one domain even if organized across multiple tabs -- classify the whole file, not each sheet separately.

A cheap keyword heuristic already ranked these as the top candidates: ${candidateList}.
The full domain taxonomy is: ${allSlugs}.

Re-rank the top 3 most likely domains for this dataset given the column names, types, and sample values. Only choose from the taxonomy list above -- do not invent a new domain slug. Respond with ONLY a JSON array, no prose, no markdown fences, in this exact shape:
[{"slug": "...", "confidence": 0.0-1.0, "reasoning": "..."}]`;

  const result = await invokeAIRoutedCompletion({
    messages: [{ role: "user", content: prompt }],
    maxTokens: 500,
  });

  const jsonMatch = result.text.trim().match(/\[[\s\S]*\]/);
  if (!jsonMatch) return null;


  const parsed: { slug: string; confidence: number; reasoning: string }[] = JSON.parse(jsonMatch[0]);
  const bySlug = new Map(DOMAIN_TAXONOMY.map((d) => [d.slug, d.name]));

  return parsed
    .filter((p) => bySlug.has(p.slug))
    .slice(0, 3)
    .map((p) => ({
      slug: p.slug,
      name: bySlug.get(p.slug)!,
      confidence: Math.max(0, Math.min(1, p.confidence)),
      matchedSignals: [p.reasoning],
    }));
}

export async function classifyDomain(profile: WorkbookProfile): Promise<ClassificationResult> {
  const heuristicCandidates = scoreHeuristically(profile);

  if (!isAmbiguous(heuristicCandidates)) {
    return { candidates: heuristicCandidates, reasoningSource: "heuristic", classifiedAt: new Date().toISOString() };
  }

  if (await isAiSuppressed()) {
    return { candidates: heuristicCandidates, reasoningSource: "heuristic", classifiedAt: new Date().toISOString() };
  }

  try {
    const llmCandidates = await refineWithLLM(profile, heuristicCandidates);
    if (llmCandidates && llmCandidates.length) {
      return { candidates: llmCandidates, reasoningSource: "llm", classifiedAt: new Date().toISOString() };
    }
  } catch {
    // No API key configured, network error, rate limit, malformed response --
    // fall through to the heuristic result rather than failing the request.
  }

  return { candidates: heuristicCandidates, reasoningSource: "heuristic", classifiedAt: new Date().toISOString() };
}
