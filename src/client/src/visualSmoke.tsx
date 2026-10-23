import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MarketOverview from "@/components/panels/MarketOverview";
import MarketBreadthPanel from "@/components/panels/MarketBreadthPanel";
import NewsPanel from "@/components/panels/NewsPanel";
import WatchlistPanel from "@/components/panels/WatchlistPanel";
import DockviewWorkspaceGrid from "@/components/terminal/DockviewWorkspaceGrid";
import WorkspacePanel from "@/components/panels/WorkspacePanel";
import VisualCanvas from "@/components/terminal/VisualCanvas";
import { DEFAULT_TERMINAL_UX_PREFERENCES } from "@/lib/terminalUxPreferences";
import { DOCKVIEW_LAYOUT_STORAGE_KEY } from "@/lib/dockviewWorkspaceState";
import { dispatchVisualContext } from "@/lib/visualEnvironment";
import type { PaneId, PaneState, WorkspaceState } from "@/lib/terminalTypes";
import "./terminalStyles";

type SmokeCase =
  | "market"
  | "breadth"
  | "news"
  | "watchlist"
  | "layout-2"
  | "layout-3"
  | "layout-4"
  | "workbench-real"
  | "workbench-real-narrow"
  | "project-home"
  | "conversation"
  | "conversation-artifact"
  | "workspace-focus";
type Density = "terminal" | "compact" | "standard" | "comfortable";

const STATUS = {
  provider: "Limuria Intelligence",
  freshness: "current",
  asOf: "2026-09-09T05:00:00.000Z",
  delayLabel: "Current session",
  isFallback: false,
};

const QUOTE_BASE = [
  ["AAPL", "Apple Inc.", 238.42, 1.36, 3_120_000_000_000, 51_900_000],
  ["MSFT", "Microsoft Corp.", 516.77, 0.84, 3_840_000_000_000, 22_800_000],
  ["NVDA", "NVIDIA Corp.", 187.14, 2.21, 4_570_000_000_000, 167_300_000],
  ["AMZN", "Amazon.com Inc.", 229.85, -0.63, 2_440_000_000_000, 38_400_000],
  ["META", "Meta Platforms", 748.31, 1.11, 1_890_000_000_000, 14_900_000],
  ["JPM", "JPMorgan Chase", 311.08, -0.24, 852_000_000_000, 9_300_000],
] as const;

function makeQuote(symbol: string, index = 0) {
  const row = QUOTE_BASE.find(([candidate]) => candidate === symbol) ?? QUOTE_BASE[index % QUOTE_BASE.length];
  const [, name, price, changePercent, marketCap, volume] = row;
  const change = price * (changePercent / 100);
  return {
    symbol,
    name: symbol.startsWith("^") ? `${symbol} Index` : name,
    price,
    change,
    changePercent,
    volume,
    marketCap,
    pe: 29.7,
    eps: 7.14,
    revenue: 420_000_000_000,
    high52: price * 1.08,
    low52: price * 0.72,
    open: price - change * 0.35,
    previousClose: price - change,
    dayHigh: price * 1.006,
    dayLow: price * 0.992,
    avgVolume: volume * 0.9,
    exchange: "NASDAQ",
    sector: "Technology",
    quoteSource: "visual-smoke-fixture",
    isLive: true,
    status: STATUS,
    currency: "USD",
  };
}

const BREADTH_SERIES = Array.from({ length: 28 }, (_, index) => {
  const day = String(index + 1).padStart(2, "0");
  const net = Math.round(Math.sin(index / 3.2) * 48 + 18);
  return {
    date: `2026-08-${day}`,
    advances: 320 + Math.max(net, 0),
    declines: 170 + Math.max(-net, 0),
    unchanged: 10,
    netAdvances: net,
    advanceDeclineLine: 820 + index * 18 + Math.sin(index / 2.5) * 90,
    newHighs: 34 + Math.round(Math.max(0, Math.sin(index / 4) * 18)),
    newLows: 12 + Math.round(Math.max(0, -Math.sin(index / 4) * 8)),
    mcClellanOscillator: Math.sin(index / 3.6) * 72 + 14,
  };
});

