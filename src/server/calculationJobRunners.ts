import { factorRiskSnapshotRequestSchema } from "./factorRiskRoutes";
import { captureFactorRiskSnapshot } from "./factorRiskModel";
import {
  registerCalculationJobRunner,
  type CalculationJobRunContext,
} from "./calculationJobService";
import { runWithRequestIdentity } from "./requestContext";
import { runScenarioPipeline, assertScenarioPipelineResultCurrent, scenarioPipelineRequestSchema, ScenarioPipelineError, type ScenarioPipelineRequest } from "./scenarioPipeline";
import { getDb } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { tenantContext } from "./tenantContext";

export const FACTOR_RISK_CALCULATION_KIND = "factor-risk-capture";
export const SCENARIO_PIPELINE_CALCULATION_KIND = "scenario-pipeline-preview";

function invalidInput(message: string): never {
  throw new Error(`Invalid calculation job input: ${message}`);
}

function requestIdentity(ctx: CalculationJobRunContext) {
  return { userId: ctx.userId, organizationId: ctx.organizationId };
}

/**
 * Registers the production runners owned by this server. Registration is
 * intentionally explicit and idempotent so route setup can safely call it
 * during every process boot while tests can reset and re-register the map.
 */
export function registerBuiltInCalculationJobRunners(): void {
  registerCalculationJobRunner(FACTOR_RISK_CALCULATION_KIND, async (input, ctx) => {
    const parsed = factorRiskSnapshotRequestSchema.safeParse(input);
    if (!parsed.success) invalidInput(parsed.error.issues.map((issue) => issue.message).join("; "));
    await ctx.reportProgress(5);
    const result = await runWithRequestIdentity(requestIdentity(ctx), () => captureFactorRiskSnapshot(parsed.data));
    await ctx.reportProgress(95);
    return result;
  });

  registerCalculationJobRunner(SCENARIO_PIPELINE_CALCULATION_KIND, async (input, ctx) => {
    const parsed = scenarioPipelineRequestSchema.safeParse(input);
    if (!parsed.success) invalidInput(parsed.error.issues.map((issue) => issue.message).join("; "));
    await ctx.reportProgress(5);
    const [actor] = await getDb().select().from(users).where(eq(users.id, ctx.userId)).limit(1);
    if (!actor || !actor.active || (actor.organizationId ?? null) !== ctx.organizationId ||
        !["internal_admin", "internal_analyst", "internal_compliance"].includes(actor.role)) throw new Error("Calculation owner authority is no longer current.");
    const result = await runWithRequestIdentity(requestIdentity(ctx), () => runScenarioPipeline(parsed.data as ScenarioPipelineRequest, tenantContext(actor)));
    await ctx.reportProgress(95);
    return result;
  }, { authorizeRead: async (job, scope) => {
    const [actor] = await getDb().select().from(users).where(eq(users.id, scope.userId)).limit(1);
    if (!actor || !actor.active || !["internal_admin", "internal_analyst", "internal_compliance"].includes(actor.role))
      throw new ScenarioPipelineError(403, "Calculation reader authority is no longer current.");
    await runWithRequestIdentity({userId:actor.id,organizationId:actor.organizationId??null}, () =>
      assertScenarioPipelineResultCurrent(tenantContext(actor), job.input, job.result));
  } });
}
