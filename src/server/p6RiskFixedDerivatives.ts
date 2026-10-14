import { p6Hash } from "./p6BacktestEngine";

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(label + " must be finite.");
  return value;
}

export interface P6RiskPosition {
  id: string;
  weight: number;
  marketValue: number;
  sector?: string | null;
  currency?: string | null;
  averageDailyVolumeValue?: number | null;
}

export function calculateRiskContribution(input: {
  positions: P6RiskPosition[];
  covariance: number[][];
}) {
  const n = input.positions.length;
  if (!n || input.covariance.length !== n || input.covariance.some((row) => row.length !== n)) throw new Error("Covariance matrix must match positions.");
  const weights = input.positions.map((position) => finite(position.weight, "weight"));
  if (Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) > 1e-6) throw new Error("Risk weights must sum to 1.");
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    finite(input.covariance[i][j], "covariance");
    if (Math.abs(input.covariance[i][j] - input.covariance[j][i]) > 1e-10) throw new Error("Covariance matrix must be symmetric.");
  }
  const covTimesWeight = input.covariance.map((row) => row.reduce((sum, value, j) => sum + value * weights[j], 0));
  const variance = weights.reduce((sum, weight, i) => sum + weight * covTimesWeight[i], 0);
  if (variance < -1e-10) throw new Error("Portfolio variance cannot be negative.");
  const volatility = Math.sqrt(Math.max(0, variance));
  const rows = input.positions.map((position, i) => {
    const marginalRisk = volatility > 0 ? covTimesWeight[i] / volatility : 0;
    const componentRisk = position.weight * marginalRisk;
    return {
      id: position.id,
      weight: position.weight,
      marginalRisk,
      componentRisk,
      percentContribution: volatility > 0 ? componentRisk / volatility : 0,
    };
  });
  return {
    engineId: "lios.risk-contribution.core-v1",
    deterministic: true as const,
    portfolioVariance: variance,
    portfolioVolatility: volatility,
    positions: rows,
    resultHash: p6Hash({ input, rows }),
  };
}

export function runPortfolioScenarioStress(input: {
  positions: P6RiskPosition[];
  marketShock?: number;
  sectorShocks?: Record<string, number>;
  currencyShocks?: Record<string, number>;
}) {
  const marketShock = input.marketShock ?? 0;
  const rows = input.positions.map((position) => {
    const sectorShock = position.sector ? input.sectorShocks?.[position.sector] ?? 0 : 0;
    const currencyShock = position.currency ? input.currencyShocks?.[position.currency] ?? 0 : 0;
    const combinedShock = (1 + marketShock) * (1 + sectorShock) * (1 + currencyShock) - 1;
    return {
      id: position.id,
      combinedShock,
      pnl: position.marketValue * combinedShock,
      sectorShock,
      currencyShock,
      marketShock,
    };
  });
  return {
    engineId: "lios.portfolio-stress.core-v1",
    deterministic: true as const,
    totalPnl: rows.reduce((sum, row) => sum + row.pnl, 0),
    rows,
    resultHash: p6Hash({ input, rows }),
  };
}

export function calculateLiquidityStress(input: {
  positions: P6RiskPosition[];
  participationRate?: number;
  volumeHaircut?: number;
}) {
  const participation = input.participationRate ?? 0.1;
  const haircut = input.volumeHaircut ?? 0.5;
  if (!(participation > 0 && participation <= 1)) throw new Error("participationRate must be in (0,1].");
  if (!(haircut > 0 && haircut <= 1)) throw new Error("volumeHaircut must be in (0,1].");
  const rows = input.positions.map((position) => {
    const adv = position.averageDailyVolumeValue ?? null;
    const stressedCapacity = adv === null ? null : adv * haircut * participation;
    const daysToLiquidate = stressedCapacity && stressedCapacity > 0 ? Math.abs(position.marketValue) / stressedCapacity : null;
    return { id: position.id, stressedDailyCapacity: stressedCapacity, daysToLiquidate };
  });
  return {
    engineId: "lios.liquidity-stress.core-v1",
    deterministic: true as const,
    participationRate: participation,
    volumeHaircut: haircut,
    positions: rows,
    warnings: rows.some((row) => row.daysToLiquidate === null) ? ["ADV missing for one or more positions; no liquidity number was invented."] : [],
    resultHash: p6Hash({ input, rows }),
  };
}

export interface BondLadderInstrument {
  id: string;
  marketValue: number;
  maturityDate: string;
  couponCashflows: Array<{ date: string; amount: number }>;
  principalCashflow?: number | null;
  duration?: number | null;
}