const NEWS_ITEMS = [
  {
    title: "Apple supplier checks point to resilient premium-device demand",
    summary: "Channel data remains constructive while investors watch component lead times and launch-mix assumptions.",
    url: "https://example.invalid/apple-demand",
    source: "Reuters",
    feedProvider: "fixture",
    publishedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
    sentiment: "positive",
    status: STATUS,
  },
  {
    title: "Treasury yields edge higher as markets reassess the policy path",
    summary: "Rates moved modestly higher with the front end reacting most to revised expectations for the next policy meetings.",
    url: "https://example.invalid/rates",
    source: "Bloomberg",
    feedProvider: "fixture",
    publishedAt: new Date(Date.now() - 42 * 60_000).toISOString(),
    sentiment: "neutral",
    status: STATUS,
  },
  {
    title: "Semiconductor shares outperform on renewed accelerator demand",
    summary: "Large-cap chip names led the tape after another round of stronger infrastructure spending commentary.",
    url: "https://example.invalid/chips",
    source: "Financial Times",
    feedProvider: "fixture",
    publishedAt: new Date(Date.now() - 67 * 60_000).toISOString(),
    sentiment: "positive",
    status: STATUS,
  },
  {
    title: "Energy complex softens as near-term inventory expectations rise",
    summary: "Crude prices eased and energy equities lagged as traders positioned for a less supportive inventory print.",
    url: "https://example.invalid/energy",
    source: "Reuters",
    feedProvider: "fixture",
    publishedAt: new Date(Date.now() - 94 * 60_000).toISOString(),
    sentiment: "negative",
    status: STATUS,
  },
];

