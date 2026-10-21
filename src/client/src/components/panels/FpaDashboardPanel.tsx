import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo, memo } from "react";
import { BarChart2, DollarSign, Percent, TrendingUp, Sliders, Play, Settings, ShieldAlert, Cpu, Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Legend, LineChart, Line, Cell } from "recharts";
import { computeNPV, computeIRR, computeMIRR, paybackPeriod, discountedPaybackPeriod } from "@/lib/quantModels";


function FpaDashboardPanel() {
  // Driver-Based Planning Inputs
  const [headcountGrowth, setHeadcountGrowth] = useTerminalArtifactState("FpaDashboardPanel.headcountGrowth", 15);
  const [pricePerUnit, setPricePerUnit] = useTerminalArtifactState("FpaDashboardPanel.pricePerUnit", 120);
  const [cac, setCac] = useTerminalArtifactState("FpaDashboardPanel.cac", 250);
  const [churnRate, setChurnRate] = useTerminalArtifactState("FpaDashboardPanel.churnRate", 1.8);
  
  // Project Yield Inputs (P50/P90)
  const [pOption, setPOption] = useTerminalArtifactState<"P50" | "P90" | "P99">("FpaDashboardPanel.pOption", "P50");
  const [conceptionMonths, setConceptionMonths] = useTerminalArtifactState("FpaDashboardPanel.conceptionMonths", 18);

  // Capital Budgeting: cashflows[0] is the initial outlay (t=0), the rest are
  // period 1..N net cash flows -- user-editable, not tied to any other tab's model.
  const [cbCashflows, setCbCashflows] = useTerminalArtifactState<number[]>("FpaDashboardPanel.cbCashflows", [-1000, 250, 300, 350, 350, 400]);
  const [cbDiscountRate, setCbDiscountRate] = useTerminalArtifactState("FpaDashboardPanel.cbDiscountRate", 10);
  const [cbReinvestRate, setCbReinvestRate] = useTerminalArtifactState("FpaDashboardPanel.cbReinvestRate", 8);

  const updateCbCashflow = (idx: number, value: number) => {
    setCbCashflows((prev) => prev.map((cf, i) => (i === idx ? value : cf)));
  };
  const addCbPeriod = () => setCbCashflows((prev) => [...prev, 0]);
  const removeCbPeriod = (idx: number) => {
    if (cbCashflows.length <= 2) return; // keep at least the outlay + one period
    setCbCashflows((prev) => prev.filter((_, i) => i !== idx));
  };

  const cbNpv = useMemo(() => computeNPV(cbCashflows, cbDiscountRate), [cbCashflows, cbDiscountRate]);
  const cbIrr = useMemo(() => computeIRR(cbCashflows), [cbCashflows]);
  const cbMirr = useMemo(() => computeMIRR(cbCashflows, cbDiscountRate, cbReinvestRate), [cbCashflows, cbDiscountRate, cbReinvestRate]);
  const cbPayback = useMemo(() => paybackPeriod(cbCashflows), [cbCashflows]);
  const cbDiscPayback = useMemo(() => discountedPaybackPeriod(cbCashflows, cbDiscountRate), [cbCashflows, cbDiscountRate]);

  const cbChartData = useMemo(() => {
    let cumulative = 0, cumulativeDiscounted = 0;
    return cbCashflows.map((cf, t) => {
      cumulative += cf;
      cumulativeDiscounted += cf / Math.pow(1 + cbDiscountRate / 100, t);
      return {
        period: t === 0 ? "T0" : `T${t}`,
        cashflow: cf,
        cumulative: Math.round(cumulative * 100) / 100,
        cumulativeDiscounted: Math.round(cumulativeDiscounted * 100) / 100,
      };
    });
  }, [cbCashflows, cbDiscountRate]);

  // Baseline financials (for Year 0)
  const baseCustomers = 12000;
  const baseSalary = 85000; // Average Salary ($)
  
  // Calculated Drivers outputs
  const projectedCustomers = useMemo(() => {
    // customers grow based on CAC investment (assuming flat budget of $1M CAC budget)
    const newCust = Math.round(1000000 / cac);
    const lostCust = Math.round((baseCustomers + newCust) * (churnRate / 100));
    return baseCustomers + newCust - lostCust;
  }, [cac, churnRate]);

  const projectedRevenue = useMemo(() => {
    return (projectedCustomers * pricePerUnit * 12) / 1000000; // in Millions ($M)
  }, [projectedCustomers, pricePerUnit]);

  const projectedHeadcountCost = useMemo(() => {
    const baselineStaff = 150;
    const newStaff = Math.round(baselineStaff * (headcountGrowth / 100));
    return ((baselineStaff + newStaff) * baseSalary * 1.25) / 1000000; // assumes 25% benefits loading
  }, [headcountGrowth]);

  const projectedEbitda = useMemo(() => {
    const cogs = projectedRevenue * 0.25; // 25% COGS margin
    const marketing = 1.0; // $1M flat CAC budget
    const genericOpex = 2.5; // $2.5M G&A
    return projectedRevenue - cogs - projectedHeadcountCost - marketing - genericOpex;
  }, [projectedRevenue, projectedHeadcountCost]);

  // Budget vs Actual data sheet
  const budgetSheetData = [
    { metric: "Gross Revenue", budget: 18.5, actual: 19.2, variance: 0.7, pct: 3.8 },
    { metric: "Cost of Goods (COGS)", budget: 4.6, actual: 4.8, variance: -0.2, pct: -4.3 },
    { metric: "Personnel Expenses", budget: 6.8, actual: 7.0, variance: -0.2, pct: -2.9 },
    { metric: "Sales & Marketing", budget: 2.2, actual: 2.1, variance: 0.1, pct: 4.5 },
    { metric: "R&D Expenditures", budget: 1.8, actual: 1.7, variance: 0.1, pct: 5.6 },
    { metric: "EBITDA Operating Income", budget: 3.1, actual: 3.6, variance: 0.5, pct: 16.1 },
  ];

  // EBITDA Variance Bridge data
  const varianceBridgeData = [
    { name: "Budget EBITDA", value: 3.1 },
    { name: "Rev Gain", value: 0.7 },
    { name: "COGS Rise", value: -0.2 },
    { name: "Payroll Rise", value: -0.2 },
    { name: "S&M Savings", value: 0.1 },
    { name: "Actual EBITDA", value: 3.6 },
  ];

  // SaaS KPIs
  const saasRuleOf40 = useMemo(() => {
    // Growth % + EBITDA Margin %
    const growth = 22; // 22% ARR growth
    const margin = (projectedEbitda / projectedRevenue) * 100;
    return Math.round(growth + margin);
  }, [projectedEbitda, projectedRevenue]);

  const ltvToCac = useMemo(() => {
    // LTV = Gross Margin ($) / Churn
    const grossMargin = pricePerUnit * 0.75 * 12; // 75% gross margin
    const ltv = grossMargin / (churnRate / 100);
    return Number((ltv / cac).toFixed(1));
  }, [pricePerUnit, churnRate, cac]);

  // Project Finance yield calculations (P50/P90/P99)
  const yieldCapacity = pOption === "P50" ? 120 : pOption === "P90" ? 95 : 75; // MW hours
  const dscrData = useMemo(() => {
    const pricePerMWh = 48; // $48/MWh tariff
    const rev = (yieldCapacity * 8760 * 0.35 * pricePerMWh) / 1000000; // 35% capacity factor
    const opex = rev * 0.20; // 20% opex
    const cfads = rev - opex; // Cash Flow Available for Debt Service
    
    // Debt service payment (Senior debt)
    const annualDebtService = 10.2 * (pOption === "P50" ? 1.0 : pOption === "P90" ? 0.9 : 0.8);
    const dscrValue = cfads / annualDebtService;

    return [
      { year: "Y1", CFADS: Number(cfads.toFixed(2)), DebtService: Number(annualDebtService.toFixed(2)), DSCR: Number(dscrValue.toFixed(2)) },
      { year: "Y2", CFADS: Number((cfads * 1.02).toFixed(2)), DebtService: Number(annualDebtService.toFixed(2)), DSCR: Number((dscrValue * 1.02).toFixed(2)) },
      { year: "Y3", CFADS: Number((cfads * 1.04).toFixed(2)), DebtService: Number((annualDebtService * 0.95).toFixed(2)), DSCR: Number((dscrValue * 1.09).toFixed(2)) }, // amortization begins
      { year: "Y4", CFADS: Number((cfads * 1.06).toFixed(2)), DebtService: Number((annualDebtService * 0.90).toFixed(2)), DSCR: Number((dscrValue * 1.18).toFixed(2)) },
      { year: "Y5", CFADS: Number((cfads * 1.08).toFixed(2)), DebtService: Number((annualDebtService * 0.85).toFixed(2)), DSCR: Number((dscrValue * 1.27).toFixed(2)) },
    ];
  }, [pOption, yieldCapacity]);

  // Interest during construction (IDC) Drawdown schedule
  const capEx = 120; // $120M total construction costs
  const idcData = useMemo(() => {
    const monthlyCost = capEx / conceptionMonths;
    const interestRateIDC = 0.06; // 6% IDC interest rate
    let cumDrawdown = 0;
    let cumInterest = 0;
    const items = [];

    for (let i = 1; i <= Math.min(10, conceptionMonths / 2); i++) {
      const stage = `Phase ${i}`;
      const draw = monthlyCost * 2; // draw every phase
      cumDrawdown += draw;
      const idcAccrual = cumDrawdown * (interestRateIDC / 12) * 2;
      cumInterest += idcAccrual;
      items.push({
        phase: stage,
        Drawdown: Number(draw.toFixed(1)),
        CumulativeDrawdown: Number(cumDrawdown.toFixed(1)),
        InterestDuringConstruction: Number(cumInterest.toFixed(2))
      });
    }
    return items;
  }, [conceptionMonths]);

  return (
    <div className="h-full flex flex-col bg-[#050505] text-foreground overflow-hidden">
      {/* Panel Top bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <BarChart2 className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label font-bold text-xs tracking-wider">FP&A DASHBOARD & FORECASTING LAB</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">FPA</span>
      </div>

      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="budget" className="h-full flex flex-col">
          <div className="border-b border-border bg-[#070707] px-4 shrink-0">
            <TabsList className="bg-transparent gap-4 p-0">
              <TabsTrigger value="budget" className="border-b-2 border-transparent data-[state=active]:border-[hsl(38,95%,50%)] rounded-none py-2 text-[10px] uppercase font-semibold">Budget vs Actuals</TabsTrigger>
              <TabsTrigger value="drivers" className="border-b-2 border-transparent data-[state=active]:border-[hsl(38,95%,50%)] rounded-none py-2 text-[10px] uppercase font-semibold">Driver-Based Modeler</TabsTrigger>
              <TabsTrigger value="saas" className="border-b-2 border-transparent data-[state=active]:border-[hsl(38,95%,50%)] rounded-none py-2 text-[10px] uppercase font-semibold">SaaS Cockpit</TabsTrigger>
              <TabsTrigger value="project" className="border-b-2 border-transparent data-[state=active]:border-[hsl(38,95%,50%)] rounded-none py-2 text-[10px] uppercase font-semibold">Project & Yield Finance</TabsTrigger>
              <TabsTrigger value="capbudget" className="border-b-2 border-transparent data-[state=active]:border-[hsl(38,95%,50%)] rounded-none py-2 text-[10px] uppercase font-semibold">Capital Budgeting</TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto p-4 min-h-0 bg-[#050505]">
            
            {/* TABS CONTENT 1: BUDGET VS ACTUALS */}
            <TabsContent value="budget" className="space-y-4 m-0">
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2 space-y-4">
                  <div className="border border-border rounded bg-[#070707] overflow-hidden">
                    <Table>
                      <TableHeader className="bg-[#0d0d0d]">
                        <TableRow className="border-b border-border">
                          <TableHead className="text-[10px] font-bold">Financial Metric ($M)</TableHead>
                          <TableHead className="text-[10px] font-bold text-right">Budget Plan</TableHead>
                          <TableHead className="text-[10px] font-bold text-right">Actual YTD</TableHead>
                          <TableHead className="text-[10px] font-bold text-right">Variance ($M)</TableHead>
                          <TableHead className="text-[10px] font-bold text-right">Variance %</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {budgetSheetData.map((row, idx) => (
                          <TableRow key={idx} className="border-b border-border hover:bg-white/5 transition-colors">
                            <TableCell className="font-semibold text-xs text-foreground">{row.metric}</TableCell>
                            <TableCell className="text-xs text-right font-terminal">${row.budget.toFixed(1)}M</TableCell>
                            <TableCell className="text-xs text-right font-terminal text-slate-200">${row.actual.toFixed(1)}M</TableCell>
                            <TableCell className={`text-xs text-right font-terminal font-semibold ${row.variance >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                              {row.variance >= 0 ? "+" : ""}${row.variance.toFixed(1)}M
                            </TableCell>
                            <TableCell className={`text-xs text-right font-terminal font-semibold ${row.pct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                              {row.pct >= 0 ? "+" : ""}{row.pct.toFixed(1)}%
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* EBITDA Variance Bridge */}
                <Card className="bg-[#070707] border-border text-foreground">
                  <CardHeader className="p-4 border-b border-border">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">EBITDA Variance Bridge ($M)</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={varianceBridgeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                          <XAxis dataKey="name" stroke="#888" fontSize={8} interval={0} />
                          <YAxis stroke="#888" fontSize={9} />
                          <Tooltip contentStyle={{ backgroundColor: "#0d0d0d", borderColor: "#333", color: "#fff" }} />
                          <Bar dataKey="value" fill="hsl(38,95%,50%)" radius={[4, 4, 0, 0]}>
                            {varianceBridgeData.map((entry, index) => {
                              const color = entry.value >= 3.0 ? "hsl(38,95%,50%)" : entry.value >= 0 ? "#10b981" : "#f43f5e";
                              return <Cell key={`cell-${index}`} fill={color} />;
                            })}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* TABS CONTENT 2: DRIVER-BASED PLANNING */}
            <TabsContent value="drivers" className="space-y-4 m-0">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="bg-[#070707] border-border">
                  <CardHeader className="p-4 border-b border-border">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Financial Drivers</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-6">
                    {/* Headcount growth */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Headcount Growth Rate:</span>
                        <span className="text-purple-400 font-bold font-terminal">+{headcountGrowth}%</span>
                      </div>
                      <Slider 
                        min={0} max={40} step={2} 
                        value={[headcountGrowth]} 
                        onValueChange={(val) => setHeadcountGrowth(val[0])} 
                      />
                    </div>

                    {/* Unit price */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Avg Product Unit Price:</span>
                        <span className="text-emerald-400 font-bold font-terminal">${pricePerUnit}</span>
                      </div>
                      <Slider 
                        min={50} max={250} step={5} 
                        value={[pricePerUnit]} 
                        onValueChange={(val) => setPricePerUnit(val[0])} 
                      />
                    </div>

                    {/* CAC */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Customer Acquisition Cost (CAC):</span>
                        <span className="text-amber-500 font-bold font-terminal">${cac}</span>
                      </div>
                      <Slider 
                        min={100} max={600} step={20} 
                        value={[cac]} 
                        onValueChange={(val) => setCac(val[0])} 
                      />
                    </div>

                    {/* Churn */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Monthly Logo Churn:</span>
                        <span className="text-rose-500 font-bold font-terminal">{churnRate}%</span>
                      </div>
                      <Slider 
                        min={0.5} max={5.0} step={0.1} 
                        value={[churnRate]} 
                        onValueChange={(val) => setChurnRate(val[0])} 
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Real-time Pro-Forma Output */}
                <Card className="bg-[#070707] border-border text-foreground font-terminal">
                  <CardHeader className="p-4 border-b border-border">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Projected Pro-Forma (Run Rate)</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4 text-xs">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-[#0a0a0a] p-3 border border-border rounded text-center">
                        <span className="text-[10px] text-muted-foreground uppercase">Projected Revenue</span>
                        <h4 className="text-lg font-bold text-cyan-400 mt-1">${projectedRevenue.toFixed(2)}M</h4>
                      </div>
                      <div className="bg-[#0a0a0a] p-3 border border-border rounded text-center">
                        <span className="text-[10px] text-muted-foreground uppercase">Projected EBITDA</span>
                        <h4 className={`text-lg font-bold mt-1 ${projectedEbitda >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          ${projectedEbitda.toFixed(2)}M
                        </h4>
                      </div>
                    </div>

                    <div className="space-y-2 border-t border-border pt-3">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Customer Base:</span>
                        <span>{projectedCustomers.toLocaleString()} accounts</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Personnel Cost:</span>
                        <span>${projectedHeadcountCost.toFixed(2)}M</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">EBITDA Margin:</span>
                        <span>{((projectedEbitda / projectedRevenue) * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* TABS CONTENT 3: SAAS COCKPIT */}
            <TabsContent value="saas" className="space-y-4 m-0">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-[#070707] border-border text-center font-terminal">
                  <CardHeader className="p-4 border-b border-border">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Rule of 40</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="inline-flex items-center justify-center w-24 h-24 rounded-full border-4 border-emerald-950 bg-emerald-950/20 text-emerald-400 text-3xl font-bold mb-2">
                      {saasRuleOf40}%
                    </div>
                    <span className="text-[10px] text-muted-foreground block">Growth rate (22%) + EBITDA Margin ({Math.round((projectedEbitda / projectedRevenue) * 100)}%)</span>
                    <span className={`mt-2 inline-block text-[9px] px-2 py-0.5 border rounded font-semibold ${saasRuleOf40 >= 40 ? "text-emerald-400 bg-emerald-950/30 border-emerald-800" : "text-amber-500 bg-amber-950/30 border-amber-800"}`}>
                      {saasRuleOf40 >= 40 ? "OUTPERFORMING" : "UNDERPERFORMING"}
                    </span>
                  </CardContent>
                </Card>

                <Card className="bg-[#070707] border-border text-center font-terminal">
                  <CardHeader className="p-4 border-b border-border">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">LTV : CAC Ratio</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="inline-flex items-center justify-center w-24 h-24 rounded-full border-4 border-cyan-950 bg-cyan-950/20 text-cyan-400 text-3xl font-bold mb-2">
                      {ltvToCac}x
                    </div>
                    <span className="text-[10px] text-muted-foreground block">Target ratio is &gt;3.0x for healthy units.</span>
                    <span className={`mt-2 inline-block text-[9px] px-2 py-0.5 border rounded font-semibold ${ltvToCac >= 3.0 ? "text-emerald-400 bg-emerald-950/30 border-emerald-800" : "text-rose-500 bg-rose-950/30 border-rose-800"}`}>
                      {ltvToCac >= 3.0 ? "HEALTHY METRIC" : "UNHEALTHY ACQUISITION COST"}
                    </span>
                  </CardContent>
                </Card>

                <Card className="bg-[#070707] border-border font-terminal text-xs">
                  <CardHeader className="p-4 border-b border-border">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">SaaS KPIs Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex justify-between border-b border-border pb-1">
                      <span>Monthly Churn:</span>
                      <span className="text-rose-400">{churnRate}%</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-1">
                      <span>Net Revenue Retention (NRR):</span>
                      <span className="text-emerald-400">114.2%</span>
                    </div>
                    <div className="flex justify-between border-b border-border pb-1">
                      <span>Customer Lifetime (LTV):</span>
                      <span>${Math.round((pricePerUnit * 0.75 * 12) / (churnRate / 100))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Average CAC Cost:</span>
                      <span>${cac}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* TABS CONTENT 4: PROJECT & YIELD FINANCE */}
            <TabsContent value="project" className="space-y-4 m-0">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card className="bg-[#070707] border-border lg:col-span-2">
                  <CardHeader className="p-4 border-b border-border flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Debt Coverage: CFADS vs Debt Service ($M)</CardTitle>
                    </div>
                    <div className="flex border border-border rounded bg-black overflow-hidden font-terminal text-[9px] select-none shrink-0">
                      {(["P50", "P90", "P99"] as const).map((opt) => (
                        <button
                          key={opt}
                          onClick={() => setPOption(opt)}
                          className={`px-3 py-1 border-r last:border-0 border-border hover:bg-neutral-800 transition-colors ${pOption === opt ? "bg-[hsl(38,95%,50%)] text-black font-bold" : "text-muted-foreground"}`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={dscrData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                          <XAxis dataKey="year" stroke="#888" fontSize={10} />
                          <YAxis stroke="#888" fontSize={10} />
                          <Tooltip contentStyle={{ backgroundColor: "#0d0d0d", borderColor: "#333", color: "#fff" }} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          <Line type="monotone" dataKey="CFADS" stroke="#10b981" strokeWidth={2} name="CFADS Cash Flow ($M)" />
                          <Line type="monotone" dataKey="DebtService" stroke="#a855f7" strokeWidth={2} name="Senior Debt Service ($M)" />
                          <Line type="monotone" dataKey="DSCR" stroke="#f59e0b" strokeWidth={2} name="DSCR Coverage Ratio (x)" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {/* IDC construction scheduler */}
                <Card className="bg-[#070707] border-border flex flex-col font-terminal">
                  <CardHeader className="p-4 border-b border-border shrink-0">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">IDC Construction Scheduler</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 flex-1 overflow-y-auto space-y-4 text-xs">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-muted-foreground">Construction Months:</span>
                      <span className="text-[hsl(38,95%,50%)] font-bold">{conceptionMonths} months</span>
                    </div>
                    <Slider 
                      min={12} max={36} step={6} 
                      value={[conceptionMonths]} 
                      onValueChange={(val) => setConceptionMonths(val[0])} 
                    />

                    <div className="border border-border/60 rounded bg-[#090909] mt-4 overflow-hidden">
                      <Table>
                        <TableHeader className="bg-black">
                          <TableRow className="border-b border-border/60">
                            <TableHead className="p-1.5 text-[8px]">Phase</TableHead>
                            <TableHead className="p-1.5 text-[8px] text-right">Draw ($M)</TableHead>
                            <TableHead className="p-1.5 text-[8px] text-right">IDC Acc. ($M)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {idcData.map((row, idx) => (
                            <TableRow key={idx} className="border-b border-border/40">
                              <TableCell className="p-1.5 text-[10px] font-semibold text-slate-300">{row.phase}</TableCell>
                              <TableCell className="p-1.5 text-[10px] text-right text-emerald-400">${row.CumulativeDrawdown}M</TableCell>
                              <TableCell className="p-1.5 text-[10px] text-right text-purple-400">${row.InterestDuringConstruction}M</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* TABS CONTENT 5: CAPITAL BUDGETING (NPV / IRR / MIRR / PAYBACK) */}
            <TabsContent value="capbudget" className="space-y-4 m-0">
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2 space-y-4">
                  <Card className="bg-[#070707] border-border">
                    <CardHeader className="p-4 border-b border-border flex flex-row items-center justify-between">
                      <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Project Cash Flows ($000s)</CardTitle>
                      <button
                        onClick={addCbPeriod}
                        className="flex items-center gap-1 px-2 py-1 border border-border font-terminal text-[9px] text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,30%)] transition-colors"
                      >
                        <Plus className="w-3 h-3" /> ADD PERIOD
                      </button>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="flex flex-wrap gap-2">
                        {cbCashflows.map((cf, idx) => (
                          <div key={idx} className="flex flex-col items-center gap-1 border border-border bg-[#0a0a0a] p-2 w-24">
                            <span className="font-terminal text-[8px] text-muted-foreground">{idx === 0 ? "OUTLAY (T0)" : `PERIOD ${idx}`}</span>
                            <input
                              type="number"
                              value={cf}
                              onChange={(e) => updateCbCashflow(idx, Number(e.target.value) || 0)}
                              className={`w-full bg-black border border-border p-1 text-center font-terminal text-[10px] font-bold font-mono ${cf >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                            />
                            {cbCashflows.length > 2 && (
                              <button onClick={() => removeCbPeriod(idx)} className="text-muted-foreground hover:text-rose-400">
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 gap-4 mt-5 pt-4 border-t border-border">
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-muted-foreground">Discount Rate (WACC):</span>
                            <span className="text-amber-500 font-bold font-terminal">{cbDiscountRate.toFixed(1)}%</span>
                          </div>
                          <Slider min={0} max={30} step={0.5} value={[cbDiscountRate]} onValueChange={(val) => setCbDiscountRate(val[0])} />
                        </div>
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-muted-foreground">Reinvestment Rate (for MIRR):</span>
                            <span className="text-cyan-400 font-bold font-terminal">{cbReinvestRate.toFixed(1)}%</span>
                          </div>
                          <Slider min={0} max={30} step={0.5} value={[cbReinvestRate]} onValueChange={(val) => setCbReinvestRate(val[0])} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-[#070707] border-border">
                    <CardHeader className="p-4 border-b border-border">
                      <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Cumulative Cash Flow (Payback Visualizer)</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={cbChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                            <XAxis dataKey="period" stroke="#888" fontSize={9} />
                            <YAxis stroke="#888" fontSize={9} />
                            <Tooltip contentStyle={{ backgroundColor: "#0d0d0d", borderColor: "#333", color: "#fff" }} />
                            <Legend wrapperStyle={{ fontSize: 10 }} />
                            <Line type="monotone" dataKey="cumulative" stroke="#10b981" strokeWidth={2} name="Cumulative CF" />
                            <Line type="monotone" dataKey="cumulativeDiscounted" stroke="hsl(38,95%,50%)" strokeWidth={2} name="Discounted Cumulative CF" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Results */}
                <Card className="bg-[#070707] border-border text-foreground font-terminal">
                  <CardHeader className="p-4 border-b border-border">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Investment Decision Metrics</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-3 text-xs">
                    <div className="bg-[#0a0a0a] p-3 border border-border rounded text-center">
                      <span className="text-[10px] text-muted-foreground uppercase">Net Present Value</span>
                      <h4 className={`text-xl font-bold mt-1 ${cbNpv >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {cbNpv >= 0 ? "+" : ""}${cbNpv.toFixed(1)}K
                      </h4>
                      <span className={`mt-1 inline-block text-[9px] px-2 py-0.5 border rounded font-semibold ${cbNpv >= 0 ? "text-emerald-400 bg-emerald-950/30 border-emerald-800" : "text-rose-500 bg-rose-950/30 border-rose-800"}`}>
                        {cbNpv >= 0 ? "ACCEPT" : "REJECT"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-[#0a0a0a] p-2.5 border border-border rounded text-center">
                        <span className="text-[9px] text-muted-foreground uppercase">IRR</span>
                        <h4 className={`text-base font-bold mt-0.5 ${cbIrr !== null && cbIrr >= cbDiscountRate ? "text-emerald-400" : "text-rose-400"}`}>
                          {cbIrr !== null ? `${cbIrr.toFixed(1)}%` : "N/A"}
                        </h4>
                      </div>
                      <div className="bg-[#0a0a0a] p-2.5 border border-border rounded text-center">
                        <span className="text-[9px] text-muted-foreground uppercase">MIRR</span>
                        <h4 className="text-base font-bold mt-0.5 text-cyan-400">
                          {cbMirr !== null ? `${cbMirr.toFixed(1)}%` : "N/A"}
                        </h4>
                      </div>
                      <div className="bg-[#0a0a0a] p-2.5 border border-border rounded text-center">
                        <span className="text-[9px] text-muted-foreground uppercase">Payback</span>
                        <h4 className="text-base font-bold mt-0.5">
                          {cbPayback !== null ? `${cbPayback.toFixed(1)} yrs` : "Never"}
                        </h4>
                      </div>
                      <div className="bg-[#0a0a0a] p-2.5 border border-border rounded text-center">
                        <span className="text-[9px] text-muted-foreground uppercase">Disc. Payback</span>
                        <h4 className="text-base font-bold mt-0.5">
                          {cbDiscPayback !== null ? `${cbDiscPayback.toFixed(1)} yrs` : "Never"}
                        </h4>
                      </div>
                    </div>

                    <div className="text-[8px] text-muted-foreground leading-normal border-t border-border pt-3 space-y-1">
                      <p><strong className="text-foreground">NPV</strong> — sum of all cash flows discounted at the WACC. Positive means the project creates value above the cost of capital.</p>
                      <p><strong className="text-foreground">IRR</strong> — the discount rate that makes NPV exactly zero, solved directly from these cash flows (not a shortcut formula), so it stays correct with any number of periods or interim flows.</p>
                      <p><strong className="text-foreground">MIRR</strong> — like IRR, but assumes interim cash flows reinvest at your Reinvestment Rate rather than at the IRR itself, which is usually the more realistic assumption.</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

          </div>
        </Tabs>
      </div>
    </div>
  );
}
export default memo(FpaDashboardPanel);
