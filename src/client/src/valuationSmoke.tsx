import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InstitutionalValuationPanel from "@/components/panels/InstitutionalValuationPanel";
import "./terminalStyles";

const STATUS = {
  provider: "valuation-smoke-fixture",
  freshness: "current",
  asOf: "2026-09-08T20:00:00.000Z",
  delayLabel: "Deterministic fixture",
  isFallback: false,
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

const quote = {
  symbol: "AAPL",
  name: "Apple Inc.",
  price: 316.22,
  change: -3.74,
  changePercent: -1.17,
  volume: 35_423_000,
  marketCap: 4_783_000_000_000,
  pe: 37.2,
  eps: 8.5,
  revenue: 416_160_000_000,
  high52: 320.70,
  low52: 169.21,
  open: 317.10,
  previousClose: 319.96,
  dayHigh: 320.70,
  dayLow: 314.90,
  avgVolume: 42_000_000,
  exchange: "NASDAQ",
  sector: "Technology",
  quoteSource: "valuation-smoke-fixture",
  isLive: true,
  status: STATUS,
  currency: "USD",
};

const fundamentals = {
  symbol: "AAPL",
  marketCap: quote.marketCap,
  trailingPE: 37.2,
  forwardPE: 31.4,
  trailingEps: 8.5,
  forwardEps: 10.1,
  priceToBook: 47.2,
  dividendYield: 0.45,
  beta: 1.1,
  totalRevenue: 416_160_000_000,
  profitMargins: 0.269,
  revenueGrowth: 0.064,
  fiftyTwoWeekHigh: 320.70,
  fiftyTwoWeekLow: 169.21,
  sharesOutstanding: 15_127_000_000,
  bookValue: 6.68,
  returnOnEquity: 1.51,
  debtToEquity: 1.34,
  sector: "Technology",
  industry: "Computers/Peripherals",
  longName: "Apple Inc.",
  currency: "USD",
};

const income2025 = {
  ebit: 133_000_000_000,
  revenue: 416_160_000_000,
  netIncome: 112_000_000_000,
  costOfRevenue: 239_000_000_000,
  grossProfit: 177_160_000_000,
  operatingIncome: 133_000_000_000,
  interestExpense: 4_100_000_000,
  sellingGeneralAdministrative: 28_000_000_000,
  depreciationAndAmortization: 12_500_000_000,
  incomeTaxExpense: 31_000_000_000,
  incomeBeforeTax: 143_000_000_000,
};
const income2024 = { ...income2025, revenue: 391_000_000_000, ebit: 123_000_000_000, operatingIncome: 123_000_000_000, netIncome: 101_000_000_000, costOfRevenue: 225_000_000_000, grossProfit: 166_000_000_000, depreciationAndAmortization: 11_500_000_000, incomeTaxExpense: 28_000_000_000, incomeBeforeTax: 132_000_000_000 };

const balance2025 = {
  totalCurrentAssets: 152_000_000_000,
  totalCurrentLiabilities: 168_000_000_000,
  totalAssets: 377_000_000_000,
  retainedEarnings: -19_000_000_000,
  totalLiabilities: 274_000_000_000,
  longTermDebt: 86_000_000_000,
  cashAndCashEquivalents: 34_000_000_000,
  netReceivables: 36_000_000_000,
  inventory: 7_300_000_000,
  propertyPlantEquipmentNet: 48_000_000_000,
  totalStockholdersEquity: 103_000_000_000,
  shortTermDebt: 12_000_000_000,
  accountPayables: 69_000_000_000,
};
const balance2024 = { ...balance2025, netReceivables: 33_000_000_000, inventory: 6_900_000_000, accountPayables: 66_000_000_000, propertyPlantEquipmentNet: 45_000_000_000, totalStockholdersEquity: 98_000_000_000 };

const cashflow2025 = {
  operatingCashFlow: 137_000_000_000,
  netCommonStockIssuance: -91_000_000_000,
  capitalExpenditure: -10_800_000_000,
  freeCashFlow: 126_200_000_000,
};

function financialRows(reportType: string) {
  const common = { symbol: "AAPL", report_type: reportType, period: "FY", reported_currency: "USD", filing_date: "2025-11-01", data_source: "valuation-smoke-fixture", status: STATUS };
  if (reportType === "income") return [
    { ...common, date: "2025-09-27", fiscal_year: "2025", data: JSON.stringify(income2025) },
    { ...common, date: "2024-09-28", fiscal_year: "2024", data: JSON.stringify(income2024) },
  ];
  if (reportType === "balance") return [
    { ...common, date: "2025-09-27", fiscal_year: "2025", data: JSON.stringify(balance2025) },
    { ...common, date: "2024-09-28", fiscal_year: "2024", data: JSON.stringify(balance2024) },
  ];
  if (reportType === "cashflow") return [
    { ...common, date: "2025-09-27", fiscal_year: "2025", data: JSON.stringify(cashflow2025) },
  ];
  return [];
}

class NoopWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = NoopWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  addEventListener() {}
  removeEventListener() {}
  send() {}
  close() { this.readyState = NoopWebSocket.CLOSED; }
}
Object.assign(window, { WebSocket: NoopWebSocket });

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(raw, window.location.origin);
  if (url.pathname === "/api/finance/quotes") return jsonResponse([quote]);
  if (url.pathname === "/api/finance/fundamentals") return jsonResponse(fundamentals);
  if (url.pathname === "/api/lse/financials/AAPL") return jsonResponse(financialRows(url.searchParams.get("reportType") || "income"));
  if (url.pathname === "/api/economics/indicator/DGS20") return jsonResponse({
    quote: { seriesId: "DGS20", name: "Market Yield on U.S. Treasury Securities at 20-Year Constant Maturity", unit: "%", value: 4.55, previousValue: 4.53, change: 0.02, changePercent: 0.44, asOf: "2026-09-08", isLive: true },
    history: [{ date: "2026-09-05", value: 4.53 }, { date: "2026-09-08", value: 4.55 }],
    provenance: { provider: "FRED fixture", sourceReference: "DGS20", status: "live" },
  });
  if (url.pathname === "/api/economics/indicator/DGS3MO") return jsonResponse({
    quote: { seriesId: "DGS3MO", name: "3-Month Treasury", unit: "%", value: 4.20, previousValue: 4.19, change: 0.01, changePercent: 0.24, asOf: "2026-09-08", isLive: true },
    history: [{ date: "2026-09-05", value: 4.19 }, { date: "2026-09-08", value: 4.20 }],
    provenance: { provider: "FRED fixture", sourceReference: "DGS3MO", status: "live" },
  });
  if (url.pathname.startsWith("/api/quant/damodaran/industries/")) return jsonResponse({
    industry: "Computers/Peripherals",
    numberOfFirms: 48,
    beta: 1.08,
    unleveredBeta: 0.93,
    unleveredBetaCorrectedForCash: 0.98,
    debtToEquity: 18.4,
    costOfEquityPct: 10.2,
    afterTaxCostOfDebtPct: 4.8,
    wacc: 8.91,
  });
  if (url.pathname === "/api/quant/challenge-assumption" && init?.method === "POST") return jsonResponse({ note: "Growth is the dominant assumption in this test. Validate it against unit growth, pricing, addressable-market maturity and reinvestment capacity before relying on the base case." });
  return jsonResponse({ error: `Unhandled valuation smoke route: ${url.pathname}` }, 404);
};

document.documentElement.classList.add("dark");
document.documentElement.setAttribute("data-theme", "dark");

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

function Harness() {
  return (
    <div className="terminal-root h-screen w-screen overflow-hidden bg-[#050505]" data-density="standard" data-text-scale="normal" data-visual-smoke-ready="true">
      <InstitutionalValuationPanel symbol="AAPL" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <Harness />
  </QueryClientProvider>,
);
