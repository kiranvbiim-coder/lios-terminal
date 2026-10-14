import { type ReactNode, useMemo, useState } from "react";
import { AlertTriangle, Calculator, Plus, ShieldCheck, Trash2, WalletCards } from "lucide-react";
import {
  type P6Debt,
  type P6Goal,
  type P6PersonalAccount,
  type P6PersonalFinanceRequest,
} from "@shared/p6FinanceContracts";

type AccountDraft = {
  key: string;
  id: string;
  kind: P6PersonalAccount["kind"];
  balance: string;
  currency: string;
};

type DebtDraft = {
  key: string;
  id: string;
  principal: string;
  annualRatePct: string;
  monthlyPayment: string;
  currency: string;
};

type GoalDraft = {
  key: string;
  id: string;
  targetAmount: string;
  currentAmount: string;
  monthlyContribution: string;
  annualReturnPct: string;
  targetDate: string;
  currency: string;
};

type Snapshot = {
  engineId: string;
  deterministic: true;
  asOf: string;
  netWorth: number;
  assets: number;
  liabilities: number;
  trailingMonthlyIncome: number;
  trailingMonthlyExpenses: number;
  trailingMonthlyCashFlow: number;
  savingsRate: number | null;
  debt: Array<{ id: string; payoffMonths: number | null; totalInterest: number | null; status: string }>;
  goals: Array<{ id: string; targetAmount: number; projectedAmount: number; fundingGap: number; targetDate: string; onTrack: boolean }>;
  retirement: null | {
    years: number;
    projectedNominalPortfolio: number;
    projectedRealPortfolio: number;
    targetPortfolioAtRetirement: number;
    fundingGap: number;
    fundedRatio: number | null;
  };
  inputHash: string;
  warnings: string[];
};

const INPUT = "h-9 w-full rounded-md border border-border/60 bg-black/25 px-2.5 font-ui text-[10px] text-foreground outline-none focus:border-amber-300/40";
const LABEL = "mb-1 block font-terminal text-[7px] uppercase tracking-[0.14em] text-muted-foreground";