export function buildFixedIncomeLadder(input: {
  asOf: string;
  instruments: BondLadderInstrument[];
  bucketMonths?: number;
}) {
  const asOf = new Date(input.asOf + "T00:00:00.000Z");
  if (!Number.isFinite(asOf.getTime())) throw new Error("asOf must be a valid date.");
  const bucketMonths = Math.max(1, Math.floor(input.bucketMonths ?? 12));
  const buckets = new Map<number, { bucket: number; fromMonth: number; toMonth: number; marketValue: number; cashflow: number; instrumentIds: string[] }>();
  const monthDistance = (date: string): number | null => {
    const target = new Date(date + (date.length === 10 ? "T00:00:00.000Z" : ""));
    if (!Number.isFinite(target.getTime())) throw new Error("Cash-flow and maturity dates must be valid.");
    if (target < asOf) return null;
    return Math.max(0, (target.getUTCFullYear() - asOf.getUTCFullYear()) * 12 + target.getUTCMonth() - asOf.getUTCMonth());
  };
  const bucketRow = (bucket: number) => {
    const existing = buckets.get(bucket);
    if (existing) return existing;
    const created = { bucket, fromMonth: bucket * bucketMonths, toMonth: (bucket + 1) * bucketMonths - 1, marketValue: 0, cashflow: 0, instrumentIds: [] as string[] };
    buckets.set(bucket, created);
    return created;
  };
  const addInstrument = (row: { instrumentIds: string[] }, id: string) => {
    if (!row.instrumentIds.includes(id)) row.instrumentIds.push(id);
  };

  for (const instrument of input.instruments) {
    if (!Number.isFinite(instrument.marketValue) || instrument.marketValue < 0) throw new Error("Bond marketValue must be finite and non-negative.");
    const maturityMonths = monthDistance(instrument.maturityDate);
    if (maturityMonths === null) throw new Error("Bond maturity must not be before asOf.");
    const maturityBucket = Math.floor(maturityMonths / bucketMonths);
    const maturityRow = bucketRow(maturityBucket);
    maturityRow.marketValue += instrument.marketValue;
    addInstrument(maturityRow, instrument.id);

    for (const cashflow of instrument.couponCashflows) {
      if (!Number.isFinite(cashflow.amount)) throw new Error("Coupon cash-flow amount must be finite.");
      const cashflowMonths = monthDistance(cashflow.date);
      if (cashflowMonths === null) continue;
      const cashflowRow = bucketRow(Math.floor(cashflowMonths / bucketMonths));
      cashflowRow.cashflow += cashflow.amount;
      addInstrument(cashflowRow, instrument.id);
    }

    const principal = instrument.principalCashflow ?? 0;
    if (!Number.isFinite(principal)) throw new Error("Principal cash-flow amount must be finite.");
    maturityRow.cashflow += principal;
  }
  const rows = [...buckets.values()].sort((a, b) => a.bucket - b.bucket);
  const totalMarketValue = input.instruments.reduce((sum, item) => sum + item.marketValue, 0);
  const durationNumerator = input.instruments.reduce((sum, item) => sum + item.marketValue * (item.duration ?? 0), 0);
  const durationDenominator = input.instruments.filter((item) => item.duration !== null && item.duration !== undefined).reduce((sum, item) => sum + item.marketValue, 0);
  return {
    engineId: "lios.fixed-income.ladder-v1",
    deterministic: true as const,
    asOf: input.asOf,
    bucketMonths,
    buckets: rows,
    totalMarketValue,
    weightedDuration: durationDenominator > 0 ? durationNumerator / durationDenominator : null,
    resultHash: p6Hash({ input, rows }),
  };
}

export interface OptionFlowRecord {
  expiry: string;
  strike: number;
  optionType: "call" | "put";
  side: "buy" | "sell";
  premium: number;
  openInterest: number;
  volume?: number | null;
}

export function aggregateOptionsFlow(records: OptionFlowRecord[]) {
  const normalized = records.map((record) => {
    if (record.premium < 0 || record.openInterest < 0 || (record.volume ?? 0) < 0) throw new Error("Options flow values must be non-negative.");
    return record;
  });
  const netPremium = (type: "call" | "put") => normalized.filter((row) => row.optionType === type).reduce((sum, row) => sum + (row.side === "buy" ? row.premium : -row.premium), 0);
  const callOi = normalized.filter((row) => row.optionType === "call").reduce((sum, row) => sum + row.openInterest, 0);
  const putOi = normalized.filter((row) => row.optionType === "put").reduce((sum, row) => sum + row.openInterest, 0);
  const byStrike = new Map<number, { strike: number; callOpenInterest: number; putOpenInterest: number; premium: number; volume: number }>();
  for (const row of normalized) {
    const current = byStrike.get(row.strike) ?? { strike: row.strike, callOpenInterest: 0, putOpenInterest: 0, premium: 0, volume: 0 };
    if (row.optionType === "call") current.callOpenInterest += row.openInterest;
    else current.putOpenInterest += row.openInterest;
    current.premium += row.side === "buy" ? row.premium : -row.premium;
    current.volume += row.volume ?? 0;
    byStrike.set(row.strike, current);
  }
  return {
    engineId: "lios.options-flow.core-v1",
    deterministic: true as const,
    callNetPremium: netPremium("call"),
    putNetPremium: netPremium("put"),
    putCallOpenInterestRatio: callOi > 0 ? putOi / callOi : null,
    strikes: [...byStrike.values()].sort((a, b) => (b.callOpenInterest + b.putOpenInterest) - (a.callOpenInterest + a.putOpenInterest)),
    resultHash: p6Hash(normalized),
  };
}