const WORKSPACE_FIXTURE = {
  id: "visual-smoke-workspace",
  name: "Apple Research",
  clientName: "Limuria Demo",
  description: "Deterministic workspace fixture for real Dockview shell acceptance.",
  symbols: ["AAPL", "MSFT"],
  tags: ["valuation", "research"],
  pinned: true,
  archived: false,
  createdByUserId: 1,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-27T05:00:00.000Z",
};

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

  if (url.pathname === "/api/workspaces") {
    if (init?.method === "POST") return jsonResponse(WORKSPACE_FIXTURE);
    return jsonResponse([WORKSPACE_FIXTURE]);
  }
  if (url.pathname === `/api/workspaces/${WORKSPACE_FIXTURE.id}`) return jsonResponse(WORKSPACE_FIXTURE);
  if (url.pathname === `/api/uide/workspace-imports/${WORKSPACE_FIXTURE.id}`) return jsonResponse([]);
  if (url.pathname === `/api/workspaces/${WORKSPACE_FIXTURE.id}/snapshots`) return jsonResponse([]);

  if (url.pathname === "/api/watchlist") {
    if (init?.method === "POST") return jsonResponse({ ok: true });
    return jsonResponse(QUOTE_BASE.map(([symbol, name], index) => ({ id: index + 1, userId: 1, symbol, name })));
  }
  if (url.pathname.startsWith("/api/watchlist/") && init?.method === "DELETE") return jsonResponse({ ok: true });

  if (url.pathname === "/api/finance/quotes") {
    const symbols = (url.searchParams.get("symbols") || "").split(",").filter(Boolean);
    return jsonResponse(symbols.map((symbol, index) => makeQuote(symbol, index)));
  }

  if (url.pathname === "/api/finance/sparklines") {
    const symbols = ["^NSEI", "^BSESN", "^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX", "^N225", "^HSI", "^FTSE", "^GDAXI"];
    return jsonResponse(Object.fromEntries(symbols.map((symbol, seed) => [symbol, Array.from({ length: 22 }, (_, i) => 100 + seed * 3 + Math.sin((i + seed) / 3) * 4 + i * 0.28)])));
  }

  if (url.pathname === "/api/finance/directory") {
    const items = QUOTE_BASE.map(([symbol, name], index) => ({
      symbol,
      name,
      exchange: index < 5 ? "NASDAQ" : "NYSE",
      sector: index < 5 ? "Technology" : "Financial Services",
      assetClass: "equity",
      region: "US",
    }));
    return jsonResponse({ items, total: items.length, page: 1, totalPages: 1 });
  }

  if (url.pathname === "/api/finance/breadth") {
    return jsonResponse({
      universeSize: 500,
      series: BREADTH_SERIES,
      latest: {
        date: "2026-09-08",
        advances: 347,
        declines: 141,
        unchanged: 12,
        newHighs: 48,
        newLows: 17,
        armsIndex: 0.81,
        mcClellanOscillator: 58.4,
      },
      putCallRatio: null,
    });
  }

  if (url.pathname === "/api/finance/news") {
    return jsonResponse({ items: NEWS_ITEMS, returnedCount: NEWS_ITEMS.length, knownCount: 78, hasMore: true, page: 1 });
  }

  if (url.pathname === "/api/finance/news/read") {
    const requested = NEWS_ITEMS.find((item) => item.url === url.searchParams.get("url")) ?? NEWS_ITEMS[0];
    return jsonResponse({
      title: requested.title,
      source: requested.source,
      feedProvider: requested.feedProvider,
      url: requested.url,
      publishedAt: requested.publishedAt,
      excerpt: requested.summary,
      content: [
        "The read-through keeps the original source context visible while preserving a dense analytical workspace. This fixture is deterministic and contains no production market claim.",
        "The purpose of this visual smoke surface is to verify hierarchy, resizing, information density, and evidence context at desktop scale before merge.",
        "Object, source, sentiment, and age remain visible beside the story so analysts can maintain context while scanning supporting evidence.",
      ],
      status: STATUS,
    });
  }

  if (url.pathname === "/api/finance/gainers" || url.pathname === "/api/finance/losers" || url.pathname === "/api/finance/active") {
    return jsonResponse(QUOTE_BASE.slice(0, 5).map(([symbol], index) => makeQuote(symbol, index)));
  }

  if (url.pathname === "/api/finance/sentiment") return jsonResponse({ sentiment: "Bullish", score: 64, bullish: 64, bearish: 36 });

  console.warn("Visual smoke harness received unhandled fetch", url.pathname);
  return originalFetch(input, init);
};

class SmokeWebSocket {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(_url: string | URL) {}
  close() { this.onclose?.(); }
  send() {}
}
(window as unknown as { WebSocket: typeof WebSocket }).WebSocket = SmokeWebSocket as unknown as typeof WebSocket;

try {
  localStorage.removeItem(DOCKVIEW_LAYOUT_STORAGE_KEY);
  localStorage.removeItem("limuria.activeWorkspaceId");
} catch {
  // Visual smoke must remain deterministic even in hardened/private storage contexts.
}

document.documentElement.classList.add("dark");
document.documentElement.setAttribute("data-theme", "dark");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

