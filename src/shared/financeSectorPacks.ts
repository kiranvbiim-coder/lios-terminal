import { FINANCIAL_METRICS, type FinancialMetricDefinition } from "./financialMetricRegistry";

export interface FinanceSectorPack {
  id: string;
  label: string;
  aliases: string[];
  metricIds: string[];
  description: string;
}

const PACKS: FinanceSectorPack[] = [
  { id: "banks", label: "Banks", aliases: ["banking", "bank"], description: "Capital, asset quality, margins, funding, profitability and valuation for banks.", metricIds: ["bank.nim", "bank.casa", "bank.gnpa", "bank.nnpa", "bank.cet1", "bank.car", "bank.costOfRisk", "bank.costIncome", "roe", "roa", "pb", "ptbv"] },
  { id: "insurance", label: "Insurance", aliases: ["life insurance", "general insurance", "p&c"], description: "Premium growth, underwriting quality, solvency and embedded-value economics.", metricIds: ["insurance.gwp", "insurance.combinedRatio", "insurance.lossRatio", "insurance.solvency", "insurance.embeddedValue", "insurance.vnb", "roe", "pb"] },
  { id: "reit", label: "REITs & Real Estate", aliases: ["reit", "real estate"], description: "NOI, FFO/AFFO, NAV, occupancy, cap rates and lease duration.", metricIds: ["reit.noi", "reit.ffo", "reit.affo", "reit.nav", "reit.occupancy", "reit.capRate", "reit.wale", "netDebtEbitda", "dividendYield"] },
  { id: "saas", label: "SaaS & Software", aliases: ["software", "saas"], description: "Recurring revenue, retention, unit economics, growth efficiency and valuation.", metricIds: ["saas.arr", "saas.mrr", "saas.nrr", "saas.grr", "saas.churn", "saas.cac", "saas.ltv", "saas.cacPayback", "saas.ruleOf40", "saas.rpo", "evRevenue", "evRevenueNtm", "fcfMargin", "sbcRevenue"] },
  { id: "energy", label: "Energy / Oil & Gas", aliases: ["energy", "oil", "gas", "e&p"], description: "Production, reserves, realized pricing, cost structure and capital efficiency.", metricIds: ["energy.production", "energy.reserves", "energy.realizedPrice", "energy.liftingCost", "energy.findingDevelopmentCost", "energy.recycleRatio", "evEbitda", "fcfYield", "netDebtEbitda"] },
  { id: "airlines", label: "Airlines", aliases: ["airline", "aviation"], description: "Unit revenue/cost, traffic, capacity and operating leverage.", metricIds: ["airline.rasm", "airline.casm", "airline.loadFactor", "airline.yield", "airline.ask", "airline.rpk", "ebitdaMargin", "netDebtEbitda"] },
  { id: "hotels", label: "Hotels & Hospitality", aliases: ["hotel", "hospitality", "lodging"], description: "Room economics, occupancy and asset-light operating performance.", metricIds: ["hotel.revpar", "hotel.adr", "hotel.occupancy", "ebitdaMargin", "evEbitda"] },
  { id: "telecom", label: "Telecom", aliases: ["telecom", "wireless", "communications"], description: "Subscriber economics, ARPU, churn, leverage and capital intensity.", metricIds: ["telecom.arpu", "telecom.churn", "telecom.subscribers", "capexIntensity", "netDebtEbitda", "fcfYield"] },
  { id: "semiconductors", label: "Semiconductors", aliases: ["semiconductor", "semis", "chips"], description: "Capacity, utilization, pricing, growth and cycle-sensitive margins.", metricIds: ["semis.waferStarts", "semis.utilization", "semis.asp", "grossMargin", "ebitdaMargin", "revenueGrowth", "evEbitda"] },
  { id: "retail", label: "Retail & Consumer", aliases: ["retail", "consumer"], description: "Same-store growth, inventory productivity, margin structure and valuation.", metricIds: ["retail.sameStoreSales", "retail.salesPerSqFt", "retail.inventoryTurns", "grossMargin", "inventoryTurnover", "cashConversionCycle", "pe"] },
  { id: "automotive", label: "Automotive", aliases: ["auto", "automotive", "vehicles"], description: "Volumes, pricing, utilization, margins and capital intensity.", metricIds: ["auto.deliveries", "auto.asp", "auto.utilization", "grossMargin", "ebitMargin", "capexIntensity", "evEbitda"] },
  { id: "mining", label: "Mining & Metals", aliases: ["mining", "metals"], description: "Production, reserve life, sustaining costs and commodity-cycle valuation.", metricIds: ["mining.aisc", "mining.production", "mining.reserveLife", "fcfYield", "netDebtEbitda", "evEbitda"] },
  { id: "shipping", label: "Shipping", aliases: ["shipping", "marine", "tankers", "dry bulk"], description: "Charter economics, fleet utilization, orderbook and balance-sheet cyclicality.", metricIds: ["shipping.tce", "shipping.utilization", "shipping.orderbookFleet", "netDebtEbitda", "fcfYield"] },
  { id: "biotech", label: "Biotech & Life Sciences", aliases: ["biotech", "life sciences", "pharma"], description: "Cash runway, R&D intensity and event-driven financial risk.", metricIds: ["biotech.cashRunway", "biotech.rndIntensity", "cash", "rd", "fcf", "marketCap"] },
  { id: "payments", label: "Payments & Fintech", aliases: ["payments", "fintech"], description: "Payment volume, take-rate economics, transactions and scalable margins.", metricIds: ["payments.tpv", "payments.takeRate", "payments.transactions", "revenueGrowth", "ebitdaMargin", "evRevenue"] },
  { id: "asset-management", label: "Asset Management", aliases: ["asset management", "fund manager"], description: "AUM, flows, fee-rate economics and operating leverage.", metricIds: ["assetMgmt.aum", "assetMgmt.netFlows", "assetMgmt.feeRate", "ebitdaMargin", "pe", "dividendYield"] },
];

const BY_ID = new Map(PACKS.map(pack => [pack.id, pack]));

export const FINANCE_SECTOR_PACKS: readonly FinanceSectorPack[] = PACKS;

export function getFinanceSectorPack(idOrSector: string): FinanceSectorPack | null {
  const exact = BY_ID.get(idOrSector);
  if (exact) return exact;
  const q = idOrSector.trim().toLowerCase();
  return PACKS.find(pack => pack.id === q || pack.label.toLowerCase().includes(q) || pack.aliases.some(alias => q.includes(alias) || alias.includes(q))) ?? null;
}

export function metricsForSectorPack(pack: FinanceSectorPack): FinancialMetricDefinition[] {
  const ids = new Set(pack.metricIds);
  return FINANCIAL_METRICS.filter(metric => ids.has(metric.id));
}

export function inferFinanceSectorPack(sector?: string | null, industry?: string | null): FinanceSectorPack | null {
  const text = `${sector ?? ""} ${industry ?? ""}`.trim().toLowerCase();
  if (!text) return null;
  return PACKS.find(pack => pack.aliases.some(alias => text.includes(alias))) ?? null;
}
