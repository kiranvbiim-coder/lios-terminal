import type {CSSProperties, ReactNode} from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const DEMO_WIDTH = 1920;
export const DEMO_HEIGHT = 1080;
export const DEMO_FPS = 30;
export const DEMO_DURATION_IN_FRAMES = 1800;

type SceneDefinition = {
  id: string;
  label: string;
  duration: number;
};

const SCENES: SceneDefinition[] = [
  {id: "intro", label: "Intro", duration: 180},
  {id: "market", label: "Market", duration: 270},
  {id: "single", label: "Single Name", duration: 300},
  {id: "research", label: "Research", duration: 300},
  {id: "risk", label: "Risk", duration: 240},
  {id: "agent", label: "AI Agent", duration: 300},
  {id: "close", label: "Close", duration: 210},
];

const computedDuration = SCENES.reduce((sum, scene) => sum + scene.duration, 0);
if (computedDuration !== DEMO_DURATION_IN_FRAMES) {
  throw new Error(`BLMTRM demo must total ${DEMO_DURATION_IN_FRAMES} frames, received ${computedDuration}.`);
}

const COLORS = {
  background: "#050505",
  panel: "#0d0f11",
  panelAlt: "#121519",
  text: "#f4ead8",
  muted: "#8e8777",
  amber: "#f3a32d",
  amberSoft: "rgba(243, 163, 45, 0.16)",
  green: "#28d17c",
  greenSoft: "rgba(40, 209, 124, 0.16)",
  red: "#ff5b4d",
  redSoft: "rgba(255, 91, 77, 0.16)",
  cyan: "#46c7ff",
  cyanSoft: "rgba(70, 199, 255, 0.14)",
  border: "rgba(255, 255, 255, 0.06)",
};

const TICKER_TAPE = [
  {symbol: "ES1", price: 5891.4, change: 0.82},
  {symbol: "NQ1", price: 20831.5, change: 1.18},
  {symbol: "DXY", price: 101.23, change: -0.22},
  {symbol: "US10Y", price: 4.08, change: -0.07},
  {symbol: "EURUSD", price: 1.11, change: 0.18},
  {symbol: "BTC", price: 94220, change: 2.14},
  {symbol: "WTI", price: 79.84, change: -0.63},
  {symbol: "GC1", price: 2442.5, change: 0.51},
];

const INDEX_CARDS = [
  {label: "S&P 500", symbol: "SPX", price: 5891.44, change: 0.82, points: [52, 54, 55, 56, 57, 58, 60, 63, 66, 68, 71, 74]},
  {label: "NASDAQ 100", symbol: "NDX", price: 20831.55, change: 1.18, points: [48, 49, 51, 55, 58, 62, 65, 70, 74, 78, 82, 88]},
  {label: "Dow Jones", symbol: "DJI", price: 43218.17, change: 0.31, points: [65, 64, 65, 67, 69, 70, 69, 71, 72, 73, 74, 76]},
  {label: "STOXX 600", symbol: "SXXP", price: 515.21, change: 0.24, points: [42, 43, 44, 43, 45, 47, 48, 47, 49, 50, 52, 53]},
  {label: "Nikkei 225", symbol: "NKY", price: 39291.8, change: -0.28, points: [76, 74, 71, 69, 67, 64, 60, 58, 55, 53, 52, 51]},
  {label: "Hang Seng", symbol: "HSI", price: 18871.02, change: -0.54, points: [70, 69, 68, 66, 65, 64, 61, 60, 58, 57, 55, 53]},
];

const HEATMAP = [
  {symbol: "NVDA", move: 2.8, size: 3},
  {symbol: "MSFT", move: 0.9, size: 2},
  {symbol: "AAPL", move: -0.4, size: 2},
  {symbol: "AMZN", move: 1.4, size: 2},
  {symbol: "META", move: 2.1, size: 2},
  {symbol: "GOOGL", move: 0.7, size: 2},
  {symbol: "TSLA", move: -1.9, size: 2},
  {symbol: "JPM", move: 0.5, size: 1},
  {symbol: "XOM", move: -0.7, size: 1},
  {symbol: "LLY", move: 1.1, size: 1},
  {symbol: "AVGO", move: 2.2, size: 1},
  {symbol: "AMD", move: 3.4, size: 1},
];

const RESEARCH_NEWS = [
  {time: "07:42", source: "RTRS", headline: "Mega-cap AI spend forecast lifted after hyperscaler capex updates.", tone: "positive" as const},
  {time: "08:13", source: "WSJ", headline: "Treasury issuance mix pressures long-end term premium into CPI week.", tone: "neutral" as const},
  {time: "08:46", source: "FT", headline: "Copper breaks out as China stimulus chatter accelerates cyclicals.", tone: "positive" as const},
  {time: "09:04", source: "BBG", headline: "Fed speakers reiterate data dependence; front-end vol remains elevated.", tone: "negative" as const},
];

const SCREENER_ROWS = [
  {symbol: "NVDA", sector: "Semis", momentum: 98, rev: 84, change: 2.8},
  {symbol: "AVGO", sector: "Semis", momentum: 96, rev: 88, change: 2.2},
  {symbol: "MSFT", sector: "Software", momentum: 91, rev: 72, change: 0.9},
  {symbol: "CRWD", sector: "Security", momentum: 89, rev: 77, change: 1.7},
  {symbol: "LLY", sector: "Healthcare", momentum: 86, rev: 69, change: 1.1},
];

const ECON_EVENTS = [
  {time: "08:30", label: "CPI YoY", actual: "3.1%", previous: "3.3%", surprise: "+0.2σ"},
  {time: "09:45", label: "PMI Flash", actual: "52.8", previous: "51.6", surprise: "+0.8σ"},
  {time: "10:00", label: "Existing Home Sales", actual: "4.21M", previous: "4.09M", surprise: "+0.4σ"},
  {time: "13:00", label: "20Y Auction", actual: "4.59%", previous: "4.63%", surprise: "Bid-to-cover 2.69x"},
];

