import type { ViewMode } from "./terminalTypes";
import { getExperienceViewLabel } from "./terminalExperience";
import { getWorkspaceForView, type WorkspaceKey } from "./featureRegistry";

export type CapabilityAudience = "all" | "internal" | "client";
export type CapabilityDomain = "finance" | "macro" | "supply-chain" | "sustainability" | "media" | "tourism" | "platform" | "delivery";

export interface TerminalCapabilityGuidance {
  /** Why this capability matters to the decision the user is trying to make. */
  why: string;
  /** What the user walks away with after using it. */
  outcome: string;
  /** The real question a user is trying to answer when they open this -- not
   * the feature name, the underlying question (manifesto Use-Case Contract
   * "user question"). Optional: not every capability needs a distinct one
   * beyond `why`. */
  userQuestion?: string;
  /** What can go wrong, what the result does NOT mean, or a real limitation
   * of the current implementation (e.g. synthetic data, a heuristic rather
   * than a validated model). Optional -- required only where a genuine
   * caveat exists; do not pad this field. */
  risks?: string;
  /** Logical next capabilities in the workflow this feeds into (manifesto
   * "next actions" / "context should drive the next action"). Mirrors, and
   * should stay consistent with, this view's outgoing edges in
   * terminalToolGraph.ts. */
  nextActions?: readonly ViewMode[];
}

export interface TerminalCapability {
  view: ViewMode;
  label: string;
  shortLabel: string;
  description: string;
  keywords: readonly string[];
  workspace: WorkspaceKey;
  domain: CapabilityDomain;
  audience: CapabilityAudience;
  hero: boolean;
  symbolAware: boolean;
  /** Guided-mode-only "why this matters / what you get" copy. Not every
   * capability has this yet -- absence is not an error, it just means
   * Guided mode falls back to `description` alone for that capability. */
  guidance?: TerminalCapabilityGuidance;
}

type Seed = Omit<TerminalCapability, "label" | "workspace"> & { label?: string };

const INTERNAL_ONLY = new Set<ViewMode>([
  "developer", "adminconsole", "consultinginbox", "publishdesk", "qualitygate", "research", "consensus", "brain",
  "decisionengine", "quantregistry", "quantlab", "integratedmodel", "marketdatafabric", "economicdatafabric",
  "universefabric", "crossassetfabric", "enginereadiness", "connectors", "uide", "conflictdetector",
]);

const CLIENT_ONLY = new Set<ViewMode>([
  "advisory", "activity", "crossdomainfusion", "decisionmemory", "clientdata",
]);

const SYMBOL_AWARE = new Set<ViewMode>([
  "entity", "quote", "chart", "news", "agent", "montecarlo", "options", "valuation", "fractal", "filingintel",
  "quantum", "flow", "peercomp", "backtesting", "companyfundamentals", "financialstatements", "datastats",
  "assetpricing", "advancedrisk", "integratedmodel", "marketdatafabric", "consensus", "research", "decisionengine",
  "conflictdetector",
]);

const DOMAIN_BY_VIEW: Partial<Record<ViewMode, CapabilityDomain>> = {
  economics: "macro", ecalendar: "macro", yieldcurve: "macro", globalindicators: "macro",
  globaldevelopment: "macro", indicatorexplorer: "macro", macrodashboard: "macro", indicatorworkbench: "macro",
  econsignals: "macro", econpolicyquant: "macro", macrostress: "macro",
  supplychainindicators: "supply-chain", supplychaindashboard: "supply-chain", supplychainquant: "supply-chain",
  environmentindicators: "sustainability", environmentdashboard: "sustainability", environmentquant: "sustainability",
  globalclimate: "sustainability", carbonintensity: "sustainability", environment: "platform",
  mediaindicators: "media", mediadashboard: "media", tourismindicators: "tourism", tourismdashboard: "tourism",
  workspaces: "delivery", spreadsheet: "delivery", mnadesk: "delivery", integration: "delivery", fpa: "delivery",
  advisory: "delivery", activity: "delivery", publishdesk: "delivery",
  uide: "platform", coveragemap: "platform", developer: "platform", adminconsole: "platform", consultinginbox: "platform",
  qualitygate: "platform", clientdata: "platform", quantregistry: "platform", quantlab: "platform", integratedmodel: "finance",
  marketdatafabric: "platform", economicdatafabric: "platform", universefabric: "platform", crossassetfabric: "platform",
  enginereadiness: "platform", connectors: "platform", conflictdetector: "platform",
};

