import type { z } from "zod";
import {
  conversationCapabilityMatchSchema,
  type ConversationCapabilityMatch,
  type ConversationRequest,
} from "@shared/conversationRuntime";
import { classifyAskLiosIntent, buildAskLiosDelegation } from "@shared/askLiosRouter";
import { resolveP5ProfessionalIntents } from "./p5ProfessionalWorkflow";
import { naturalResearchEntry } from "./naturalResearchEntry";

// Uppercase finance abbreviations that appear in stated assumptions are never tickers.
const COMMON_UPPERCASE_WORDS = new Set([
  "AI", "AND", "DCF", "EBIT", "EBITDA", "EQUITY", "EUR", "FCF", "FCFE", "FCFF", "FOR", "GBP", "MACD", "OF", "ON", "OR", "PRICE",
  "RSI", "SHARES", "STOCK", "STRATEGY", "TGR", "THE", "TO", "USD", "VAR", "WACC", "WITH",
]);

/** Prefix for a specific model input listed in `missingInputs` (after the generic structured-inputs marker). */
const MODEL_INPUT_PREFIX = "model_input:";

function cleanEntityPhrase(value: string): string | null {
  const cleaned = value
    .replace(/^[\s"'“”]+|[\s"'“”.,;:!?]+$/g, "")
    // "Apple: key fundamentals" / "Apple - risks": the entity ends where the topic list begins.
    .replace(/^(?:an?\s+|the\s+)?(?:(?:research|analyst|equity|investment)\s+)?(?:report|note|memo|brief|summary|write-?up)\s+(?:on|about|for)\s+/i, "")
    .replace(/\s*[:—–]\s.*$/, "")
    .replace(/\s+-\s+.*$/, "")
    // A leading name followed by topic words ("Apple key fundamentals") is still just the name.
    .replace(/\s+(?:key|latest|its|their|fundamentals?|financials?|earnings|outlook|performance)\b.*$/i, "")
    .replace(/\b(?:and|then)\b.*$/i, "")
    .replace(/\b(?:with|using|show|include|plus)\b.*$/i, "")
    .replace(/\b(?:technical|technicals|rsi|macd|backtest|valuation|risk|chart|price)\b.*$/i, "")
    .trim();
  // Unfilled template text such as "[company or ticker]" is not an entity; never resolve it.
  if (/[\[\]{}<>]/.test(cleaned)) return null;
  // Pronouns and generic nouns refer to something LiOS does not know yet; asking beats guessing.
  if (/^(?:this|that|it|them|these|those|one|something|anything|everything|(?:the\s+)?(?:company|stock|security|equity|ticker|firm|business))$/i.test(cleaned)) return null;
  return cleaned.length >= 1 && cleaned.length <= 120 ? cleaned : null;
}

const PROPER_NAME = "([A-Z][A-Za-z0-9&.'\\-]*(?:\\s+[A-Z][A-Za-z0-9&.'\\-]*){0,3})";
const SOFT_COMPANY_PHRASING = new RegExp(
  `\\b(?:[Tt]ell me about|[Ww]hat(?:'s| is) going on with|[Dd]eep dive (?:on|into)|[Ww]hat do you think (?:of|about))\\s+${PROPER_NAME}(?=$|[,.!?;])`
  + `|\\b(?:[Ii]s|[Aa]re)\\s+${PROPER_NAME}\\s+(?:over|under)?valued\\b`
  + `|\\b(?:[Ww]hat(?:'s| is)|[Hh]ow much is)\\s+${PROPER_NAME}\\s+worth\\b`,
);

export function extractConversationEntityQuery(request: ConversationRequest): {
  symbol: string | null;
  entityQuery: string | null;
} {
  const contextual = request.context?.symbol?.trim();
  if (contextual) return { symbol: contextual.toUpperCase(), entityQuery: contextual };

  const dollarTicker = request.message.match(/\$([A-Za-z][A-Za-z0-9.\-]{0,15})\b/);
  if (dollarTicker?.[1]) return { symbol: dollarTicker[1].toUpperCase(), entityQuery: dollarTicker[1].toUpperCase() };

  const explicitTicker = request.message.match(/\b(?:ticker|symbol)\s+([A-Za-z][A-Za-z0-9.\-]{0,15})\b/i);
  if (explicitTicker?.[1]) return { symbol: explicitTicker[1].toUpperCase(), entityQuery: explicitTicker[1].toUpperCase() };

  const exchangeTicker = request.message.match(/\b(\d{1,5}\.[A-Za-z]{1,3})\b/);
  if (exchangeTicker?.[1]) return { symbol: exchangeTicker[1].toUpperCase(), entityQuery: exchangeTicker[1].toUpperCase() };

  const uppercase = request.message.match(/\b[A-Z][A-Z0-9]{0,5}(?:\.[A-Z]{1,3}|-[A-Z]{3})?\b/g) ?? [];
  const ticker = uppercase.find((token) => !COMMON_UPPERCASE_WORDS.has(token));
  if (ticker) return { symbol: ticker, entityQuery: ticker };

  const named = request.message.match(
    /\b(?:research|analy[sz]e|analysis of|overview of|review|look into|assess|investigate|resolve|lookup|identify)\s+(?:the\s+)?(.+?)(?=$|[,.!?;]|\s+and\s+|\s+then\s+|\s+with\s+|\s+using\s+|\s+show\s+|\s+include\s+|\s+plus\s+)/i,
  );
  const ofSubject = named ? null : request.message.match(
    /\b(?:charts?|technicals?|technical analysis|price|prices|quote|rsi|macd|support|resistance|momentum|levels|dcf(?:\s+sensitivity)?|valuation)\s+(?:for|of|on)\s+(?:the\s+)?(.+?)(?=$|[,.!?;]|\s+and\s+|\s+with\s+|\s+using\s+|\s+over\s+)/i,
  );
  // Conversational phrasings only name a company when the name is capitalised, so
  // "tell me about inflation" is never mistaken for a company.
  const soft = named || ofSubject ? null : request.message.match(SOFT_COMPANY_PHRASING);
  const subject = named?.[1] ?? ofSubject?.[1] ?? soft?.slice(1).find(Boolean);
  const entityQuery = subject ? cleanEntityPhrase(subject) : null;
  return { symbol: null, entityQuery };
}

type CapabilityInput = z.input<typeof conversationCapabilityMatchSchema>;

function capability(input: CapabilityInput): ConversationCapabilityMatch {
  return conversationCapabilityMatchSchema.parse(input);
}

function connectedScope(request: ConversationRequest): Pick<ConversationCapabilityMatch, "sourceScopeCompatible" | "sourceScopeReason"> {
  const compatible = request.sourceScope === "auto" || request.sourceScope === "web";
  return {
    sourceScopeCompatible: compatible,
    sourceScopeReason: compatible ? null : "Connected/external market data requires Auto or Web source scope.",
  };
}

function projectScope(request: ConversationRequest): Pick<ConversationCapabilityMatch, "sourceScopeCompatible" | "sourceScopeReason"> {
  const compatible = request.sourceScope === "auto" || request.sourceScope === "my_data";
  return {
    sourceScopeCompatible: compatible,
    sourceScopeReason: compatible ? null : "Project intelligence requires Auto or My Data source scope.",
  };
}

export function resolveConversationCapabilities(request: ConversationRequest): ConversationCapabilityMatch[] {
  const message = request.message;
  const { symbol, entityQuery } = extractConversationEntityQuery(request);
  const entity = symbol ?? entityQuery;
  const resolved: ConversationCapabilityMatch[] = [];
  const p5Intents = resolveP5ProfessionalIntents(request);
  const artifactReportOnly = p5Intents.length === 1 && p5Intents[0].family === "research_reporting" && Boolean(p5Intents[0].activeArtifactRef);
  const wantsPersonalFinance = /\b(?:personal finance|personal finances|net worth|retirement|retire|debt payoff|savings rate|financial goals?|my finances|my income|my expenses|my cash flow)\b/i.test(message);
  const explicitMarketBundleCue = /\b(?:backtest|back-test|historical simulation|technical|technicals|rsi|macd|chart|support|resistance|momentum|price action)\b/i.test(message);
  const explicitResearchJourney = /\b(?:research|review|assess|investigate|look into)\b/i.test(message);
  // Generic topic research must not become a fictitious company merely because
  // the existing entity extractor accepts any text after "research" as a name.
  // Explicit financial/company cues and named entities keep their original P5 path.
  const plainResearch = naturalResearchEntry(message);
  const generalResearchTopic = Boolean(
    plainResearch
    && /^[a-z]/.test(plainResearch.objective)
    && !/\b(?:company|stock|equity|shares?|ticker|firm|business|security|earnings|fundamentals?|financials?|valuation|dcf|portfolio)\b/i.test(plainResearch.objective)
  );
  const softResearchCue = /\b(?:tell me about|what(?:'s| is) going on with|deep dive|what do you think (?:of|about)|(?:over|under)valued|worth)\b/i.test(message);
  const genericAnalyzeJourney = /\banaly[sz]e\b/i.test(message) && !explicitMarketBundleCue;
  const add = (item: CapabilityInput) => {
    const parsed = capability(item);
    if (!resolved.some((candidate) => candidate.id === parsed.id)) resolved.push(parsed);
  };

  // "Analyze Apple: fundamentals, technicals and a valuation": the valuation needs model inputs,
  // but the fundamentals/technicals ask is independent and must still get its research bundle.
  const valuationWithCompanyAnalysis = p5Intents.some((item) => item.capabilityId === "company.valuation")
    && /\b(?:analy[sz]e|analysis|research|review|assess|fundamentals?|technicals?)\b/i.test(message);
  if (!artifactReportOnly && entity && (explicitResearchJourney || genericAnalyzeJourney || valuationWithCompanyAnalysis || softResearchCue)
    && !p5Intents.some((item) => item.family === "company_research")
    && !wantsPersonalFinance
    && !generalResearchTopic
    && !/\b(?:project|portfolio)\b/i.test(message)) {
    p5Intents.push({
      family: "company_research",
      capabilityId: "company.research",
      label: "Company Research",
      reason: "The request asks to research a resolved company/security.",
      modelPath: null,
      parameters: null,
      inputProvenance: undefined,
      activeArtifactRef: null,
      requiresEntity: true,
      workspaceCommand: "/research",
      inputGap: null,
    });
  }

  for (const professional of p5Intents) {
    const isExternalCompanyFlow = professional.family === "company_research" || professional.family === "company_fundamentals";
    const gap = professional.inputGap;
    // Plain-language assumptions the user started to state (complete values are already parameters) must never be
    // discarded in favour of an active Artifact's stored parameters: block and let the user finish or correct them.
    const statedAssumptions = Boolean(gap && (gap.issues.length || gap.notes.length || Object.keys(gap.provided).length));
    const explicitOrArtifactInputs = Boolean(professional.parameters || (professional.activeArtifactRef && !statedAssumptions));
    const needsModel = ["valuation", "portfolio_risk", "fixed_income", "derivatives", "macro_fx"].includes(professional.family)
      && !professional.modelPath
      && !professional.activeArtifactRef;
    const requiredInputs: string[] = [];
    if (professional.requiresEntity) requiredInputs.push("company_or_security");
    if (needsModel) requiredInputs.push("professional_model");
    if (professional.modelPath && !explicitOrArtifactInputs) {
      requiredInputs.push(
        "structured_model_inputs_or_active_artifact",
        ...(gap ? [...gap.missing, ...gap.issues.map((issue) => issue.key)] : []).map((key) => MODEL_INPUT_PREFIX + key),
      );
    }
    if (professional.family === "research_reporting" && !explicitOrArtifactInputs && !entity) requiredInputs.push("source_artifact_or_company");

    const missingInputs = requiredInputs.filter((inputName) => {
      if (inputName === "company_or_security") return !entity;
      if (inputName === "professional_model") return !professional.modelPath;
      if (inputName === "structured_model_inputs_or_active_artifact" || inputName.startsWith(MODEL_INPUT_PREFIX)) return !explicitOrArtifactInputs;
      if (inputName === "source_artifact_or_company") return !professional.activeArtifactRef && !entity;
      return false;
    });
    const scope = isExternalCompanyFlow
      ? connectedScope(request)
      : professional.activeArtifactRef
        ? projectScope(request)
        : professional.parameters
          ? { sourceScopeCompatible: true, sourceScopeReason: null }
          : professional.family === "research_reporting"
            ? projectScope(request)
            : { sourceScopeCompatible: true, sourceScopeReason: null };

    add({
      id: professional.capabilityId,
      label: professional.label,
      confidence: professional.modelPath ? 0.99 : professional.family === "company_research" ? 0.97 : 0.95,
      reason: professional.reason,
      entityQuery,
      symbol,
      permissionClass: "safe_auto",
      availability: missingInputs.length ? "needs_input" : "ready",
      requiredInputs,
      missingInputs,
      requiresAI: false,
      requiresDeterministicCompute: true,
      sourceKinds: isExternalCompanyFlow ? ["connected"] : professional.activeArtifactRef ? ["project"] : [],
      ...scope,
      parameters: {
        family: professional.family,
        modelPath: professional.modelPath,
        modelParameters: professional.parameters,
        inputGap: gap,
        inputProvenance: professional.inputProvenance,
        activeArtifactRef: professional.activeArtifactRef,
        workspaceCommand: professional.workspaceCommand,
      },
    });
  }
  if (artifactReportOnly) return resolved;

  const wantsProjectContinuity = /\bproject continuity\b|\b(?:resume|continue)\s+(?:this|the|my)\s+project\b|\b(?:show|review|open)\s+(?:the\s+)?decision memory\b|\bwhat\s+(?:should|do)\s+(?:i|we)\s+(?:continue|work on|do)\s+next\s+in\s+(?:this|the)\s+project\b/i.test(message);
  if (wantsProjectContinuity) {
    add({
      id: "project.continuity",
      label: "Resume Project Continuity",
      confidence: 0.99,
      reason: "The request asks to resume durable Project work, review Decision Memory or inspect the deterministic continuation queue.",
      entityQuery: null,
      symbol: null,
      permissionClass: "safe_auto",
      availability: "ready",
      requiresAI: false,
      requiresDeterministicCompute: true,
      sourceKinds: ["project"],
      ...projectScope(request),
      parameters: {},
    });
  }

  const projectSearch = message.match(/\b(?:search|find)\s+(?:in\s+)?(?:this\s+)?project\s+(?:for\s+)?(.+)/i);
  if (projectSearch?.[1]) {
    add({
      id: "project.search",
      label: "Search Project intelligence",
      confidence: 0.99,
      reason: "The request explicitly asks to search the active Project.",
      entityQuery: null,
      symbol: null,
      permissionClass: "safe_auto",
      requiresAI: false,
      requiresDeterministicCompute: false,
      sourceKinds: ["project"],
      ...projectScope(request),
      parameters: { query: projectSearch[1].trim() },
    });
  }

  if (/\bwhat (?:has )?changed\b|\bproject changes?\b|\bchanges? since\b/i.test(message)) {
    add({
      id: "project.changes",
      label: "Compare Project intelligence",
      confidence: 0.98,
      reason: "The request asks for change intelligence in the active Project.",
      entityQuery: null,
      symbol: null,
      permissionClass: "safe_auto",
      availability: "ready",
      requiresAI: false,
      requiresDeterministicCompute: true,
      sourceKinds: ["project"],
      ...projectScope(request),
      parameters: {},
    });
  }

  if (/\binsight lens\b|\bproject insights?\b|\bcontradictions?\b.*\bproject\b/i.test(message)) {
    add({
      id: "project.insight_lens",
      label: "Run Project Insight Lens",
      confidence: 0.98,
      reason: "The request asks for deterministic Project insight synthesis.",
      entityQuery: null,
      symbol: null,
      permissionClass: "safe_auto",
      requiresAI: false,
      requiresDeterministicCompute: true,
      sourceKinds: ["project"],
      ...projectScope(request),
      parameters: {},
    });
  }

  if (wantsPersonalFinance) {
    add({
      id: "personal_finance.snapshot",
      label: "Analyze Personal Finance",
      confidence: 0.99,
      reason: "The request is explicitly about user-owned personal-finance inputs.",
      entityQuery: null,
      symbol: null,
      permissionClass: "safe_auto",
      availability: request.context?.personalFinance ? "ready" : "needs_input",
      requiredInputs: ["personal_finance_profile"],
      missingInputs: request.context?.personalFinance ? [] : ["personal_finance_profile"],
      requiresAI: false,
      requiresDeterministicCompute: true,
      sourceKinds: ["project"],
      ...projectScope(request),
      parameters: {},
    });
  }

  const wantsBacktest = /\b(backtest|back-test|historical simulation|test (?:this |my )?strategy)\b/i.test(message);
  if (wantsBacktest) {
    add({
      id: "strategy.backtest",
      label: "Backtest strategy",
      confidence: 0.99,
      reason: "The request explicitly asks for a historical strategy simulation.",
      entityQuery,
      symbol,
      permissionClass: "user_confirm",
      availability: entity ? "needs_approval" : "needs_input",
      requiredInputs: ["company_or_security"],
      missingInputs: entity ? [] : ["company_or_security"],
      requiresAI: false,
      requiresDeterministicCompute: true,
      sourceKinds: ["connected"],
      ...connectedScope(request),
      parameters: {},
    });
  }

  const explicitTechnicalCue = /\b(technical|technicals|chart|support|resistance|momentum|price action)\b/i.test(message);
  const explicitIndicatorSnapshot = /\b(?:show|current|calculate|compute|what(?:'s| is))\s+(?:the\s+)?(?:rsi|macd)\b/i.test(message);
  const wantsTechnical = explicitTechnicalCue || explicitIndicatorSnapshot || (!wantsBacktest && /\b(rsi|macd)\b/i.test(message));
  if (wantsTechnical) {
    add({
      id: "market.technical",
      label: "Run technical analysis",
      confidence: 0.98,
      reason: "The request asks for deterministic market technical calculations.",
      entityQuery,
      symbol,
      permissionClass: "safe_auto",
      availability: entity ? "ready" : "needs_input",
      requiredInputs: ["company_or_security"],
      missingInputs: entity ? [] : ["company_or_security"],
      requiresAI: false,
      requiresDeterministicCompute: true,
      sourceKinds: ["connected"],
      ...connectedScope(request),
      parameters: {},
    });
  }

  const explicitSecurityCue = Boolean(symbol)
    || /\$(?:[A-Za-z][A-Za-z0-9.\-]{0,15})\b/.test(message)
    || /\b(?:stock|security|equity|company|ticker|shares?)\b/i.test(message);
  const p5OwnsCompanyJourney = resolved.some((item) => ["company.research", "company.fundamentals", "company.valuation"].includes(item.id));
  const mentionsPortfolio = /\bportfolio\b/i.test(message);
  const wantsQuote = Boolean(entity) && !wantsTechnical && /\b(?:share |stock )?(?:price|quote)\s+(?:of|for)\b/i.test(message);
  const wantsOverview = (/\b(research|analy[sz]e|overview|review|look into|assess|investigate)\b/i.test(message) || wantsQuote)
    && (!wantsPersonalFinance || explicitSecurityCue)
    && (!mentionsPortfolio || explicitSecurityCue)
    && !p5OwnsCompanyJourney
    && !generalResearchTopic;
  if (wantsOverview) {
    add({
      id: "security.overview",
      label: "Build security overview",
      confidence: 0.92,
      reason: "The request asks LiOS to understand a named security/company without manual module selection.",
      entityQuery,
      symbol,
      permissionClass: "safe_auto",
      availability: entity ? "ready" : "needs_input",
      requiredInputs: ["company_or_security"],
      missingInputs: entity ? [] : ["company_or_security"],
      requiresAI: false,
      requiresDeterministicCompute: true,
      sourceKinds: ["connected"],
      ...connectedScope(request),
      parameters: {},
    });
  }

  const legacyIntent = classifyAskLiosIntent(message);
  if (legacyIntent.kind === "resolve") {
    add({
      id: "instrument.resolve",
      label: "Resolve instrument identity",
      confidence: 0.99,
      reason: "The request explicitly asks LiOS to resolve an instrument.",
      entityQuery: legacyIntent.ticker,
      symbol: legacyIntent.ticker,
      permissionClass: "safe_auto",
      requiresAI: false,
      requiresDeterministicCompute: false,
      sourceKinds: ["connected"],
      parameters: { ticker: legacyIntent.ticker },
    });
  } else if (legacyIntent.kind === "compute" && p5Intents.length === 0) {
    const delegation = buildAskLiosDelegation(legacyIntent);
    add({
      id: "deterministic.engine",
      label: delegation.engineLabel,
      confidence: 0.96,
      reason: "The request maps to a registered deterministic LiOS engine.",
      entityQuery,
      symbol,
      permissionClass: request.executionMode === "ai_direct" ? "user_confirm" : "safe_auto",
      availability: request.executionMode === "ai_direct" ? "needs_approval" : "needs_input",
      requiredInputs: request.executionMode === "ai_direct" ? [] : ["explicit_engine_inputs"],
      missingInputs: request.executionMode === "ai_direct" ? [] : ["explicit_engine_inputs"],
      requiresAI: request.executionMode === "ai_direct",
      requiresDeterministicCompute: request.executionMode !== "ai_direct",
      sourceKinds: request.executionMode === "ai_direct" ? ["ai"] : [],
      parameters: { engineId: legacyIntent.engineId, view: delegation.view },
    });
  }

  if (resolved.length === 0) {
    add({
      id: "ai.answer",
      label: "Ask configured BYOAI",
      confidence: 0.8,
      reason: "No deterministic LiOS capability fully covers the request.",
      entityQuery,
      symbol,
      permissionClass: "safe_auto",
      availability: "requires_ai",
      requiresAI: true,
      requiresDeterministicCompute: false,
      sourceKinds: ["ai"],
      parameters: {},
    });
  }

  return resolved;
}

export function isMarketCapabilityBundle(capabilities: ConversationCapabilityMatch[]): boolean {
  const supported = new Set(["security.overview", "market.technical", "strategy.backtest"]);
  if (!capabilities.length || capabilities.some((item) => !supported.has(item.id))) return false;
  const ids = new Set(capabilities.map((item) => item.id));
  if (capabilities.some((item) => item.availability === "needs_input")) return true;
  // The direct technical path needs a ticker; a company name goes through the bundle, which resolves it.
  if (ids.has("market.technical") && capabilities.some((item) => !item.symbol && item.entityQuery)) return true;
  return ids.has("security.overview")
    || (ids.has("market.technical") && ids.has("strategy.backtest"));
}