const ALERTS = [
  {symbol: "NVDA", condition: "last > 955", state: "armed" as const},
  {symbol: "US10Y", condition: "yield < 4.05%", state: "triggered" as const},
  {symbol: "BTC", condition: "volatility > 58", state: "armed" as const},
  {symbol: "ES1", condition: "breadth < 42%", state: "watch" as const},
];

const PORTFOLIO = [
  {symbol: "NVDA", weight: 24, pnl: 5.8, contribution: 1.39},
  {symbol: "MSFT", weight: 18, pnl: 1.4, contribution: 0.25},
  {symbol: "AVGO", weight: 14, pnl: 3.1, contribution: 0.43},
  {symbol: "XLE", weight: 11, pnl: -0.8, contribution: -0.09},
  {symbol: "IEF", weight: 9, pnl: 0.7, contribution: 0.06},
  {symbol: "Cash", weight: 24, pnl: 0, contribution: 0},
];

const AGENT_LINES = [
  "Summary: risk assets remain supported by easing rate volatility and broadening earnings revision breadth.",
  "Quote: NVDA demand signal remains intact; channel checks imply AI server lead times still extended into 2H.",
  "Macro: cooler CPI + stable payrolls keep soft-landing base case above 55% confidence.",
  "Risk: keep an eye on 10Y back-up above 4.20% and oil > 82 as equity duration headwinds.",
  "Actions: surface bullish AI semis basket, refresh CPI watchlist, and arm hedge alert on QQQ gap fill.",
];

const BOOT_LINES = [
  "SYNCING MARKET STATE...",
  "INDEX GRID READY",
  "NEWS + ECON FEEDS ONLINE",
  "AGENT CONTEXT LOADED",
  "TERMINAL WORKFLOW ARMED",
];

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const formatPrice = (value: number) => {
  if (value >= 1000) {
    return value.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  }

  return value.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
};

const formatCompact = (value: number) =>
  new Intl.NumberFormat("en-US", {maximumFractionDigits: 1, notation: value >= 1000 ? "compact" : "standard"}).format(value);

const signed = (value: number, digits = 2) => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
const percentLabel = (value: number, digits = 2) => `${signed(value, digits)}%`;
const moveClass = (value: number) => (value > 0 ? "metric-positive" : value < 0 ? "metric-negative" : "metric-amber");
const moveColor = (value: number) => (value > 0 ? COLORS.green : value < 0 ? COLORS.red : COLORS.amber);

const sceneStarts = SCENES.reduce<Record<string, number>>((acc, scene, index) => {
  const start = index === 0 ? 0 : acc[SCENES[index - 1].id] + SCENES[index - 1].duration;
  acc[scene.id] = start;
  return acc;
}, {});

const getActiveScene = (frame: number) => {
  let cursor = 0;
  for (const scene of SCENES) {
    if (frame >= cursor && frame < cursor + scene.duration) {
      return scene;
    }
    cursor += scene.duration;
  }
  return SCENES[SCENES.length - 1];
};

const enterProgress = (frame: number, fps: number, delay = 0, durationInFrames = 24) =>
  spring({
    frame: frame - delay,
    fps,
    durationInFrames,
    config: {damping: 200},
  });