function PlaceholderPane({ paneId, pane }: { paneId: PaneId; pane: PaneState }) {
  const metric = paneId === "primary" ? "$516.77" : paneId === "secondary" ? "+1.36%" : paneId === "tertiary" ? "0.81" : "58.4";
  return (
    <div className="h-full bg-[#050505] p-4" data-analytical-role="output">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="panel-label">{pane.view.toUpperCase()}</span>
        <span className="font-terminal text-[8px] text-muted-foreground">{paneId.toUpperCase()}</span>
      </div>
      <div className="mt-5 font-terminal text-[8px] tracking-[0.18em] text-muted-foreground">ACTIVE OBJECT</div>
      <div className="mt-1 font-terminal text-xl text-amber-300">{pane.symbol || "GLOBAL"}</div>
      <div className="mt-6 grid grid-cols-2 gap-2">
        <div className="border border-border bg-[#0a0a0a] p-3">
          <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">PRIMARY SIGNAL</div>
          <div className="mt-2 font-terminal text-lg text-foreground">{metric}</div>
        </div>
        <div className="border border-border bg-[#0a0a0a] p-3">
          <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">CONTEXT</div>
          <div className="mt-2 font-terminal text-[9px] leading-relaxed text-cyan-300">LINKED ANALYTICAL PANE</div>
        </div>
      </div>
      <div className="mt-3 h-28 border border-border bg-[linear-gradient(180deg,rgba(255,182,39,.08),rgba(0,0,0,0))] p-3">
        <div className="h-full w-full border-b border-l border-border/70 opacity-80" />
      </div>
    </div>
  );
}

function layoutFor(count: 2 | 3 | 4): WorkspaceState {
  return {
    primary: { view: "quote", symbol: "MSFT" },
    secondary: { view: "news", symbol: "MSFT" },
    tertiary: count >= 3 ? { view: "marketbreadth", symbol: "" } : null,
    quaternary: count >= 4 ? { view: "watchlist", symbol: "MSFT" } : null,
    focusedPane: "primary",
  };
}

function LayoutCase({ count, density }: { count: 2 | 3 | 4; density: Density }) {
  const workspace = useMemo(() => layoutFor(count), [count]);
  return (
    <DockviewWorkspaceGrid
      workspace={workspace}
      isMobile={false}
      maximizedPane={null}
      onFocus={() => {}}
      onClose={() => {}}
      onToggleMaximize={() => {}}
      onOpenActions={() => {}}
      renderPane={(paneId, pane) => <PlaceholderPane paneId={paneId} pane={pane} />}
      density={density}
    />
  );
}

function RealWorkbenchCase({ density, narrow = false }: { density: Density; narrow?: boolean }) {
  const workspace = useMemo<WorkspaceState>(() => ({
    primary: { view: "workspaces", symbol: "AAPL" },
    secondary: { view: "valuation", symbol: "AAPL" },
    tertiary: narrow ? { view: "news", symbol: "AAPL" } : null,
    quaternary: narrow ? { view: "advancedrisk", symbol: "AAPL" } : null,
    focusedPane: "primary",
  }), [narrow]);

  return (
    <section
      className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#050505] ${narrow ? "mx-auto w-[1000px] max-w-full" : ""}`}
      data-real-workbench-smoke="true"
      data-workbench-narrow={narrow ? "true" : "false"}
    >
      <div className="flex h-8 shrink-0 items-center border-b border-border bg-[#070707] px-3">
        <span className="font-terminal text-[7px] tracking-[0.16em] text-muted-foreground">CANONICAL WORKBENCH · REAL DOCKVIEW</span>
        <span className="ml-auto font-terminal text-[7px] text-cyan-300">{narrow ? "AAPL · FOUR PANE · NARROW" : "AAPL · TWO PANE"}</span>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <DockviewWorkspaceGrid
          workspace={workspace}
          isMobile={false}
          maximizedPane={null}
          onFocus={() => {}}
          onClose={() => {}}
          onToggleMaximize={() => {}}
          onOpenActions={() => {}}
          renderPane={(paneId, pane) => pane.view === "workspaces"
            ? <WorkspacePanel onSymbol={() => {}} onNav={() => {}} />
            : <PlaceholderPane paneId={paneId} pane={pane} />}
          density={density}
        />
      </div>
    </section>
  );
}