const DESCRIPTIONS: Partial<Record<ViewMode, string>> = {
  missioncontrol: "Resume work, launch workflows, and see active analytical contexts.",
  artifact: "Continue the exact saved Chat Artifact in the full Workbench, then return to the same conversation.",
  entity: "Open a company or security as a persistent analytical context.",
  market: "Monitor cross-market conditions, leadership, and major moves.",
  quote: "Inspect price, market state, and core security descriptors.",
  chart: "Study price action and market structure with interactive charts.",
  news: "Review current company, market, and event evidence.",
  screener: "Discover securities using fundamental, market, and quantitative filters.",
  scanner: "Find technical patterns and event-driven setups across the universe.",
  watchlist: "Track selected securities and reusable research universes.",
  alerts: "Monitor conditions, triggers, and changing evidence.",
  companyfundamentals: "Inspect normalized operating, balance-sheet, and valuation fundamentals.",
  financialstatements: "Review income statement, balance sheet, and cash-flow history.",
  valuation: "Build DCF and intrinsic-value scenarios with editable assumptions.",
  peercomp: "Compare operating and valuation metrics across a peer set.",
  integratedmodel: "Build a connected three-statement forecast model.",
  advancedrisk: "Measure downside, tail, drawdown, and risk-adjusted behavior.",
  portfolio: "Analyze holdings, exposures, performance, and portfolio context.",
  personalfinance: "Calculate net worth, cash flow, debt payoff, goals, and retirement from user-owned inputs.",
  portfolioattribution: "Explain portfolio performance by allocation and selection effects.",
  portfoliostress: "Stress portfolio exposures under adverse scenarios.",
  correlation: "Inspect dependency, concentration, and diversification across assets.",
  optimizer: "Construct constrained portfolio allocations and efficient frontiers.",
  riskreturn: "Compare securities or strategies on risk-adjusted outcomes.",
  economics: "Review macroeconomic conditions and core economic releases.",
  macrodashboard: "See a structured macro dashboard across growth, inflation, labor, and rates.",
  indicatorexplorer: "Explore global economic and public-policy indicators.",
  indicatorworkbench: "Transform, regress, normalize, and compare economic time series.",
  econsignals: "Generate interpretable macro signals from economic relationships.",
  econpolicyquant: "Model policy and macroeconomic scenarios quantitatively.",
  supplychaindashboard: "Monitor freight, logistics, capacity, and supply-chain conditions.",
  supplychainindicators: "Explore underlying freight and logistics datasets.",
  supplychainquant: "Run quantitative network, capacity, and logistics scenarios.",
  environmentdashboard: "Monitor sustainability, emissions, energy, and transition indicators.",
  environmentindicators: "Explore emissions, energy, and sustainability datasets.",
  environmentquant: "Run sustainability and emissions scenario models.",
  globalclimate: "Monitor climate, weather, and physical-risk observations.",
  carbonintensity: "Benchmark carbon intensity and transition trajectories.",
  research: "Synthesize source-backed evidence into structured research.",
  consensus: "Compare internal views with expectations and variant perception.",
  decisionengine: "Turn evidence, scenarios, and contradictions into an auditable decision.",
  decisionmemory: "Track forecasts, assumptions, triggers, and outcomes through time.",
  brain: "Orchestrate multi-step investigations across data, models, and evidence.",
  spreadsheet: "Build reusable analytical models and exportable calculations.",
  workspaces: "Package analysis into durable workspaces and engagements.",
  clientdata: "Connect and work with user-owned datasets locally.",
  coveragemap: "Inspect data availability, provenance, and coverage by source.",
  conflictdetector: "Compare every provider's reported value for a field and see which source won, and why.",
};

