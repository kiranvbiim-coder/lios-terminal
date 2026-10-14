import crypto from "node:crypto";
import { z } from "zod";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { assertNotAborted } from "./conversationRuntimeCore";
import { getProject } from "./projectStore";
import { evaluateQlibRiskChallenger, QLIB_RISK_CHALLENGER_SOURCE } from "./qlibRiskChallenger.mjs";

/**
 * SI-05.16/.23: readable point-in-time-neutral Qlib-formula challenger.
 * The user/model explicitly submits returns, not a ticker/market-data lookup.
 * The Qlib Python runtime is NOT installed or invoked by this tool.
 */
export const qlibRiskChallengerInputSchema = z.object({
  returns: z.array(z.number().finite().gt(-1).max(10)).min(2).max(512),
  annualizationSessions: z.number().int().min(1).max(365),
  mode: z.enum(["sum", "product"]),
}).strict();

const metricsSchema = z.object({
  method: z.literal("qlib_risk_analysis_mit_adaptation_v1"),
  inputTruth: z.literal("unknown"),
  runtime: z.literal("liOS_adapted_formula"),
  accumulation: z.enum(["sum", "product"]),
  sampleCount: z.number().int().min(2).max(512),
  annualizationSessions: z.number().int().min(1).max(365),
  mean: z.number().finite(),
  std: z.number().finite().nonnegative(),
  annualizedReturn: z.number().finite(),
  informationRatio: z.number().finite().nullable(),
  maxDrawdown: z.number().finite().nonpositive(),
  caveats: z.array(z.string().max(300)).min(4).max(10),
}).strict();

export const qlibRiskChallengerOutputSchema = z.object({
  output: z.object({
    model: z.literal("qlib_risk_analysis_mit_adaptation_v1"),
    validation: z.literal("experimental_challenger"),
    numerical: metricsSchema,
    inputSha256: z.string().regex(/^[0-9a-f]{64}$/),
    outputSha256: z.string().regex(/^[0-9a-f]{64}$/),
    upstream: z.object({
      repository: z.literal("microsoft/qlib"),
      commit: z.string().regex(/^[0-9a-f]{40}$/),
      originalPath: z.literal("qlib/contrib/evaluate.py"),
      license: z.literal("MIT"),
      installedRuntime: z.literal(false),
    }).strict(),
    observedMarketData: z.literal(false),
    brokerageExecution: z.literal(false),
  }).strict(),
  summary: z.string().trim().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string()).length(0),
}).strict();

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
}).strict();

const sha256 = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const qlibRiskChallengerTool: ConversationToolDefinition = {
  id: "lios.quant.qlib_risk_challenger",
  label: "Calculate explicitly assumed return-risk metrics using Qlib-adapted formulas (experimental)",
  planningHint: "Calculate Qlib-adapted risk metrics only from explicitly available decimal returns (0.02 means +2%). Model-submitted values stay unverified/unknown until source-bound; never invent or fetch prices. The annualizationSessions parameter (1–365; 238 is Qlib daily default) and sum/product accumulation convention are mandatory. This is an experimental read-only numerical challenger, not a live Qlib engine, price source or brokerage capability.",
  kind: "calculate",
  permissionClass: "safe_auto",
  access: "read",
  sideEffect: "none",
  replaySafe: true,
  inputSchema: qlibRiskChallengerInputSchema,
  outputSchema: qlibRiskChallengerOutputSchema.transform((value): ConversationToolResult => value),
  maxOutputBytes: 16 * 1024,
  cancel: null,
  invoke: async (input, signal, call): Promise<ConversationToolResult> => {
    assertNotAborted(signal);
    if (call.source !== "agent" || !call.requestId) {
      throw new Error("Qlib risk challenger requires an authenticated governed agent request.");
    }
    if (call.resourceTransmissionAllowed === false) {
      throw new Error("Qlib risk challenger cannot read returns when resource transmission is disabled.");
    }
    const tenant = tenantSchema.parse(call.tenant);
    const projectId = Number(call.projectId);
    if (call.userId !== tenant.userId || !Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new Error("Qlib risk challenger requires the exact owner and Project context.");
    }
    await getProject(tenant, projectId);
    assertNotAborted(signal);
    const parsed = qlibRiskChallengerInputSchema.parse(input);
    const numerical = evaluateQlibRiskChallenger(parsed);
    assertNotAborted(signal);
    const result = qlibRiskChallengerOutputSchema.parse({
      output: {
        model: "qlib_risk_analysis_mit_adaptation_v1",
        validation: "experimental_challenger",
        numerical,
        inputSha256: sha256(parsed),
        outputSha256: sha256(numerical),
        upstream: {
          repository: QLIB_RISK_CHALLENGER_SOURCE.repository,
          commit: QLIB_RISK_CHALLENGER_SOURCE.commit,
          originalPath: QLIB_RISK_CHALLENGER_SOURCE.originalPath,
          license: QLIB_RISK_CHALLENGER_SOURCE.license,
          installedRuntime: false,
        },
        observedMarketData: false,
        brokerageExecution: false,
      },
      summary: `Calculated ${numerical.sampleCount} unverified model-submitted period returns using Qlib-adapted ${numerical.accumulation} risk formulas. Annualization: ${numerical.annualizationSessions} sessions. These experimental challenger inputs have unknown truth until server-bound; no provider observations, Qlib Python engine, or trades were used. Undefined ratios remain null.`,
      deterministic: true,
      sourceRefs: [],
    });
    return result;
  },
};
