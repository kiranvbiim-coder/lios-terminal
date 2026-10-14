import { stdNormPDF, type OptionCalculationAudit } from "./optionsModels";

export interface FormulaNotebookLine {
  id: string;
  label: string;
  symbolic: string;
  substitution?: string;
  result?: string;
  note?: string;
}

export interface FormulaNotebookSection {
  id: string;
  title: string;
  description?: string;
  lines: FormulaNotebookLine[];
}

export interface OptionFormulaNotebook {
  model: string;
  instrument: string;
  methodology: string;
  sections: FormulaNotebookSection[];
  checks: Array<{ label: string; value: string; passed?: boolean }>;
  warnings: string[];
}

const fmt = (value: number, digits = 6): string => Number.isFinite(value) ? value.toFixed(digits) : "—";
const expFmt = (value: number, digits = 6): string => Number.isFinite(value) ? value.toExponential(digits) : "—";

function sideName(audit: OptionCalculationAudit): "Call" | "Put" {
  return audit.optionSide === "call" ? "Call" : "Put";
}

function buildFiniteDifferenceGreeks(audit: OptionCalculationAudit): FormulaNotebookSection {
  const { spot: S, volatility: sigma } = audit.inputs;
  const hS = Math.max(S * 0.001, 0.01);
  const hV = Math.max(0.0005, sigma * 0.0025);
  const hR = 0.0001;

  return {
    id: "finite-difference-greeks",
    title: "Greeks · same-engine finite differences",
    description: "Used for American exercise and for European pricing with discrete cash dividends so the sensitivities remain consistent with the pricing engine.",
    lines: [
      {
        id: "delta",
        label: "Delta Δ",
        symbolic: "Δ ≈ [V(S+hS) − V(S−hS)] / (2hS)",
        substitution: `hS = max(0.001×${fmt(S, 4)}, 0.01) = ${fmt(hS, 6)}`,
        result: fmt(audit.output.delta, 6),
        note: "Underlying units per option unit.",
      },
      {
        id: "gamma",
        label: "Gamma Γ",
        symbolic: "Γ ≈ [V(S+hS) − 2V(S) + V(S−hS)] / hS²",
        substitution: `hS = ${fmt(hS, 6)}`,
        result: fmt(audit.output.gamma, 8),
        note: "Change in delta per 1-unit spot move.",
      },
      {
        id: "theta",
        label: "Theta Θ",
        symbolic: "Θ/day ≈ [V(T−Δt) − V(T)] / calendar-days(Δt)",
        substitution: "Δt = min(1/365, T/2), with the cash-dividend schedule rolled forward consistently",
        result: fmt(audit.output.theta, 6),
        note: audit.conventions.thetaUnit,
      },
      {
        id: "vega",
        label: "Vega ν",
        symbolic: "Vega/1 vol pt ≈ {[V(σ+hσ) − V(σ−hσ)] / (2hσ)} × 0.01",
        substitution: `hσ = max(0.0005, 0.0025×${fmt(sigma, 6)}) = ${fmt(hV, 6)}`,
        result: fmt(audit.output.vega, 6),
        note: audit.conventions.vegaUnit,
      },
      {
        id: "rho",
        label: "Rho ρ",
        symbolic: "ρ/100bp ≈ {[V(r+hr) − V(r−hr)] / (2hr)} × 0.01",
        substitution: `hr = ${fmt(hR, 4)} (1bp decimal bump)` ,
        result: fmt(audit.output.rho, 6),
        note: audit.conventions.rhoUnit,
      },
    ],
  };
}

