import { z } from "zod";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { assertNotAborted, sourceScopeAllowsProjectData } from "./conversationRuntimeCore";
import { getProject } from "./projectStore";
import {
  TRADINGAGENTS_RESEARCH_SOURCE,
  parseTradingAgentsResearchRating,
  planTradingAgentsDebateTurn,
  planTradingAgentsRiskTurn,
} from "./tradingAgentsResearchGate.mjs";

/**
 * Bounded GM-compatible read-only adapter for a TradingAgents-style research
 * debate. No second agent runner, no direct provider/LLM calls, no trades.
 *
 * Registered only through the existing canonical conversationRuntime catalogue.
 * No parallel execution/permission authority is created. Owner review must
 * still qualify real model input provenance and packaged SP-05 acceptance.
 */
const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

export const tradingAgentsResearchToolInputSchema = z.object({
  decisionText: z.string().trim().min(1).max(8_000),
  turns: z.array(z.object({
    speaker: z.enum(["bull", "bear"]),
    argument: z.string().trim().min(1).max(5_000),
  }).strict()).max(6),
  maxRounds: z.number().int().min(1).max(3),
  riskTurns: z.array(z.object({
    speaker: z.enum(["aggressive", "conservative", "neutral"]),
    argument: z.string().trim().min(1).max(5_000),
  }).strict()).max(9).default([]),
  riskMaxRounds: z.number().int().min(1).max(3).default(1),
}).strict();

export const tradingAgentsResearchToolOutputSchema = z.object({
  output: z.object({
    source: z.object({
      repository: z.literal("TauricResearch/TradingAgents"),
      commit: z.string().regex(/^[a-f0-9]{40}$/),
      license: z.literal("Apache-2.0"),
      importedRuntime: z.literal(false),
    }).strict(),
    interpretation: z.object({
      rating: z.enum(["Buy", "Overweight", "Hold", "Underweight", "Sell", "REVIEW"]),
      requiresHumanReview: z.boolean(),
      reason: z.string(),
      outputTruth: z.literal("unverified_model_output"),
      executable: z.literal(false),
    }).strict(),
    debate: z.object({
      next: z.enum(["bull", "bear", "human_review"]),
      complete: z.boolean(),
      usedTurns: z.number().int().min(0).max(6),
      maximumTurns: z.number().int().min(2).max(6),
      sourceStatus: z.literal("unverified_model_debate"),
      executable: z.literal(false),
    }).strict(),
    riskDebate: z.object({
      next: z.enum(["aggressive", "conservative", "neutral", "human_review"]),
      complete: z.boolean(),
      usedTurns: z.number().int().min(0).max(9),
      maximumTurns: z.number().int().min(3).max(9),
      sourceStatus: z.literal("unverified_model_risk_debate"),
      executable: z.literal(false),
    }).strict(),
    evidenceStatus: z.literal("not_source_verified"),
    brokerageExecution: z.literal(false),
  }).strict(),
  summary: z.string().trim().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string()).length(0),
}).strict();

export const tradingAgentsResearchTool: ConversationToolDefinition = {
  id: "lios.research.tradingagents_debate_review",
  label: "Review source-unverified bull/bear debate and five-tier research opinion",
  planningHint: "Read-only TradingAgents-inspired five-tier rating, bounded bull/bear and aggressive/conservative/neutral risk debate interpretation. All arguments are unverified model opinions, not evidence, investment advice or broker permissions. Missing research remains unavailable. No autonomous analyst invocation or market-data lookup.",
  kind: "calculate",
  permissionClass: "safe_auto",
  access: "read",
  sideEffect: "none",
  replaySafe: true,
  inputSchema: tradingAgentsResearchToolInputSchema,
  outputSchema: tradingAgentsResearchToolOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 16 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    assertNotAborted(signal);
    if (call.source !== "agent" || !call.requestId) {
      throw new Error("TradingAgents research gate requires an authenticated governed agent request.");
    }
    if (call.resourceTransmissionAllowed === false ||
        !sourceScopeAllowsProjectData(call.sourceScope ?? "auto")) {
      throw new Error("TradingAgents research gate requires permitted Project research scope.");
    }
    const tenant = tenantSchema.parse(call.tenant);
    const projectId = Number(call.projectId);
    if (call.userId !== tenant.userId || !Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new Error("TradingAgents research gate requires exact Project owner context.");
    }
    await getProject(tenant, projectId);
    assertNotAborted(signal);
    const parsed = tradingAgentsResearchToolInputSchema.parse(input);
    const interpretation = parseTradingAgentsResearchRating(parsed.decisionText);
    const debate = planTradingAgentsDebateTurn({
      turns: parsed.turns,
      maxRounds: parsed.maxRounds,
    });
    const riskDebate = planTradingAgentsRiskTurn({
      turns: parsed.riskTurns,
      maxRounds: parsed.riskMaxRounds,
    });
    assertNotAborted(signal);
    const out = tradingAgentsResearchToolOutputSchema.parse({
      output: {
        source: {
          repository: TRADINGAGENTS_RESEARCH_SOURCE.repository,
          commit: TRADINGAGENTS_RESEARCH_SOURCE.commit,
          license: TRADINGAGENTS_RESEARCH_SOURCE.license,
          importedRuntime: false,
        },
        interpretation,
        debate,
        riskDebate,
        evidenceStatus: "not_source_verified",
        brokerageExecution: false,
      },
      summary: interpretation.rating === "REVIEW"
        ? "TradingAgents-style output has no unambiguous explicit rating and requires human review; neither missing nor contradictory opinions can be converted to Hold. Source evidence and broker permissions are unavailable."
        : `TradingAgents-style rating ${interpretation.rating} was parsed from unverified model text and REQUIRES human review. Research next: ${debate.next}; risk next: ${riskDebate.next}. No verified provider rating, approved action, source evidence or trade execution.`,
      deterministic: true,
      sourceRefs: [],
    });
    return out;
  },
};