const sceneMotion = (frame: number, duration: number, fps: number): CSSProperties => {
  const entrance = enterProgress(frame, fps, 0, 28);
  const exit = interpolate(frame, [duration - 18, duration - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const opacity = clamp(entrance * exit, 0, 1);
  const translateY = interpolate(opacity, [0, 1], [24, 0]);
  const scale = interpolate(opacity, [0, 1], [0.985, 1]);

  return {
    opacity,
    transform: `translateY(${translateY}px) scale(${scale})`,
  };
};

const typeText = (text: string, frame: number, charsPerSecond = 28) => {
  const visible = Math.floor((frame / DEMO_FPS) * charsPerSecond);
  return text.slice(0, visible);
};

const countUp = (frame: number, from: number, to: number, duration = 48) => {
  const progress = interpolate(frame, [0, duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return from + (to - from) * progress;
};

const buildLinePath = (points: number[], width: number, height: number) => {
  if (points.length === 0) {
    return "";
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((point - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
};

const buildAreaPath = (points: number[], width: number, height: number) => {
  const line = buildLinePath(points, width, height);
  if (!line) {
    return "";
  }

  return `${line} L ${width},${height} L 0,${height} Z`;
};

const panelBodyStyle: CSSProperties = {
  position: "relative",
  padding: 20,
  height: "calc(100% - 57px)",
};

type PanelProps = {
  title: string;
  kicker?: string;
  rightSlot?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
};

const Panel = ({title, kicker, rightSlot, children, style}: PanelProps) => (
  <div className="terminal-panel" style={style}>
    <div className="panel-header">
      <div>
        {kicker ? <div className="panel-kicker">{kicker}</div> : null}
        <div className="panel-title">{title}</div>
      </div>
      {rightSlot}
    </div>
      <div style={panelBodyStyle}>{children}</div>
  </div>
);

const ValueCard = ({label, value, change, delay = 0}: {label: string; value: string; change: string; delay?: number}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const reveal = enterProgress(frame, fps, delay, 20);

  return (
    <div
      style={{
        padding: 18,
        borderRadius: 14,
        border: `1px solid ${COLORS.border}`,
        background: "rgba(255,255,255,0.02)",
        opacity: reveal,
        transform: `translateY(${interpolate(reveal, [0, 1], [18, 0])}px)`,
      }}
    >
      <div className="panel-kicker">{label}</div>
      <div style={{fontSize: 34, fontWeight: 700, marginTop: 10}}>{value}</div>
      <div className={moveClass(parseFloat(change))} style={{fontSize: 18, marginTop: 8}}>
        {change}
      </div>
    </div>
  );
};

const TerminalHeader = ({frame}: {frame: number}) => {
  const activeScene = getActiveScene(frame);
  const progress = clamp(frame / (DEMO_DURATION_IN_FRAMES - 1));

  return (
    <div className="terminal-topbar">
      <div className="terminal-brand">
        <div className="terminal-brand-mark" />
        <div className="terminal-brand-name">blmtrm</div>
      </div>
      <div className="terminal-status-row">
        <span className="status-badge">
          <span className="grid-dot" />
          Demo Cut
        </span>
        <span>{activeScene.label}</span>
        <span className="mono-muted">60s / 1080p / 30fps</span>
      </div>
      <div style={{display: "flex", alignItems: "center", gap: 16}}>
        <div style={{width: 220, height: 6, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.08)"}}>
          <div
            style={{
              width: `${progress * 100}%`,
              height: "100%",
              background: `linear-gradient(90deg, ${COLORS.amber}, ${COLORS.cyan})`,
              boxShadow: `0 0 18px ${COLORS.amberSoft}`,
            }}
          />
        </div>
        <span style={{color: COLORS.text}}>{String(Math.floor(progress * 60)).padStart(2, "0")}s</span>
      </div>
    </div>
  );
};

const TerminalFooter = ({frame}: {frame: number}) => {
  const activeScene = getActiveScene(frame);

  return (
    <div className="terminal-footer">
      <div style={{display: "flex", gap: 10, alignItems: "center"}}>
        <span className="terminal-kbd">F1</span>
        <span>Market</span>
        <span className="terminal-kbd">F2</span>
        <span>Quote</span>
        <span className="terminal-kbd">F3</span>
        <span>Research</span>
        <span className="terminal-kbd">F4</span>
        <span>Risk</span>
        <span className="terminal-kbd">F5</span>
        <span>Agent</span>
      </div>
      <div className="story-chip-row">
        {SCENES.slice(1, 6).map((scene) => (
          <span key={scene.id} className={`story-chip ${activeScene.id === scene.id ? "active" : ""}`}>
            {scene.label}
          </span>
        ))}
      </div>
    </div>
  );
};

const TickerStrip = () => {
  const frame = useCurrentFrame();
  const translate = -(frame * 3.4) % 1640;

  return (
    <div
      style={{
        position: "absolute",
        top: 70,
        left: 24,
        right: 24,
        height: 32,
        borderRadius: 999,
        border: `1px solid ${COLORS.border}`,
        overflow: "hidden",
        background: "rgba(0,0,0,0.24)",
      }}
    >
      <div
        style={{
          display: "flex",
          width: 3200,
          gap: 24,
          padding: "7px 22px",
          transform: `translateX(${translate}px)`,
          whiteSpace: "nowrap",
        }}
      >
        {[...TICKER_TAPE, ...TICKER_TAPE, ...TICKER_TAPE].map((ticker, index) => (
          <div key={`${ticker.symbol}-${index}`} style={{display: "flex", alignItems: "center", gap: 10, fontSize: 16}}>
            <span style={{color: COLORS.amber}}>{ticker.symbol}</span>
            <span style={{color: COLORS.text}}>{formatCompact(ticker.price)}</span>
            <span className={moveClass(ticker.change)}>{percentLabel(ticker.change)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const LineChart = ({
  points,
  color,
  delay = 0,
  height = 220,
  gridLines = 4,
}: {
  points: number[];
  color: string;
  delay?: number;
  height?: number;
  gridLines?: number;
}) => {
  const frame = useCurrentFrame();
  const width = 1000;
  const progress = interpolate(frame - delay, [0, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const path = buildLinePath(points, width, height);
  const area = buildAreaPath(points, width, height);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{width: "100%", height}}>
      {[...Array(gridLines)].map((_, index) => {
        const y = (height / (gridLines - 1)) * index;
        return (
          <line
            key={index}
            x1={0}
            x2={width}
            y1={y}
            y2={y}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="8 12"
          />
        );
      })}
      <path d={area} fill={`${color}22`} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={2000}
        strokeDashoffset={(1 - progress) * 2000}
        style={{filter: `drop-shadow(0 0 10px ${color})`}}
      />
    </svg>
  );
};

const SceneFrame = ({children, duration}: {children: ReactNode; duration: number}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <div style={{...sceneMotion(frame, duration, fps), width: "100%", height: "100%"}}>{children}</div>
  );
};

const IntroScene = ({duration}: {duration: number}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const reveal = enterProgress(frame, fps, 0, 30);
  const command = typeText("BOOT BLMTRM // TERMINAL-NATIVE MARKET INTELLIGENCE", frame, 22);

  return (
    <SceneFrame duration={duration}>
      <div style={{display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 24, height: "100%"}}>
        <Panel
          title="Terminal-first market intelligence"
          kicker="Brand reveal"
          rightSlot={<span className="status-badge positive">Live design language</span>}
          style={{height: "100%"}}
        >
          <div style={{display: "flex", flexDirection: "column", gap: 28, height: "100%", justifyContent: "center"}}>
            <div>
              <div className="panel-kicker">Boot sequence</div>
              <div style={{fontSize: 66, lineHeight: 1.02, fontWeight: 700, maxWidth: 900, letterSpacing: "-0.03em"}}>
                Bloomberg-grade context.
                <br />
                Modern agent workflow.
              </div>
            </div>
            <div style={{fontSize: 28, color: COLORS.amber, minHeight: 40}}>
              {command}
              {frame < 148 ? <span className="type-cursor" /> : null}
            </div>
            <div className="story-chip-row">
              <span className="story-chip active">Market overview</span>
              <span className="story-chip active">Quote + chart</span>
              <span className="story-chip active">Research + economics</span>
              <span className="story-chip active">Risk + alerts</span>
              <span className="story-chip active">AI agent</span>
            </div>
            <div className="soft-divider" />
            <div style={{display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 18}}>
              <ValueCard label="Coverage" value="Cross-asset" change="+ equities, macro, news" delay={18} />
              <ValueCard label="Workflow" value="Search to thesis" change="+ faster context" delay={28} />
              <ValueCard label="Output" value="Deterministic" change="+ render-ready demo" delay={38} />
            </div>
          </div>
        </Panel>

        <Panel title="System status" kicker="Startup diagnostics" style={{height: "100%"}}>
          <div style={{display: "flex", flexDirection: "column", gap: 20}}>
            {BOOT_LINES.map((line, index) => {
              const localFrame = frame - 16 - index * 14;
              const alpha = clamp(localFrame / 10);
              return (
                <div key={line} style={{display: "flex", alignItems: "center", gap: 14, opacity: alpha}}>
                  <span className={`status-badge ${index < 3 ? "positive" : ""}`}>
                    <span className="grid-dot" />
                    {index < 4 ? "ok" : "armed"}
                  </span>
                  <span style={{fontSize: 22, color: index === 4 ? COLORS.amber : COLORS.text}}>{line}</span>
                </div>
              );
            })}
            <div style={{marginTop: 24, padding: 20, borderRadius: 16, background: "rgba(243,163,45,0.08)", border: `1px solid ${COLORS.amberSoft}`}}>
              <div className="panel-kicker">Positioning statement</div>
              <div style={{fontSize: 32, lineHeight: 1.25, marginTop: 12}}>
                Recreate the terminal mood with clean motion, dense panels, and zero dependency on a live browser recording.
              </div>
            </div>
            <div style={{flex: 1, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14}}>
              {["QUOTES", "NEWS", "SCRN", "ECON"].map((code, index) => (
                <div
                  key={code}
                  style={{
                    borderRadius: 14,
                    border: `1px solid ${COLORS.border}`,
                    background: "rgba(255,255,255,0.02)",
                    padding: 18,
                    opacity: reveal,
                    transform: `translateY(${(3 - index) * 2}px)`,
                  }}
                >
                  <div className="panel-kicker">Module</div>
                  <div style={{fontSize: 34, marginTop: 10, color: index % 2 === 0 ? COLORS.amber : COLORS.cyan}}>{code}</div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </SceneFrame>
  );
};

const MarketScene = ({duration}: {duration: number}) => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame duration={duration}>
      <div style={{display: "grid", gridTemplateRows: "180px 1fr", gap: 24, height: "100%"}}>
        <div style={{display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 18}}>
          {INDEX_CARDS.map((card, index) => {
            const cardFrame = Math.max(frame - index * 5, 0);
            const price = countUp(cardFrame, card.price * 0.985, card.price, 38);
            const change = countUp(cardFrame, 0, card.change, 42);
            return (
              <div
                key={card.symbol}
                className="terminal-panel"
                style={{padding: 18, opacity: clamp(cardFrame / 20), transform: `translateY(${interpolate(clamp(cardFrame / 20), [0, 1], [20, 0])}px)`}}
              >
                <div className="panel-kicker">{card.label}</div>
                <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 10}}>
                  <div style={{fontSize: 18, color: COLORS.amber}}>{card.symbol}</div>
                  <div className={moveClass(card.change)} style={{fontSize: 18}}>{percentLabel(change)}</div>
                </div>
                <div style={{fontSize: 38, marginTop: 6, fontWeight: 700}}>{formatPrice(price)}</div>
                <div style={{marginTop: 14}}>
                  <LineChart points={card.points} color={moveColor(card.change)} delay={index * 5} height={62} gridLines={3} />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 24}}>
          <Panel
            title="Market overview hero"
            kicker="Global dashboard"
            rightSlot={<span className="status-badge positive">Breadth 67% above 20D</span>}
            style={{height: "100%"}}
          >
            <div style={{display: "grid", gridTemplateColumns: "1.35fr 0.65fr", gap: 20, height: "100%"}}>
              <div style={{display: "flex", flexDirection: "column", gap: 18}}>
                <div style={{fontSize: 44, lineHeight: 1.1, maxWidth: 800}}>
                  Start from the tape: global indices, movers, heatmap, and risk regime in one sweep.
                </div>
                <div className="story-chip-row">
                  <span className="story-chip active">Open / pre / after-hours aware</span>
                  <span className="story-chip active">Cross-asset tape</span>
                  <span className="story-chip active">Visual breadth</span>
                </div>
                <div style={{display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14}}>
                  {[
                    {label: "Fear/Greed", value: countUp(frame, 42, 68, 55).toFixed(0), cls: "metric-positive"},
                    {label: "VIX", value: countUp(frame, 17.9, 15.4, 55).toFixed(1), cls: "metric-positive"},
                    {label: "High/Low", value: `${countUp(frame, 182, 241, 55).toFixed(0)} / ${countUp(frame, 73, 41, 55).toFixed(0)}`, cls: "metric-amber"},
                    {label: "FX vol", value: countUp(frame, 8.9, 7.8, 55).toFixed(1), cls: "metric-cyan"},
                  ].map((item) => (
                    <div key={item.label} style={{padding: 16, borderRadius: 14, border: `1px solid ${COLORS.border}`, background: "rgba(255,255,255,0.02)"}}>
                      <div className="panel-kicker">{item.label}</div>
                      <div className={item.cls} style={{fontSize: 28, marginTop: 10}}>{item.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, flex: 1}}>
                  {HEATMAP.map((cell, index) => (
                    <div
                      key={cell.symbol}
                      style={{
                        gridColumn: `span ${cell.size}`,
                        minHeight: 82 + cell.size * 12,
                        borderRadius: 16,
                        border: `1px solid ${cell.move >= 0 ? COLORS.greenSoft : COLORS.redSoft}`,
                        background: cell.move >= 0 ? "rgba(40,209,124,0.12)" : "rgba(255,91,77,0.12)",
                        padding: 16,
                        opacity: clamp((frame - index * 2) / 18),
                      }}
                    >
                      <div style={{fontSize: 18, color: COLORS.text}}>{cell.symbol}</div>
                      <div className={moveClass(cell.move)} style={{fontSize: 26, marginTop: 6}}>{percentLabel(cell.move, 1)}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{display: "flex", flexDirection: "column", gap: 18}}>
                <Panel title="Flow" kicker="Now" style={{height: "50%"}}>
                  <div style={{display: "grid", gap: 18}}>
                    {[
                      {label: "Top gainers", value: "Semis + software"},
                      {label: "Weakest tape", value: "Rate-sensitive REITs"},
                      {label: "Macro tone", value: "Goldilocks, lower vol"},
                    ].map((row) => (
                      <div key={row.label} style={{display: "flex", justifyContent: "space-between", fontSize: 20}}>
                        <span className="mono-muted">{row.label}</span>
                        <span style={{color: COLORS.text}}>{row.value}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
                <Panel title="Most active" kicker="Scanner" style={{height: "50%"}}>
                  <table className="terminal-table">
                    <tbody>
                      {[
                        {symbol: "NVDA", last: 952.14, change: 2.8},
                        {symbol: "AMD", last: 186.51, change: 3.4},
                        {symbol: "TSLA", last: 173.22, change: -1.9},
                        {symbol: "AAPL", last: 214.32, change: -0.4},
                      ].map((row) => (
                        <tr key={row.symbol}>
                          <td style={{color: COLORS.amber}}>{row.symbol}</td>
                          <td style={{textAlign: "right"}}>{formatPrice(row.last)}</td>
                          <td className={moveClass(row.change)} style={{textAlign: "right"}}>{percentLabel(row.change, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>
              </div>
            </div>
          </Panel>

          <Panel title="Storyboard cue" kicker="Product story" style={{height: "100%"}}>
            <div style={{display: "flex", flexDirection: "column", gap: 16}}>
              <div style={{fontSize: 34, lineHeight: 1.2}}>Open on the whole market, then dive directly into the instrument that matters.</div>
              <div className="soft-divider" />
              <div style={{display: "grid", gap: 12}}>
                {["Global indices animate in with live-looking counters", "Heatmap shows breadth without narration", "Ticker tape maintains motion and terminal credibility"].map((point) => (
                  <div key={point} style={{display: "flex", gap: 12, alignItems: "flex-start", fontSize: 20}}>
                    <span style={{color: COLORS.amber}}>▸</span>
                    <span>{point}</span>
                  </div>
                ))}
              </div>
              <div style={{flex: 1, display: "flex", alignItems: "flex-end"}}>
                <div style={{padding: 18, borderRadius: 16, border: `1px solid ${COLORS.border}`, background: "rgba(70,199,255,0.08)", color: COLORS.cyan, fontSize: 26, lineHeight: 1.25}}>
                  blmtrm makes the first screen useful enough to orient, not just decorative enough to impress.
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </SceneFrame>
  );
};

const SingleNameScene = ({duration}: {duration: number}) => {
  const frame = useCurrentFrame();
  const command = typeText("/ NVDA US <EQUITY> // quote + chart + peer context", frame, 24);
  const quote = countUp(frame, 938.2, 952.14, 44);
  const pct = countUp(frame, 0, 2.83, 44);

  return (
    <SceneFrame duration={duration}>
      <div style={{display: "grid", gridTemplateRows: "88px 1fr", gap: 24, height: "100%"}}>
        <div className="terminal-panel" style={{padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between"}}>
          <div style={{fontSize: 28, color: COLORS.amber}}>
            {command}
            {frame < 160 ? <span className="type-cursor" /> : null}
          </div>
          <span className="status-badge positive">Single-name workflow</span>
        </div>

        <div style={{display: "grid", gridTemplateColumns: "0.74fr 1.26fr", gap: 24}}>
          <Panel title="Quote snapshot" kicker="NVDA US" style={{height: "100%"}}>
            <div style={{display: "flex", flexDirection: "column", gap: 18, height: "100%"}}>
              <div>
                <div style={{fontSize: 62, fontWeight: 700, lineHeight: 1}}>{formatPrice(quote)}</div>
                <div className={moveClass(pct)} style={{fontSize: 28, marginTop: 10}}>{percentLabel(pct, 2)} today</div>
              </div>
              <div style={{display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14}}>
                {[
                  {label: "Mkt cap", value: "$2.34T", cls: "metric-amber"},
                  {label: "Volume", value: "71.2M", cls: "metric-positive"},
                  {label: "1Y alpha", value: "+142%", cls: "metric-positive"},
                  {label: "Short int", value: "0.9%", cls: "metric-cyan"},
                  {label: "Next event", value: "Earnings 12d", cls: "metric-amber"},
                  {label: "Peer spread", value: "+310bp", cls: "metric-positive"},
                ].map((item) => (
                  <div key={item.label} style={{padding: 16, borderRadius: 14, border: `1px solid ${COLORS.border}`, background: "rgba(255,255,255,0.02)"}}>
                    <div className="panel-kicker">{item.label}</div>
                    <div className={item.cls} style={{fontSize: 28, marginTop: 8}}>{item.value}</div>
                  </div>
                ))}
              </div>
              <div style={{padding: 18, borderRadius: 16, background: COLORS.amberSoft, border: `1px solid ${COLORS.amberSoft}`}}>
                <div className="panel-kicker">Fast take</div>
                <div style={{fontSize: 26, lineHeight: 1.3, marginTop: 10}}>
                  Demand remains supply-constrained, estimate revisions are still moving up, and price confirms the narrative.
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Chart + insight" kicker="Price action" rightSlot={<span className="status-badge">1D / 1W / 1M / 1Y</span>} style={{height: "100%"}}>
            <div style={{display: "grid", gridTemplateRows: "1fr 180px", gap: 18, height: "100%"}}>
              <div style={{position: "relative", borderRadius: 18, border: `1px solid ${COLORS.border}`, padding: 18, background: "rgba(255,255,255,0.02)"}}>
                <LineChart
                  points={[38, 40, 43, 45, 47, 51, 55, 58, 61, 63, 66, 70, 72, 74, 71, 76, 82, 88, 90, 93]}
                  color={COLORS.amber}
                  delay={12}
                  height={390}
                  gridLines={5}
                />
                <div
                  style={{
                    position: "absolute",
                    left: `${interpolate(frame, [20, 120], [24, 760], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})}px`,
                    top: 30,
                    bottom: 30,
                    width: 2,
                    background: "linear-gradient(180deg, rgba(255,255,255,0.0), rgba(255,255,255,0.45), rgba(255,255,255,0.0))",
                  }}
                />
                <div style={{position: "absolute", right: 24, top: 28, display: "grid", gap: 12, width: 280}}>
                  {[
                    {label: "Relative strength", value: "94th pct", cls: "metric-positive"},
                    {label: "Volume delta", value: "+38% vs 20D", cls: "metric-positive"},
                    {label: "Range expansion", value: "Breakout holds", cls: "metric-amber"},
                  ].map((callout, index) => (
                    <div
                      key={callout.label}
                      style={{
                        padding: 14,
                        borderRadius: 14,
                        background: "rgba(0,0,0,0.32)",
                        border: `1px solid ${COLORS.border}`,
                        opacity: clamp((frame - 36 - index * 10) / 14),
                      }}
                    >
                      <div className="panel-kicker">{callout.label}</div>
                      <div className={callout.cls} style={{fontSize: 22, marginTop: 8}}>{callout.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16}}>
                {[
                  {title: "Catalyst", body: "Hyperscaler capex commentary keeps AI infrastructure narrative firm."},
                  {title: "Peer check", body: "AVGO + AMD confirm the move; SOX breadth broadens beyond one name."},
                  {title: "Action", body: "Jump from quote to chart to watchlist without leaving the terminal frame."},
                ].map((card) => (
                  <div key={card.title} style={{borderRadius: 16, border: `1px solid ${COLORS.border}`, padding: 18, background: "rgba(255,255,255,0.02)"}}>
                    <div className="panel-kicker">{card.title}</div>
                    <div style={{fontSize: 20, lineHeight: 1.35, marginTop: 10}}>{card.body}</div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </SceneFrame>
  );
};

const ResearchScene = ({duration}: {duration: number}) => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame duration={duration}>
      <div style={{display: "grid", gridTemplateColumns: "1.1fr 0.9fr 0.9fr", gap: 24, height: "100%"}}>
        <Panel title="News flow" kicker="Research workflow" rightSlot={<span className="status-badge positive">Source clustered</span>} style={{height: "100%"}}>
          <div style={{display: "flex", flexDirection: "column", gap: 14}}>
            {RESEARCH_NEWS.map((item, index) => (
              <div
                key={item.headline}
                style={{
                  borderRadius: 16,
                  border: `1px solid ${COLORS.border}`,
                  background: item.tone === "positive" ? COLORS.greenSoft : item.tone === "negative" ? COLORS.redSoft : "rgba(255,255,255,0.02)",
                  padding: 16,
                  opacity: clamp((frame - index * 8) / 16),
                  transform: `translateX(${interpolate(clamp((frame - index * 8) / 16), [0, 1], [18, 0])}px)`,
                }}
              >
                <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                  <span className="panel-kicker">{item.source}</span>
                  <span className="mono-muted">{item.time}</span>
                </div>
                <div style={{fontSize: 23, lineHeight: 1.3, marginTop: 10}}>{item.headline}</div>
              </div>
            ))}
            <div style={{marginTop: 4, padding: 18, borderRadius: 16, border: `1px solid ${COLORS.amberSoft}`, background: COLORS.amberSoft}}>
              <div className="panel-kicker">What matters</div>
              <div style={{fontSize: 26, lineHeight: 1.3, marginTop: 10}}>
                Read the tape, rank the headlines, and promote only the stories that actually move positioning.
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Screener" kicker="Cross-sectional view" style={{height: "100%"}}>
          <table className="terminal-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Sector</th>
                <th style={{textAlign: "right"}}>Mom.</th>
                <th style={{textAlign: "right"}}>Rev</th>
                <th style={{textAlign: "right"}}>Day</th>
              </tr>
            </thead>
            <tbody>
              {SCREENER_ROWS.map((row, index) => (
                <tr key={row.symbol} style={{opacity: clamp((frame - 12 - index * 7) / 14)}}>
                  <td style={{color: COLORS.amber}}>{row.symbol}</td>
                  <td>{row.sector}</td>
                  <td style={{textAlign: "right"}}>{row.momentum}</td>
                  <td style={{textAlign: "right"}}>{row.rev}</td>
                  <td className={moveClass(row.change)} style={{textAlign: "right"}}>{percentLabel(row.change, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{position: "absolute", left: 20, right: 20, bottom: 20, display: "grid", gap: 12}}>
            {[
              "Sort by revision breadth, not just momentum.",
              "Pivot from screen result straight into a quote or chart panel.",
            ].map((text) => (
              <div key={text} style={{fontSize: 18, color: COLORS.muted, lineHeight: 1.35}}>
                {text}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Economics" kicker="Calendar + surprise" style={{height: "100%"}}>
          <div style={{display: "grid", gap: 14}}>
            {ECON_EVENTS.map((event, index) => (
              <div
                key={event.label}
                style={{
                  borderRadius: 16,
                  border: `1px solid ${COLORS.border}`,
                  background: "rgba(255,255,255,0.02)",
                  padding: 16,
                  opacity: clamp((frame - 18 - index * 8) / 14),
                }}
              >
                <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                  <span className="panel-kicker">{event.time}</span>
                  <span className="status-badge">{event.surprise}</span>
                </div>
                <div style={{fontSize: 22, marginTop: 10}}>{event.label}</div>
                <div style={{display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 18}}>
                  <span className="mono-muted">Actual {event.actual}</span>
                  <span className="mono-muted">Prev {event.previous}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </SceneFrame>
  );
};

const RiskScene = ({duration}: {duration: number}) => {
  const frame = useCurrentFrame();
  const portfolioPnl = countUp(frame, 0.4, 2.04, 54);

  return (
    <SceneFrame duration={duration}>
      <div style={{display: "grid", gridTemplateColumns: "0.82fr 1.18fr", gap: 24, height: "100%"}}>
        <Panel title="Alerts" kicker="Risk workflow" rightSlot={<span className="status-badge negative">1 triggered</span>} style={{height: "100%"}}>
          <div style={{display: "grid", gap: 14}}>
            {ALERTS.map((alert, index) => {
              const statusClass = alert.state === "triggered" ? "negative" : alert.state === "armed" ? "positive" : "";
              return (
                <div
                  key={`${alert.symbol}-${alert.condition}`}
                  style={{
                    borderRadius: 16,
                    border: `1px solid ${COLORS.border}`,
                    background: alert.state === "triggered" ? COLORS.redSoft : "rgba(255,255,255,0.02)",
                    padding: 18,
                    opacity: clamp((frame - index * 8) / 14),
                  }}
                >
                  <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                    <div style={{fontSize: 22, color: COLORS.amber}}>{alert.symbol}</div>
                    <span className={`status-badge ${statusClass}`}>{alert.state}</span>
                  </div>
                  <div style={{fontSize: 20, marginTop: 10}}>{alert.condition}</div>
                </div>
              );
            })}
          </div>
          <div style={{position: "absolute", left: 20, right: 20, bottom: 20, padding: 16, borderRadius: 16, background: "rgba(255,255,255,0.02)", border: `1px solid ${COLORS.border}`}}>
            <div className="panel-kicker">Triggered message</div>
            <div style={{fontSize: 24, lineHeight: 1.3, marginTop: 10}}>
              US10Y crossed below 4.05%. Surface duration beneficiaries and update hedge context.
            </div>
          </div>
        </Panel>

        <Panel title="Portfolio monitor" kicker="Exposure + contribution" rightSlot={<span className="status-badge positive">Day P/L {percentLabel(portfolioPnl, 2)}</span>} style={{height: "100%"}}>
          <div style={{display: "grid", gridTemplateRows: "172px 1fr", gap: 20, height: "100%"}}>
            <div style={{display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16}}>
              {[
                {label: "Net exposure", value: `${countUp(frame, 71, 76, 40).toFixed(0)}%`, cls: "metric-amber"},
                {label: "Beta", value: countUp(frame, 0.91, 1.08, 40).toFixed(2), cls: "metric-cyan"},
                {label: "VaR (1d)", value: `${countUp(frame, 1.3, 1.9, 40).toFixed(1)}%`, cls: "metric-negative"},
              ].map((item) => (
                <div key={item.label} style={{padding: 18, borderRadius: 16, border: `1px solid ${COLORS.border}`, background: "rgba(255,255,255,0.02)"}}>
                  <div className="panel-kicker">{item.label}</div>
                  <div className={item.cls} style={{fontSize: 34, marginTop: 12}}>{item.value}</div>
                </div>
              ))}
            </div>

            <div style={{display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 18}}>
              <div style={{borderRadius: 16, border: `1px solid ${COLORS.border}`, padding: 18, background: "rgba(255,255,255,0.02)"}}>
                <table className="terminal-table">
                  <thead>
                    <tr>
                      <th>Position</th>
                      <th style={{textAlign: "right"}}>Wgt</th>
                      <th style={{textAlign: "right"}}>Day P/L</th>
                      <th style={{textAlign: "right"}}>Ctrb</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PORTFOLIO.map((row, index) => (
                      <tr key={row.symbol} style={{opacity: clamp((frame - 8 - index * 5) / 12)}}>
                        <td style={{color: row.symbol === "Cash" ? COLORS.text : COLORS.amber}}>{row.symbol}</td>
                        <td style={{textAlign: "right"}}>{row.weight}%</td>
                        <td className={moveClass(row.pnl)} style={{textAlign: "right"}}>{percentLabel(row.pnl, 1)}</td>
                        <td className={moveClass(row.contribution)} style={{textAlign: "right"}}>{signed(row.contribution, 2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{display: "grid", gap: 14}}>
                <div style={{padding: 18, borderRadius: 16, border: `1px solid ${COLORS.border}`, background: "rgba(255,255,255,0.02)"}}>
                  <div className="panel-kicker">Allocation bars</div>
                  <div style={{display: "grid", gap: 12, marginTop: 14}}>
                    {PORTFOLIO.slice(0, 5).map((row) => (
                      <div key={row.symbol}>
                        <div style={{display: "flex", justifyContent: "space-between", marginBottom: 6}}>
                          <span style={{color: COLORS.text}}>{row.symbol}</span>
                          <span className="mono-muted">{row.weight}%</span>
                        </div>
                        <div style={{height: 10, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden"}}>
                          <div
                            style={{
                              height: "100%",
                              width: `${row.weight}%`,
                              background: row.pnl >= 0 ? `linear-gradient(90deg, ${COLORS.green}, ${COLORS.cyan})` : `linear-gradient(90deg, ${COLORS.red}, ${COLORS.amber})`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{padding: 18, borderRadius: 16, border: `1px solid ${COLORS.amberSoft}`, background: COLORS.amberSoft}}>
                  <div className="panel-kicker">Why it matters</div>
                  <div style={{fontSize: 24, lineHeight: 1.35, marginTop: 10}}>
                    Alerts feed directly into portfolio context, so the desk sees exposure and actionability in the same frame.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </SceneFrame>
  );
};

const AgentScene = ({duration}: {duration: number}) => {
  const frame = useCurrentFrame();
  const prompt = typeText("What changed after CPI, which names benefit, and what hedge should I arm?", frame, 26);

  return (
    <SceneFrame duration={duration}>
      <div style={{display: "grid", gridTemplateColumns: "0.88fr 1.12fr", gap: 24, height: "100%"}}>
        <Panel title="Prompt" kicker="AI workflow" rightSlot={<span className="status-badge">Claude Sonnet</span>} style={{height: "100%"}}>
          <div style={{display: "flex", flexDirection: "column", gap: 18, height: "100%"}}>
            <div style={{padding: 20, borderRadius: 18, border: `1px solid ${COLORS.amberSoft}`, background: COLORS.amberSoft}}>
              <div className="panel-kicker">User</div>
              <div style={{fontSize: 32, lineHeight: 1.28, marginTop: 10, minHeight: 168}}>
                {prompt}
                {frame < 90 ? <span className="type-cursor" /> : null}
              </div>
            </div>
            <div className="story-chip-row">
              <span className="story-chip active">Summarize macro</span>
              <span className="story-chip active">Name the winners</span>
              <span className="story-chip active">Surface the hedge</span>
            </div>
            <div style={{display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14, marginTop: "auto"}}>
              {[
                {title: "Context", value: "Macro + tape + positions"},
                {title: "Latency", value: "Streamed to terminal"},
                {title: "Outcome", value: "Answer + actions"},
              ].map((card) => (
                <div key={card.title} style={{padding: 16, borderRadius: 14, border: `1px solid ${COLORS.border}`, background: "rgba(255,255,255,0.02)"}}>
                  <div className="panel-kicker">{card.title}</div>
                  <div style={{fontSize: 22, marginTop: 10, lineHeight: 1.3}}>{card.value}</div>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Streamed answer" kicker="BLMTRM AI" rightSlot={<span className="status-badge positive">Reasoning in flow</span>} style={{height: "100%"}}>
          <div style={{display: "flex", flexDirection: "column", gap: 16}}>
            {AGENT_LINES.map((line, index) => {
              const start = 24 + index * 28;
              const visible = typeText(line, Math.max(frame - start, 0), 30);
              const showCursor = frame >= start && frame < start + Math.ceil((line.length / 30) * DEMO_FPS);
              return (
                <div key={line} style={{padding: 16, borderRadius: 16, border: `1px solid ${COLORS.border}`, background: index === AGENT_LINES.length - 1 ? COLORS.greenSoft : "rgba(255,255,255,0.02)"}}>
                  <div className="panel-kicker">{index === 0 ? "Summary" : index === AGENT_LINES.length - 1 ? "Action" : `Point ${index}`}</div>
                  <div style={{fontSize: 24, lineHeight: 1.4, marginTop: 10, minHeight: 68}}>
                    {visible}
                    {showCursor ? <span className="type-cursor" /> : null}
                  </div>
                </div>
              );
            })}
            <div style={{display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, marginTop: "auto"}}>
              <div style={{padding: 18, borderRadius: 16, border: `1px solid ${COLORS.border}`, background: "rgba(255,255,255,0.02)"}}>
                <div className="panel-kicker">Follow-up</div>
                <div style={{fontSize: 22, marginTop: 10}}>Open QQQ hedge panel and pre-fill trigger at 495.00.</div>
              </div>
              <div style={{padding: 18, borderRadius: 16, border: `1px solid ${COLORS.border}`, background: COLORS.cyanSoft}}>
                <div className="panel-kicker">Workflow payoff</div>
                <div style={{fontSize: 22, marginTop: 10}}>The answer reads like a desk note, not a chatbot transcript.</div>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </SceneFrame>
  );
};

const ClosingScene = ({duration}: {duration: number}) => {
  const frame = useCurrentFrame();
  const cards = [
    {label: "MRKT", title: "Global market overview", tone: COLORS.amberSoft},
    {label: "QUOT", title: "Quote + chart insight", tone: COLORS.greenSoft},
    {label: "RSCH", title: "News, screener, economics", tone: COLORS.cyanSoft},
    {label: "RISK", title: "Alerts + portfolio context", tone: COLORS.redSoft},
  ];

  return (
    <SceneFrame duration={duration}>
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, height: "100%"}}>
        <div style={{display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 18}}>
          {cards.map((card, index) => (
            <div
              key={card.label}
              className="terminal-panel"
              style={{
                padding: 22,
                background: `linear-gradient(180deg, ${card.tone}, rgba(12, 14, 16, 0.95))`,
                opacity: clamp((frame - index * 8) / 14),
              }}
            >
              <div className="panel-kicker">{card.label}</div>
              <div style={{fontSize: 30, lineHeight: 1.2, marginTop: 12}}>{card.title}</div>
              <div style={{marginTop: 24, height: 110, borderRadius: 16, border: `1px solid ${COLORS.border}`, background: "rgba(0,0,0,0.18)"}} />
            </div>
          ))}
        </div>

        <Panel title="Closing card" kicker="Call to action" style={{height: "100%"}}>
          <div style={{display: "flex", flexDirection: "column", justifyContent: "center", height: "100%"}}>
            <div className="panel-kicker">blmtrm</div>
            <div style={{fontSize: 76, lineHeight: 0.98, fontWeight: 700, marginTop: 18, maxWidth: 720}}>
              Terminal-speed context for market, research, risk, and AI workflows.
            </div>
            <div style={{fontSize: 30, lineHeight: 1.35, color: COLORS.muted, marginTop: 24, maxWidth: 760}}>
              One polished 60-second composition. One render command. No live browser dependency.
            </div>
            <div className="story-chip-row" style={{marginTop: 28}}>
              <span className="story-chip active">npm run video:studio</span>
              <span className="story-chip active">npm run video:render</span>
            </div>
            <div style={{marginTop: 34, padding: 20, borderRadius: 16, background: COLORS.amberSoft, border: `1px solid ${COLORS.amberSoft}`, fontSize: 28, lineHeight: 1.3}}>
              Discoverable composition: <span style={{color: COLORS.amber}}>BLMTRMTerminalDemo</span>
            </div>
          </div>
        </Panel>
      </div>
    </SceneFrame>
  );
};

export const DemoVideo = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill className="remotion-terminal">
      <div className="scanlines" />
      <div className="terminal-shell">
        <TerminalHeader frame={frame} />
        <TickerStrip />
        <div className="terminal-content">
          <Sequence from={sceneStarts.intro} durationInFrames={SCENES[0].duration} premountFor={DEMO_FPS}>
            <IntroScene duration={SCENES[0].duration} />
          </Sequence>
          <Sequence from={sceneStarts.market} durationInFrames={SCENES[1].duration} premountFor={DEMO_FPS}>
            <MarketScene duration={SCENES[1].duration} />
          </Sequence>
          <Sequence from={sceneStarts.single} durationInFrames={SCENES[2].duration} premountFor={DEMO_FPS}>
            <SingleNameScene duration={SCENES[2].duration} />
          </Sequence>
          <Sequence from={sceneStarts.research} durationInFrames={SCENES[3].duration} premountFor={DEMO_FPS}>
            <ResearchScene duration={SCENES[3].duration} />
          </Sequence>
          <Sequence from={sceneStarts.risk} durationInFrames={SCENES[4].duration} premountFor={DEMO_FPS}>
            <RiskScene duration={SCENES[4].duration} />
          </Sequence>
          <Sequence from={sceneStarts.agent} durationInFrames={SCENES[5].duration} premountFor={DEMO_FPS}>
            <AgentScene duration={SCENES[5].duration} />
          </Sequence>
          <Sequence from={sceneStarts.close} durationInFrames={SCENES[6].duration} premountFor={DEMO_FPS}>
            <ClosingScene duration={SCENES[6].duration} />
          </Sequence>
        </div>
        <TerminalFooter frame={frame} />
      </div>
    </AbsoluteFill>
  );
};