// Guided-mode "why it matters / what you get" copy. Deliberately not
// filled in for all ~130 views -- prioritized to the hero views (already
// the most important surfaces) plus the panels most likely to need
// explanation: dense quant models (Ising, Hawkes, Quantum, Fractal,
// Entropy) and the platform's core differentiators (Decision Engine,
// Cross-Domain Fusion, Conflict Detector, etc). A missing entry is not a
// bug -- Guided mode falls back to `description` alone.
const GUIDANCE: Partial<Record<ViewMode, TerminalCapabilityGuidance>> = {
  missioncontrol: { why: "Every session should resume exactly where you left off, not force you to re-find your last thesis.", outcome: "A launch point showing active analytical contexts, recent tools, and next steps." },
  entity: { why: "Most real analysis starts from a specific company or security, not a menu.", outcome: "A persistent workspace scoped to one entity that every other tool can plug into." },
  market: { why: "You need one glance to know if today is a normal day or a day that changes your priorities.", outcome: "A cross-market read on leadership, breadth, and the moves that matter right now." },
  screener: { why: "Manually checking hundreds of names for one condition doesn't scale.", outcome: "A filtered list of securities that actually meet your fundamental, market, or quant criteria." },
  chart: { why: "Price action often confirms or contradicts a fundamental thesis before the numbers do.", outcome: "An interactive price/volume view with the technical context to time or validate a call." },
  financialstatements: { why: "Every valuation and risk judgment ultimately traces back to the filed numbers.", outcome: "Income statement, balance sheet, and cash-flow history in one normalized, comparable view." },
  valuation: { why: "A price target is only defensible if the assumptions behind it are visible and editable.", outcome: "A DCF/intrinsic-value model you can stress by changing growth, margin, or discount-rate assumptions." },
  peercomp: { why: "A number means little without knowing where it sits against comparable companies.", outcome: "Side-by-side operating and valuation multiples across a peer set you choose." },
  portfolio: { why: "Individual positions don't tell you what you're actually exposed to in aggregate.", outcome: "Holdings, exposures, and performance rolled up into one portfolio-level view." },
  personalfinance: { why: "Personal planning needs explicit user-owned inputs and assumptions rather than market proxies.", outcome: "A deterministic snapshot of net worth, cash flow, debt payoff, goals, and retirement progress.", userQuestion: "What does my current financial position imply for my goals?", risks: "Only supplied user-owned values are used; multiple currencies are not FX-normalized by the current local engine.", nextActions: ["portfolio", "montecarlo"] },
  portfoliostress: { why: "A portfolio that looks fine today can break under a scenario you haven't tested.", outcome: "P&L and exposure impact of your portfolio under adverse market scenarios you define." },
  macrodashboard: { why: "Bottom-up analysis is incomplete without the macro backdrop it's happening inside.", outcome: "One structured read on growth, inflation, labor, and rates instead of ten separate charts." },
  econpolicyquant: { why: "Policy changes ripple into company and portfolio outcomes long before they show up in earnings.", outcome: "A quantitative model of how a specific policy or macro scenario would propagate." },
  supplychaindashboard: { why: "Freight and logistics conditions are a leading indicator most financial models ignore.", outcome: "A live read on shipping, capacity, and freight conditions relevant to sourcing and cost risk." },
  supplychainquant: { why: "Supply-chain decisions (where to source, how much to hold) have quantifiable trade-offs.", outcome: "Network, capacity, and cost-to-serve scenarios you can run before committing to a decision." },
  environmentdashboard: { why: "Sustainability exposure is increasingly a financial and regulatory risk, not just a disclosure line.", outcome: "Emissions, energy, and transition-risk indicators in one dashboard." },
  environmentquant: { why: "ESG claims are only useful if you can model the financial consequence of a scenario.", outcome: "Quantitative sustainability/emissions scenario models tied to financial outcomes." },
  research: { why: "A defensible thesis needs evidence you can point back to, not a vague impression.", outcome: "Source-backed evidence assembled into a structured, citable research note." },
  decisionengine: { why: "Most bad calls come from an unexamined assumption, not bad data.", outcome: "An auditable decision: the evidence, the scenarios, the contradictions, and what would change your mind." },
  workspaces: { why: "Analysis that lives only in your head or a scattered set of tabs can't be handed off or revisited.", outcome: "A durable, shareable package of your analysis tied to a specific engagement." },
  spreadsheet: { why: "Some work still needs a model you can hand to someone else or export.", outcome: "A reusable, exportable analytical model built from live terminal data." },
  ising: { why: "Herding and crowd behavior move prices independent of fundamentals, and this makes that visible.", outcome: "A simulation of trader coordination showing when the market is coordinated (trending) vs. random (noisy).", userQuestion: "Is this market being driven by real information right now, or by traders copying each other?", risks: "A stylized simulation calibrated to illustrate herding dynamics, not a live measurement of this security's actual order flow.", nextActions: ["hawkes", "flow"] },
  hawkes: { why: "Volatility clusters -- one shock tends to trigger more shocks -- and this measures that clustering directly.", outcome: "A self-exciting event-intensity model showing how likely a new shock is right after the last one.", userQuestion: "After this shock, how likely is another one soon?", risks: "Self-exciting intensity is fit to historical event timing; it doesn't predict the direction or size of the next shock, only its likelihood.", nextActions: ["ising", "advancedrisk"] },
  quantum: { why: "Support and resistance levels don't hold with certainty; this quantifies the odds they break.", outcome: "A probability that price \"tunnels\" through a support/resistance barrier instead of bouncing off it.", userQuestion: "How likely is this support/resistance level to actually hold?", risks: "A probabilistic framing borrowed from quantum tunneling mechanics as an analogy, not a claim that markets are quantum systems.", nextActions: ["chart", "advancedrisk"] },
  fractal: { why: "Standard volatility models assume calm markets; this checks whether that assumption actually holds for this ticker.", outcome: "Persistence (Hurst), tail risk (kurtosis), and a GARCH/EGARCH volatility forecast fit to this security's own history.", userQuestion: "Does this ticker actually trend and cluster volatility the way standard models assume, or not?", risks: "Hurst/GARCH estimates need a long enough history to be reliable; short lookbacks give noisy estimates.", nextActions: ["advancedrisk", "flow"] },
  entropy: { why: "Cross-asset lead-lag relationships are often assumed, not measured; this tests them directly.", outcome: "A measure of how much one asset's history actually predicts another's, in either direction.", userQuestion: "Does asset A's history actually help predict asset B, or is that relationship assumed?", risks: "Transfer entropy measures statistical dependence in historical data, not a guarantee the relationship persists.", nextActions: ["correlation", "risknetwork"] },
  flow: { why: "The advanced quant models are more useful linked together than read in isolation.", outcome: "A combined view showing how coordination, event intensity, and other signals feed into one synthesis.", userQuestion: "How do these individual quant signals combine into one read?", risks: "A synthesis of the other quant panels' outputs -- inherits each of their individual limitations.", nextActions: ["ising", "hawkes"] },
  regime: { why: "The same strategy performs differently in a recession than a boom; knowing the regime changes what \"good\" looks like.", outcome: "A classification of the current macro regime so you can judge strategies against the right backdrop." },
  cryptochain: { why: "Crypto's real signal often lives on-chain, not in the price candle.", outcome: "On-chain activity and flow context alongside price for a digital asset." },
  shillercape: { why: "Trailing P/E overstates cheapness right after an earnings crash and understates it right after a boom.", outcome: "A cyclically-adjusted valuation read (CAPE) that smooths out that distortion.", userQuestion: "Is this cheap or expensive after smoothing out where we are in the earnings cycle?", risks: "CAPE is a long-horizon valuation signal, not a timing tool for near-term moves.", nextActions: ["valuation", "peercomp"] },
  correlation: { why: "Two assets that look diversifying can move together exactly when you need them not to.", outcome: "A dependency/correlation map showing real diversification, not assumed diversification." },
  optimizer: { why: "An intuitive-feeling allocation is rarely the mathematically efficient one.", outcome: "A constrained portfolio allocation on the efficient frontier, given your own risk/return targets." },
  riskreturn: { why: "Return alone doesn't tell you what risk was taken to get there.", outcome: "Securities or strategies ranked on a risk-adjusted, not just absolute, basis." },
  portfolioattribution: { why: "Knowing you beat the benchmark isn't useful without knowing whether skill or luck drove it.", outcome: "A breakdown of portfolio performance into allocation and selection effects." },
  advancedrisk: { why: "A single volatility number hides how bad the worst days actually were.", outcome: "Downside, tail, and drawdown risk measured in ways a simple standard deviation misses." },
  crossdomainfusion: { why: "A rate move or a policy shock doesn't stay inside one domain -- it moves through supply chains, sectors, and portfolios.", outcome: "A traced path showing how a shock in one domain propagates into consequences in another.", userQuestion: "If this macro shock happens, what actually happens to my real exposure?", nextActions: ["decisionmemory", "portfoliostress"] },
  decisionmemory: { why: "If you don't track what you predicted and why, you can't tell whether your process actually works.", outcome: "A record of past forecasts, the assumptions behind them, and how they turned out." },
  brain: { why: "A complex question usually needs several tools run in sequence, not one panel.", outcome: "A multi-step investigation that pulls data, runs models, and assembles evidence toward one question.", userQuestion: "What's the fastest path from a broad question to an evidenced answer?", risks: "Orchestrates existing tools and models; it does not invent data or override their validation status.", nextActions: ["research", "decisionengine"] },
  consensus: { why: "Being right isn't valuable if the market already agrees with you; being right where consensus is wrong is.", outcome: "Your view compared explicitly against market/analyst consensus, with the variant clearly flagged." },
  conflictdetector: { why: "Different data providers sometimes disagree on the same reported number, and blending them silently hides that.", outcome: "Every provider's reported value for a field, which one is treated as authoritative, and why.", userQuestion: "Which number is right when two data sources disagree?", risks: "Flags disagreement and shows the resolution rule; it does not adjudicate which provider is factually correct.", nextActions: ["research", "valuation"] },
  coveragemap: { why: "A model is only as good as the data behind it, and coverage gaps aren't always obvious.", outcome: "A map of what data is actually available, and from which source, before you rely on it.", userQuestion: "Is there enough real data behind this to trust a model built on it?", risks: "Shows what's available, not what's correct -- pair with Conflict Detector when sources disagree.", nextActions: ["conflictdetector", "valuation"] },
  enginereadiness: { why: "Before trusting an engine's output, you should know if it's actually validated and live.", outcome: "A readiness state for every quantitative engine -- validated, live, or still pending.", userQuestion: "Is this engine actually validated and safe to rely on, or still experimental?", risks: "Readiness reflects configuration and validation state, not real-time output quality for a specific run.", nextActions: ["quantregistry", "connectors"] },
  connectors: { why: "Every number in the terminal traces back to a specific data connector, and that connector's health matters.", outcome: "The truthful runtime state of every connector -- implemented, credentialed, verified, or catalog-only.", userQuestion: "Is the data behind this number actually live, or just catalog-declared?", risks: "Reports the connector's own runtime state; a \"live\" connector can still return stale or incomplete data upstream.", nextActions: ["enginereadiness", "coveragemap"] },
  clientdata: { why: "Some of the most decision-relevant data -- your own holdings, deal files, client records -- never comes from a public API.", outcome: "Your own files and datasets, connected locally and usable across the terminal's models without leaving your control.", userQuestion: "Can I bring my own data in and use it the same way as a market data feed?", risks: "Only as reliable as the file you upload; the terminal does not independently verify user-supplied data.", nextActions: ["portfolio", "workspaces"] },
  montecarlo: { why: "A single price forecast hides how wide the range of actual outcomes could be.", outcome: "A distribution of simulated future price paths built from this security's own drift and volatility.", userQuestion: "How much could this price realistically move, not just where might it land?", risks: "Paths are simulated from historical drift/volatility, not a guarantee of future distribution -- a regime change breaks the assumption.", nextActions: ["valuation", "advancedrisk"] },
  options: { why: "An option's price embeds a market view on volatility and probability that the raw quote doesn't show.", outcome: "Theoretical pricing, Greeks, and probability-of-touch for a contract, benchmarked against the live chain.", userQuestion: "Is this option fairly priced, and what does it actually imply about probability of profit?", risks: "Model prices are theoretical (Black-Scholes/binomial); real fills depend on live liquidity and the actual chain.", nextActions: ["montecarlo", "advancedrisk"] },
  fixedincome: { why: "Bond pricing and curve risk aren't intuitive from a quoted yield alone.", outcome: "Bond price/yield calculations and sovereign curve-shift scenarios you control directly.", userQuestion: "What happens to this bond's price, or the curve, under a rate move I define?", risks: "Sovereign curve data uses illustrative base yields; treat curve-shift scenarios as directional, not a live market feed.", nextActions: ["yieldcurve", "portfoliostress"] },
  assetpricing: { why: "Raw returns don't say whether performance came from market exposure, factor tilts, or skill.", outcome: "A regression of this security's returns against CAPM, Fama-French 3/5-factor, or Carhart 4-factor models.", userQuestion: "How much of this security's return is explained by known risk factors, versus unexplained alpha?", risks: "Factor regressions are backward-looking and sensitive to the lookback window chosen.", nextActions: ["riskreturn", "advancedrisk"] },
  sentiment: { why: "Price alone doesn't tell you whether the crowd is fearful, greedy, or somewhere in between -- and extremes often precede reversals.", outcome: "A fear/greed read plus cross-asset sentiment context alongside the news driving it.", userQuestion: "Is current sentiment stretched enough that it's a contrarian signal, or just noise?", risks: "Sentiment is a coincident/lagging market-mood read, not a standalone trading signal.", nextActions: ["news", "market"] },
  insiders: { why: "People with the most direct knowledge of a company are required to disclose when they buy or sell its stock.", outcome: "Recent insider open-market buys and sales, sourced from EDGAR and LSE regulatory filings.", userQuestion: "Are the people who know this company best buying or selling right now?", risks: "One trade rarely means much; look for clusters and context (10b5-1 plans, tax timing) before treating it as signal.", nextActions: ["entity", "research"] },
  cotpositioning: { why: "Futures positioning shows how large speculators and commercials are actually leaning, not just where price is.", outcome: "CFTC Commitment of Traders positioning across major commodity, index, and FX futures.", userQuestion: "Are large speculators crowded onto one side of this market?", risks: "COT data is a weekly, lagged snapshot (as of the prior Tuesday), not real-time positioning.", nextActions: ["forex", "crossasset"] },
  optionsflow: { why: "Unusually large options premium can reflect informed positioning before it shows up in the stock price.", outcome: "A live scan of large options trades by premium size, sourced from LSE options flow.", userQuestion: "Is there unusual options activity in this name right now, and how large?", risks: "Large premium can reflect hedging, not directional conviction -- flow alone doesn't disclose intent.", nextActions: ["options", "entity"] },
  shortinterest: { why: "How crowded a short position is changes how a stock behaves on both good and bad news.", outcome: "Short float, days-to-cover, and borrow rate, with a read on whether short interest is rising or falling.", userQuestion: "Is this name a short-squeeze risk, or is the short position stable?", risks: "Current dataset is illustrative for demonstration tickers, not a live FINRA/Quandl feed -- treat as directional only.", nextActions: ["entity", "sentiment"] },
  morningbrief: { why: "Before you decide what to look at today, you need one pass across overnight moves, news, and sentiment.", outcome: "A pre-market synthesis of index levels, news, sentiment, and top movers.", userQuestion: "What actually matters this morning before I start my day's analysis?", risks: "A synthesis, not a substitute for reading the underlying news and data it summarizes.", nextActions: ["news", "market"] },
  tradeideas: { why: "Turning a wall of tickers into a shortlist of what's actually worth a closer look saves real time.", outcome: "A generated shortlist of names flagged on price, volatility, valuation, and news/sentiment heuristics.", userQuestion: "Which names in my universe deserve a closer look today?", risks: "Ideas are generated from simple heuristics (price/vol/news proxies), not a validated or backtested strategy -- treat as a starting shortlist, not a recommendation.", nextActions: ["entity", "decisionengine"] },
  agent: { why: "Sometimes the fastest path to an answer is asking directly instead of navigating to the right panel yourself.", outcome: "A conversational assistant that can pull terminal data and navigate to the right analytical surface for you.", userQuestion: "Can I just ask this instead of finding the right tool myself?", risks: "Explains and navigates the terminal's own deterministic data and models; it does not calculate or invent numbers itself.", nextActions: ["entity", "research"] },
  risknetwork: { why: "A shock to one asset rarely stays contained -- it propagates through correlated names and sectors.", outcome: "A spillover network showing how a shock to one node propagates to correlated assets and sectors.", userQuestion: "If this name gets hit, what else in my universe is likely to move with it?", risks: "Covariance/spillover weights shown are illustrative proxies, not a live-estimated covariance matrix.", nextActions: ["correlation", "portfoliostress"] },
  watchlist: { why: "You can't act on a change you never see, and manually re-checking a list of names doesn't scale.", outcome: "A tracked list of securities and reusable research universes, with live prices and change alerts.", userQuestion: "What am I tracking right now, and has anything on my list changed?", nextActions: ["alerts", "entity"] },
  riskcalc: { why: "Quick risk math -- position sizing, VaR, exposure limits -- shouldn't require opening a spreadsheet.", outcome: "Standalone risk calculators for position sizing, VaR-style estimates, and exposure limits.", userQuestion: "Given my risk tolerance, how large a position should this actually be?", risks: "A calculator, not a portfolio-aware model -- pair with Portfolio Stress for full-book impact.", nextActions: ["portfoliostress", "advancedrisk"] },
  ecalendar: { why: "Central bank decisions and scheduled economic releases are known risk events, not surprises, if you're prepared for them.", outcome: "Upcoming economic releases and central bank rate decisions with market-implied probabilities for each outcome.", userQuestion: "What scheduled events could move markets in the next few weeks, and what does the market expect?", nextActions: ["econpolicyquant", "macrodashboard"] },
  marketdatafabric: { why: "A price you see today may get revised tomorrow, and knowing that matters for anything computed from it.", outcome: "Point-in-time price-bar snapshots for a symbol with a full revision history and lineage.", userQuestion: "What did the data actually look like at the time a model used it, before any later revisions?", nextActions: ["connectors", "enginereadiness"] },
  economicdatafabric: { why: "Economic series get revised constantly (initial vs. final GDP, for example), and the version a model used matters.", outcome: "Point-in-time snapshots of economic series and yield curves, with revision history.", userQuestion: "What did this economic series or curve actually show as of a specific date, before later revisions?", nextActions: ["econpolicyquant", "yieldcurve"] },
  universefabric: { why: "Index and universe membership changes over time, and using today's membership to backtest yesterday creates lookahead bias.", outcome: "Point-in-time security universe membership snapshots with entitlement policy and lineage.", userQuestion: "Who was actually in this universe as of a specific date, not just today?", nextActions: ["screener", "backtesting"] },
  crossassetfabric: { why: "Estimates, options chains, commodity curves, and portfolio holdings all need the same point-in-time discipline as prices do.", outcome: "Point-in-time snapshots across estimates, options, commodity curves, portfolio holdings, and private series.", userQuestion: "What did this alternative dataset look like as of a specific date?", nextActions: ["crossasset", "options"] },
  quantregistry: { why: "Not every quant model in the terminal has been independently validated, and knowing which is which changes how much weight to give the output.", outcome: "Every quant model's validation status -- validated, implemented, experimental, synthetic, or planned -- with open limitations.", userQuestion: "Can I actually trust this specific model's output, or is it still experimental?", nextActions: ["enginereadiness", "coveragemap"] },
  qualitygate: { why: "A client deliverable shouldn't leave the building without data, calculation, and assumption validation plus a real review trail.", outcome: "The explicit approval pipeline for a deliverable -- data, calculation, assumption, and citation validation through consultant and senior review.", userQuestion: "Has this deliverable actually cleared every required review, or is that step being skipped?", nextActions: ["research", "decisionengine"] },
  heatmap: { why: "Scanning a table of hundreds of tickers misses relative moves a visual map shows at a glance.", outcome: "A color-coded heat map of market or sector performance, sized and shaded by move." },
  globalindicators: { why: "Cross-country economic comparisons need a consistent dataset, not ad hoc lookups across sources.", outcome: "World Bank/IMF-sourced global economic indicators, comparable across countries." },
  marketbreadth: { why: "An index can rise on a handful of large stocks while most of the market falls -- breadth shows which is happening.", outcome: "Advance/decline and participation metrics showing how broad-based a market move actually is." },
  mediaindicators: { why: "Media tone shifts can precede or amplify price moves, especially around events.", outcome: "Media sentiment and topic-tone tracking for a company or sector." },
  mediadashboard: { why: "Individual headlines don't show the aggregate media narrative building around a company.", outcome: "A structured view of media coverage volume and tone over time." },
  tourismindicators: { why: "Travel and hospitality exposure needs sector-specific indicators that general macro data doesn't capture.", outcome: "Tourism and hospitality sector indicators -- arrivals, occupancy, spend." },
  advisory: { why: "Some questions need a person, not another panel.", outcome: "A direct channel to your advisory team." },
  activity: { why: "Knowing what changed in your own account or workspace matters as much as what changed in the market.", outcome: "An audit log of account and workspace activity." },
  developer: { why: "Engineering and support staff need visibility into system internals the analytical UI intentionally hides.", outcome: "An internal developer console for runtime diagnostics and configuration." },
  adminconsole: { why: "User, org, and license administration needs its own controls, separate from analytical workflows.", outcome: "Administrative controls for users, organizations, and licensing." },
  consultinginbox: { why: "Client requests need a triage queue, not scattered messages.", outcome: "A queue of incoming client requests and projects for the consulting team to triage." },
  publishdesk: { why: "Client-facing deliverables need a controlled publishing step, not an ad hoc export.", outcome: "The publishing workflow for turning internal work into a client-facing deliverable." },
  uide: { why: "Every client sends data in a different shape; hand-mapping every file doesn't scale.", outcome: "Automatic ingestion, profiling, and classification of uploaded files across every sheet." },
  integration: { why: "Post-merger integration has its own critical path and risks that a standard financial model doesn't track.", outcome: "A tracker for M&A integration milestones, critical-path risks, and dependencies." },
};

