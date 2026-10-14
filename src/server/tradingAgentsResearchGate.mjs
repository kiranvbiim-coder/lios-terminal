/**
 * SI-05.26/.27/.29 read-only TradingAgents adaptation behind LiOS research.
 *
 * Adapted from TauricResearch/TradingAgents (Apache-2.0) at exact upstream
 * commit 2d17df8da1536c121e4d7395ac5a5dcec9e96d6f:
 *   tradingagents/agents/utils/rating.py (extract_rating, REVIEW fallback)
 *   tradingagents/graph/conditional_logic.py (bounded bull/bear turns)
 *
 * Unlike the upstream graph, this pure gate does not call models, providers,
 * brokers or tools, store state, or assert that an opinion is sourced. The
 * canonical GM-12 agent runtime owns invocation and approval; P5/P7 own
 * instrument identity, entitlement, evidence and source references.
 */
export const TRADINGAGENTS_RESEARCH_SOURCE = Object.freeze({
  repository: "TauricResearch/TradingAgents",
  commit: "2d17df8da1536c121e4d7395ac5a5dcec9e96d6f",
  license: "Apache-2.0",
  originalPaths: Object.freeze([
    "tradingagents/agents/utils/rating.py",
    "tradingagents/graph/conditional_logic.py",
    "tradingagents/agents/utils/agent_utils.py",
    "tradingagents/agents/risk_mgmt/aggressive_debator.py",
    "tradingagents/agents/risk_mgmt/conservative_debator.py",
    "tradingagents/agents/risk_mgmt/neutral_debator.py",
  ]),
  mode: "read_only_bounded_adaptation",
});

export const RESEARCH_RATINGS = Object.freeze([
  "Buy", "Overweight", "Hold", "Underweight", "Sell",
]);
export const RESEARCH_REVIEW = "REVIEW";

const ratingSet = new Set(RESEARCH_RATINGS);
const ratingText = "(Buy|Overweight|Hold|Underweight|Sell)";
const ratingWords = new RegExp(`\\b${ratingText}\\b`, "gi");
const labelPattern = new RegExp(
  `^\\s*(?:[-*]\\s+)?(?:\\*\\*)?(?:Rating|Recommendation)(?:\\*\\*)?\\s*[:\\-\\u2010-\\u2015]\\s*\\*{0,2}${ratingText}\\b`,
  "i",
);
const legendPattern = /^\s*(?:[-*]\s+)?(?:\*\*)?(?:Rating\s*(?:Scale|Options|Legend)|Recommendation\s*(?:Scale|Options|Legend))\b/i;

function review(reason) {
  return Object.freeze({
    rating: RESEARCH_REVIEW,
    requiresHumanReview: true,
    reason,
    outputTruth: "unverified_model_output",
    executable: false,
  });
}

function found(rating, reason) {
  return Object.freeze({
    rating,
    // Parsing a model-supplied label never proves research evidence, suitability,
    // broker grants or trade approval. Every such opinion needs human review.
    requiresHumanReview: true,
    reason,
    outputTruth: "unverified_model_output",
    executable: false,
  });
}

/**
 * Adapt the donor's 5-tier structured-decision parser with stronger safety:
 * never turn an unreadable/ambiguous rating into a fabricated Hold, never
 * classify labels inside a rating scale as an investment recommendation, and
 * never interpret the result as broker permission or observed research.
 *
 * The optional single-word fallback is *off by default*. A model's argument
 * that merely mentions Buy is not a decision without an explicit rating.
 */
export function parseTradingAgentsResearchRating(text, { allowSingleWordFallback = false } = {}) {
  if (typeof text !== "string" || !text.trim()) return review("missing_rating");
  if (text.length > 20_000) return review("rating_output_too_large");
  const normalized = text.normalize("NFKC");
  const labelled = new Set();
  for (const line of normalized.split(/\r?\n/)) {
    if (legendPattern.test(line)) continue;
    const match = labelPattern.exec(line);
    if (match) {
      const rating = RESEARCH_RATINGS.find((r) => r.toLowerCase() === match[1].toLowerCase());
      if (rating) labelled.add(rating);
    }
  }
  if (labelled.size > 1) return review("contradictory_explicit_ratings");
  if (labelled.size === 1) return found([...labelled][0], "explicit_rating");

  if (!allowSingleWordFallback) return review("missing_explicit_rating");
  const words = new Set();
  for (const match of normalized.matchAll(ratingWords)) {
    const rating = RESEARCH_RATINGS.find((r) => r.toLowerCase() === match[1].toLowerCase());
    if (rating && ratingSet.has(rating)) words.add(rating);
  }
  if (words.size === 1) return found([...words][0], "single_unlabelled_rating");
  return review(words.size > 1 ? "ambiguous_unlabelled_ratings" : "unrecognizable_rating");
}

