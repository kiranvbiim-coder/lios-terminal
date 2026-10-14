import { useState, useEffect, useRef } from "react";
import Login from "./Login";
import type { SessionData } from "@/App";
import "@/reference-entry.css";

const NAV_ITEMS = ["Product", "Capabilities", "Connectivity", "Pricing"];

const FINANCE_FAMILIES = [
  {
    id: "01",
    name: "Market Data",
    desc: "Real-time quotes, order book, OHLCV, tick data across equities, FX, crypto, commodities",
  },
  {
    id: "02",
    name: "Company Fundamentals",
    desc: "Income statements, balance sheets, cash flows, earnings, analyst estimates",
  },
  {
    id: "03",
    name: "Valuation",
    desc: "DCF, comps, precedent transactions, multiples — deterministic engines, AI-augmented",
  },
  {
    id: "04",
    name: "Portfolio & Risk",
    desc: "Multi-asset portfolio analytics, VaR, CVaR, factor exposure, stress testing",
  },
  {
    id: "05",
    name: "Fixed Income",
    desc: "Bond pricing, yield curves, duration, convexity, credit spread analytics",
  },
  {
    id: "06",
    name: "Derivatives",
    desc: "Options pricing, Greeks, vol surfaces, futures term structure",
  },
  {
    id: "07",
    name: "Macro & FX",
    desc: "Economic calendars, central bank data, FX cross rates, macro regime analysis",
  },
  {
    id: "08",
    name: "Alternative Assets",
    desc: "Private equity, real assets, crypto, commodities, hedge fund strategies",
  },
  {
    id: "09",
    name: "Corporate Actions",
    desc: "Dividends, splits, M&A, spinoffs, rights issues with entity-level continuity",
  },
  {
    id: "10",
    name: "Research & Reporting",
    desc: "AI-composed research memos, PDF/Excel/PPT exports, shareable artifacts",
  },
  {
    id: "11",
    name: "Personal Finance",
    desc: "Net worth tracking, portfolio aggregation, planning, wealth modelling",
  },
];

const EXECUTION_STEPS = [
  { step: "ASK", desc: "Natural language query or structured command" },
  {
    step: "UNDERSTAND",
    desc: "Intent routing, context resolution, entity linking",
  },
  {
    step: "EXECUTE",
    desc: "Deterministic engines + BYOAI inference in parallel",
  },
  { step: "INSPECT", desc: "Evidence panel, data lineage, source attribution" },
  { step: "REFINE", desc: "Follow-up, drill-down, parameter adjustment" },
  { step: "SAVE", desc: "Live artifact persisted to project ledger" },
  { step: "MONITOR", desc: "Automated alerts, scheduled re-runs, watchlists" },
];

const FEATURES = [
  {
    label: "PROJECTS / CHATS",
    title: "Persistent intelligence workspaces",
    desc: "Every analysis lives inside a Project. Chats retain full financial context — positions, universe filters, prior calculations — across sessions.",
    tag: "ChatGPT-style context",
  },
  {
    label: "LIVE ARTIFACTS",
    title: "Side-by-side interactive outputs",
    desc: "Charts, models, tables, and reports render live beside the conversation. Scroll, filter, drill, export — without leaving the chat.",
    tag: "Claude-style artifacts",
  },
  {
    label: "EVIDENCE LAYER",
    title: "Every claim cites its source",
    desc: "Every data point surfaces its provider, timestamp, and confidence tier. AI-derived estimates are clearly labelled; engines remain authoritative.",
    tag: "Perplexity-style citations",
  },
  {
    label: "BYOD / BYOAI",
    title: "Bring your own data and models",
    desc: "Connect any REST/GraphQL/SQL source. Route inference to Claude, GPT-4, Gemini, local Ollama, or any provider-neutral endpoint. Your keys, your cost.",
    tag: "Provider-neutral",
  },
];