const KEYWORDS: Partial<Record<ViewMode, readonly string[]>> = {
  missioncontrol: ["lios power", "power mode", "power on", "full terminal", "advanced mode"],
  valuation: ["dcf", "value", "intrinsic value", "fcff", "fcfe", "wacc", "terminal value", "lbo", "dupont"],
  financialstatements: ["financials", "statements", "income statement", "balance sheet", "cash flow", "p&l"],
  companyfundamentals: ["fundamentals", "ratios", "filings", "company data"],
  peercomp: ["peers", "comps", "comparables", "relative valuation", "multiples"],
  advancedrisk: ["risk", "var", "cvar", "sortino", "drawdown", "tail risk"],
  portfolio: ["portfolio", "holdings", "positions", "exposure"],
  personalfinance: ["personal finance", "net worth", "cash flow", "retirement", "debt payoff", "savings", "goals", "wealth"],
  portfolioattribution: ["attribution", "brinson", "performance contribution"],
  portfoliostress: ["portfolio stress", "scenario", "shock", "stress test"],
  optimizer: ["optimize", "efficient frontier", "allocation", "black litterman"],
  screener: ["screen", "filter", "discover stocks", "universe"],
  scanner: ["scan", "pattern", "breakout", "technical setup"],
  news: ["news", "events", "headlines", "what changed", "macro news"],
  earnings: ["earnings", "eps", "earnings tracker", "earnings calendar"],
  research: ["research", "evidence", "thesis", "investigate"],
  consensus: ["consensus", "estimates", "expectations", "variant perception"],
  decisionengine: ["decision", "kill thesis", "reverse dcf", "decision receipt"],
  brain: ["brain", "orchestrate", "investigation", "one click"],
  economics: ["economy", "macro", "growth", "inflation", "labor"],
  macrodashboard: ["macro dashboard", "economy dashboard", "growth inflation rates"],
  indicatorexplorer: ["indicator", "world bank", "imf", "economic data"],
  econsignals: ["sahm", "okun", "taylor rule", "recession signal"],
  econpolicyquant: ["policy", "scenario", "fiscal", "monetary policy", "central bank", "fed", "fomc"],
  supplychaindashboard: ["supply chain", "freight", "logistics", "shipping"],
  supplychainquant: ["network design", "inventory", "routing", "capacity", "cost to serve"],
  environmentdashboard: ["sustainability", "esg", "emissions", "energy"],
  environmentquant: ["carbon model", "emissions scenario", "climate scenario"],
  spreadsheet: ["spreadsheet", "excel", "model", "table"],
  workspaces: ["workspace", "engagement", "save layout", "project"],
  clientdata: ["byod", "my data", "upload", "dataset"],
  conflictdetector: ["conflicts", "conflict", "data conflict", "authoritative source", "provider disagreement"],
};