function ProjectRailFixture() {
  return (
    <aside className="w-[260px] shrink-0 border-r border-border/70 bg-[#070707]/95 p-3">
      <div className="font-ui text-[10px] font-semibold text-foreground">Projects</div>
      <div className="mt-3 rounded-md border border-border/60 bg-black/25 px-2.5 py-2 font-ui text-[8px] text-muted-foreground">Search projects…</div>
      <div className="mt-4 space-y-1.5">
        {["Apple Research", "Global Macro", "Portfolio Risk"].map((name, index) => (
          <div key={name} className={`rounded-md px-2.5 py-2 font-ui text-[8px] ${index === 0 ? "border border-amber-300/20 bg-amber-300/[0.04] text-foreground" : "text-muted-foreground"}`}>
            {name}
          </div>
        ))}
      </div>
    </aside>
  );
}

function ComposerFixture({ label = "Ask LiOS… use @ for Project context or / for tools" }: { label?: string }) {
  return (
    <div className="lios-conversation-composer rounded-xl border border-border/70 bg-[#090909]/90 shadow-2xl">
      <div className="px-4 py-4 font-ui text-[9px] text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2 border-t border-border/40 px-3 py-2">
        <span className="rounded border border-border/50 px-2 py-1 font-terminal text-[6px] text-muted-foreground">DETERMINISTIC FIRST</span>
        <span className="ml-auto font-terminal text-[6px] text-muted-foreground">ENTER SEND</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400 font-ui text-[9px] font-semibold text-black">↑</span>
      </div>
    </div>
  );
}

