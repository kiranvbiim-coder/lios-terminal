export declare const TRADINGAGENTS_RESEARCH_SOURCE: Readonly<{
  repository: "TauricResearch/TradingAgents";
  commit: string;
  license: "Apache-2.0";
  originalPaths: readonly string[];
  mode: "read_only_bounded_adaptation";
}>;
export declare const RESEARCH_RATINGS: readonly ["Buy","Overweight","Hold","Underweight","Sell"];
export declare const RESEARCH_REVIEW: "REVIEW";
export interface TradingAgentsRating {
  rating: "Buy" | "Overweight" | "Hold" | "Underweight" | "Sell" | "REVIEW";
  requiresHumanReview: boolean;
  reason: string;
  outputTruth: "unverified_model_output";
  executable: false;
}
export interface TradingAgentsDebateTurn {
  speaker: "bull" | "bear";
  argument: string;
}
export interface TradingAgentsDebatePlan {
  next: "bull" | "bear" | "human_review";
  complete: boolean;
  usedTurns: number;
  maximumTurns: number;
  sourceStatus: "unverified_model_debate";
  executable: false;
}
export declare function parseTradingAgentsResearchRating(
  text: unknown,
  options?: { allowSingleWordFallback?: boolean },
): TradingAgentsRating;
export declare function planTradingAgentsDebateTurn(input: {
  turns: TradingAgentsDebateTurn[];
  maxRounds?: number;
}): TradingAgentsDebatePlan;

export interface TradingAgentsRiskTurn {
  speaker: "aggressive" | "conservative" | "neutral";
  argument: string;
}
export interface TradingAgentsRiskPlan {
  next: "aggressive" | "conservative" | "neutral" | "human_review";
  complete: boolean;
  usedTurns: number;
  maximumTurns: number;
  sourceStatus: "unverified_model_risk_debate";
  executable: false;
}
export declare function planTradingAgentsRiskTurn(input: {
  turns: TradingAgentsRiskTurn[];
  maxRounds?: number;
}): TradingAgentsRiskPlan;
export declare function donorOpponentOrOpening(text: string, opponent: string): string;
export declare function donorReportOrAbsent(text: string, source: string): string;