const HERO_VIEWS = new Set<ViewMode>([
  "missioncontrol", "entity", "market", "screener", "chart", "financialstatements", "valuation", "peercomp",
  "portfolio", "personalfinance", "portfoliostress", "macrodashboard", "econpolicyquant", "supplychaindashboard", "supplychainquant",
  "environmentdashboard", "environmentquant", "research", "decisionengine", "workspaces", "spreadsheet",
]);

const SHORT_LABELS: Partial<Record<ViewMode, string>> = {
  missioncontrol: "HOME", entity: "X-RAY", financialstatements: "FIN", valuation: "DCF", peercomp: "PEERS",
  advancedrisk: "RISK", companyfundamentals: "FUND", portfolio: "PORT", personalfinance: "WEALTH", portfoliostress: "STRESS",
  portfolioattribution: "ATTR", macrodashboard: "MACRO", indicatorexplorer: "DATA", econsignals: "SIGNALS",
  econpolicyquant: "POLICY", supplychaindashboard: "SC DASH", supplychainquant: "SC MODEL",
  environmentdashboard: "ESG DASH", environmentquant: "ESG MODEL", research: "RESEARCH",
  decisionengine: "DECIDE", workspaces: "WORK", spreadsheet: "SHEET", clientdata: "MY DATA",
  conflictdetector: "CFLT",
};