function buildEuropeanNotebook(audit: OptionCalculationAudit): FormulaNotebookSection[] {
  const { adjustedSpot: S } = audit.adjustments;
  const { strike: K, timeYears: T, rate: r, dividendYield: q, volatility: sigma } = audit.inputs;
  const d1 = audit.intermediates.d1;
  const d2 = audit.intermediates.d2;
  const nd1 = audit.intermediates.nd1;
  const nd2 = audit.intermediates.nd2;
  const sqrtT = Math.sqrt(T);
  const eqT = Math.exp(-q * T);
  const erT = Math.exp(-r * T);
  const pdfd1 = d1 == null ? null : stdNormPDF(d1);
  const nMinusD1 = nd1 == null ? null : 1 - nd1;
  const nMinusD2 = nd2 == null ? null : 1 - nd2;
  const isCall = audit.optionSide === "call";

  const core: FormulaNotebookSection = {
    id: "bsm-core",
    title: "Black-Scholes-Merton core",
    description: audit.inputs.discreteDividends.length > 0
      ? "Cash dividends are first converted to present value and removed from spot. The adjusted spot then enters the European BSM diffusion."
      : "Dividend-adjusted Black-Scholes-Merton with continuous compounding and ACT/365 time.",
    lines: [
      {
        id: "adjusted-spot",
        label: "Dividend-adjusted spot S*",
        symbolic: audit.inputs.discreteDividends.length > 0 ? "S* = S − PV(cash dividends before expiry)" : "S* = S",
        substitution: audit.inputs.discreteDividends.length > 0
          ? `${fmt(audit.inputs.spot, 6)} − ${fmt(audit.adjustments.discreteDividendPv, 6)}`
          : fmt(audit.inputs.spot, 6),
        result: fmt(S, 6),
        note: audit.adjustments.dividendMethod,
      },
      {
        id: "d1",
        label: "d₁",
        symbolic: "d₁ = [ln(S*/K) + (r − q + σ²/2)T] / (σ√T)",
        substitution: `[ln(${fmt(S, 6)}/${fmt(K, 6)}) + (${fmt(r, 6)} − ${fmt(q, 6)} + ${fmt(sigma, 6)}²/2)×${fmt(T, 8)}] / (${fmt(sigma, 6)}×√${fmt(T, 8)})`,
        result: d1 == null ? "—" : fmt(d1, 8),
      },
      {
        id: "d2",
        label: "d₂",
        symbolic: "d₂ = d₁ − σ√T",
        substitution: d1 == null ? "—" : `${fmt(d1, 8)} − ${fmt(sigma, 6)}×${fmt(sqrtT, 8)}`,
        result: d2 == null ? "—" : fmt(d2, 8),
      },
      {
        id: "price",
        label: `${sideName(audit)} value`,
        symbolic: isCall
          ? "C = S*e^(−qT)N(d₁) − Ke^(−rT)N(d₂)"
          : "P = Ke^(−rT)N(−d₂) − S*e^(−qT)N(−d₁)",
        substitution: isCall
          ? `${fmt(S, 6)}×${fmt(eqT, 8)}×${nd1 == null ? "—" : fmt(nd1, 8)} − ${fmt(K, 6)}×${fmt(erT, 8)}×${nd2 == null ? "—" : fmt(nd2, 8)}`
          : `${fmt(K, 6)}×${fmt(erT, 8)}×${nMinusD2 == null ? "—" : fmt(nMinusD2, 8)} − ${fmt(S, 6)}×${fmt(eqT, 8)}×${nMinusD1 == null ? "—" : fmt(nMinusD1, 8)}`,
        result: fmt(audit.output.price, 8),
      },
    ],
  };

  if (audit.inputs.discreteDividends.length > 0 || d1 == null || d2 == null || nd1 == null || nd2 == null || pdfd1 == null) {
    return [core, buildFiniteDifferenceGreeks(audit)];
  }

  const analyticalGreeks: FormulaNotebookSection = {
    id: "analytical-greeks",
    title: "Analytical Greeks",
    description: "These closed-form Greeks are used only when there is no discrete cash-dividend schedule. Units match the production engine.",
    lines: [
      {
        id: "delta",
        label: "Delta Δ",
        symbolic: isCall ? "Δcall = e^(−qT)N(d₁)" : "Δput = −e^(−qT)N(−d₁)",
        substitution: isCall
          ? `${fmt(eqT, 8)}×${fmt(nd1, 8)}`
          : `−${fmt(eqT, 8)}×${fmt(1 - nd1, 8)}`,
        result: fmt(audit.output.delta, 6),
      },
      {
        id: "gamma",
        label: "Gamma Γ",
        symbolic: "Γ = e^(−qT)φ(d₁) / (Sσ√T)",
        substitution: `${fmt(eqT, 8)}×${fmt(pdfd1, 8)} / (${fmt(audit.inputs.spot, 6)}×${fmt(sigma, 6)}×${fmt(sqrtT, 8)})`,
        result: fmt(audit.output.gamma, 8),
      },
      {
        id: "theta",
        label: "Theta Θ / day",
        symbolic: isCall
          ? "Θannual = −Se^(−qT)φ(d₁)σ/(2√T) − rKe^(−rT)N(d₂) + qSe^(−qT)N(d₁); Θ/day = Θannual/365"
          : "Θannual = −Se^(−qT)φ(d₁)σ/(2√T) + rKe^(−rT)N(−d₂) − qSe^(−qT)N(−d₁); Θ/day = Θannual/365",
        result: fmt(audit.output.theta, 6),
        note: audit.conventions.thetaUnit,
      },
      {
        id: "vega",
        label: "Vega ν / 1 vol pt",
        symbolic: "Vega = Se^(−qT)φ(d₁)√T / 100",
        substitution: `${fmt(audit.inputs.spot, 6)}×${fmt(eqT, 8)}×${fmt(pdfd1, 8)}×${fmt(sqrtT, 8)} / 100`,
        result: fmt(audit.output.vega, 6),
        note: audit.conventions.vegaUnit,
      },
      {
        id: "rho",
        label: "Rho ρ / 100bp",
        symbolic: isCall ? "ρcall = KTe^(−rT)N(d₂) / 100" : "ρput = −KTe^(−rT)N(−d₂) / 100",
        substitution: isCall
          ? `${fmt(K, 6)}×${fmt(T, 8)}×${fmt(erT, 8)}×${fmt(nd2, 8)} / 100`
          : `−${fmt(K, 6)}×${fmt(T, 8)}×${fmt(erT, 8)}×${fmt(1 - nd2, 8)} / 100`,
        result: fmt(audit.output.rho, 6),
        note: audit.conventions.rhoUnit,
      },
    ],
  };

  return [core, analyticalGreeks];
}