function UxFlagshipCase({ mode }: { mode: "project-home" | "conversation" | "conversation-artifact" | "workspace-focus" }) {
  useEffect(() => {
    dispatchVisualContext({
      projectId: "visual-smoke-apple",
      projectName: "Apple Research",
      intensity: mode === "project-home" ? "immersive" : mode === "workspace-focus" ? "focus" : "contextual",
      semanticContext: "company",
    });
  }, [mode]);

  const focus = mode === "workspace-focus";
  const artifact = mode === "conversation-artifact";

  return (
    <main className="relative h-full overflow-hidden bg-transparent" data-visual-host="true" data-ux-flagship-smoke={mode}>
      <VisualCanvas
        surface={focus ? "workbench" : "projects"}
        activeView={focus ? "valuation" : "research"}
        focusMode={focus}
        presentationMode={false}
        preferences={DEFAULT_TERMINAL_UX_PREFERENCES}
      />
      <div className="relative z-[1] flex h-full min-h-0">
        <ProjectRailFixture />
        {focus ? (
          <section className="min-w-0 flex-1 bg-[#050505]/90 p-3">
            <div className="mb-3 flex items-center justify-between border-b border-border/60 pb-2">
              <div>
                <div className="font-ui text-[11px] font-semibold text-foreground">Apple Research · Valuation Workspace</div>
                <div className="mt-1 font-terminal text-[6px] text-muted-foreground">FOCUS MODE · LINKED CONTEXT · SESSION RESTORABLE</div>
              </div>
              <span className="rounded border border-amber-300/20 px-2 py-1 font-terminal text-[6px] text-amber-200">AAPL</span>
            </div>
            <div className="grid h-[calc(100%_-_52px)] grid-cols-2 grid-rows-2 gap-2">
              {[
                ["FINANCIALS", "Revenue · Margin · FCF"],
                ["VALUATION", "DCF · Base / Bull / Bear"],
                ["PEERS", "Multiples · Growth · Quality"],
                ["RISK", "Sensitivity · Downside · Stress"],
              ].map(([title, detail]) => (
                <section key={title} className="border border-border/70 bg-[#080808] p-3">
                  <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">{title}</div>
                  <div className="mt-4 font-ui text-[12px] font-semibold text-foreground">{detail}</div>
                  <div className="mt-6 h-20 border-b border-l border-border/70 bg-[linear-gradient(180deg,rgba(246,159,10,.07),transparent)]" />
                </section>
              ))}
            </div>
          </section>
        ) : (
          <section className="min-w-0 flex-1 overflow-hidden bg-transparent">
            {mode === "project-home" ? (
              <div className="mx-auto flex h-full max-w-5xl flex-col justify-center px-8 pb-14">
                <div className="max-w-3xl">
                  <div className="font-terminal text-[7px] uppercase tracking-[0.22em] text-amber-200/80">Project · Company Intelligence</div>
                  <h1 className="mt-3 font-ui text-3xl font-semibold tracking-tight text-foreground">Apple Research</h1>
                  <p className="mt-3 max-w-2xl font-ui text-[10px] leading-5 text-muted-foreground">A calm conversational entry into research, sources, models and persistent analytical work.</p>
                </div>
                <div className="mt-8 max-w-3xl">
                  <ComposerFixture label="Ask LiOS inside this Project" />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {["Research a company and show what changed", "Build a valuation", "Analyze downside scenarios", "Create a decision-ready memo"].map((action) => (
                      <span key={action} className="rounded-full border border-border/55 bg-black/25 px-3 py-1.5 font-ui text-[7px] text-muted-foreground">{action}</span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-0">
                <section className="flex min-w-0 flex-1 flex-col">
                  <header className="border-b border-border/60 bg-[#070707]/70 px-5 py-3">
                    <div className="font-ui text-[10px] font-semibold text-foreground">Apple Research · Earnings change analysis</div>
                    <div className="mt-1 font-terminal text-[6px] text-muted-foreground">CONTEXTUAL · COMPANY INTELLIGENCE · GOVERNED SOURCES</div>
                  </header>
                  <div className="flex-1 space-y-4 overflow-hidden px-7 py-5">
                    <div className="ml-auto max-w-[70%] rounded-xl border border-border/60 bg-white/[0.025] px-4 py-3 font-ui text-[9px] leading-5 text-foreground">Research Apple and tell me what changed since the last earnings release.</div>
                    <div className="max-w-[78%] rounded-xl border border-border/60 bg-[#080808]/90 px-4 py-3">
                      <div className="font-terminal text-[6px] uppercase tracking-wider text-cyan-200/70">Observed sources · deterministic calculations</div>
                      <div className="mt-2 font-ui text-[9px] leading-5 text-foreground">Revenue growth held up, services mix improved, and the valuation case is most sensitive to long-run margin and terminal growth assumptions.</div>
                      <div className="mt-3 flex gap-2">
                        {["Open model", "Compare peers", "Inspect source"].map((action) => <span key={action} className="rounded border border-border/50 px-2 py-1 font-ui text-[6px] text-muted-foreground">{action}</span>)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-amber-300/15 bg-amber-300/[0.02] px-3 py-2 font-ui text-[7px] text-muted-foreground">Execution complete · filing evidence linked · Artifact ready</div>
                  </div>
                  <div className="px-6 pb-5">
                    <ComposerFixture />
                  </div>
                </section>
                {artifact && (
                  <aside className="w-[46%] shrink-0 border-l border-border/70 bg-[#060606]/96 p-4">
                    <div className="lios-artifact-frame rounded-xl border border-amber-300/15 bg-[#080808]">
                      <div className="flex items-center justify-between border-b border-border/60 p-3">
                        <div>
                          <div className="font-ui text-[10px] font-semibold text-foreground">Apple Valuation</div>
                          <div className="mt-1 font-terminal text-[6px] text-muted-foreground">VALUATION · V3 · DETERMINISTIC · SOURCE-LINKED</div>
                        </div>
                        <button className="rounded border border-border/50 px-2 py-1 font-ui text-[7px] text-muted-foreground">Show Work</button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 p-3">
                        {["Base $245", "Bull $292", "Bear $184"].map((item) => <div key={item} className="border border-border/60 bg-black/20 p-3 font-terminal text-[9px] text-foreground">{item}</div>)}
                      </div>
                      <div className="mx-3 mb-3 h-44 border-b border-l border-border/70 bg-[linear-gradient(180deg,rgba(246,159,10,.08),transparent)]" />
                      <div className="border-t border-border/50 px-3 py-2 font-terminal text-[6px] text-muted-foreground">SOURCE-LINKED · 2 RECEIPTS · 3 REVISIONS · 1 PROJECT REF</div>
                    </div>
                  </aside>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

const SMOKE_CASES: SmokeCase[] = [
  "market",
  "breadth",
  "news",
  "watchlist",
  "layout-2",
  "layout-3",
  "layout-4",
  "workbench-real",
  "workbench-real-narrow",
  "project-home",
  "conversation",
  "conversation-artifact",
  "workspace-focus",
];
const DENSITIES: Density[] = ["terminal", "compact", "standard", "comfortable"];

function isSmokeCase(value: unknown): value is SmokeCase {
  return typeof value === "string" && SMOKE_CASES.includes(value as SmokeCase);
}

function isDensity(value: unknown): value is Density {
  return typeof value === "string" && DENSITIES.includes(value as Density);
}

function Surface({ smokeCase, density }: { smokeCase: SmokeCase; density: Density }) {
  if (smokeCase === "market") return <MarketOverview activeSymbol="MSFT" onSymbol={() => {}} onNav={() => {}} />;
  if (smokeCase === "breadth") return <MarketBreadthPanel />;
  if (smokeCase === "news") return <NewsPanel symbol="AAPL" />;
  if (smokeCase === "watchlist") return <WatchlistPanel activeSymbol="MSFT" onSymbol={() => {}} role="admin" />;
  if (smokeCase === "layout-2") return <LayoutCase count={2} density={density} />;
  if (smokeCase === "layout-3") return <LayoutCase count={3} density={density} />;
  if (smokeCase === "layout-4") return <LayoutCase count={4} density={density} />;
  if (smokeCase === "workbench-real") return <RealWorkbenchCase density={density} />;
  if (smokeCase === "workbench-real-narrow") return <RealWorkbenchCase density={density} narrow />;
  return <UxFlagshipCase mode={smokeCase} />;
}

function Harness() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestedCase = params.get("case");
  const requestedDensity = params.get("density");
  const initialCase: SmokeCase = isSmokeCase(requestedCase) ? requestedCase : "market";
  const initialDensity: Density = isDensity(requestedDensity) ? requestedDensity : "standard";
  const [smokeCase, setSmokeCase] = useState<SmokeCase>(initialCase);
  const [density, setDensity] = useState<Density>(initialDensity);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const handleStateChange = (event: Event) => {
      const detail = (event as CustomEvent<{ smokeCase?: unknown; density?: unknown }>).detail;
      if (isSmokeCase(detail?.smokeCase)) setSmokeCase(detail.smokeCase);
      if (isDensity(detail?.density)) setDensity(detail.density);
    };
    window.addEventListener("lios-visual-smoke-state", handleStateChange);
    return () => window.removeEventListener("lios-visual-smoke-state", handleStateChange);
  }, []);

  useEffect(() => {
    setReady(false);
    const timeout = window.setTimeout(() => setReady(true), 1600);
    return () => window.clearTimeout(timeout);
  }, [smokeCase, density]);

  return (
    <div className="terminal-root h-screen min-h-0 overflow-hidden bg-[#030303] text-foreground" data-density={density} data-visual-smoke-ready={ready ? "true" : "false"}>
      <div className="flex h-8 items-center border-b border-border bg-[#080808] px-3">
        <span className="font-terminal text-[9px] font-bold tracking-[0.18em] text-amber-300">LIOS · VISUAL SMOKE</span>
        <span className="ml-3 font-terminal text-[8px] tracking-widest text-muted-foreground">{smokeCase.toUpperCase()} · {density.toUpperCase()}</span>
        <span className="ml-auto font-terminal text-[7px] tracking-widest text-cyan-300">DETERMINISTIC FIXTURE · NOT LIVE</span>
      </div>
      <div className="h-[calc(100vh-32px)] min-h-0 overflow-hidden">
        <Surface smokeCase={smokeCase} density={density} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <Harness />
  </QueryClientProvider>,
);