const ALL_VIEWS: readonly ViewMode[] = [
  "missioncontrol", "entity", "market", "quote", "chart", "news", "agent", "screener", "watchlist", "alerts",
  "economics", "econpolicyquant", "supplychainquant", "environmentquant", "portfolio", "personalfinance", "montecarlo", "correlation",
  "options", "forex", "heatmap", "earnings", "ising", "optimizer", "valuation", "fixedincome", "fractal", "risknetwork",
  "filingintel", "quantum", "hawkes", "entropy", "flow", "macrostress", "sentiment", "yieldcurve", "peercomp", "ecalendar",
  "crossasset", "scanner", "morningbrief", "sectorrotation", "riskcalc", "portfoliostress", "dividends",
  "shortinterest", "regime", "cryptochain", "tradeideas", "backtesting", "mnadesk", "integration", "fpa", "optionsflow",
  "insiders", "developer", "adminconsole", "consultinginbox", "publishdesk", "cotpositioning",
  "globalindicators", "companyfundamentals", "financialstatements", "globaldevelopment", "globalclimate", "datastats",
  "assetpricing", "advancedrisk", "quantworkbench", "portfolioattribution", "riskreturn", "marketbreadth", "indicatorexplorer",
  "macrodashboard", "indicatorworkbench", "econsignals", "supplychainindicators", "supplychaindashboard", "environmentindicators",
  "environmentdashboard", "carbonintensity", "mediaindicators", "mediadashboard", "tourismindicators", "tourismdashboard",
  "uide", "coveragemap", "workspaces", "spreadsheet", "advisory", "activity", "shillercape", "crossdomainfusion",
  "decisionmemory", "qualitygate", "clientdata", "research", "consensus", "brain", "decisionengine", "quantregistry", "quantlab",
  "integratedmodel", "marketdatafabric", "economicdatafabric", "universefabric", "crossassetfabric", "enginereadiness", "connectors",
  "conflictdetector",
  "environment",
];

