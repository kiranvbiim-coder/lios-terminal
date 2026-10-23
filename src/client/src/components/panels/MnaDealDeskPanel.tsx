import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useMemo, memo } from "react";
import { 
  Building2, Search, Percent, ShieldAlert, Scale, 
  Coins, ArrowRightLeft, TrendingUp, Info 
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Legend, LineChart, Line } from "recharts";
import { runLboModel } from "@/lib/valuationModels";
import { AdvancedReceiptFooter, useAdvancedModel, type AdvancedReceipt } from "@/lib/advancedValuationCredit";

interface PrecedentDeal { id: number; target: string; acquirer: string; value: number; premium: number; evEbitda: number; evSales: number; date: string; sector: string }

const DEAL_SECTORS = ["Technology", "Healthcare", "Utilities", "Industrials", "Financials", "Consumer Staples", "Energy", "Real Estate", "Other"];

function median(nums: number[]) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function MnaDealDeskPanel() {
  const [activeTab, setActiveTab] = useTerminalArtifactState("MnaDealDeskPanel.activeTab", "db");
  const [searchTerm, setSearchTerm] = useTerminalArtifactState("MnaDealDeskPanel.searchTerm", "");
  const [selectedSector, setSelectedSector] = useTerminalArtifactState("MnaDealDeskPanel.selectedSector", "All");
  // Starts empty rather than seeded with plausible-looking deals (real
  // acquirer names like "Pfizer"/"Oracle" paired with fabricated targets,
  // values, and multiples) -- that reads as real precedent-transaction data
  // pulled from somewhere, when it wasn't. Deal-team analysts know their own
  // precedent set; "+ ADD DEAL" builds the real table from what they know,
  // same manual-entry-first pattern as the Comps tab's peer table.
  const [deals, setDeals] = useTerminalArtifactState<PrecedentDeal[]>("MnaDealDeskPanel.deals", []);
  const addDeal = () => setDeals(prev => [...prev, {
    id: prev.length ? Math.max(...prev.map(d => d.id)) + 1 : 1,
    target: "", acquirer: "", value: 0, premium: 0, evEbitda: 0, evSales: 0,
    date: new Date().toISOString().slice(0, 10), sector: "Technology",
  }]);
  const removeDeal = (id: number) => setDeals(prev => prev.filter(d => d.id !== id));
  const updateDeal = <K extends keyof PrecedentDeal>(id: number, key: K, val: PrecedentDeal[K]) =>
    setDeals(prev => prev.map(d => (d.id === id ? { ...d, [key]: val } : d)));

  // Accretion / Dilution Modeler Inputs
  const [offerPrice, setOfferPrice] = useTerminalArtifactState("MnaDealDeskPanel.offerPrice", 45);
  const [cashPct, setCashPct] = useTerminalArtifactState("MnaDealDeskPanel.cashPct", 40);
  const [debtPct, setDebtPct] = useTerminalArtifactState("MnaDealDeskPanel.debtPct", 30);
  const [costSavings, setCostSavings] = useTerminalArtifactState("MnaDealDeskPanel.costSavings", 60);
  const [revSynergies, setRevSynergies] = useTerminalArtifactState("MnaDealDeskPanel.revSynergies", 25);
  
  const nativeModel = useAdvancedModel<{ proFormaEps: number; standaloneAcquirerEps: number; accretionDilutionPct: number; newSharesIssued: number; debtFinancing: number; breakEvenSynergiesAfterTax: number; receipt: AdvancedReceipt }>("valuation/merger-accretion");
  const advancedAccretion = nativeModel.result;
  const [accretionError, setAccretionError] = useState<string | null>(null);
  const [accretionRunning, setAccretionRunning] = useState(false);
  // Defense / Poison Pill Inputs
  const [triggerPct, setTriggerPct] = useTerminalArtifactState("MnaDealDeskPanel.triggerPct", 15);
  const [insiderControl, setInsiderControl] = useTerminalArtifactState("MnaDealDeskPanel.insiderControl", 12);

  // LBO Modeler Inputs
  const [lboEntryEbitda, setLboEntryEbitda] = useTerminalArtifactState("MnaDealDeskPanel.lboEntryEbitda", 50);
  const [lboEntryMultiple, setLboEntryMultiple] = useTerminalArtifactState("MnaDealDeskPanel.lboEntryMultiple", 10.0);
  const [lboLeverageMultiple, setLboLeverageMultiple] = useTerminalArtifactState("MnaDealDeskPanel.lboLeverageMultiple", 6.0);
  const [lboDebtCost, setLboDebtCost] = useTerminalArtifactState("MnaDealDeskPanel.lboDebtCost", 6.5);
  const [lboEbitdaGrowth, setLboEbitdaGrowth] = useTerminalArtifactState("MnaDealDeskPanel.lboEbitdaGrowth", 8.0);
  const [lboExitMultiple, setLboExitMultiple] = useTerminalArtifactState("MnaDealDeskPanel.lboExitMultiple", 10.0);
  const [lboCapexPct, setLboCapexPct] = useTerminalArtifactState("MnaDealDeskPanel.lboCapexPct", 15.0); // Capex % of EBITDA

  // VC Waterfall Inputs
  const [vcPreMoneyVal, setVcPreMoneyVal] = useTerminalArtifactState("MnaDealDeskPanel.vcPreMoneyVal", 20);
  const [vcRoundSize, setVcRoundSize] = useTerminalArtifactState("MnaDealDeskPanel.vcRoundSize", 5);
  const [vcOptionPoolPct, setVcOptionPoolPct] = useTerminalArtifactState("MnaDealDeskPanel.vcOptionPoolPct", 10);
  const [vcLiqPrefMultiplier, setVcLiqPrefMultiplier] = useTerminalArtifactState("MnaDealDeskPanel.vcLiqPrefMultiplier", 1.0);
  const [vcIsParticipating, setVcIsParticipating] = useTerminalArtifactState("MnaDealDeskPanel.vcIsParticipating", false);

  // LBO Calculations -- uses the shared LBO engine (lib/valuationModels.ts)
  // also used by the DCF panel's LBO tab, rather than a second independent
  // implementation of the same model.
  const lboCalculations = useMemo(() => {
    const result = runLboModel({
      entryEbitda: lboEntryEbitda, entryMultiple: lboEntryMultiple, exitMultiple: lboExitMultiple,
      ebitdaGrowthRate: lboEbitdaGrowth, capexPctOfEbitda: lboCapexPct, holdYears: 5,
      tranches: [{ id: "single", label: "DEBT", leverageMult: lboLeverageMultiple, interestRate: lboDebtCost }],
    });

    const projection = result.yearly.map(y => ({
      year: `Yr ${y.year}`,
      ebitda: Math.round(y.ebitda * 10) / 10,
      interest: Math.round(y.interest * 10) / 10,
      fcf: Math.round(y.freeCashFlow * 10) / 10,
      debt: Math.round(y.totalDebt * 10) / 10,
      debtPaidDown: Math.round(y.debtPaidDown * 10) / 10,
    }));

    return {
      entryEv: result.entryEV,
      debtRaised: result.entryDebt,
      sponsorEquity: result.sponsorEntryEquity,
      projection,
      exitEv: result.exitEV,
      exitEquityValue: result.sponsorExitEquity,
      moic: Math.round(result.moic * 100) / 100,
      irr: result.irr === null ? null : Math.round(result.irr * 10) / 10,
    };
  }, [lboEntryEbitda, lboEntryMultiple, lboLeverageMultiple, lboDebtCost, lboEbitdaGrowth, lboExitMultiple, lboCapexPct]);

  // LBO Sensitivity Matrix: Exit Multiple vs Leverage -- same shared engine.
  const lboSensitivityData = useMemo(() => {
    const multiples = [8.0, 9.0, 10.0, 11.0, 12.0];
    const leverages = [4.0, 5.0, 6.0, 7.0, 8.0];

    return multiples.map(exitMult => {
      const row: Record<string, any> = { multiple: `${exitMult}x` };
      leverages.forEach(levMult => {
        const result = runLboModel({
          entryEbitda: lboEntryEbitda, entryMultiple: lboEntryMultiple, exitMultiple: exitMult,
          ebitdaGrowthRate: lboEbitdaGrowth, capexPctOfEbitda: lboCapexPct, holdYears: 5,
          tranches: [{ id: "single", label: "DEBT", leverageMult: levMult, interestRate: lboDebtCost }],
        });
        row[`lev_${levMult.toFixed(1)}`] = result.irr === null ? null : Math.round(result.irr * 10) / 10;
      });
      return row;
    });
  }, [lboEntryEbitda, lboEntryMultiple, lboEbitdaGrowth, lboDebtCost, lboCapexPct]);

  // VC Cap Table & Waterfall Projections
  const vcCalculations = useMemo(() => {
    const postMoneyVal = vcPreMoneyVal + vcRoundSize;
    
    const initialCommonShares = 10.0;
    const seedInvested = 1.5;
    const seedPreMoney = 6.0;
    const seedShares = seedInvested / (seedPreMoney / initialCommonShares);
    
    const seriesAOwnership = vcRoundSize / postMoneyVal;
    const seriesAPct = seriesAOwnership;
    const optionPoolPct = vcOptionPoolPct / 100;
    
    const remainingPct = 1 - seriesAPct - optionPoolPct;
    const foundersRatio = initialCommonShares / (initialCommonShares + seedShares);
    const seedRatio = seedShares / (initialCommonShares + seedShares);
    
    const foundersPct = remainingPct * foundersRatio;
    const seedPct = remainingPct * seedRatio;
    
    const calculatePayouts = (exitVal: number) => {
      const seriesALiqPref = vcRoundSize * vcLiqPrefMultiplier;
      const seedLiqPref = seedInvested * 1.0;
      
      let remainingDist = exitVal;
      
      const seriesAPreferredPayout = Math.min(remainingDist, seriesALiqPref);
      remainingDist -= seriesAPreferredPayout;
      
      const seedPreferredPayout = Math.min(remainingDist, seedLiqPref);
      remainingDist -= seedPreferredPayout;
      
      let seriesAPayout = 0;
      let seedPayout = 0;
      let commonPayout = 0;
      
      if (vcIsParticipating) {
        const poolSharesPct = foundersPct + optionPoolPct;
        const totalProRataShare = seriesAPct + seedPct + poolSharesPct;
        
        seriesAPayout = seriesAPreferredPayout + (seriesAPct / totalProRataShare) * remainingDist;
        seedPayout = seedPreferredPayout + (seedPct / totalProRataShare) * remainingDist;
        commonPayout = (poolSharesPct / totalProRataShare) * remainingDist;
      } else {
        const seriesAProRata = seriesAPct * exitVal;
        const seedProRata = seedPct * exitVal;
        
        const seriesAConverts = seriesAProRata > seriesAPreferredPayout;
        const seedConverts = seedProRata > seedPreferredPayout;
        
        if (seriesAConverts && seedConverts) {
          seriesAPayout = seriesAProRata;
          seedPayout = seedProRata;
          commonPayout = (foundersPct + optionPoolPct) * exitVal;
        } else if (seriesAConverts) {
          const remainingForCommon = Math.max(0, exitVal - seedPreferredPayout);
          const relativeA = seriesAPct / (seriesAPct + foundersPct + optionPoolPct);
          seriesAPayout = relativeA * remainingForCommon;
          seedPayout = seedPreferredPayout;
          commonPayout = (1 - relativeA) * remainingForCommon;
        } else if (seedConverts) {
          const remainingForCommon = Math.max(0, exitVal - seriesAPreferredPayout);
          const relativeSeed = seedPct / (seedPct + foundersPct + optionPoolPct);
          seriesAPayout = seriesAPreferredPayout;
          seedPayout = relativeSeed * remainingForCommon;
          commonPayout = (1 - relativeSeed) * remainingForCommon;
        } else {
          seriesAPayout = seriesAPreferredPayout;
          seedPayout = seedPreferredPayout;
          commonPayout = remainingDist;
        }
      }
      
      return {
        exitVal: Math.round(exitVal * 10) / 10,
        SeriesA: Math.round(seriesAPayout * 10) / 10,
        Seed: Math.round(seedPayout * 10) / 10,
        Common: Math.round(commonPayout * 10) / 10,
      };
    };
    
    const exitValRange = Array.from({ length: 21 }, (_, i) => i * (postMoneyVal * 2.5 / 20));
    const waterfallData = exitValRange.map(exit => calculatePayouts(exit));
    
    return {
      postMoneyVal,
      seriesAPct: Math.round(seriesAPct * 1000) / 10,
      optionPoolPct: Math.round(optionPoolPct * 1000) / 10,
      foundersPct: Math.round(foundersPct * 1000) / 10,
      seedPct: Math.round(seedPct * 1000) / 10,
      waterfallData,
      calculatePayouts,
    };
  }, [vcPreMoneyVal, vcRoundSize, vcOptionPoolPct, vcLiqPrefMultiplier, vcIsParticipating]);


  // Target Profile baseline
  const targetShares = 60; // 60 Million shares
  const targetSpot = 35;
  const targetNetIncome = 135; // $135M
  const targetBookValue = 900; // $900M
  
  // Acquirer Profile baseline
  const acquirerNetIncome = 850; // $850M
  const acquirerShares = 220; // 220 Million shares
  const acquirerPrice = 85; // $85
  const acquirerEPS = 850 / 220; // $3.86
  
  // Financial parameters
  const interestRate = 0.055; // 5.5% cost of new debt
  const foregoneYield = 0.045; // 4.5% foregone cash yield
  const taxRate = 0.21; // 21% corporate tax

  // Calculated variables
  const offerPremium = ((offerPrice - targetSpot) / targetSpot) * 100;
  const transactionValue = targetShares * offerPrice; // Offer Value ($M)
  
  const cashVal = transactionValue * (cashPct / 100);
  const debtVal = transactionValue * (debtPct / 100);
  const stockPct = Math.max(0, 100 - cashPct - debtPct);
  const stockVal = transactionValue * (stockPct / 100);
  
  const sharesIssued = stockVal / acquirerPrice;
  const proFormaShares = acquirerShares + sharesIssued;
  
  // Synergy post-tax contribution
  const costSavingsPostTax = costSavings * (1 - taxRate);
  const revSynergyPostTax = revSynergies * 0.35 * (1 - taxRate); // assumes 35% margin on rev synergies
  const totalSynergiesPF = costSavingsPostTax + revSynergyPostTax;

  // New debt and cash foregone costs (after tax)
  const newDebtCostPostTax = debtVal * interestRate * (1 - taxRate);
  const foregoneCashPostTax = cashVal * foregoneYield * (1 - taxRate);
  
  const proFormaNetIncome = acquirerNetIncome + targetNetIncome + totalSynergiesPF - newDebtCostPostTax - foregoneCashPostTax;
  const proFormaEPS = proFormaNetIncome / proFormaShares;
  const accDilPct = ((proFormaEPS - acquirerEPS) / acquirerEPS) * 100;

  async function runCanonicalAccretion() {
    const parameters = {
      acquirerShares, acquirerNetIncome, acquirerSharePrice: acquirerPrice,
      targetShares, targetNetIncome, offerPricePerShare: offerPrice,
      stockConsiderationPct: stockPct, debtInterestRatePct: interestRate * 100,
      taxRatePct: taxRate * 100, annualSynergiesAfterTax: totalSynergiesPF,
    };
    setAccretionRunning(true); setAccretionError(null);
    try { await nativeModel.run(parameters); }
    catch (error) { setAccretionError(error instanceof Error ? error.message : "Merger accretion run failed."); }
    finally { setAccretionRunning(false); }
  }

  // Goodwill / PPA calculation
  const intangiblesWriteUp = transactionValue * 0.15; // 15% write-up
  const goodwill = Math.max(0, transactionValue - targetBookValue - intangiblesWriteUp);

  // Precedent Deal filtering
  const filteredDeals = useMemo(() => {
    return deals.filter(deal => {
      const matchSearch = deal.target.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          deal.acquirer.toLowerCase().includes(searchTerm.toLowerCase());
      const matchSector = selectedSector === "All" || deal.sector === selectedSector;
      return matchSearch && matchSector;
    });
  }, [deals, searchTerm, selectedSector]);

  // Sector median multiples -- computed live from whatever real deals the
  // analyst has actually entered. Empty/thin data is reported honestly (0,
  // with a count) rather than backfilled with a plausible-looking number.
  const sectorMedians = useMemo(() => {
    const pool = selectedSector === "All" ? deals : deals.filter(d => d.sector === selectedSector);
    return {
      n: pool.length,
      evEbitda: Number(median(pool.map(d => d.evEbitda).filter(v => v > 0)).toFixed(1)),
      evSales: Number(median(pool.map(d => d.evSales).filter(v => v > 0)).toFixed(1)),
      premium: Number(median(pool.map(d => d.premium).filter(v => v !== 0)).toFixed(1)),
    };
  }, [deals, selectedSector]);

  // 3-Year EPS Projections
  const epsProjectionData = useMemo(() => {
    return [
      { year: "Year 1", Standalone: Number(acquirerEPS.toFixed(2)), ProForma: Number(proFormaEPS.toFixed(2)) },
      { year: "Year 2", Standalone: Number((acquirerEPS * 1.05).toFixed(2)), ProForma: Number((proFormaEPS * 1.08).toFixed(2)) }, 
      { year: "Year 3", Standalone: Number((acquirerEPS * 1.10).toFixed(2)), ProForma: Number((proFormaEPS * 1.16).toFixed(2)) },
    ];
  }, [acquirerEPS, proFormaEPS]);

  // HHI Market share calculation
  const marketShares = [
    { name: "Acquirer", share: 24 },
    { name: "Target", share: 7 },
    { name: "Competitor A", share: 22 },
    { name: "Competitor B", share: 18 },
    { name: "Competitor C", share: 11 },
    { name: "Others (Unconcentrated)", share: 18 }
  ];
  
  const hhiPre = useMemo(() => {
    return marketShares.reduce((sum, item) => sum + Math.pow(item.share, 2), 0);
  }, []);

  const hhiPost = useMemo(() => {
    const combinedShare = marketShares[0].share + marketShares[1].share; 
    const otherSum = marketShares.slice(2).reduce((sum, item) => sum + Math.pow(item.share, 2), 0);
    return Math.pow(combinedShare, 2) + otherSum;
  }, []);

  const hhiChange = hhiPost - hhiPre;

  const getHhiRiskLevel = () => {
    if (hhiPost > 2500 && hhiChange > 200) return { label: "HIGH REGULATORY RISK", color: "text-[hsl(0,80%,60%)] bg-[hsl(0,80%,10%)] border-[hsl(0,80%,30%)]" };
    if (hhiPost > 1500 || hhiChange > 100) return { label: "MODERATE RISK / SECONDARY SEC REVIEW", color: "text-[hsl(38,95%,55%)] bg-[hsl(38,95%,10%)] border-[hsl(38,95%,30%)]" };
    return { label: "LOW REGULATORY RISK", color: "text-[hsl(142,71%,45%)] bg-[hsl(142,71%,10%)] border-[hsl(142,71%,30%)]" };
  };

  const hhiRisk = getHhiRiskLevel();

  return (
    <div className="h-full flex flex-col bg-[#050505] text-foreground overflow-hidden">
      {/* Panel Top bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <Building2 className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label font-bold text-xs tracking-wider">M&A TRANSACTION DESK & DEAL BUILDER</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">MNA</span>
      </div>

      <div className="flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <div className="border-b border-border bg-[#070707] px-4 shrink-0">
            <TabsList className="bg-transparent gap-4 p-0">
              <TabsTrigger value="db" className="border-b-2 border-transparent data-[state=active]:border-[hsl(38,95%,50%)] rounded-none py-2 text-[10px] uppercase font-semibold">Deal Database</TabsTrigger>
              <TabsTrigger value="modeler" className="border-b-2 border-transparent data-[state=active]:border-[hsl(38,95%,50%)] rounded-none py-2 text-[10px] uppercase font-semibold">Synergy & PPA Modeler</TabsTrigger>
              <TabsTrigger value="accdil" className="border-b-2 border-transparent data-[state=active]:border-[hsl(38,95%,50%)] rounded-none py-2 text-[10px] uppercase font-semibold">Accretion/Dilution Analysis</TabsTrigger>
              <TabsTrigger value="lbo" className="border-b-2 border-transparent data-[state=active]:border-[hsl(38,95%,50%)] rounded-none py-2 text-[10px] uppercase font-semibold">PE LBO Modeler</TabsTrigger>
              <TabsTrigger value="vc" className="border-b-2 border-transparent data-[state=active]:border-[hsl(38,95%,50%)] rounded-none py-2 text-[10px] uppercase font-semibold">VC Waterfall</TabsTrigger>
              <TabsTrigger value="defense" className="border-b-2 border-transparent data-[state=active]:border-[hsl(38,95%,50%)] rounded-none py-2 text-[10px] uppercase font-semibold">Hostile Defense</TabsTrigger>
              <TabsTrigger value="antitrust" className="border-b-2 border-transparent data-[state=active]:border-[hsl(38,95%,50%)] rounded-none py-2 text-[10px] uppercase font-semibold">Antitrust & HHI</TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto p-4 min-h-0 bg-[#050505]">
            
            {/* TABS CONTENT 1: DEAL DATABASE */}
            <TabsContent value="db" className="space-y-4 m-0">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-3 space-y-4">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search targets or acquirers..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-8 bg-[#090909] border-border text-xs"
                      />
                    </div>
                    <select
                      value={selectedSector}
                      onChange={(e) => setSelectedSector(e.target.value)}
                      className="bg-[#090909] border border-border rounded px-3 text-xs text-muted-foreground focus:outline-none"
                    >
                      <option value="All">All Sectors</option>
                      {DEAL_SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button onClick={addDeal} className="px-3 text-xs font-semibold border border-[hsl(38,95%,50%)/40%] text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)/10%] rounded whitespace-nowrap">
                      + ADD DEAL
                    </button>
                  </div>

                  <div className="border border-border rounded bg-[#070707] overflow-hidden">
                    {deals.length === 0 ? (
                      <div className="p-6 text-center text-xs text-muted-foreground">
                        No precedent deals entered yet. Click "+ ADD DEAL" and type in the real transactions your deal team is tracking — every cell below is editable.
                      </div>
                    ) : (
                    <Table>
                      <TableHeader className="bg-[#0d0d0d]">
                        <TableRow className="border-b border-border">
                          <TableHead className="text-[10px] font-bold">Target Company</TableHead>
                          <TableHead className="text-[10px] font-bold">Acquirer</TableHead>
                          <TableHead className="text-[10px] font-bold">Sector</TableHead>
                          <TableHead className="text-[10px] font-bold text-right">Deal Value ($M)</TableHead>
                          <TableHead className="text-[10px] font-bold text-right">Premium Paid</TableHead>
                          <TableHead className="text-[10px] font-bold text-right">EV/EBITDA</TableHead>
                          <TableHead className="text-[10px] font-bold text-right">EV/Sales</TableHead>
                          <TableHead className="text-[10px] font-bold">Announced</TableHead>
                          <TableHead className="w-6"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredDeals.map((deal) => (
                          <TableRow key={deal.id} className="border-b border-border hover:bg-white/5 transition-colors">
                            <TableCell className="p-1">
                              <input value={deal.target} onChange={e => updateDeal(deal.id, "target", e.target.value)} placeholder="Target name" className="w-28 bg-transparent text-xs font-semibold text-foreground focus:outline-none focus:border-b focus:border-[hsl(38,95%,50%)/50%]" />
                            </TableCell>
                            <TableCell className="p-1">
                              <input value={deal.acquirer} onChange={e => updateDeal(deal.id, "acquirer", e.target.value)} placeholder="Acquirer name" className="w-28 bg-transparent text-xs text-muted-foreground focus:outline-none focus:border-b focus:border-[hsl(38,95%,50%)/50%]" />
                            </TableCell>
                            <TableCell className="p-1">
                              <select value={deal.sector} onChange={e => updateDeal(deal.id, "sector", e.target.value)} className="bg-transparent text-[10px] text-muted-foreground focus:outline-none">
                                {DEAL_SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </TableCell>
                            <TableCell className="p-1 text-right">
                              <input type="number" value={deal.value || ""} onChange={e => updateDeal(deal.id, "value", Number(e.target.value))} className="w-20 bg-transparent text-right text-xs font-terminal font-semibold text-emerald-400 focus:outline-none focus:border-b focus:border-[hsl(38,95%,50%)/50%]" />
                            </TableCell>
                            <TableCell className="p-1 text-right">
                              <input type="number" value={deal.premium || ""} onChange={e => updateDeal(deal.id, "premium", Number(e.target.value))} className="w-14 bg-transparent text-right text-xs font-terminal text-orange-400 focus:outline-none focus:border-b focus:border-[hsl(38,95%,50%)/50%]" />
                            </TableCell>
                            <TableCell className="p-1 text-right">
                              <input type="number" value={deal.evEbitda || ""} onChange={e => updateDeal(deal.id, "evEbitda", Number(e.target.value))} className="w-14 bg-transparent text-right text-xs font-terminal focus:outline-none focus:border-b focus:border-[hsl(38,95%,50%)/50%]" />
                            </TableCell>
                            <TableCell className="p-1 text-right">
                              <input type="number" value={deal.evSales || ""} onChange={e => updateDeal(deal.id, "evSales", Number(e.target.value))} className="w-14 bg-transparent text-right text-xs font-terminal focus:outline-none focus:border-b focus:border-[hsl(38,95%,50%)/50%]" />
                            </TableCell>
                            <TableCell className="p-1">
                              <input type="date" value={deal.date} onChange={e => updateDeal(deal.id, "date", e.target.value)} className="bg-transparent text-[10px] text-muted-foreground focus:outline-none" />
                            </TableCell>
                            <TableCell className="p-1">
                              <button onClick={() => removeDeal(deal.id)} className="text-muted-foreground hover:text-[hsl(0,80%,60%)] text-xs">✕</button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <Card className="bg-[#070707] border-border">
                    <CardHeader className="p-4 border-b border-border">
                      <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%,50%)]">Sector Benchmarks</CardTitle>
                      <CardDescription className="text-[9px]">Precedent metrics for {selectedSector} — computed live from {sectorMedians.n} entered deal{sectorMedians.n === 1 ? "" : "s"}</CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 space-y-4 font-terminal">
                      {sectorMedians.n === 0 ? (
                        <div className="text-[10px] text-muted-foreground">No deals entered for this filter yet — benchmarks compute automatically once you add real transactions.</div>
                      ) : (
                      <>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted-foreground">Median Premium</span>
                          <span className="text-orange-400 font-bold">{sectorMedians.premium}%</span>
                        </div>
                        <div className="w-full bg-[#111] h-1.5 rounded overflow-hidden">
                          <div className="bg-orange-500 h-full" style={{ width: `${Math.min(100, sectorMedians.premium * 2)}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted-foreground">Median EV/EBITDA</span>
                          <span className="text-emerald-400 font-bold">{sectorMedians.evEbitda}x</span>
                        </div>
                        <div className="w-full bg-[#111] h-1.5 rounded overflow-hidden">
                          <div className="bg-emerald-500 h-full" style={{ width: `${Math.min(100, sectorMedians.evEbitda * 3.3)}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted-foreground">Median EV/Sales</span>
                          <span className="text-cyan-400 font-bold">{sectorMedians.evSales}x</span>
                        </div>
                        <div className="w-full bg-[#111] h-1.5 rounded overflow-hidden">
                          <div className="bg-cyan-500 h-full" style={{ width: `${Math.min(100, sectorMedians.evSales * 8)}%` }} />
                        </div>
                      </div>
                      </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* TABS CONTENT 2: MODELER */}
            <TabsContent value="modeler" className="space-y-4 m-0">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Sliders Input */}
                <Card className="bg-[#070707] border-border text-foreground">
                  <CardHeader className="p-4 border-b border-border">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Deal Structure Parameters</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-6">
                    {/* Offer Price */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-semibold text-muted-foreground">Target Offer Price:</span>
                        <span className="text-[hsl(38,95%,50%)] font-bold font-terminal">${offerPrice} <span className="text-[10px] text-muted-foreground font-normal">({offerPremium.toFixed(1)}% premium)</span></span>
                      </div>
                      <Slider 
                        min={35} max={65} step={1} 
                        value={[offerPrice]} 
                        onValueChange={(val) => setOfferPrice(val[0])} 
                      />
                    </div>

                    {/* Funding splits */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-muted-foreground">Cash Funding:</span>
                          <span className="text-cyan-400 font-bold font-terminal">{cashPct}%</span>
                        </div>
                        <Slider 
                          min={0} max={100 - debtPct} step={5} 
                          value={[cashPct]} 
                          onValueChange={(val) => setCashPct(val[0])} 
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-muted-foreground">Debt Funding:</span>
                          <span className="text-purple-400 font-bold font-terminal">{debtPct}%</span>
                        </div>
                        <Slider 
                          min={0} max={100 - cashPct} step={5} 
                          value={[debtPct]} 
                          onValueChange={(val) => setDebtPct(val[0])} 
                        />
                      </div>
                    </div>

                    {/* Synergies */}
                    <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-muted-foreground">Cost Synergies:</span>
                          <span className="text-emerald-400 font-bold font-terminal">${costSavings}M</span>
                        </div>
                        <Slider 
                          min={0} max={120} step={5} 
                          value={[costSavings]} 
                          onValueChange={(val) => setCostSavings(val[0])} 
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-muted-foreground">Revenue Synergies:</span>
                          <span className="text-yellow-400 font-bold font-terminal">${revSynergies}M</span>
                        </div>
                        <Slider 
                          min={0} max={80} step={5} 
                          value={[revSynergies]} 
                          onValueChange={(val) => setRevSynergies(val[0])} 
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Deal Output Metrics */}
                <Card className="bg-[#070707] border-border text-foreground">
                  <CardHeader className="p-4 border-b border-border">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Deal Metrics Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 grid grid-cols-2 gap-4">
                    <div className="bg-[#0a0a0a] p-3 border border-border rounded font-terminal text-center">
                      <span className="text-[10px] text-muted-foreground uppercase">Transaction Value</span>
                      <h4 className="text-lg font-bold text-emerald-400 mt-1">${transactionValue.toLocaleString()}M</h4>
                    </div>

                    <div className="bg-[#0a0a0a] p-3 border border-border rounded font-terminal text-center">
                      <span className="text-[10px] text-muted-foreground uppercase">Goodwill Created</span>
                      <h4 className="text-lg font-bold text-cyan-400 mt-1">${goodwill.toLocaleString()}M</h4>
                    </div>

                    <div className="col-span-2 border-t border-border pt-2">
                      <h5 className="text-[10px] font-bold text-muted-foreground uppercase mb-2">Purchase Price Allocation (PPA)</h5>
                      <div className="space-y-2 text-xs font-terminal">
                        <div className="flex justify-between">
                          <span>Target Book Value (Net Assets):</span>
                          <span>${targetBookValue}M</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Intangible Asset Write-Ups (15%):</span>
                          <span>${intangiblesWriteUp}M</span>
                        </div>
                        <div className="flex justify-between border-t border-border pt-1 font-semibold">
                          <span>Total Allocations (PPA):</span>
                          <span>${targetBookValue + intangiblesWriteUp}M</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* TABS CONTENT 3: ACCRETION / DILUTION */}
            <TabsContent value="accdil" className="space-y-4 m-0">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-[#070707] border-border md:col-span-2">
                  <CardHeader className="p-4 border-b border-border">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">EPS Impact: Standalone vs Pro-Forma</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={epsProjectionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                          <XAxis dataKey="year" stroke="#888" fontSize={10} />
                          <YAxis stroke="#888" fontSize={10} domain={[3, 5]} />
                          <Tooltip contentStyle={{ backgroundColor: "#0d0d0d", borderColor: "#333", color: "#fff" }} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          <Bar dataKey="Standalone" fill="#444" radius={[4, 4, 0, 0]} name="Standalone EPS ($)" />
                          <Bar dataKey="ProForma" fill="hsl(38,95%,50%)" radius={[4, 4, 0, 0]} name="Pro-Forma EPS ($)" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              <div className="border border-border bg-[#080808] p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-terminal text-[9px] tracking-widest text-[hsl(38,95%,55%)]">CANONICAL ADVANCED MERGER ACCRETION</span><button type="button" disabled={accretionRunning} onClick={runCanonicalAccretion} className="border border-[hsl(38,95%,50%)] px-2 py-1 font-terminal text-[8px] text-[hsl(38,95%,55%)] disabled:opacity-40">{accretionRunning ? "RUNNING…" : "RUN RECEIPTED MODEL"}</button></div>
                <div className="font-terminal text-[7px] text-muted-foreground">MANUAL deal inputs only. Formal units: money (net income, offer price, synergies); shares; percent (stock consideration, interest, tax). This canonical engine treats non-stock consideration as debt; the legacy worksheet’s cash funding and separate revenue-synergy margin are shown only as a reconciliation bridge.</div>
                {accretionError ? <div className="font-terminal text-[8px] text-red-400">{accretionError}</div> : null}
                {advancedAccretion ? <><div className="font-terminal text-[8px] text-muted-foreground">Recorded native EPS {advancedAccretion.proFormaEps.toFixed(2)}; recorded accretion {advancedAccretion.accretionDilutionPct >= 0 ? "+" : ""}{advancedAccretion.accretionDilutionPct.toFixed(2)}%; break-even after-tax synergies {advancedAccretion.breakEvenSynergiesAfterTax.toFixed(2)}. The table uses current worksheet inputs separately; run explicitly after editing to create a new native result.</div><AdvancedReceiptFooter receipt={advancedAccretion.receipt} /></> : null}
              </div>

                {/* Accretion Table */}
                <Card className="bg-[#070707] border-border font-terminal">
                  <CardHeader className="p-4 border-b border-border">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)] flex items-center justify-between">
                      <span>Pro-Forma Output</span>
                      <span className={`px-2 py-0.5 rounded text-[8px] font-bold ${accDilPct >= 0 ? "bg-emerald-950 text-emerald-400 border border-emerald-800" : "bg-rose-950 text-rose-400 border border-rose-800"}`}>
                        {accDilPct >= 0 ? "ACCRETIVE" : "DILUTIVE"}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4 text-xs">
                    <div className="text-center bg-[#0a0a0a] p-3 rounded border border-border">
                      <span className="text-[10px] text-muted-foreground uppercase">EPS Accretion / (Dilution)</span>
                      <h4 className={`text-xl font-bold mt-1 ${accDilPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {accDilPct >= 0 ? "+" : ""}{accDilPct.toFixed(2)}%
                      </h4>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">New Shares Issued:</span>
                        <span>{sharesIssued.toFixed(2)}M</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Pro-Forma Shares:</span>
                        <span>{proFormaShares.toFixed(2)}M</span>
                      </div>
                      <div className="flex justify-between border-t border-border pt-1">
                        <span className="text-muted-foreground">Standalone EPS:</span>
                        <span>${acquirerEPS.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-bold text-foreground">
                        <span>Pro-Forma EPS:</span>
                        <span className={accDilPct >= 0 ? "text-emerald-400" : "text-rose-400"}>${proFormaEPS.toFixed(2)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* TABS CONTENT 4: PE LBO MODELER */}
            <TabsContent value="lbo" className="space-y-4 m-0 animate-in fade-in duration-200">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                
                {/* LBO Controls */}
                <div className="lg:col-span-4 space-y-4">
                  <Card className="bg-[#070707] border-border">
                    <CardHeader className="p-4 border-b border-border">
                      <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">LBO Parameters</CardTitle>
                      <CardDescription className="text-[10px] text-muted-foreground">Adjust leverage, pricing, and exit multiples.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 space-y-4 font-terminal text-xs">
                      <div>
                        <div className="flex justify-between mb-1 text-muted-foreground text-[10px]">
                          <span>ENTRY EBITDA</span>
                          <span className="text-[hsl(38,95%,50%)] font-bold">${lboEntryEbitda}M</span>
                        </div>
                        <Slider min={10} max={200} step={5} value={[lboEntryEbitda]} onValueChange={v => setLboEntryEbitda(v[0])} />
                      </div>

                      <div>
                        <div className="flex justify-between mb-1 text-muted-foreground text-[10px]">
                          <span>ENTRY MULTIPLE</span>
                          <span className="text-[hsl(38,95%,50%)] font-bold">{lboEntryMultiple}x</span>
                        </div>
                        <Slider min={4} max={20} step={0.5} value={[lboEntryMultiple]} onValueChange={v => setLboEntryMultiple(v[0])} />
                      </div>

                      <div>
                        <div className="flex justify-between mb-1 text-muted-foreground text-[10px]">
                          <span>LEVERAGE (DEBT / EBITDA)</span>
                          <span className="text-[hsl(38,95%,50%)] font-bold">{lboLeverageMultiple}x</span>
                        </div>
                        <Slider min={2} max={9} step={0.2} value={[lboLeverageMultiple]} onValueChange={v => setLboLeverageMultiple(v[0])} />
                      </div>

                      <div>
                        <div className="flex justify-between mb-1 text-muted-foreground text-[10px]">
                          <span>DEBT COST (INTEREST RATE)</span>
                          <span className="text-[hsl(38,95%,50%)] font-bold">{lboDebtCost}%</span>
                        </div>
                        <Slider min={3} max={15} step={0.1} value={[lboDebtCost]} onValueChange={v => setLboDebtCost(v[0])} />
                      </div>

                      <div>
                        <div className="flex justify-between mb-1 text-muted-foreground text-[10px]">
                          <span>ANNUAL EBITDA GROWTH</span>
                          <span className="text-[hsl(38,95%,50%)] font-bold">{lboEbitdaGrowth}%</span>
                        </div>
                        <Slider min={-5} max={30} step={1} value={[lboEbitdaGrowth]} onValueChange={v => setLboEbitdaGrowth(v[0])} />
                      </div>

                      <div>
                        <div className="flex justify-between mb-1 text-muted-foreground text-[10px]">
                          <span>EXIT EBITDA MULTIPLE</span>
                          <span className="text-[hsl(38,95%,50%)] font-bold">{lboExitMultiple}x</span>
                        </div>
                        <Slider min={4} max={20} step={0.5} value={[lboExitMultiple]} onValueChange={v => setLboExitMultiple(v[0])} />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-[#070707] border-border p-4 font-terminal text-[10px] text-muted-foreground leading-relaxed">
                    <div className="font-bold text-foreground mb-1">SOURCES & USES BREAKDOWN</div>
                    <div className="flex justify-between border-b border-border/30 py-1">
                      <span>Senior Debt ({lboLeverageMultiple}x EBITDA)</span>
                      <span className="text-foreground font-bold">${lboCalculations.debtRaised.toFixed(1)}M</span>
                    </div>
                    <div className="flex justify-between border-b border-border/30 py-1">
                      <span>Sponsor Equity contribution</span>
                      <span className="text-[hsl(38,95%,55%)] font-bold">${lboCalculations.sponsorEquity.toFixed(1)}M</span>
                    </div>
                    <div className="flex justify-between font-bold text-foreground pt-1.5">
                      <span>Total Enterprise Value (Entry)</span>
                      <span>${lboCalculations.entryEv.toFixed(1)}M</span>
                    </div>
                  </Card>
                </div>

                {/* LBO Outputs & Sensitivity */}
                <div className="lg:col-span-8 space-y-4">
                  {/* KPI Strip */}
                  <div className="grid grid-cols-5 border border-border bg-[#060606] divide-x divide-border font-terminal text-center">
                    <div className="p-2.5">
                      <div className="text-[7.5px] text-muted-foreground tracking-widest mb-0.5">PURCHASE EV</div>
                      <div className="text-sm font-bold text-foreground">${lboCalculations.entryEv.toFixed(1)}M</div>
                    </div>
                    <div className="p-2.5">
                      <div className="text-[7.5px] text-muted-foreground tracking-widest mb-0.5">SPONSOR EQUITY</div>
                      <div className="text-sm font-bold text-foreground">${lboCalculations.sponsorEquity.toFixed(1)}M</div>
                    </div>
                    <div className="p-2.5">
                      <div className="text-[7.5px] text-muted-foreground tracking-widest mb-0.5">EXIT EQUITY VAL</div>
                      <div className="text-sm font-bold text-foreground">${lboCalculations.exitEquityValue.toFixed(1)}M</div>
                    </div>
                    <div className="p-2.5 bg-[hsl(38,95%,50%)/5%]">
                      <div className="text-[7.5px] text-[hsl(38,95%,55%)] tracking-widest mb-0.5">SPONSOR MOIC</div>
                      <div className="text-sm font-bold text-[hsl(38,95%,55%)]">{lboCalculations.moic}x</div>
                    </div>
                    <div className="p-2.5 bg-[hsl(142,71%,50%)/5%]">
                      <div className="text-[7.5px] text-[hsl(142,71%,55%)] tracking-widest mb-0.5">SPONSOR IRR (5-YR)</div>
                      <div className="text-sm font-bold text-[hsl(142,71%,55%)]">{lboCalculations.irr === null ? "N/A" : `${lboCalculations.irr}%`}</div>
                    </div>
                  </div>

                  {/* Debt Amortization Chart */}
                  <Card className="bg-[#070707] border-border">
                    <CardHeader className="p-4 border-b border-border flex flex-row items-center justify-between">
                      <div className="space-y-0.5">
                        <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">5-Year Debt Paydown Schedule</CardTitle>
                        <CardDescription className="text-[9px] text-muted-foreground">Deleveraging profile vs EBITDA expansion</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={lboCalculations.projection} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                            <XAxis dataKey="year" stroke="#444" fontSize={9} />
                            <YAxis stroke="#444" fontSize={9} />
                            <Tooltip contentStyle={{ backgroundColor: "#080808", borderColor: "#222", color: "#fff" }} />
                            <Legend wrapperStyle={{ fontSize: 9 }} />
                            <Line type="monotone" dataKey="ebitda" name="EBITDA ($M)" stroke="hsl(142,71%,45%)" strokeWidth={1.5} dot={false} />
                            <Line type="monotone" dataKey="debt" name="Outstanding Debt ($M)" stroke="hsl(0,80%,50%)" strokeWidth={1.5} dot={false} />
                            <Line type="monotone" dataKey="fcf" name="FCF Cash Sweep ($M)" stroke="hsl(38,95%,50%)" strokeWidth={1.5} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Sensitivity Grid */}
                  <Card className="bg-[#070707] border-border">
                    <CardHeader className="p-4 border-b border-border">
                      <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">IRR Sensitivity matrix (5-Year)</CardTitle>
                      <CardDescription className="text-[9px] text-muted-foreground">Exit Multiple (Rows) vs. Leverage Level (Columns)</CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 font-terminal text-[10px]">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-b border-border">
                            <TableHead className="p-1.5">Exit Multiple</TableHead>
                            <TableHead className="p-1.5 text-right">4.0x Leverage</TableHead>
                            <TableHead className="p-1.5 text-right">5.0x Leverage</TableHead>
                            <TableHead className="p-1.5 text-right">6.0x Leverage</TableHead>
                            <TableHead className="p-1.5 text-right">7.0x Leverage</TableHead>
                            <TableHead className="p-1.5 text-right">8.0x Leverage</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {lboSensitivityData.map((row, idx) => (
                            <TableRow key={idx} className="border-b border-border/30 hover:bg-white/5">
                              <TableCell className="p-1.5 font-bold">{row.multiple}</TableCell>
                              <TableCell className="p-1.5 text-right text-[hsl(142,71%,55%)] font-bold">{row["lev_4.0"]}%</TableCell>
                              <TableCell className="p-1.5 text-right text-[hsl(142,71%,55%)] font-bold">{row["lev_5.0"]}%</TableCell>
                              <TableCell className="p-1.5 text-right text-[hsl(142,71%,55%)] font-bold">{row["lev_6.0"]}%</TableCell>
                              <TableCell className="p-1.5 text-right text-[hsl(142,71%,55%)] font-bold">{row["lev_7.0"]}%</TableCell>
                              <TableCell className="p-1.5 text-right text-[hsl(142,71%,55%)] font-bold">{row["lev_8.0"]}%</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* TABS CONTENT 5: VC WATERFALL & CAP TABLE */}
            <TabsContent value="vc" className="space-y-4 m-0 animate-in fade-in duration-200">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                
                {/* VC Configuration */}
                <div className="lg:col-span-4 space-y-4">
                  <Card className="bg-[#070707] border-border">
                    <CardHeader className="p-4 border-b border-border">
                      <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Series A parameters</CardTitle>
                      <CardDescription className="text-[10px] text-muted-foreground">Adjust valuation, round size, and preferred rights.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 space-y-4 font-terminal text-xs">
                      <div>
                        <div className="flex justify-between mb-1 text-muted-foreground text-[10px]">
                          <span>PRE-MONEY VALUATION</span>
                          <span className="text-[hsl(38,95%,50%)] font-bold">${vcPreMoneyVal}M</span>
                        </div>
                        <Slider min={5} max={100} step={1} value={[vcPreMoneyVal]} onValueChange={v => setVcPreMoneyVal(v[0])} />
                      </div>

                      <div>
                        <div className="flex justify-between mb-1 text-muted-foreground text-[10px]">
                          <span>ROUND SIZE (INVESTMENT)</span>
                          <span className="text-[hsl(38,95%,50%)] font-bold">${vcRoundSize}M</span>
                        </div>
                        <Slider min={1} max={30} step={0.5} value={[vcRoundSize]} onValueChange={v => setVcRoundSize(v[0])} />
                      </div>

                      <div>
                        <div className="flex justify-between mb-1 text-muted-foreground text-[10px]">
                          <span>OPTION POOL EXPANSION</span>
                          <span className="text-[hsl(38,95%,50%)] font-bold">{vcOptionPoolPct}%</span>
                        </div>
                        <Slider min={0} max={25} step={1} value={[vcOptionPoolPct]} onValueChange={v => setVcOptionPoolPct(v[0])} />
                      </div>

                      <div>
                        <div className="flex justify-between mb-1 text-muted-foreground text-[10px]">
                          <span>LIQUIDATION PREFERENCE</span>
                          <span className="text-[hsl(38,95%,50%)] font-bold">{vcLiqPrefMultiplier}x</span>
                        </div>
                        <Slider min={1.0} max={3.0} step={0.5} value={[vcLiqPrefMultiplier]} onValueChange={v => setVcLiqPrefMultiplier(v[0])} />
                      </div>

                      <div className="flex items-center justify-between border-t border-border/30 pt-3">
                        <span className="font-terminal text-[10px] text-muted-foreground">PARTICIPATING PREFERRED RIGHTS</span>
                        <input type="checkbox" checked={vcIsParticipating} onChange={e => setVcIsParticipating(e.target.checked)}
                          className="w-4 h-4 accent-[hsl(38,95%,50%)] bg-transparent border-border focus:ring-0" />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Post-round ownership table */}
                  <Card className="bg-[#070707] border-border">
                    <CardHeader className="p-4 border-b border-border">
                      <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Post-Round Cap Table</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 font-terminal text-[10px]">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-b border-border">
                            <TableHead className="p-1">Shareholder</TableHead>
                            <TableHead className="p-1 text-right">Ownership %</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow className="border-b border-border/20">
                            <TableCell className="p-1">Founders (Common)</TableCell>
                            <TableCell className="p-1 text-right font-bold text-foreground">{vcCalculations.foundersPct}%</TableCell>
                          </TableRow>
                          <TableRow className="border-b border-border/20">
                            <TableCell className="p-1">Series A Investors (Preferred)</TableCell>
                            <TableCell className="p-1 text-right font-bold text-[hsl(38,95%,55%)]">{vcCalculations.seriesAPct}%</TableCell>
                          </TableRow>
                          <TableRow className="border-b border-border/20">
                            <TableCell className="p-1">Seed Investors (Preferred)</TableCell>
                            <TableCell className="p-1 text-right font-bold text-foreground">{vcCalculations.seedPct}%</TableCell>
                          </TableRow>
                          <TableRow className="border-b border-border/20">
                            <TableCell className="p-1">Employee Option Pool</TableCell>
                            <TableCell className="p-1 text-right font-bold text-muted-foreground">{vcCalculations.optionPoolPct}%</TableCell>
                          </TableRow>
                          <TableRow className="font-bold bg-white/5">
                            <TableCell className="p-1">Total</TableCell>
                            <TableCell className="p-1 text-right">100.0%</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>

                {/* VC Waterfall Charts */}
                <div className="lg:col-span-8 space-y-4">
                  
                  {/* KPI Strip */}
                  <div className="grid grid-cols-4 border border-border bg-[#060606] divide-x divide-border font-terminal text-center">
                    <div className="p-2.5">
                      <div className="text-[7.5px] text-muted-foreground tracking-widest mb-0.5">POST-MONEY VAL</div>
                      <div className="text-sm font-bold text-foreground">${vcCalculations.postMoneyVal.toFixed(1)}M</div>
                    </div>
                    <div className="p-2.5">
                      <div className="text-[7.5px] text-muted-foreground tracking-widest mb-0.5">SERIES A PREF. POOL</div>
                      <div className="text-sm font-bold text-foreground">${(vcRoundSize * vcLiqPrefMultiplier).toFixed(1)}M</div>
                    </div>
                    <div className="p-2.5">
                      <div className="text-[7.5px] text-muted-foreground tracking-widest mb-0.5">SERIES A CAPITAL</div>
                      <div className="text-sm font-bold text-[hsl(38,95%,55%)]">${vcRoundSize.toFixed(1)}M</div>
                    </div>
                    <div className="p-2.5">
                      <div className="text-[7.5px] text-muted-foreground tracking-widest mb-0.5">PARTICIPATING</div>
                      <div className={`text-sm font-bold ${vcIsParticipating ? "text-[hsl(142,71%,55%)]" : "text-muted-foreground"}`}>{vcIsParticipating ? "ACTIVE" : "INACTIVE"}</div>
                    </div>
                  </div>

                  {/* Waterfall Chart */}
                  <Card className="bg-[#070707] border-border">
                    <CardHeader className="p-4 border-b border-border">
                      <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Liquidation Payout Waterfall</CardTitle>
                      <CardDescription className="text-[9px] text-muted-foreground">Payout distribution across classes at various exit valuations ($M)</CardDescription>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={vcCalculations.waterfallData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                            <XAxis dataKey="exitVal" stroke="#444" fontSize={9} />
                            <YAxis stroke="#444" fontSize={9} />
                            <Tooltip contentStyle={{ backgroundColor: "#080808", borderColor: "#222", color: "#fff" }} />
                            <Legend wrapperStyle={{ fontSize: 9 }} />
                            <Area type="monotone" dataKey="SeriesA" stackId="1" stroke="hsl(38,95%,50%)" fill="hsl(38,95%,50%)" fillOpacity={0.2} name="Series A preferred ($M)" />
                            <Area type="monotone" dataKey="Seed" stackId="1" stroke="hsl(210,100%,50%)" fill="hsl(210,100%,50%)" fillOpacity={0.2} name="Seed preferred ($M)" />
                            <Area type="monotone" dataKey="Common" stackId="1" stroke="hsl(142,71%,45%)" fill="hsl(142,71%,45%)" fillOpacity={0.1} name="Founders & Common ($M)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Payout sample schedule table */}
                  <Card className="bg-[#070707] border-border">
                    <CardHeader className="p-4 border-b border-border">
                      <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Liquidation Payout scenarios</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 font-terminal text-[10px]">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-b border-border">
                            <TableHead className="p-1">Exit Valuation</TableHead>
                            <TableHead className="p-1 text-right">Series A Payout</TableHead>
                            <TableHead className="p-1 text-right">Seed Payout</TableHead>
                            <TableHead className="p-1 text-right">Common Payout</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[1.0, 5.0, 15.0, 30.0, 60.0].map((multiplier, idx) => {
                            const exitVal = vcCalculations.postMoneyVal * multiplier;
                            const payouts = vcCalculations.calculatePayouts(exitVal);
                            return (
                              <TableRow key={idx} className="border-b border-border/30 hover:bg-white/5">
                                <TableCell className="p-1 font-bold">${payouts.exitVal.toFixed(1)}M ({multiplier}x round val)</TableCell>
                                <TableCell className="p-1 text-right text-[hsl(38,95%,55%)] font-bold">${payouts.SeriesA.toFixed(1)}M</TableCell>
                                <TableCell className="p-1 text-right text-blue-500 font-bold">${payouts.Seed.toFixed(1)}M</TableCell>
                                <TableCell className="p-1 text-right text-[hsl(142,71%,55%)] font-bold">${payouts.Common.toFixed(1)}M</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* TABS CONTENT 4: HOSTILE DEFENSE */}
            <TabsContent value="defense" className="space-y-4 m-0">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="bg-[#070707] border-border text-foreground">
                  <CardHeader className="p-4 border-b border-border">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-rose-500 flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4" />
                      Takeover Vulnerability & defense modeling
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-6">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Poison Pill Trigger Level:</span>
                        <span className="text-rose-400 font-bold font-terminal">{triggerPct}%</span>
                      </div>
                      <Slider 
                        min={10} max={25} step={1} 
                        value={[triggerPct]} 
                        onValueChange={(val) => setTriggerPct(val[0])} 
                      />
                      <span className="text-[9px] text-muted-foreground mt-1 block">Dilutes hostile bidder with discounted shares if holdings cross this threshold.</span>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Insider & Board Equity Holdings:</span>
                        <span className="text-emerald-400 font-bold font-terminal">{insiderControl}%</span>
                      </div>
                      <Slider 
                        min={5} max={40} step={1} 
                        value={[insiderControl]} 
                        onValueChange={(val) => setInsiderControl(val[0])} 
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Score and Defense status */}
                <Card className="bg-[#070707] border-border text-foreground">
                  <CardHeader className="p-4 border-b border-border">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Vulnerability Analysis Dashboard</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-4">
                    <div className="p-3 bg-[#0a0a0a] rounded border border-border flex items-center justify-between font-terminal">
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase">Target Hostile Vulnerability Index</span>
                        <h4 className="text-lg font-bold mt-1 text-orange-400">
                          {Math.max(10, 85 - triggerPct - insiderControl * 1.5)}/100
                        </h4>
                      </div>
                      <div className="text-right">
                        <span className="text-[8px] block text-muted-foreground">RECOMMENDED DEFENSE</span>
                        <span className="text-[10px] font-bold text-rose-400 bg-rose-950 px-2 py-0.5 border border-rose-800 rounded">
                          FLIP-IN POISON PILL
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs">
                      <h5 className="text-[10px] font-bold uppercase text-muted-foreground">Active Defensive Shields</h5>
                      <div className="flex justify-between border-b border-border/40 pb-1">
                        <span>Classified Staggered Board</span>
                        <span className="text-emerald-400 font-bold">ACTIVE</span>
                      </div>
                      <div className="flex justify-between border-b border-border/40 pb-1">
                        <span>Golden Parachute Severances</span>
                        <span className="text-emerald-400 font-bold">ACTIVE</span>
                      </div>
                      <div className="flex justify-between">
                        <span>White Knight Capital Commitments</span>
                        <span className="text-muted-foreground">STANDBY</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* TABS CONTENT 5: ANTITRUST */}
            <TabsContent value="antitrust" className="space-y-4 m-0">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-[#070707] border-border md:col-span-2">
                  <CardHeader className="p-4 border-b border-border">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)] flex items-center gap-2">
                      <Scale className="w-4 h-4 text-[hsl(38,95%,50%)]" />
                      Herfindahl-Hirschman Index (HHI) Concentration Checker
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="grid grid-cols-2 gap-4 mb-4 font-terminal text-center">
                      <div className="bg-[#0a0a0a] p-3 border border-border rounded">
                        <span className="text-[10px] text-muted-foreground block uppercase">HHI Pre-Merger</span>
                        <span className="text-lg font-bold text-slate-300">{hhiPre}</span>
                      </div>
                      <div className="bg-[#0a0a0a] p-3 border border-border rounded">
                        <span className="text-[10px] text-muted-foreground block uppercase">HHI Post-Merger</span>
                        <span className="text-lg font-bold text-amber-500">{hhiPost} <span className="text-[10px] text-rose-500 font-normal">(+{hhiChange})</span></span>
                      </div>
                    </div>

                    <div className={`p-3 border rounded text-xs text-center font-bold ${hhiRisk.color}`}>
                      {hhiRisk.label}
                    </div>

                    <div className="text-[9px] text-muted-foreground mt-4 space-y-1">
                      <p>• HHI under 1,500 is considered an unconcentrated marketplace.</p>
                      <p>• HHI between 1,500 and 2,500 represents moderate market concentration.</p>
                      <p>• HHI above 2,500 is highly concentrated. Transactions increasing HHI by &gt;200 trigger intense FTC/DOJ review.</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Market share table */}
                <Card className="bg-[#070707] border-border">
                  <CardHeader className="p-4 border-b border-border">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[hsl(38,95%)]">Market Shares (%)</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 font-terminal">
                    <Table>
                      <TableHeader className="bg-transparent">
                        <TableRow className="border-b border-border">
                          <TableHead className="p-1 text-[9px]">Competitor</TableHead>
                          <TableHead className="p-1 text-[9px] text-right">Share %</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {marketShares.map((item, idx) => (
                          <TableRow key={idx} className="border-b border-border/40">
                            <TableCell className="p-1 text-xs">{item.name}</TableCell>
                            <TableCell className="p-1 text-xs text-right font-bold">{item.share}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
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
export default memo(MnaDealDeskPanel);
