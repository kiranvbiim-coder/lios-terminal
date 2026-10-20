import crypto from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { financialModelRuns } from "@shared/schema";
import type { IntegratedFinancialModelResult } from "@shared/integratedFinancialModel";
import type { FinancialDatasetPayload } from "@shared/pointInTimeData";
import { getDb, type DrizzleDb } from "./db";
import { listDatasetSnapshots } from "./pointInTimeDatasetStore";
import { resolvePositionIdentity } from "./positionIdentity";

export async function saveFinancialModelRun(input: {
  result: IntegratedFinancialModelResult; resultHash: string; createdByUserId: number;
}, db: Pick<DrizzleDb, "select" | "insert"> = getDb()) {
  const id = crypto.randomUUID();
  const identity = await resolvePositionIdentity(db, input.result.symbol);
  const [created] = await db.insert(financialModelRuns).values({
    id,
    symbol: identity.symbol,
    listingId: identity.listingId,
    securityId: identity.securityId,
    datasetSnapshotId: input.result.datasetSnapshotId,
    modelVersion: input.result.modelVersion,
    assumptions: input.result.assumptions,
    result: input.result as unknown as Record<string, unknown>,
    resultHash: input.resultHash,
    createdByUserId: input.createdByUserId,
  }).onConflictDoNothing().returning();
  if (created) return created;
  const [existing] = await db.select().from(financialModelRuns).where(and(eq(financialModelRuns.datasetSnapshotId, input.result.datasetSnapshotId), eq(financialModelRuns.resultHash, input.resultHash))).limit(1);
  return existing;
}

export async function listFinancialModelRuns(symbol: string, limit = 50) {
  return getDb().select().from(financialModelRuns).where(eq(financialModelRuns.symbol, symbol.toUpperCase())).orderBy(desc(financialModelRuns.createdAt)).limit(limit);
}

export function buildForecastActualVariance(result: IntegratedFinancialModelResult, actuals: FinancialDatasetPayload) {
  const periods = new Map(actuals.periods.map((period) => [period.fiscalYear, period]));
  const rows = result.forecast.flatMap((forecast) => {
    const actual = periods.get(forecast.fiscalYear);
    if (!actual) return [];
    const metrics = [
      ["revenue", forecast.income.revenue, actual.income.revenue],
      ["netIncome", forecast.income.netIncome, actual.income.netIncome],
      ["dilutedEps", forecast.income.dilutedEps, actual.income.epsDiluted ?? actual.income.eps],
    ] as const;
    return metrics.flatMap(([metric, forecastValue, actualValue]) => Number.isFinite(actualValue) ? [{
      fiscalYear: forecast.fiscalYear, metric, forecast: forecastValue, actual: actualValue as number,
      variance: (actualValue as number) - forecastValue,
      variancePercent: forecastValue === 0 ? null : ((actualValue as number) - forecastValue) / Math.abs(forecastValue),
    }] : []);
  });
  return { status: rows.length > 0 ? "measured" as const : "pending_actuals" as const, rows };
}

export async function getForecastActualVariance(symbol: string) {
  const [actualSnapshot] = await listDatasetSnapshots(symbol, 1);
  const runs = await listFinancialModelRuns(symbol, 50);
  if (!actualSnapshot) return { symbol: symbol.toUpperCase(), actualSnapshotId: null, runs: [] };
  return {
    symbol: symbol.toUpperCase(), actualSnapshotId: actualSnapshot.id,
    runs: runs.map((run) => ({ runId: run.id, createdAt: run.createdAt.toISOString(), modelVersion: run.modelVersion, resultHash: run.resultHash,
      ...buildForecastActualVariance(run.result as unknown as IntegratedFinancialModelResult, actualSnapshot.payload) })),
  };
}