function defaultDescription(view: ViewMode): string {
  return `Open ${getExperienceViewLabel(view)} and continue the active analytical workflow.`;
}

function audienceFor(view: ViewMode): CapabilityAudience {
  if (INTERNAL_ONLY.has(view)) return "internal";
  if (CLIENT_ONLY.has(view)) return "client";
  return "all";
}

export const TERMINAL_CAPABILITIES: readonly TerminalCapability[] = ALL_VIEWS.map((view) => ({
  view,
  label: getExperienceViewLabel(view),
  shortLabel: SHORT_LABELS[view] ?? getExperienceViewLabel(view).toUpperCase().slice(0, 10),
  description: DESCRIPTIONS[view] ?? defaultDescription(view),
  keywords: KEYWORDS[view] ?? [],
  workspace: getWorkspaceForView(view),
  domain: DOMAIN_BY_VIEW[view] ?? "finance",
  audience: audienceFor(view),
  hero: HERO_VIEWS.has(view),
  symbolAware: SYMBOL_AWARE.has(view),
  guidance: GUIDANCE[view],
}));

export function isCapabilityVisible(capability: TerminalCapability, isInternal: boolean): boolean {
  if (capability.audience === "internal") return isInternal;
  if (capability.audience === "client") return !isInternal;
  return true;
}