const PLANS = [
  {
    name: "Trial",
    price: "Free",
    period: "",
    desc: "Full-feature evaluation. No card required.",
    items: [
      "14-day access",
      "Community data sources",
      "5 Projects",
      "Standard artifacts",
      "Web app",
    ],
    cta: "Start free trial",
    accent: false,
  },
  {
    name: "Starter",
    price: "$49",
    period: "/mo",
    desc: "Individual analyst or investor.",
    items: [
      "Unlimited Projects",
      "BYOD connectors",
      "BYOAI routing",
      "PDF/Excel exports",
      "Web + Desktop app",
    ],
    cta: "Get Starter",
    accent: false,
  },
  {
    name: "Pro",
    price: "$149",
    period: "/mo",
    desc: "Power users, portfolio managers, researchers.",
    items: [
      "All Starter features",
      "Advanced quant pack",
      "Automation & monitoring",
      "Team sharing",
      "Priority support",
    ],
    cta: "Get Pro",
    accent: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    desc: "Multi-seat, on-premise, SLA, compliance.",
    items: [
      "Unlimited seats",
      "Private deployment",
      "SSO / SAML",
      "Data residency",
      "Dedicated support",
    ],
    cta: "Contact us",
    accent: false,
  },
];

type TerminalLine = {
  type: "prompt" | "sys" | "data" | "ai" | "ok";
  text: string;
  /** Pause before this line appears, in ms. Fixed sample cadence, never sampled. */
  delayMs: number;
};

// Illustrative replay only. Every line, figure and delay below is fixed sample
// content (labelled DEMO in the UI), not market data or a model output. Delays
// are explicit rather than randomised so the replay is identical on every
// visit and on every "View demo" restart.
const TERMINAL_LINES: readonly TerminalLine[] = [
  {
    type: "prompt",
    text: "> Analyse MSFT Q3 2026 earnings vs consensus",
    delayMs: 340,
  },
  {
    type: "sys",
    text: "Routing → Fundamentals Engine + BYOAI (Claude claude-opus-5-5)",
    delayMs: 300,
  },
  {
    type: "data",
    text: "Revenue: $70.1B  Est: $68.4B  Beat: +2.5%",
    delayMs: 420,
  },
  {
    type: "data",
    text: "EPS (adj): $3.46  Est: $3.22  Beat: +7.5%",
    delayMs: 360,
  },
  {
    type: "data",
    text: "Azure growth: +31% YoY  (prior qtr: +29%)",
    delayMs: 300,
  },
  {
    type: "ai",
    text: "↳ AI: Cloud reacceleration driven by Copilot seat expansion.",
    delayMs: 440,
  },
  {
    type: "ai",
    text: "   Operating margin expanded 240bps; guidance raised for Q4.",
    delayMs: 380,
  },
  {
    type: "prompt",
    text: "> Build DCF with 5yr WACC sensitivity",
    delayMs: 320,
  },
  {
    type: "sys",
    text: "Spawning → ValuationArtifact [DCF / WACC grid]",
    delayMs: 460,
  },
  {
    type: "ok",
    text: "✓ Artifact ready — intrinsic range $387–$441 (base $412)",
    delayMs: 380,
  },
];

