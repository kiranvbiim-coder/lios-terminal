import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Globe, Calculator, ShieldAlert, Sliders, Settings } from "lucide-react";
import { AdvancedRatesDerivativesRunner } from "@/lib/advancedRatesDerivatives";
import { FixedIncomeCreditControls } from "@/components/panels/FixedIncomeCreditControls";

// Standard sovereign tenors
const TENORS = ["3M", "6M", "1Y", "2Y", "5Y", "10Y", "30Y"];
const TENOR_MULTIPLIERS = [0.25, 0.5, 1, 2, 5, 10, 30];

// Base yields mapping
const US_BASE_YIELDS = [5.2, 5.1, 4.8, 4.3, 4.1, 4.0, 4.2]; // Inverted US curve
const IN_BASE_YIELDS = [6.8, 6.9, 7.0, 7.1, 7.2, 7.2, 7.4]; // Sloped IN curve

export default function FixedIncomePanel({ onSymbol }: { onSymbol: (sym: string) => void }) {
  // Sovereign yield shifts
  const [usShift, setUsShift] = useTerminalArtifactState("FixedIncomePanel.usShift", 0.0);
  const [inShift, setInShift] = useTerminalArtifactState("FixedIncomePanel.inShift", 0.0);
  const [steepnessShift, setSteepnessShift] = useTerminalArtifactState("FixedIncomePanel.steepnessShift", 0.0);

  // Bond pricing calculator states
  const [couponRate, setCouponRate] = useTerminalArtifactState("FixedIncomePanel.couponRate", 5.0);
  const [maturityYears, setMaturityYears] = useTerminalArtifactState("FixedIncomePanel.maturityYears", 10);
  const [yieldToMaturity, setYieldToMaturity] = useTerminalArtifactState("FixedIncomePanel.yieldToMaturity", 4.0);
  const [semiAnnual, setSemiAnnual] = useTerminalArtifactState("FixedIncomePanel.semiAnnual", true);

  // CDS States
  const [hazardRate, setHazardRate] = useTerminalArtifactState("FixedIncomePanel.hazardRate", 2.0);
  const [recoveryRate, setRecoveryRate] = useTerminalArtifactState("FixedIncomePanel.recoveryRate", 40.0);

  // Sovereign yields solver
  const yieldCurvesData = useMemo(() => {
    return TENORS.map((t, idx) => {
      const multiplier = TENOR_MULTIPLIERS[idx];
      // Steepen shifts the long end up and short end down
      const steepAdjustment = (multiplier - 5) / 25 * steepnessShift;

      const usYield = Math.max(0.1, US_BASE_YIELDS[idx] + usShift + steepAdjustment);
      const inYield = Math.max(0.1, IN_BASE_YIELDS[idx] + inShift + steepAdjustment);

      return {
        tenor: t,
        "US Treasury": usYield,
        "Indian Sovereign": inYield,
      };
    });
  }, [usShift, inShift, steepnessShift]);

  // Bond math calculator
  const bondStats = useMemo(() => {
    const f = semiAnnual ? 2 : 1;
    const c = couponRate / 100 / f; // coupon per period
    const y = yieldToMaturity / 100 / f; // yield per period
    const n = maturityYears * f; // total periods
    const faceValue = 100;

    let price = 0;
    let macDurationNum = 0;
    let convexityNum = 0;

    for (let t = 1; t <= n; t++) {
      const cf = t === n ? faceValue + faceValue * c : faceValue * c;
      const pvFactor = Math.pow(1 + y, t);
      const pvCF = cf / pvFactor;

      price += pvCF;
      macDurationNum += t * pvCF;
      convexityNum += t * (t + 1) * pvCF;
    }

    const macDurationPeriods = price > 0 ? macDurationNum / price : 0;
    const macDurationYears = macDurationPeriods / f;
    const modDuration = macDurationYears / (1 + y);
    const convexity = price > 0 ? convexityNum / (price * Math.pow(1 + y, 2) * f * f) : 0;

    return {
      price,
      macDuration: macDurationYears,
      modDuration,
      convexity,
    };
  }, [couponRate, maturityYears, yieldToMaturity, semiAnnual]);

  // Credit Default Swap (CDS) Valuation
  const cdsStats = useMemo(() => {
    const holdYears = 5;
    const r = 0.045; // risk free discount rate proxy (4.5%)
    const lambda = hazardRate / 100; // Hazard rate
    const R = recoveryRate / 100; // Recovery rate

    let protectionLeg = 0;
    let premiumLeg = 0;

    // We discount cash flows quarterly to be accurate for CDS markets
    const periods = holdYears * 4;
    const dt = 0.25;

    for (let t = 1; t <= periods; t++) {
      const time = t * dt;
      // Discount factor
      const df = Math.exp(-r * time);
      
      // Survival probability: q = e^(-lambda * time)
      const q_prev = Math.exp(-lambda * (time - dt));
      const q_curr = Math.exp(-lambda * time);
      
      // Marginal default probability in this period
      const dP = q_prev - q_curr;

      // Protection leg pays (1 - Recovery) upon default
      protectionLeg += df * (1 - R) * dP;

      // Premium leg pays spread * dt * survival probability
      premiumLeg += df * dt * q_curr;
    }

    // CDS Fair Spread (bps) = ProtectionLeg / PremiumLeg * 10000
    const fairSpread = premiumLeg > 0 ? (protectionLeg / premiumLeg) * 10000 : 0;

    return {
      protectionLeg,
      premiumLeg,
      fairSpread,
    };
  }, [hazardRate, recoveryRate]);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden text-foreground">
      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
        {/* Left Column: Yield Curve & Spreads */}
        <div className="flex-1 p-4 overflow-y-auto scrollbar-thin space-y-5 border-b xl:border-b-0 xl:border-r border-border">
          {/* Sovereign Yield Curves Chart */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase">SOVEREIGN YIELD CURVE COMPARISON</span>
              <span className="font-terminal text-[9px] text-muted-foreground">
                Spread (10Y IN-US): {((yieldCurvesData[5]["Indian Sovereign"] - yieldCurvesData[5]["US Treasury"])).toFixed(2)}%
              </span>
            </div>
            <div className="h-[230px] w-full relative">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={yieldCurvesData} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                  <CartesianGrid stroke="#111" />
                  <XAxis dataKey="tenor" stroke="#555" tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }} />
                  <YAxis
                    stroke="#555"
                    domain={[0, 10]}
                    tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    content={({ active, payload }: any) => {
                      if (!active || !payload?.length) return null;
                      const pt = payload[0].payload;
                      return (
                        <div className="bg-[#0c0c0c] border border-border p-2 font-terminal text-[9px] space-y-0.5">
                          <div className="text-muted-foreground font-bold">Maturity Tenor: {pt.tenor}</div>
                          <div className="text-[hsl(38,95%,55%)] font-semibold">US Treasury: {pt["US Treasury"].toFixed(2)}%</div>
                          <div className="text-emerald-500 font-semibold">Indian Sovereign: {pt["Indian Sovereign"].toFixed(2)}%</div>
                        </div>
                      );
                    }}
                  />
                  <Line type="monotone" dataKey="US Treasury" stroke="hsl(38,95%,55%)" strokeWidth={2} dot={true} />
                  <Line type="monotone" dataKey="Indian Sovereign" stroke="hsl(142,71%,45%)" strokeWidth={2} dot={true} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Section: Bond Pricing Calculator */}
          <div className="space-y-3 border-t border-border pt-4">
            <span className="font-terminal text-[9px] tracking-widest text-muted-foreground uppercase flex items-center gap-1.5">
              <Calculator className="w-3.5 h-3.5" /> BOND DURATION & SENSITIVITY DESK
            </span>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Inputs */}
              <div className="space-y-2 bg-[#070707] p-3 border border-border">
                <div className="flex justify-between items-center font-terminal text-[9.5px]">
                  <span className="text-muted-foreground">COUPON RATE (%)</span>
                  <input
                    type="number"
                    step="0.1"
                    value={couponRate}
                    onChange={(e) => setCouponRate(parseFloat(e.target.value) || 0)}
                    className="w-14 bg-black border border-border p-0.5 text-center font-mono text-[10px] font-bold text-foreground"
                  />
                </div>
                <div className="flex justify-between items-center font-terminal text-[9.5px]">
                  <span className="text-muted-foreground">MATURITY (YEARS)</span>
                  <input
                    type="number"
                    value={maturityYears}
                    onChange={(e) => setMaturityYears(parseInt(e.target.value) || 1)}
                    className="w-14 bg-black border border-border p-0.5 text-center font-mono text-[10px] font-bold text-foreground"
                  />
                </div>
                <div className="flex justify-between items-center font-terminal text-[9.5px]">
                  <span className="text-muted-foreground">YIELD TO MATURITY (YTM %)</span>
                  <input
                    type="number"
                    step="0.1"
                    value={yieldToMaturity}
                    onChange={(e) => setYieldToMaturity(parseFloat(e.target.value) || 0)}
                    className="w-14 bg-black border border-border p-0.5 text-center font-mono text-[10px] font-bold text-[hsl(38,95%,55%)]"
                  />
                </div>
                <div className="flex justify-between items-center font-terminal text-[9.5px] border-t border-border/50 pt-2">
                  <span className="text-muted-foreground">PAYMENT FREQUENCY</span>
                  <button
                    onClick={() => setSemiAnnual(!semiAnnual)}
                    className="px-2 py-0.5 bg-black border border-border font-terminal text-[8px] tracking-widest text-foreground hover:bg-white/5"
                  >
                    {semiAnnual ? "SEMI-ANNUAL (2x)" : "ANNUAL (1x)"}
                  </button>
                </div>
              </div>

              {/* Outputs */}
              <div className="space-y-2 bg-[#080808] p-3 border border-border font-mono text-[10px]">
                <div className="flex justify-between border-b border-border/40 pb-1 font-terminal text-[8px] text-muted-foreground tracking-widest uppercase">
                  <span>METRIC</span>
                  <span>VALUE</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-terminal">BOND PRICE ($/₹ PAR)</span>
                  <span className="text-foreground font-bold">{bondStats.price.toFixed(3)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-terminal">MACAULAY DURATION</span>
                  <span className="text-foreground font-bold">{bondStats.macDuration.toFixed(3)} yrs</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-terminal">MODIFIED DURATION</span>
                  <span className="text-amber-500 font-bold">{bondStats.modDuration.toFixed(3)} yrs</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-terminal">CONVEXITY</span>
                  <span className="text-foreground font-bold">{bondStats.convexity.toFixed(4)}</span>
                </div>
              </div>
            </div>
          </div>
          <FixedIncomeCreditControls
            title="INSTITUTIONAL FI / CREDIT · FIXED-INCOME ANALYTICS"
            paths={[
              "fixed-income/spread-analytics",
              "fixed-income/key-rate-risk",
              "fixed-income/immunize-duration",
              "fixed-income/callable-oas",
              "fixed-income/floating-rate-note",
              "fixed-income/inflation-linked-bond",
              "fixed-income/credit-spread-curve",
            ]}
          />
          <AdvancedRatesDerivativesRunner
            title="FIXED INCOME & RATES DERIVATIVES · MANUAL TERMS"
            modelPaths={[
              "derivatives/interest-rate-swap",
              "derivatives/black-swaption",
            ]}
          />
        </div>

        {/* Right Column: Yield Curves Sliders & CDS Engine */}
        <div className="w-full xl:w-72 border-t xl:border-t-0 xl:border-l border-border bg-[#060606] flex flex-col shrink-0 overflow-y-auto scrollbar-thin">
          {/* Section: Sliders */}
          <div className="p-4 border-b border-border space-y-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Globe className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" />
              <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">CURVE SHIFT CONTROLS</span>
            </div>

            {/* US curve parallel shift */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-terminal text-[9px]">
                <span className="text-muted-foreground">US TREASURY SHIFT</span>
                <span className="text-foreground font-mono font-bold">
                  {usShift > 0 ? "+" : ""}{usShift.toFixed(2)}%
                </span>
              </div>
              <input
                type="range"
                min="-2.0"
                max="2.0"
                step="0.05"
                value={usShift}
                onChange={(e) => setUsShift(parseFloat(e.target.value))}
                className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>

            {/* IN curve parallel shift */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-terminal text-[9px]">
                <span className="text-muted-foreground">INDIAN SOVEREIGN SHIFT</span>
                <span className="text-foreground font-mono font-bold">
                  {inShift > 0 ? "+" : ""}{inShift.toFixed(2)}%
                </span>
              </div>
              <input
                type="range"
                min="-2.0"
                max="2.0"
                step="0.05"
                value={inShift}
                onChange={(e) => setInShift(parseFloat(e.target.value))}
                className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>

            {/* Steepness tilt */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-terminal text-[9px]">
                <span className="text-muted-foreground">YIELD CURVE TILT (STEEPEN)</span>
                <span className="text-foreground font-mono font-bold">
                  {steepnessShift > 0 ? "+" : ""}{steepnessShift.toFixed(2)}%
                </span>
              </div>
              <input
                type="range"
                min="-1.5"
                max="1.5"
                step="0.05"
                value={steepnessShift}
                onChange={(e) => setSteepnessShift(parseFloat(e.target.value))}
                className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>
          </div>

          {/* Section: Credit Default Swap Valuation */}
          <div className="p-4 flex-1 space-y-4 bg-[#080808]">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
              <span className="font-terminal text-[9px] tracking-widest font-bold uppercase">CREDIT DEFAULT SWAP (CDS)</span>
            </div>

            {/* Hazard Rate */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-terminal text-[9px]">
                <span className="text-muted-foreground">HAZARD RATE (DEFAULT PROB.)</span>
                <span className="text-foreground font-mono font-bold">{hazardRate.toFixed(1)}% / year</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="10.0"
                step="0.1"
                value={hazardRate}
                onChange={(e) => setHazardRate(parseFloat(e.target.value))}
                className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>

            {/* Recovery Rate */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-terminal text-[9px]">
                <span className="text-muted-foreground">RECOVERY RATE (R)</span>
                <span className="text-foreground font-mono font-bold">{recoveryRate.toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min="10.0"
                max="80.0"
                step="1"
                value={recoveryRate}
                onChange={(e) => setRecoveryRate(parseFloat(e.target.value))}
                className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>

            {/* CDS Fair Spread Output */}
            <div className="bg-[#050505] border border-border p-3 space-y-1">
              <div className="font-terminal text-[8px] text-muted-foreground tracking-widest">IMPLIED 5Y CDS PREMIUM SPREAD</div>
              <div className="font-terminal text-base font-bold font-mono text-red-500">
                {cdsStats.fairSpread.toFixed(0)} bps
                <span className="text-[8px] text-muted-foreground font-normal ml-1 font-terminal">/ year</span>
              </div>
              <div className="font-terminal text-[7.5px] text-muted-foreground mt-1">
                Protection leg cost: {(cdsStats.protectionLeg * 100).toFixed(2)}% of notional.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