export function getTerminalCapability(view: ViewMode): TerminalCapability {
  return TERMINAL_CAPABILITIES.find((capability) => capability.view === view) ?? {
    view,
    label: getExperienceViewLabel(view),
    shortLabel: getExperienceViewLabel(view).toUpperCase().slice(0, 10),
    description: defaultDescription(view),
    keywords: [],
    workspace: getWorkspaceForView(view),
    domain: "finance",
    audience: "all",
    hero: false,
    symbolAware: false,
  };
}

function scoreCapability(capability: TerminalCapability, query: string): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return capability.hero ? 10 : 1;
  const label = capability.label.toLowerCase();
  const shortLabel = capability.shortLabel.toLowerCase();
  let score = 0;
  if (label === normalized || shortLabel === normalized) score += 100;
  if (label.startsWith(normalized) || shortLabel.startsWith(normalized)) score += 60;
  if (label.includes(normalized) || shortLabel.includes(normalized)) score += 35;
  for (const keyword of capability.keywords) {
    const lower = keyword.toLowerCase();
    if (lower === normalized) score += 80;
    else if (lower.includes(normalized) || normalized.includes(lower)) score += 25;
  }
  if (capability.hero) score += 8;
  return score;
}

export function searchTerminalCapabilities(query: string, isInternal: boolean, limit = 16): TerminalCapability[] {
  return TERMINAL_CAPABILITIES
    .filter((capability) => isCapabilityVisible(capability, isInternal))
    .map((capability) => ({ capability, score: scoreCapability(capability, query) }))
    .filter((entry) => query.trim() ? entry.score > 0 : entry.capability.hero)
    .sort((a, b) => b.score - a.score || a.capability.label.localeCompare(b.capability.label))
    .slice(0, limit)
    .map((entry) => entry.capability);
}