function key(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function numberValue(value: string, label: string, { min }: { min?: number } = {}): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid number.`);
  if (min !== undefined && parsed < min) throw new Error(`${label} must be at least ${min}.`);
  return parsed;
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)}`;
  }
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-[#080808]/90 p-4">
      <div className="font-ui text-[12px] font-semibold text-foreground">{title}</div>
      <div className="mt-1 font-ui text-[9px] leading-4 text-muted-foreground">{description}</div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function PersonalFinancePanel() {
  const [asOf, setAsOf] = useState(today);
  const [accounts, setAccounts] = useState<AccountDraft[]>([
    { key: key("account"), id: "primary-bank", kind: "bank", balance: "0", currency: "INR" },
  ]);
  const [monthlyIncome, setMonthlyIncome] = useState("0");
  const [monthlyExpenses, setMonthlyExpenses] = useState("0");
  const [debts, setDebts] = useState<DebtDraft[]>([]);
  const [goals, setGoals] = useState<GoalDraft[]>([]);
  const [retirementEnabled, setRetirementEnabled] = useState(false);
  const [retirement, setRetirement] = useState({
    currentAge: "35",
    retirementAge: "60",
    currentPortfolio: "0",
    monthlyContribution: "0",
    annualReturnPct: "8",
    annualInflationPct: "5",
    annualRetirementSpendingToday: "0",
    withdrawalRatePct: "4",
  });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const primaryCurrency = useMemo(() => accounts[0]?.currency.trim().toUpperCase() || "INR", [accounts]);

  const buildRequest = (): P6PersonalFinanceRequest => {
    const normalizedAccounts: P6PersonalAccount[] = accounts.map((item, index) => ({
      id: item.id.trim() || `account-${index + 1}`,
      kind: item.kind,
      balance: numberValue(item.balance, `Account ${index + 1} balance`),
      currency: item.currency.trim().toUpperCase() || "INR",
    }));
    const cashAccountId = normalizedAccounts[0]?.id ?? "manual-cash";
    if (!normalizedAccounts.length) normalizedAccounts.push({ id: cashAccountId, kind: "cash", balance: 0, currency: primaryCurrency });

    const income = numberValue(monthlyIncome, "Monthly income", { min: 0 });
    const expenses = numberValue(monthlyExpenses, "Monthly expenses", { min: 0 });
    const transactions = [
      ...(income > 0 ? [{ id: "manual-monthly-income", at: asOf, amount: income, category: "manual_monthly_income", accountId: cashAccountId }] : []),
      ...(expenses > 0 ? [{ id: "manual-monthly-expenses", at: asOf, amount: -expenses, category: "manual_monthly_expenses", accountId: cashAccountId }] : []),
    ];

    const normalizedDebts: P6Debt[] = debts.map((item, index) => ({
      id: item.id.trim() || `debt-${index + 1}`,
      principal: numberValue(item.principal, `Debt ${index + 1} principal`, { min: 0 }),
      annualRate: numberValue(item.annualRatePct, `Debt ${index + 1} annual rate`, { min: 0 }) / 100,
      monthlyPayment: numberValue(item.monthlyPayment, `Debt ${index + 1} monthly payment`, { min: 0.01 }),
      currency: item.currency.trim().toUpperCase() || primaryCurrency,
    }));

    const normalizedGoals: P6Goal[] = goals.map((item, index) => ({
      id: item.id.trim() || `goal-${index + 1}`,
      targetAmount: numberValue(item.targetAmount, `Goal ${index + 1} target`, { min: 0.01 }),
      currentAmount: numberValue(item.currentAmount, `Goal ${index + 1} current amount`, { min: 0 }),
      monthlyContribution: numberValue(item.monthlyContribution, `Goal ${index + 1} contribution`, { min: 0 }),
      annualReturnAssumption: numberValue(item.annualReturnPct, `Goal ${index + 1} return assumption`) / 100,
      targetDate: item.targetDate,
      currency: item.currency.trim().toUpperCase() || primaryCurrency,
    }));

    return {
      schemaVersion: "1",
      asOf,
      accounts: normalizedAccounts,
      transactions,
      debts: normalizedDebts,
      goals: normalizedGoals,
      retirement: retirementEnabled ? {
        currentAge: numberValue(retirement.currentAge, "Current age", { min: 0 }),
        retirementAge: numberValue(retirement.retirementAge, "Retirement age", { min: 0 }),
        currentPortfolio: numberValue(retirement.currentPortfolio, "Current retirement portfolio", { min: 0 }),
        monthlyContribution: numberValue(retirement.monthlyContribution, "Monthly retirement contribution", { min: 0 }),
        annualReturnAssumption: numberValue(retirement.annualReturnPct, "Retirement return assumption") / 100,
        annualInflationAssumption: numberValue(retirement.annualInflationPct, "Inflation assumption") / 100,
        annualRetirementSpendingToday: numberValue(retirement.annualRetirementSpendingToday, "Annual retirement spending", { min: 0 }),
        withdrawalRate: numberValue(retirement.withdrawalRatePct, "Withdrawal rate", { min: 0.01 }) / 100,
      } : null,
    };
  };

  const calculate = async () => {
    setError("");
    setBusy(true);
    try {
      const request = buildRequest();
      const response = await fetch("/api/finance/p6-personal-finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Personal-finance calculation failed.");
      setSnapshot(body as Snapshot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Personal-finance calculation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#050505] p-4 text-foreground md:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-5">
          <div>
            <div className="flex items-center gap-2 font-terminal text-[8px] uppercase tracking-[0.16em] text-amber-300">
              <WalletCards className="h-4 w-4" /> Personal Finance
            </div>
            <h1 className="mt-2 font-ui text-xl font-semibold">Your financial position, calculated deterministically.</h1>
            <p className="mt-2 max-w-3xl font-ui text-[10px] leading-5 text-muted-foreground">
              Enter only data you own. LiOS calculates net worth, monthly cash flow, debt payoff, goals and retirement locally through the P6 deterministic engine. This panel never calls an AI provider.
            </p>
          </div>
          <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.03] px-3 py-2">
            <div className="flex items-center gap-2 font-ui text-[9px] text-emerald-200"><ShieldCheck className="h-3.5 w-3.5" /> Local deterministic boundary</div>
            <div className="mt-1 max-w-72 font-ui text-[9px] leading-4 text-muted-foreground">This Workbench surface does not send your Personal Finance inputs to chat or an AI provider. Use the Project Personal Finance surface when you want to save a profile and explicitly stage it for one governed conversation request.</div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <Section title="Net worth" description="Assets and liabilities. Multiple currencies remain separate and trigger a warning; LiOS does not invent FX conversion.">
            <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_160px]">
              <label><span className={LABEL}>As of</span><input type="date" value={asOf} onChange={(event)=>setAsOf(event.target.value)} className={INPUT}/></label>
              <div className="flex items-end"><button onClick={()=>setAccounts((current)=>[...current,{key:key("account"),id:`account-${current.length+1}`,kind:"bank",balance:"0",currency:primaryCurrency}])} className="flex h-9 items-center gap-1.5 rounded-md border border-border/60 px-3 font-ui text-[9px] text-muted-foreground hover:text-foreground"><Plus className="h-3 w-3"/> Add account</button></div>
            </div>
            <div className="space-y-2">
              {accounts.map((account,index)=>(
                <div key={account.key} className="grid gap-2 rounded-lg border border-border/45 p-2 sm:grid-cols-[1.2fr_1fr_1fr_90px_32px]">
                  <input aria-label={`Account ${index+1} name`} value={account.id} onChange={(event)=>setAccounts((current)=>current.map((item)=>item.key===account.key?{...item,id:event.target.value}:item))} className={INPUT} placeholder="Account name"/>
                  <select aria-label={`Account ${index+1} type`} value={account.kind} onChange={(event)=>setAccounts((current)=>current.map((item)=>item.key===account.key?{...item,kind:event.target.value as AccountDraft["kind"]}:item))} className={INPUT}>
                    <option value="cash">Cash</option><option value="bank">Bank</option><option value="investment">Investment</option><option value="retirement">Retirement</option><option value="property">Property</option><option value="other_asset">Other asset</option><option value="credit_card">Credit card</option><option value="loan">Loan</option><option value="other_liability">Other liability</option>
                  </select>
                  <input aria-label={`Account ${index+1} balance`} inputMode="decimal" value={account.balance} onChange={(event)=>setAccounts((current)=>current.map((item)=>item.key===account.key?{...item,balance:event.target.value}:item))} className={INPUT} placeholder="Balance"/>
                  <input aria-label={`Account ${index+1} currency`} value={account.currency} onChange={(event)=>setAccounts((current)=>current.map((item)=>item.key===account.key?{...item,currency:event.target.value}:item))} className={INPUT} placeholder="INR"/>
                  <button aria-label={`Remove account ${index+1}`} onClick={()=>setAccounts((current)=>current.filter((item)=>item.key!==account.key))} className="flex h-9 items-center justify-center rounded-md text-muted-foreground hover:bg-red-400/[0.06] hover:text-red-300"><Trash2 className="h-3.5 w-3.5"/></button>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Monthly cash flow" description="Manual trailing-month aggregates. These values are treated as explicit user inputs, not inferred transactions.">
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className={LABEL}>Monthly income</span><input inputMode="decimal" value={monthlyIncome} onChange={(event)=>setMonthlyIncome(event.target.value)} className={INPUT}/></label>
              <label><span className={LABEL}>Monthly expenses</span><input inputMode="decimal" value={monthlyExpenses} onChange={(event)=>setMonthlyExpenses(event.target.value)} className={INPUT}/></label>
            </div>
          </Section>

          <Section title="Debt payoff" description="Project payoff time and interest from your principal, rate and monthly payment.">
            <button onClick={()=>setDebts((current)=>[...current,{key:key("debt"),id:`debt-${current.length+1}`,principal:"0",annualRatePct:"0",monthlyPayment:"1",currency:primaryCurrency}])} className="mb-3 flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-2 font-ui text-[9px] text-muted-foreground hover:text-foreground"><Plus className="h-3 w-3"/> Add debt</button>
            <div className="space-y-2">
              {debts.map((debt,index)=>(
                <div key={debt.key} className="grid gap-2 rounded-lg border border-border/45 p-2 sm:grid-cols-2 lg:grid-cols-5">
                  <input aria-label={`Debt ${index+1} name`} value={debt.id} onChange={(event)=>setDebts((current)=>current.map((item)=>item.key===debt.key?{...item,id:event.target.value}:item))} className={INPUT} placeholder="Debt name"/>
                  <input aria-label={`Debt ${index+1} principal`} inputMode="decimal" value={debt.principal} onChange={(event)=>setDebts((current)=>current.map((item)=>item.key===debt.key?{...item,principal:event.target.value}:item))} className={INPUT} placeholder="Principal"/>
                  <input aria-label={`Debt ${index+1} annual rate percent`} inputMode="decimal" value={debt.annualRatePct} onChange={(event)=>setDebts((current)=>current.map((item)=>item.key===debt.key?{...item,annualRatePct:event.target.value}:item))} className={INPUT} placeholder="Rate %"/>
                  <input aria-label={`Debt ${index+1} monthly payment`} inputMode="decimal" value={debt.monthlyPayment} onChange={(event)=>setDebts((current)=>current.map((item)=>item.key===debt.key?{...item,monthlyPayment:event.target.value}:item))} className={INPUT} placeholder="Monthly payment"/>
                  <div className="flex gap-1"><input aria-label={`Debt ${index+1} currency`} value={debt.currency} onChange={(event)=>setDebts((current)=>current.map((item)=>item.key===debt.key?{...item,currency:event.target.value}:item))} className={INPUT}/><button aria-label={`Remove debt ${index+1}`} onClick={()=>setDebts((current)=>current.filter((item)=>item.key!==debt.key))} className="w-9 shrink-0 text-muted-foreground hover:text-red-300"><Trash2 className="mx-auto h-3.5 w-3.5"/></button></div>
                </div>
              ))}
              {!debts.length && <div className="font-ui text-[9px] text-muted-foreground">No debts added.</div>}
            </div>
          </Section>

          <Section title="Goals" description="Project whether current savings and monthly contributions reach each target by its date.">
            <button onClick={()=>setGoals((current)=>[...current,{key:key("goal"),id:`goal-${current.length+1}`,targetAmount:"0",currentAmount:"0",monthlyContribution:"0",annualReturnPct:"0",targetDate:asOf,currency:primaryCurrency}])} className="mb-3 flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-2 font-ui text-[9px] text-muted-foreground hover:text-foreground"><Plus className="h-3 w-3"/> Add goal</button>
            <div className="space-y-2">
              {goals.map((goal,index)=>(
                <div key={goal.key} className="grid gap-2 rounded-lg border border-border/45 p-2 sm:grid-cols-2 lg:grid-cols-3">
                  <input aria-label={`Goal ${index+1} name`} value={goal.id} onChange={(event)=>setGoals((current)=>current.map((item)=>item.key===goal.key?{...item,id:event.target.value}:item))} className={INPUT} placeholder="Goal name"/>
                  <input aria-label={`Goal ${index+1} target amount`} inputMode="decimal" value={goal.targetAmount} onChange={(event)=>setGoals((current)=>current.map((item)=>item.key===goal.key?{...item,targetAmount:event.target.value}:item))} className={INPUT} placeholder="Target amount"/>
                  <input aria-label={`Goal ${index+1} current amount`} inputMode="decimal" value={goal.currentAmount} onChange={(event)=>setGoals((current)=>current.map((item)=>item.key===goal.key?{...item,currentAmount:event.target.value}:item))} className={INPUT} placeholder="Current amount"/>
                  <input aria-label={`Goal ${index+1} monthly contribution`} inputMode="decimal" value={goal.monthlyContribution} onChange={(event)=>setGoals((current)=>current.map((item)=>item.key===goal.key?{...item,monthlyContribution:event.target.value}:item))} className={INPUT} placeholder="Monthly contribution"/>
                  <input aria-label={`Goal ${index+1} annual return percent`} inputMode="decimal" value={goal.annualReturnPct} onChange={(event)=>setGoals((current)=>current.map((item)=>item.key===goal.key?{...item,annualReturnPct:event.target.value}:item))} className={INPUT} placeholder="Return %"/>
                  <div className="flex gap-1"><input aria-label={`Goal ${index+1} target date`} type="date" value={goal.targetDate} onChange={(event)=>setGoals((current)=>current.map((item)=>item.key===goal.key?{...item,targetDate:event.target.value}:item))} className={INPUT}/><button aria-label={`Remove goal ${index+1}`} onClick={()=>setGoals((current)=>current.filter((item)=>item.key!==goal.key))} className="w-9 shrink-0 text-muted-foreground hover:text-red-300"><Trash2 className="mx-auto h-3.5 w-3.5"/></button></div>
                </div>
              ))}
              {!goals.length && <div className="font-ui text-[9px] text-muted-foreground">No goals added.</div>}
            </div>
          </Section>

          <Section title="Retirement" description="Optional long-horizon projection. Every return, inflation, spending and withdrawal assumption remains explicit.">
            <label className="mb-4 flex items-center gap-2 font-ui text-[10px] text-foreground"><input type="checkbox" checked={retirementEnabled} onChange={(event)=>setRetirementEnabled(event.target.checked)}/> Include retirement projection</label>
            {retirementEnabled && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["currentAge","Current age"],["retirementAge","Retirement age"],["currentPortfolio","Current portfolio"],["monthlyContribution","Monthly contribution"],
                ["annualReturnPct","Annual return %"],["annualInflationPct","Inflation %"],["annualRetirementSpendingToday","Annual spending today"],["withdrawalRatePct","Withdrawal rate %"],
              ].map(([field,label])=><label key={field}><span className={LABEL}>{label}</span><input inputMode="decimal" value={retirement[field as keyof typeof retirement]} onChange={(event)=>setRetirement((current)=>({...current,[field]:event.target.value}))} className={INPUT}/></label>)}
            </div>}
          </Section>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.025] p-4">
          <button onClick={()=>void calculate()} disabled={busy || !asOf} className="flex h-10 items-center gap-2 rounded-lg bg-amber-400 px-4 font-ui text-[10px] font-semibold text-black disabled:opacity-40">
            <Calculator className="h-4 w-4"/>{busy ? "Calculating…" : "Calculate snapshot"}
          </button>
          <span className="font-ui text-[9px] text-muted-foreground">Deterministic engine · no AI · no brokerage action</span>
          {error && <span role="alert" className="flex basis-full items-start gap-2 font-ui text-[9px] text-red-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0"/>{error}</span>}
        </div>

        {snapshot && <div className="mt-5 rounded-xl border border-border/65 bg-[#070707] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><div className="font-terminal text-[8px] uppercase tracking-[0.14em] text-emerald-300">Deterministic snapshot</div><div className="mt-1 font-ui text-[9px] text-muted-foreground">As of {snapshot.asOf} · {snapshot.engineId}</div></div>
            <div className="font-terminal text-[7px] text-muted-foreground">INPUT {snapshot.inputHash.slice(0,12)}…</div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Net worth",money(snapshot.netWorth,primaryCurrency)],
              ["Assets",money(snapshot.assets,primaryCurrency)],
              ["Liabilities",money(snapshot.liabilities,primaryCurrency)],
              ["Monthly cash flow",money(snapshot.trailingMonthlyCashFlow,primaryCurrency)],
              ["Monthly income",money(snapshot.trailingMonthlyIncome,primaryCurrency)],
              ["Monthly expenses",money(snapshot.trailingMonthlyExpenses,primaryCurrency)],
              ["Savings rate",snapshot.savingsRate===null?"N/A":`${(snapshot.savingsRate*100).toFixed(1)}%`],
              ["Warnings",String(snapshot.warnings.length)],
            ].map(([label,value])=><div key={label} className="rounded-lg border border-border/45 bg-black/20 p-3"><div className="font-terminal text-[7px] uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 font-ui text-[13px] font-semibold text-foreground">{value}</div></div>)}
          </div>
          {(snapshot.debt.length>0||snapshot.goals.length>0||snapshot.retirement)&&<div className="mt-4 grid gap-3 lg:grid-cols-3">
            <div className="rounded-lg border border-border/45 p-3"><div className="font-ui text-[10px] font-semibold">Debt</div><div className="mt-2 space-y-2">{snapshot.debt.map((item)=><div key={item.id} className="font-ui text-[9px] text-muted-foreground"><span className="text-foreground">{item.id}</span> · {item.status==="payoff_projected"?`${item.payoffMonths} months`:item.status.replaceAll("_"," ")}</div>)}{!snapshot.debt.length&&<span className="font-ui text-[9px] text-muted-foreground">No debt projections.</span>}</div></div>
            <div className="rounded-lg border border-border/45 p-3"><div className="font-ui text-[10px] font-semibold">Goals</div><div className="mt-2 space-y-2">{snapshot.goals.map((item)=><div key={item.id} className="font-ui text-[9px] text-muted-foreground"><span className="text-foreground">{item.id}</span> · {item.onTrack?"on track":`gap ${money(item.fundingGap,primaryCurrency)}`}</div>)}{!snapshot.goals.length&&<span className="font-ui text-[9px] text-muted-foreground">No goal projections.</span>}</div></div>
            <div className="rounded-lg border border-border/45 p-3"><div className="font-ui text-[10px] font-semibold">Retirement</div>{snapshot.retirement?<div className="mt-2 space-y-1 font-ui text-[9px] text-muted-foreground"><div>{snapshot.retirement.years} years to retirement</div><div>Projected: <span className="text-foreground">{money(snapshot.retirement.projectedNominalPortfolio,primaryCurrency)}</span></div><div>Target: <span className="text-foreground">{money(snapshot.retirement.targetPortfolioAtRetirement,primaryCurrency)}</span></div><div>Funding gap: <span className={snapshot.retirement.fundingGap>0?"text-amber-200":"text-emerald-300"}>{money(snapshot.retirement.fundingGap,primaryCurrency)}</span></div></div>:<div className="mt-2 font-ui text-[9px] text-muted-foreground">Not included.</div>}</div>
          </div>}
          {snapshot.warnings.length>0&&<div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.03] p-3">{snapshot.warnings.map((warning)=><div key={warning} className="font-ui text-[9px] leading-4 text-amber-100/90">{warning}</div>)}</div>}
        </div>}
      </div>
    </div>
  );
}