/**
 * Donor-derived alternation (bull then bear, bounded 2*rounds), but turn roles
 * and state are controlled by GM rather than inferred from model prose.
 * It does not create its own agent runner, memory or checkpoint authority.
 */
export function planTradingAgentsDebateTurn({ turns, maxRounds = 1 }) {
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > 3) {
    throw new RangeError("TradingAgents debate must have 1–3 explicitly bounded rounds.");
  }
  if (!Array.isArray(turns) || turns.length > 2 * maxRounds) {
    throw new RangeError("Debate turns exceed the declared round budget.");
  }
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const expected = i % 2 === 0 ? "bull" : "bear";
    if (!turn || typeof turn !== "object" || Array.isArray(turn) ||
        turn.speaker !== expected || typeof turn.argument !== "string" ||
        !turn.argument.trim() || turn.argument.length > 5_000) {
      throw new TypeError(`Invalid or out-of-order debate turn ${i + 1}; expected ${expected}.`);
    }
  }
  const complete = turns.length === 2 * maxRounds;
  return Object.freeze({
    next: complete ? "human_review" : (turns.length % 2 === 0 ? "bull" : "bear"),
    complete,
    usedTurns: turns.length,
    maximumTurns: 2 * maxRounds,
    sourceStatus: "unverified_model_debate",
    executable: false,
  });
}

/**
 * Adapted from TradingAgents' three-analyst risk_mgmt debate and graph
 * should_continue_risk_analysis. Unlike its live portfolio manager handoff,
 * LiOS returns non-executable human_review after a bounded sequence.
 * GM-12, not this code, owns any agent invocation/checkpoint/approval.
 */
export function planTradingAgentsRiskTurn({ turns, maxRounds = 1 }) {
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > 3) {
    throw new RangeError("Risk debate requires 1–3 explicitly bounded rounds.");
  }
  const maximumTurns = 3 * maxRounds;
  if (!Array.isArray(turns) || turns.length > maximumTurns) {
    throw new RangeError("Risk debate turns exceed the declared round budget.");
  }
  const roles = ["aggressive", "conservative", "neutral"];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const expected = roles[i % 3];
    if (!turn || typeof turn !== "object" || Array.isArray(turn) ||
        turn.speaker !== expected || typeof turn.argument !== "string" ||
        !turn.argument.trim() || turn.argument.length > 5_000) {
      throw new TypeError(`Invalid or out-of-order risk turn ${i + 1}; expected ${expected}.`);
    }
  }
  const complete = turns.length === maximumTurns;
  return Object.freeze({
    next: complete ? "human_review" : roles[turns.length % 3],
    complete,
    usedTurns: turns.length,
    maximumTurns,
    sourceStatus: "unverified_model_risk_debate",
    executable: false,
  });
}

/**
 * Adapted donor opening/absence helpers; never make an absent opponent or
 * analyst report appear to have submitted evidence. Pure formatting only.
 */
export function donorOpponentOrOpening(text, opponent) {
  if (typeof opponent !== "string" || !/^[a-z][a-z -]{1,48}$/i.test(opponent)) {
    throw new TypeError("Opponent must be an explicit bounded analyst label.");
  }
  if (typeof text !== "string" || text.length > 5_000) {
    throw new TypeError("Opponent argument must be bounded text.");
  }
  return text.trim() || `(The ${opponent} has not spoken yet; open with independently available evidence.)`;
}

export function donorReportOrAbsent(text, source) {
  if (typeof source !== "string" || !/^[a-z][a-z -]{1,48}$/i.test(source)) {
    throw new TypeError("Report source must be an explicit bounded label.");
  }
  if (typeof text !== "string" || text.length > 8_000) {
    throw new TypeError("Report must be bounded text.");
  }
  return text.trim() || `(No ${source} report available in this run; absence is not a negative finding.)`;
}
