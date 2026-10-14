/**
 * DCF Passport Bridge: connects the existing integrated financial model
 * to the data truth pipeline, generating data passports for inputs and
 * a calculated passport for the DCF output. This is the Phase 9 DCF
 * end-to-end proof — the first engine to produce fully passported,
 * receipt-ready output.
 */
import crypto from "crypto";
import type { FinancialDatasetPayload, CanonicalFinancialPeriod } from "@shared/pointInTimeData";
import type { IntegratedFinancialModelResult, IntegratedModelAssumptions } from "@shared/integratedFinancialModel";
import {
  buildCalculatedPassport,
  buildDataPassport,
  buildPassportEntry,
  type CalculatedPassport,
  type DataPassport,
  type SourceBinding,
} from "@shared/dataTruth";

export interface DcfPassportBundle {
  financialPassport: DataPassport;
  assumptionPassport: DataPassport;
  calculatedPassport: CalculatedPassport;
  decisionReceiptPayload: DcfDecisionReceiptPayload;
}

export interface DcfDecisionReceiptPayload {
  symbol: string;
  engineId: string;
  engineVersion: string;
  calculatedAt: string;
  datasetSnapshotId: string;
  datasetContentHash: string;
  inputHash: string;
  outputHash: string;
  financialPassportId: string;
  assumptionPassportId: string;
  calculatedPassportId: string;
  assumptions: Record<string, unknown>;
  terminalForecastYear: string | null;
  terminalRevenue: number | null;
  terminalEbit: number | null;
  terminalFcff: number | null;
  projectionYears: number;
  deterministic: true;
  limitations: string[];
}

function stableHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function extractFinancialPassportEntries(payload: FinancialDatasetPayload, provider: string) {
  const binding: SourceBinding = {
    contractFamily: "financial_statements",
    field: "",
    connectorId: provider.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
    provider,
    priority: "primary",
  };

  const latestPeriod = payload.periods.at(-1);
  if (!latestPeriod) return [];

  const retrievedAt = latestPeriod.availableAt ?? new Date().toISOString();
  const fields: Array<{ name: string; value: unknown }> = [
    { name: "period", value: `${latestPeriod.fiscalYear}:${latestPeriod.period}` },
    { name: "periodEndDate", value: latestPeriod.periodEnd },
    { name: "currency", value: latestPeriod.currency },
  ];

  const incomeFields = ["revenue", "costOfRevenue", "grossProfit", "operatingIncome", "netIncome",
    "depreciationAndAmortization", "interestExpense", "incomeTaxExpense"] as const;
  for (const field of incomeFields) {
    const val = latestPeriod.income[field];
    if (val != null && Number.isFinite(val)) {
      fields.push({ name: field, value: val });
    }
  }

  const balanceFields = ["totalAssets", "totalLiabilities", "totalStockholdersEquity",
    "cashAndCashEquivalents", "totalDebt", "netReceivables", "inventory",
    "accountPayables", "currentAssets", "currentLiabilities"] as const;
  for (const field of balanceFields) {
    const val = latestPeriod.balance[field];
    if (val != null && Number.isFinite(val)) {
      fields.push({ name: field === "totalStockholdersEquity" ? "totalEquity" : field, value: val });
    }
  }

  const cashflowFields = ["capitalExpenditure", "operatingCashFlow", "freeCashFlow",
    "dividendsPaid"] as const;
  for (const field of cashflowFields) {
    const rawField = field === "capitalExpenditure" ? "investmentsInPropertyPlantAndEquipment" : field;
    const val = latestPeriod.cashflow[rawField] ?? latestPeriod.cashflow[field];
    if (val != null && Number.isFinite(val)) {
      fields.push({ name: field, value: val });
    }
  }

  return fields.map((f) => buildPassportEntry(f.name, f.value, { ...binding, field: f.name }, retrievedAt));
}

export function buildDcfPassportBundle(
  symbol: string,
  payload: FinancialDatasetPayload,
  result: IntegratedFinancialModelResult,
  datasetSnapshotId: string,
  datasetContentHash: string,
  inputHash: string,
  provider: string,
): DcfPassportBundle {
  // 1. Financial data passport
  const financialEntries = extractFinancialPassportEntries(payload, provider);
  const requiredFinancialFields = ["revenue", "operatingIncome", "netIncome", "totalAssets", "totalLiabilities", "totalEquity", "cashAndCashEquivalents"];
  const financialPassport = buildDataPassport("financial_statements", symbol, financialEntries, requiredFinancialFields);

  // 2. Assumptions passport
  const assumptionEntries = Object.entries(result.assumptions).map(([key, value]) =>
    buildPassportEntry(key, value, {
      contractFamily: "assumptions",
      field: key,
      connectorId: "user_assumptions",
      provider: "User/Derived",
      priority: "manual_override",
    }, new Date().toISOString()),
  );
  const assumptionPassport = buildDataPassport("assumptions", symbol, assumptionEntries, ["revenueGrowth", "taxRate"]);

  // 3. Calculated passport
  const terminalForecast = result.forecast.at(-1);
  const outputHash = stableHash({
    symbol: result.symbol,
    forecast: result.forecast,
    checks: result.checks,
    modelVersion: result.modelVersion,
  });

  const calculatedPassport = buildCalculatedPassport(
    "valuation.dcf",
    result.modelVersion,
    [financialPassport, assumptionPassport],
    Object.entries(result.assumptions).map(([key, value]) => ({ key, value, source: "derived_or_manual" })),
    outputHash,
    [
      "Terminal growth rate is assumed constant beyond projection horizon",
      "Circular debt-interest resolution uses iterative convergence",
      "Working capital changes derived from DSO/DIO/DPO ratios",
    ],
  );

  // 4. Decision receipt payload
  const decisionReceiptPayload: DcfDecisionReceiptPayload = {
    symbol,
    engineId: "valuation.dcf",
    engineVersion: result.modelVersion,
    calculatedAt: new Date().toISOString(),
    datasetSnapshotId,
    datasetContentHash,
    inputHash,
    outputHash,
    financialPassportId: financialPassport.id,
    assumptionPassportId: assumptionPassport.id,
    calculatedPassportId: calculatedPassport.id,
    assumptions: result.assumptions,
    terminalForecastYear: terminalForecast?.fiscalYear ?? null,
    terminalRevenue: terminalForecast?.income.revenue ?? null,
    terminalEbit: terminalForecast?.income.ebit ?? null,
    terminalFcff: terminalForecast?.cashflow.fcff ?? null,
    projectionYears: result.forecast.length,
    deterministic: true,
    limitations: calculatedPassport.limitations,
  };

  return {
    financialPassport,
    assumptionPassport,
    calculatedPassport,
    decisionReceiptPayload,
  };
}