function buildAmericanNotebook(audit: OptionCalculationAudit): FormulaNotebookSection[] {
  const { spot: S, strike: K, timeYears: T, rate: r, dividendYield: q, volatility: sigma } = audit.inputs;
  const steps = audit.intermediates.treeSteps ?? 250;
  const dt = T / steps;
  const u = Math.exp(sigma * Math.sqrt(dt));
  const d = 1 / u;
  const rawP = (Math.exp((r - q) * dt) - d) / (u - d);
  const p = Math.max(0, Math.min(1, rawP));
  const disc = Math.exp(-r * dt);

  return [
    {
      id: "crr-tree",
      title: "Cox-Ross-Rubinstein early-exercise tree",
      description: audit.inputs.discreteDividends.length > 0
        ? "The tree uses an escrowed/prepaid-forward stock component. Remaining dividend PV is added back at each node before the exercise decision."
        : "Each node compares immediate exercise with discounted risk-neutral continuation value.",
      lines: [
        { id: "dt", label: "Time step Δt", symbolic: "Δt = T / N", substitution: `${fmt(T, 8)} / ${steps}`, result: fmt(dt, 10) },
        { id: "u", label: "Up factor u", symbolic: "u = e^(σ√Δt)", substitution: `e^(${fmt(sigma, 6)}×√${fmt(dt, 10)})`, result: fmt(u, 10) },
        { id: "d", label: "Down factor d", symbolic: "d = 1/u", substitution: `1 / ${fmt(u, 10)}`, result: fmt(d, 10) },
        { id: "p", label: "Risk-neutral probability p", symbolic: "p = [e^((r−q)Δt) − d] / (u − d)", substitution: `[e^((${fmt(r, 6)}−${fmt(q, 6)})×${fmt(dt, 10)}) − ${fmt(d, 10)}] / (${fmt(u, 10)} − ${fmt(d, 10)})`, result: fmt(p, 10) },
        { id: "disc", label: "Discount factor", symbolic: "disc = e^(−rΔt)", substitution: `e^(−${fmt(r, 6)}×${fmt(dt, 10)})`, result: fmt(disc, 10) },
        { id: "terminal", label: "Terminal payoff", symbolic: audit.optionSide === "call" ? "V_N = max(S_N − K, 0)" : "V_N = max(K − S_N, 0)", substitution: `K = ${fmt(K, 6)}` },
        { id: "backward", label: "Backward induction", symbolic: "V = max(intrinsic, disc × [pV_up + (1−p)V_down])", result: fmt(audit.output.price, 8), note: `${steps}-step production tree; early exercise evaluated at every node.` },
      ],
    },
    buildFiniteDifferenceGreeks(audit),
  ];
}

