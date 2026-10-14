import { createRoot } from "react-dom/client";
import { useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import QuotePanel from "@/components/panels/QuotePanel";
import EconomicsOverviewPanel from "@/components/panels/EconomicsOverviewPanel";
import QuantWorkbenchPanel from "@/components/panels/QuantWorkbenchPanel";
import "./terminalStyles";

type SmokeCase = "quote" | "economics" | "quant";

const STATUS = {
  provider: "visual-smoke-fixture",
  freshness: "current",
  asOf: "2026-09-10T09:30:00.000Z",
  delayLabel: "Deterministic fixture",
  isFallback: false,
};

const quote = {
  symbol: "NVDA",
  name: "NVIDIA Corporation",
  price: 187.14,
  change: 4.04,
  changePercent: 2.21,
  volume: 167_300_000,
  marketCap: 4_570_000_000_000,
  pe: 44.8,
  eps: 4.18,
  revenue: 165_200_000_000,
  high52: 196.82,
  low52: 86.62,
  open: 184.3,
  previousClose: 183.1,
  dayHigh: 189.42,
  dayLow: 182.98,
  avgVolume: 151_000_000,
  exchange: "NASDAQ",
  sector: "Technology",
  quoteSource: "visual-smoke-fixture",
  isLive: true,
  status: STATUS,
  currency: "USD",
};

const peers = [
  { ...quote, symbol: "AMD", name: "Advanced Micro Devices", price: 164.22, change: 1.8, changePercent: 1.11, marketCap: 266_000_000_000 },
  { ...quote, symbol: "AVGO", name: "Broadcom", price: 337.55, change: -1.4, changePercent: -0.41, marketCap: 1_590_000_000_000 },
  { ...quote, symbol: "TSM", name: "Taiwan Semiconductor", price: 251.18, change: 2.1, changePercent: 0.84, marketCap: 1_300_000_000_000 },
];

const ohlcv = {
  bars: Array.from({ length: 90 }, (_, index) => {
    const day = new Date(Date.UTC(2026, 5, 1 + index));
    const close = 148 + index * 0.42 + Math.sin(index / 4.7) * 5.2 + Math.cos(index / 9.3) * 2.1;
    return {
      date: day.toISOString().slice(0, 10),
      open: close - 0.7,
      high: close + 2.1,
      low: close - 2.3,
      close,
      volume: 130_000_000 + index * 320_000,
    };
  }),
  status: STATUS,
  supportsIntraday: false,
};

const fundamentals = {
  symbol: "NVDA",
  marketCap: 4_570_000_000_000,
  trailingPE: 44.8,
  forwardPE: 31.6,
  trailingEps: 4.18,
  forwardEps: 5.92,
  priceToBook: 36.2,
  dividendYield: 0.03,
  beta: 2.08,
  totalRevenue: 165_200_000_000,
  profitMargins: 55.8,
  revenueGrowth: 56.1,
  fiftyTwoWeekHigh: 196.82,
  fiftyTwoWeekLow: 86.62,
  sharesOutstanding: 24_400_000_000,
  bookValue: 5.17,
  returnOnEquity: 115.6,
  debtToEquity: 12.8,
  sector: "Technology",
  industry: "Semiconductors",
  longName: "NVIDIA Corporation",
  currency: "USD",
};

const news = [
  {
    title: "Accelerator demand remains firm into the next infrastructure cycle",
    summary: "Deterministic fixture used to validate dense evidence rows and narrow-pane behavior.",
    url: "https://example.invalid/nvda-demand",
    source: "Fixture Wire",
    feedProvider: "visual-smoke-fixture",
    publishedAt: "2026-09-10T09:05:00.000Z",
    sentiment: "positive" as const,
    status: STATUS,
  },
  {
    title: "Semiconductor supply chain capacity expands",
    summary: "Second deterministic fixture for the recent-evidence scan structure.",
    url: "https://example.invalid/supply",
    source: "Fixture Wire",
    feedProvider: "visual-smoke-fixture",
    publishedAt: "2026-09-10T08:40:00.000Z",
    sentiment: "neutral" as const,
    status: STATUS,
  },
];

function metric(label: string, value: number, prev: number, unit: string) {
  return { label, value, prev, unit };
}

const economics = {
  gdp: metric("REAL GDP", 3.1, 2.8, "%"),
  cpi: metric("CPI", 2.7, 2.8, "%"),
  unemployment: metric("UNEMPLOYMENT", 4.2, 4.1, "%"),
  fedFunds: metric("FED FUNDS", 4.25, 4.5, "%"),
  t10y: metric("US 10Y", 4.08, 4.03, "%"),
  t2y: metric("US 2Y", 3.72, 3.68, "%"),
  t30y: metric("US 30Y", 4.69, 4.66, "%"),
  dolllarIndex: metric("DXY", 98.22, 98.51, ""),
  eurUsd: metric("EUR/USD", 1.1728, 1.1694, ""),
  gbpUsd: metric("GBP/USD", 1.3542, 1.3511, ""),
  usdJpy: metric("USD/JPY", 147.42, 147.91, ""),
  gold: metric("GOLD", 3624.5, 3607.8, "USD"),
  oil: metric("WTI", 63.18, 64.01, "USD"),
  status: STATUS,
};

const calendar = [
  ["cpi", 101, "Consumer Price Index", "inflation", "high", "2026-09-11", "07:30"],
  ["claims", 102, "Initial Jobless Claims", "labor", "medium", "2026-09-11", "07:30"],
  ["ppi", 103, "Producer Price Index", "inflation", "high", "2026-09-12", "07:30"],
  ["retail", 104, "Retail Sales", "consumption", "high", "2026-09-15", "07:30"],
  ["fomc", 105, "Federal Funds Decision", "policy", "high", "2026-09-16", "13:00"],
].map(([id, releaseId, title, category, importance, date, timeCt]) => ({
  id: String(id),
  releaseId: Number(releaseId),
  title: String(title),
  category,
  importance,
  date: String(date),
  timeCt: String(timeCt),
  releaseUrl: "https://example.invalid/economics",
  status: STATUS,
}));

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(raw, window.location.origin);

  if (url.pathname === "/api/finance/quotes") return jsonResponse([quote]);
  if (url.pathname === "/api/finance/peers") return jsonResponse(peers);
  if (url.pathname === "/api/finance/ohlcv") return jsonResponse(ohlcv);
  if (url.pathname === "/api/finance/fundamentals") return jsonResponse(fundamentals);
  if (url.pathname === "/api/finance/news") return jsonResponse(news);
  if (url.pathname === "/api/finance/economics") return jsonResponse(economics);
  if (url.pathname === "/api/finance/economics/calendar") return jsonResponse(calendar);

  console.warn("Analytical visual smoke received unhandled fetch", url.pathname, init?.method || "GET");
  return originalFetch(input, init);
};

class SmokeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(_url: string | URL) {
    queueMicrotask(() => this.onopen?.());
  }
  close() { this.onclose?.(); }
  send() {}
}
(window as unknown as { WebSocket: typeof WebSocket }).WebSocket = SmokeWebSocket as unknown as typeof WebSocket;

document.documentElement.classList.add("dark");
document.documentElement.setAttribute("data-theme", "dark");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

function Surface({ smokeCase }: { smokeCase: SmokeCase }) {
  if (smokeCase === "economics") return <EconomicsOverviewPanel onOpenCalendar={() => {}} />;
  if (smokeCase === "quant") return <QuantWorkbenchPanel />;
  return <QuotePanel symbol="NVDA" onNav={() => {}} />;
}

function Harness() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const requested = params.get("case");
  const smokeCase: SmokeCase = requested === "economics" || requested === "quant" ? requested : "quote";
  return (
    <QueryClientProvider client={queryClient}>
      <main className="terminal-root h-screen w-screen overflow-hidden bg-[#050505]" data-density="standard" data-text-scale="normal" data-analytical-smoke-root data-smoke-case={smokeCase}>
        <Surface smokeCase={smokeCase} />
      </main>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