function TerminalMockup() {
  const [visible, setVisible] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(TERMINAL_LINES.length);
      return;
    }
    if (visible < TERMINAL_LINES.length) {
      timer.current = setTimeout(
        () => setVisible((v) => v + 1),
        TERMINAL_LINES[visible].delayMs,
      );
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [visible]);

  const colorFor = (type: string) => {
    if (type === "prompt") return "#d4a017";
    if (type === "sys") return "#6b6870";
    if (type === "data") return "#ede9e0";
    if (type === "ai") return "#7dd3fc";
    if (type === "ok") return "#22c55e";
    return "#ede9e0";
  };

  return (
    <div
      data-testid="reference-terminal-demo"
      aria-label="Sample analysis animation"
      style={{
        background: "#0d0d10",
        border: "1px solid #1f1f28",
        borderRadius: 4,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 13,
        lineHeight: "1.7",
        padding: "20px 24px",
        minHeight: 280,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {["#ef4444", "#eab308", "#22c55e"].map((c) => (
          <span
            key={c}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: c,
              display: "inline-block",
              opacity: 0.6,
            }}
          />
        ))}
        <span
          style={{
            color: "#3a3840",
            fontSize: 11,
            marginLeft: 8,
            letterSpacing: "0.08em",
          }}
        >
          LiOS Terminal — MSFT — Analysis · DEMO
        </span>
      </div>
      {TERMINAL_LINES.slice(0, visible).map((line, i) => (
        <div
          data-demo-line
          key={i}
          style={{
            color: colorFor(line.type),
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {line.text}
        </div>
      ))}
      {visible < TERMINAL_LINES.length && (
        <span
          style={{
            color: "#d4a017",
            animation: "referenceBlink 1s step-end infinite",
          }}
        >
          █
        </span>
      )}
      <style>{`@keyframes referenceBlink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  );
}

function Ticker({ items }: { items: string[] }) {
  return (
    <div
      className="lios-reference-ticker"
      aria-label="Sample market ticker, illustrative values"
      style={{
        overflow: "hidden",
        borderTop: "1px solid #1f1f28",
        borderBottom: "1px solid #1f1f28",
        background: "#0d0d10",
      }}
    >
      <span className="lios-reference-demo-label">DEMO DATA</span>
      <div
        className="lios-reference-ticker-track"
        aria-hidden="true"
        style={{
          display: "flex",
          gap: 48,
          padding: "8px 0",
          animation: "referenceTicker 30s linear infinite",
          whiteSpace: "nowrap",
        }}
      >
        {[...items, ...items].map((item, i) => (
          <span
            key={i}
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: "#6b6870",
              letterSpacing: "0.06em",
            }}
          >
            {item}
          </span>
        ))}
      </div>
      <style>{`@keyframes referenceTicker { from{transform:translateX(0)} to{transform:translateX(-50%)} }`}</style>
    </div>
  );
}

export default function PublicProductPreview({
  onLoginSuccess,
}: {
  onLoginSuccess: (session: SessionData) => void;
}) {
  const [showLogin, setShowLogin] = useState(false);
  const [loginMode, setLoginMode] = useState<"signin" | "register">("signin");
  const [demoRun, setDemoRun] = useState(0);
  const requireSignIn = () => {
    setLoginMode("signin");
    setShowLogin(true);
  };
  const requireRegistration = () => {
    setLoginMode("register");
    setShowLogin(true);
  };
  const viewDemo = () => {
    setDemoRun((run) => run + 1);
    document
      .getElementById("reference-demo")
      ?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  };
  if (showLogin)
    return (
      <div className="lios-reference-entry">
        <Login onLoginSuccess={onLoginSuccess} initialMode={loginMode} />
        <button
          type="button"
          className="lios-reference-back"
          onClick={() => setShowLogin(false)}
        >
          ← Back to preview
        </button>
      </div>
    );

  const tickerItems = [
    "MSFT +2.4%",
    "NVDA +1.1%",
    "AAPL -0.3%",
    "SPX 5,847",
    "10Y UST 4.31%",
    "EUR/USD 1.0821",
    "BTC 63,420",
    "WTI $78.14",
    "GOLD $2,641",
    "VIX 17.2",
    "AMZN +0.8%",
    "GOOGL -0.5%",
    "META +3.1%",
    "TSLA -1.2%",
  ];

  return (
    <div
      className="lios-reference-entry lios-reference-faithful"
      style={{ minHeight: "100vh", background: "#09090b", color: "#ede9e0" }}
    >
      {/* NAV */}
      <nav
        aria-label="Product information"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "rgba(9,9,11,0.92)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid #1f1f28",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            height: 56,
            gap: 32,
          }}
        >
          {/* Logo */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                background: "#d4a017",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontWeight: 800,
                  fontSize: 14,
                  color: "#09090b",
                  letterSpacing: "-0.02em",
                }}
              >
                Li
              </span>
            </div>
            <span
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 700,
                fontSize: 18,
                letterSpacing: "0.04em",
                color: "#ede9e0",
              }}
            >
              LiOS
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                color: "#3a3840",
                letterSpacing: "0.1em",
                marginTop: 1,
              }}
            >
              v1.0
            </span>
          </div>

          {/* Desktop nav links */}
          <div style={{ display: "flex", gap: 0, flex: 1 }}>
            {NAV_ITEMS.map((item) => (
              <a
                key={item}
                href={`#${item.toLowerCase()}`}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  color: "#6b6870",
                  padding: "0 16px",
                  lineHeight: "56px",
                  textDecoration: "none",
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#ede9e0")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#6b6870")}
              >
                {item.toUpperCase()}
              </a>
            ))}
          </div>

          {/* Auth CTAs */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={requireSignIn}
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                letterSpacing: "0.06em",
                background: "none",
                border: "none",
                color: "#6b6870",
                cursor: "pointer",
                padding: "6px 12px",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#ede9e0")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#6b6870")}
            >
              SIGN IN
            </button>
            <button
              onClick={requireSignIn}
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                letterSpacing: "0.06em",
                background: "none",
                border: "1px solid #2e2e3a",
                color: "#6b6870",
                cursor: "pointer",
                padding: "6px 14px",
                transition: "all 0.15s",
                marginRight: 4,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#6b6870";
                e.currentTarget.style.color = "#ede9e0";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#2e2e3a";
                e.currentTarget.style.color = "#6b6870";
              }}
            >
              OPEN APP ↗
            </button>
            <button
              type="button"
              onClick={requireRegistration}
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                letterSpacing: "0.06em",
                background: "#d4a017",
                border: "none",
                color: "#09090b",
                cursor: "pointer",
                padding: "7px 16px",
                fontWeight: 600,
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#e6b829")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "#d4a017")
              }
            >
              START FREE TRIAL
            </button>
          </div>
        </div>
      </nav>

      {/* TICKER */}
      <Ticker items={tickerItems} />

      {/* HERO */}
      <section
        className="lios-reference-source-hero"
        style={{ maxWidth: 1200, margin: "0 auto", padding: "80px 24px 60px" }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 64,
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                letterSpacing: "0.14em",
                color: "#d4a017",
                marginBottom: 20,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 20,
                  height: 1,
                  background: "#d4a017",
                }}
              />
              LIMURIA INTELLIGENCE · V1.0.0
            </div>

            <h1
              className="font-display"
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: "clamp(52px, 6vw, 80px)",
                fontWeight: 800,
                lineHeight: 0.95,
                letterSpacing: "-0.01em",
                color: "#ede9e0",
                margin: "0 0 8px",
                textTransform: "uppercase",
              }}
            >
              Financial
              <br />
              <span style={{ color: "#d4a017" }}>Intelligence</span>
              <br />
              Operating
              <br />
              System
            </h1>

            <p
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 15,
                lineHeight: 1.7,
                color: "#6b6870",
                margin: "28px 0 0",
                maxWidth: 460,
              }}
            >
              Projects, chats, live analytical artifacts, provider-neutral
              BYOD/BYOAI, deterministic finance engines, persistent financial
              state and automation.
            </p>

            <div
              style={{
                display: "flex",
                gap: 12,
                marginTop: 36,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={requireRegistration}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  letterSpacing: "0.06em",
                  background: "#d4a017",
                  color: "#09090b",
                  border: "none",
                  padding: "13px 28px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#e6b829")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "#d4a017")
                }
              >
                START FREE TRIAL
              </button>
              <button
                type="button"
                onClick={viewDemo}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  letterSpacing: "0.06em",
                  background: "none",
                  color: "#ede9e0",
                  border: "1px solid #2e2e3a",
                  padding: "13px 28px",
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.borderColor = "#6b6870")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.borderColor = "#2e2e3a")
                }
              >
                VIEW DEMO
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: 32,
                marginTop: 48,
                borderTop: "1px solid #1f1f28",
                paddingTop: 32,
              }}
            >
              {[
                ["11", "Finance capability families"],
                ["BYOD", "Your connected sources"],
                ["BYOAI", "Provider-neutral AI"],
              ].map(([val, label]) => (
                <div key={label}>
                  <div
                    style={{
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontSize: 28,
                      fontWeight: 700,
                      color: "#d4a017",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {val}
                  </div>
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10,
                      color: "#6b6870",
                      letterSpacing: "0.08em",
                      marginTop: 2,
                    }}
                  >
                    {label.toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div id="reference-demo" aria-label="Illustrative product demo">
            <TerminalMockup key={demoRun} />

            {/* DCF artifact mockup */}
            <div
              style={{
                marginTop: 12,
                background: "#111115",
                border: "1px solid #1f1f28",
                padding: "16px 20px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: "#d4a017",
                    letterSpacing: "0.1em",
                  }}
                >
                  VALUATION ARTIFACT · MSFT DCF
                </span>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 9,
                    color: "#3a3840",
                  }}
                >
                  WACC SENSITIVITY
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  gap: 1,
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {["", "7.5%", "8.0%", "8.5%", "9.0%"].map((h, i) => (
                  <div
                    key={i}
                    style={{
                      background: i === 0 ? "transparent" : "#16161c",
                      color: i === 0 ? "#3a3840" : "#6b6870",
                      padding: "5px 8px",
                      textAlign: "center",
                    }}
                  >
                    {h}
                  </div>
                ))}
                {[
                  ["g=2.5%", "$441", "$418", "$397", "$378"],
                  ["g=3.0%", "$463", "$438", "$414", "$393"],
                  ["g=3.5%", "$489", "$460", "$434", "$410"],
                ].map((row, ri) =>
                  row.map((cell, ci) => (
                    <div
                      key={`${ri}-${ci}`}
                      style={{
                        background:
                          ci === 0
                            ? "#0d0d10"
                            : ri === 1 && ci === 2
                              ? "#1a1507"
                              : "#111115",
                        color:
                          ci === 0
                            ? "#6b6870"
                            : ri === 1 && ci === 2
                              ? "#d4a017"
                              : "#ede9e0",
                        padding: "5px 8px",
                        textAlign: "center",
                        border:
                          ri === 1 && ci === 2
                            ? "1px solid #d4a017"
                            : "1px solid #1f1f28",
                        fontWeight: ri === 1 && ci === 2 ? 600 : 400,
                      }}
                    >
                      {cell}
                    </div>
                  )),
                )}
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 9,
                  color: "#3a3840",
                }}
              >
                ↳ DEMO DATA · Illustrative DCF · Not a live calculation or
                source receipt
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* EXECUTION MODEL */}
      <section
        style={{ borderTop: "1px solid #1f1f28", background: "#0d0d10" }}
        id="product"
      >
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "64px 24px" }}>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              letterSpacing: "0.14em",
              color: "#d4a017",
              marginBottom: 16,
            }}
          >
            EXECUTION MODEL
          </div>
          <h2
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: "clamp(36px, 4vw, 52px)",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "-0.01em",
              margin: "0 0 48px",
              color: "#ede9e0",
            }}
          >
            Ask → Execute → Inspect → Automate
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 0,
            }}
          >
            {EXECUTION_STEPS.map((s, i) => (
              <div
                key={s.step}
                style={{
                  borderLeft: i === 0 ? "1px solid #1f1f28" : "none",
                  borderRight: "1px solid #1f1f28",
                  borderTop: "1px solid #1f1f28",
                  borderBottom: "1px solid #1f1f28",
                  padding: "20px 16px",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 9,
                    color: "#3a3840",
                    letterSpacing: "0.1em",
                    marginBottom: 8,
                  }}
                >
                  0{i + 1}
                </div>
                <div
                  style={{
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontWeight: 700,
                    fontSize: 16,
                    color: "#d4a017",
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  {s.step}
                </div>
                <div
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 11,
                    color: "#6b6870",
                    lineHeight: 1.5,
                  }}
                >
                  {s.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" style={{ borderTop: "1px solid #1f1f28" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "80px 24px" }}>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              letterSpacing: "0.14em",
              color: "#d4a017",
              marginBottom: 16,
            }}
          >
            EXPERIENCE LAYER
          </div>
          <h2
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: "clamp(36px, 4vw, 52px)",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "-0.01em",
              margin: "0 0 48px",
              color: "#ede9e0",
              maxWidth: 600,
            }}
          >
            The best of every intelligence interface
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 1,
              background: "#1f1f28",
            }}
          >
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                style={{
                  background: "#09090b",
                  padding: "36px 36px",
                  transition: "background 0.2s",
                  cursor: "default",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#111115")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "#09090b")
                }
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 20,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      color: "#d4a017",
                    }}
                  >
                    {f.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 9,
                      letterSpacing: "0.08em",
                      color: "#3a3840",
                      background: "#111115",
                      padding: "3px 8px",
                      border: "1px solid #1f1f28",
                    }}
                  >
                    {f.tag.toUpperCase()}
                  </span>
                </div>
                <h3
                  style={{
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontWeight: 700,
                    fontSize: 24,
                    letterSpacing: "0.01em",
                    color: "#ede9e0",
                    margin: "0 0 12px",
                    textTransform: "uppercase",
                  }}
                >
                  {f.title}
                </h3>
                <p
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 13,
                    lineHeight: 1.65,
                    color: "#6b6870",
                    margin: 0,
                  }}
                >
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CAPABILITY FAMILIES */}
      <section
        style={{ borderTop: "1px solid #1f1f28", background: "#0d0d10" }}
        id="capabilities"
      >
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "80px 24px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              marginBottom: 48,
              flexWrap: "wrap",
              gap: 24,
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  color: "#d4a017",
                  marginBottom: 16,
                }}
              >
                FINANCE-FIRST SCOPE
              </div>
              <h2
                style={{
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontSize: "clamp(36px, 4vw, 52px)",
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "-0.01em",
                  margin: 0,
                  color: "#ede9e0",
                }}
              >
                11 Capability Families
              </h2>
            </div>
            <p
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                color: "#6b6870",
                maxWidth: 360,
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              Complexity lives inside LiOS. The user sees Projects, Chats, and
              Artifacts.
            </p>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 0,
              background: "#1f1f28",
            }}
          >
            {FINANCE_FAMILIES.map((fam, i) => (
              <div
                key={fam.id}
                style={{
                  background: "#09090b",
                  padding: "24px 24px",
                  borderBottom: i < 9 ? "1px solid #1f1f28" : "none",
                  display: "flex",
                  gap: 16,
                  alignItems: "flex-start",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#111115")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "#09090b")
                }
              >
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: "#d4a017",
                    letterSpacing: "0.08em",
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  {fam.id}
                </span>
                <div>
                  <div
                    style={{
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontWeight: 700,
                      fontSize: 16,
                      color: "#ede9e0",
                      letterSpacing: "0.02em",
                      textTransform: "uppercase",
                      marginBottom: 6,
                    }}
                  >
                    {fam.name}
                  </div>
                  <div
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12,
                      color: "#6b6870",
                      lineHeight: 1.55,
                    }}
                  >
                    {fam.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CONNECTIVITY */}
      <section style={{ borderTop: "1px solid #1f1f28" }} id="connectivity">
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "80px 24px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 80,
              alignItems: "center",
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  color: "#d4a017",
                  marginBottom: 16,
                }}
              >
                UNIVERSAL CONNECTIVITY
              </div>
              <h2
                style={{
                  fontFamily: "'Barlow Condensed', sans-serif",
                  fontSize: "clamp(36px, 4vw, 52px)",
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "-0.01em",
                  margin: "0 0 24px",
                  color: "#ede9e0",
                }}
              >
                Connect what
                <br />
                you bring
              </h2>
              <p
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: "#6b6870",
                  margin: "0 0 36px",
                }}
              >
                LiOS is not limited to a fixed provider list. Any API key, OAuth
                service, REST/OpenAPI/GraphQL endpoint, SQL database, file,
                cloud storage, or MCP-compatible source converges into one
                governed data layer.
              </p>
              {[
                ["REST / OpenAPI / GraphQL", "Any HTTP API with a schema"],
                ["Databases / SQL", "Postgres, SQLite, DuckDB, PGlite"],
                ["Files & Cloud Storage", "CSV, Excel, Parquet, S3, GCS"],
                ["BYOAI", "Claude, GPT-4, Gemini, Ollama, any endpoint"],
                ["MCP", "Governed tool exposure, not an auth bypass"],
              ].map(([title, sub]) => (
                <div
                  key={title}
                  style={{
                    display: "flex",
                    gap: 16,
                    alignItems: "flex-start",
                    marginBottom: 16,
                  }}
                >
                  <span
                    style={{ color: "#d4a017", marginTop: 2, flexShrink: 0 }}
                  >
                    →
                  </span>
                  <div>
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 11,
                        color: "#ede9e0",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {title}
                    </div>
                    <div
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12,
                        color: "#6b6870",
                        marginTop: 2,
                      }}
                    >
                      {sub}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div
                style={{
                  background: "#111115",
                  border: "1px solid #1f1f28",
                  padding: "28px 28px",
                }}
              >
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: "#d4a017",
                    letterSpacing: "0.1em",
                    marginBottom: 20,
                  }}
                >
                  EXAMPLE CONNECTIONS · DEMO
                </div>
                {[
                  {
                    name: "Bloomberg BLPAPI",
                    status: "CONNECTED",
                    color: "#22c55e",
                  },
                  {
                    name: "Polygon.io Market Data",
                    status: "CONNECTED",
                    color: "#22c55e",
                  },
                  {
                    name: "OpenFIGI Identity",
                    status: "CONNECTED",
                    color: "#22c55e",
                  },
                  {
                    name: "Claude claude-opus-5-5 (BYOAI)",
                    status: "ACTIVE",
                    color: "#d4a017",
                  },
                  {
                    name: "Internal Postgres (local)",
                    status: "CONNECTED",
                    color: "#22c55e",
                  },
                  {
                    name: "Refinitiv Eikon REST",
                    status: "PENDING KEY",
                    color: "#6b6870",
                  },
                ].map((c) => (
                  <div
                    key={c.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 0",
                      borderBottom: "1px solid #1f1f28",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 11,
                        color: "#ede9e0",
                      }}
                    >
                      {c.name}
                    </span>
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 9,
                        color: c.color,
                        letterSpacing: "0.1em",
                      }}
                    >
                      {c.status}
                    </span>
                  </div>
                ))}
                <div
                  style={{
                    marginTop: 20,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: "#3a3840",
                  }}
                >
                  ↳ Illustrative statuses · Connect your own sources after
                  sign-in
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section
        style={{ borderTop: "1px solid #1f1f28", background: "#0d0d10" }}
        id="pricing"
      >
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "80px 24px" }}>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              letterSpacing: "0.14em",
              color: "#d4a017",
              marginBottom: 16,
            }}
          >
            PLANS
          </div>
          <h2
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontSize: "clamp(36px, 4vw, 52px)",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "-0.01em",
              margin: "0 0 48px",
              color: "#ede9e0",
            }}
          >
            Pricing
          </h2>
          <p className="lios-reference-demo-pricing">
            Reference plan examples; current pricing and access are confirmed
            during enrollment.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 0,
              background: "#1f1f28",
            }}
          >
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                style={{
                  background: plan.accent ? "#111115" : "#09090b",
                  padding: "32px 28px",
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                  outline: plan.accent ? "2px solid #d4a017" : "none",
                  outlineOffset: -1,
                }}
              >
                {plan.accent && (
                  <div
                    style={{
                      position: "absolute",
                      top: -1,
                      left: 0,
                      right: 0,
                      background: "#d4a017",
                      height: 2,
                    }}
                  />
                )}
                {plan.accent && (
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 9,
                      letterSpacing: "0.1em",
                      color: "#09090b",
                      background: "#d4a017",
                      padding: "3px 8px",
                      display: "inline-block",
                      marginBottom: 16,
                      alignSelf: "flex-start",
                    }}
                  >
                    MOST POPULAR
                  </div>
                )}
                <div
                  style={{
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontWeight: 700,
                    fontSize: 20,
                    letterSpacing: "0.04em",
                    color: plan.accent ? "#d4a017" : "#ede9e0",
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  {plan.name}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 2,
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontWeight: 800,
                      fontSize: 36,
                      color: "#ede9e0",
                    }}
                  >
                    {plan.price}
                  </span>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                      color: "#6b6870",
                    }}
                  >
                    {plan.period}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 12,
                    color: "#6b6870",
                    lineHeight: 1.5,
                    marginBottom: 24,
                  }}
                >
                  {plan.desc}
                </div>
                <div style={{ flex: 1 }}>
                  {plan.items.map((item) => (
                    <div
                      key={item}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        marginBottom: 10,
                      }}
                    >
                      <span
                        style={{
                          color: "#d4a017",
                          flexShrink: 0,
                          fontSize: 12,
                          marginTop: 1,
                        }}
                      >
                        ✓
                      </span>
                      <span
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 10,
                          color: "#ede9e0",
                          lineHeight: 1.5,
                        }}
                      >
                        {item}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={requireRegistration}
                  style={{
                    marginTop: 28,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11,
                    letterSpacing: "0.06em",
                    background: plan.accent ? "#d4a017" : "none",
                    color: plan.accent ? "#09090b" : "#ede9e0",
                    border: plan.accent ? "none" : "1px solid #2e2e3a",
                    padding: "11px 0",
                    fontWeight: plan.accent ? 600 : 400,
                    cursor: "pointer",
                    width: "100%",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (plan.accent) {
                      e.currentTarget.style.background = "#e6b829";
                    } else {
                      e.currentTarget.style.borderColor = "#6b6870";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (plan.accent) {
                      e.currentTarget.style.background = "#d4a017";
                    } else {
                      e.currentTarget.style.borderColor = "#2e2e3a";
                    }
                  }}
                >
                  {plan.cta.toUpperCase()}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA BANNER */}
      <section
        style={{
          borderTop: "1px solid #1f1f28",
          borderBottom: "1px solid #1f1f28",
          background: "#111115",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "72px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 32,
          }}
        >
          <div>
            <h2
              style={{
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: "clamp(32px, 4vw, 52px)",
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "-0.01em",
                margin: "0 0 12px",
                color: "#ede9e0",
              }}
            >
              Ready to start your
              <br />
              <span style={{ color: "#d4a017" }}>14-day free trial?</span>
            </h2>
            <p
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 14,
                color: "#6b6870",
                margin: 0,
              }}
            >
              No credit card required. Full access from day one.
            </p>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              type="button"
              onClick={requireRegistration}
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                letterSpacing: "0.06em",
                background: "#d4a017",
                color: "#09090b",
                border: "none",
                padding: "14px 32px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#e6b829")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "#d4a017")
              }
            >
              START FREE TRIAL
            </button>
            <button
              type="button"
              onClick={viewDemo}
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                letterSpacing: "0.06em",
                background: "none",
                color: "#6b6870",
                border: "1px solid #2e2e3a",
                padding: "14px 24px",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#ede9e0";
                e.currentTarget.style.borderColor = "#6b6870";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#6b6870";
                e.currentTarget.style.borderColor = "#2e2e3a";
              }}
            >
              VIEW DEMO
            </button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ background: "#09090b", borderTop: "1px solid #1f1f28" }}>
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "48px 24px 32px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 32,
              marginBottom: 40,
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    background: "#d4a017",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontWeight: 800,
                      fontSize: 11,
                      color: "#09090b",
                    }}
                  >
                    Li
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: "'Barlow Condensed', sans-serif",
                    fontWeight: 700,
                    fontSize: 16,
                    letterSpacing: "0.04em",
                    color: "#ede9e0",
                  }}
                >
                  LiOS
                </span>
              </div>
              <p
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  color: "#3a3840",
                  lineHeight: 1.6,
                  maxWidth: 240,
                  margin: 0,
                }}
              >
                Limuria Intelligence · Financial Intelligence Operating System ·
                v1.0.0
              </p>
            </div>
            {[
              {
                title: "Product",
                items: ["Features", "Capabilities", "Pricing", "Changelog"],
              },
              {
                title: "Resources",
                items: ["Documentation", "Security", "API Reference", "Status"],
              },
              {
                title: "Company",
                items: ["About", "Contact", "Privacy", "Terms"],
              },
            ].map((col) => (
              <div key={col.title}>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 9,
                    letterSpacing: "0.12em",
                    color: "#d4a017",
                    marginBottom: 14,
                  }}
                >
                  {col.title.toUpperCase()}
                </div>
                {col.items.map((item) => (
                  <div
                    key={item}
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12,
                      color: "#3a3840",
                      marginBottom: 8,
                      transition: "color 0.15s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.color = "#6b6870")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.color = "#3a3840")
                    }
                  >
                    {item}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div
            style={{
              borderTop: "1px solid #1f1f28",
              paddingTop: 24,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                color: "#3a3840",
                letterSpacing: "0.08em",
              }}
            >
              © 2026 LIMURIA INTELLIGENCE · ALL RIGHTS RESERVED
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                color: "#3a3840",
                letterSpacing: "0.06em",
              }}
            >
              TRIAL / STARTER / PRO / ENTERPRISE
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