export function buildOptionsFormulaNotebook(audit: OptionCalculationAudit): OptionFormulaNotebook {
  const warnings: string[] = [];
  if (audit.inputs.volatilitySource === "fallback") warnings.push("Volatility is a fallback assumption; replace it with market IV, a surface, realized volatility, or a custom input before relying on the result.");
  if (audit.inputs.rateSource.toLowerCase().includes("manual")) warnings.push("Risk-free rate is manual. Confirm currency and maturity match the option being valued.");
  if (audit.exerciseStyle === "american") warnings.push("Strict European put-call parity equality is not an American exercise identity.");
  if (audit.inputs.discreteDividends.length > 0) warnings.push("Cash-dividend Greeks are finite-difference sensitivities on the same dividend-adjusted pricing engine, not closed-form BSM Greeks.");

  return {
    model: audit.model,
    instrument: `${sideName(audit)} · K ${fmt(audit.inputs.strike, 4)} · ${fmt(audit.inputs.calendarDays, 2)}d`,
    methodology: audit.exerciseStyle === "european"
      ? "Dividend-adjusted Black-Scholes-Merton"
      : "Cox-Ross-Rubinstein backward induction with node-by-node early exercise",
    sections: audit.exerciseStyle === "european" ? buildEuropeanNotebook(audit) : buildAmericanNotebook(audit),
    checks: [
      { label: "No-arbitrage lower bound", value: fmt(audit.checks.lowerBound, 8) },
      { label: "No-arbitrage upper bound", value: fmt(audit.checks.upperBound, 8) },
      { label: "Price within bounds", value: audit.checks.withinNoArbitrageBounds ? "PASS" : "FAIL", passed: audit.checks.withinNoArbitrageBounds },
      { label: "Put-call parity residual", value: audit.checks.putCallParityResidual == null ? "N/A · American exercise" : expFmt(audit.checks.putCallParityResidual, 3), passed: audit.checks.putCallParityResidual == null ? undefined : Math.abs(audit.checks.putCallParityResidual) < 1e-6 },
      { label: "Day count", value: audit.conventions.dayCount },
      { label: "Compounding", value: audit.conventions.compounding },
      { label: "Rate lineage", value: `${audit.inputs.rateSource}${audit.inputs.rateAsOf ? ` · ${audit.inputs.rateAsOf}` : ""}` },
      { label: "Volatility source", value: audit.inputs.volatilitySource },
    ],
    warnings,
  };
}
