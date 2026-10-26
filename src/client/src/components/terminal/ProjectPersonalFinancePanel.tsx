import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  p6PersonalFinanceRequestSchema,
  type P6Debt,
  type P6Goal,
  type P6PersonalAccount,
  type P6PersonalFinanceRequest,
  type P6PersonalTransaction,
  type P6RetirementProjectionInput,
} from "@shared/p6FinanceContracts";

interface PersonalFinanceProfileResponse {
  resourceId: string | null;
  profile: P6PersonalFinanceRequest | null;
}

interface PersonalFinanceSnapshot {
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
  debt: Array<{ id: string; payoffMonths: number | null; status: string }>;
  goals: Array<{ id: string; fundingGap: number; onTrack: boolean }>;
  retirement: null | { fundingGap: number; fundedRatio: number | null; projectedNominalPortfolio: number; targetPortfolioAtRetirement: number };
  warnings: string[];
}

const ACCOUNT_KINDS: P6PersonalAccount["kind"][] = [
  "cash", "bank", "investment", "retirement", "property", "other_asset",
  "credit_card", "loan", "other_liability",
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function blankProfile(): P6PersonalFinanceRequest {
  return {
    schemaVersion: "1",
    asOf: today(),
    accounts: [],
    transactions: [],
    debts: [],
    goals: [],
    retirement: null,
  };
}

function numeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 10_000) / 100) : "0";
}

function money(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  min,
  step,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: "text" | "number" | "date";
  min?: number;
  step?: number;
}) {
  return (
    <label className="min-w-0 font-ui text-xs text-muted-foreground">
      <span className="mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        min={min}
        step={step}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 w-full rounded-md border border-border/60 bg-black/25 px-2.5 py-2 font-ui text-sm text-foreground outline-none focus:border-amber-300/45"
      />
    </label>
  );
}

function Section({
  title,
  detail,
  onAdd,
  children,
}: {
  title: string;
  detail: string;
  onAdd?: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-xl border border-border/55 bg-black/15 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-ui text-sm font-semibold text-foreground">{title}</div>
          <div className="mt-1 font-ui text-xs leading-5 text-muted-foreground">{detail}</div>
        </div>
        {onAdd && (
          <button type="button" aria-label={`Add ${title.toLowerCase()}`} onClick={onAdd} className="min-h-10 rounded-md border border-border/60 px-2.5 py-1.5 font-ui text-sm text-foreground hover:border-amber-300/30">
            + Add
          </button>
        )}
      </div>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

export function ProjectPersonalFinancePanel({
  projectId,
  onAnalyze,
  stageOnly = false,
  initialProfile,
}: {
  projectId: number | null;
  onAnalyze: (profile: P6PersonalFinanceRequest) => void;
  stageOnly?: boolean;
  initialProfile?: P6PersonalFinanceRequest | null;
}) {
  const queryClient = useQueryClient();
  const profileQuery = useQuery<PersonalFinanceProfileResponse>({
    queryKey: ["/api/projects", projectId, "personal-finance-profile"],
    enabled: projectId !== null && !stageOnly,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/personal-finance-profile`);
      if (!res.ok) throw new Error("Unable to load Personal Finance profile.");
      return res.json();
    },
  });
  const [profile, setProfile] = useState<P6PersonalFinanceRequest>(() => initialProfile ?? blankProfile());
  const [snapshot, setSnapshot] = useState<PersonalFinanceSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (stageOnly) return;
    if (profileQuery.data?.profile) setProfile(profileQuery.data.profile);
    else if (profileQuery.data && !profileQuery.data.profile) setProfile(blankProfile());
  }, [profileQuery.data, stageOnly]);

  const baseCurrency = useMemo(() => profile.accounts[0]?.currency ?? profile.debts[0]?.currency ?? profile.goals[0]?.currency ?? "INR", [profile]);

  const save = async (next = profile): Promise<P6PersonalFinanceRequest> => {
    if (projectId === null || stageOnly) throw new Error("This input editor does not save a Project profile.");
    const parsed = p6PersonalFinanceRequestSchema.parse(next);
    const res = await apiRequest("PUT", `/api/projects/${projectId}/personal-finance-profile`, parsed);
    const body = await res.json() as PersonalFinanceProfileResponse;
    await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
    await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "home"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "resources"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "personal-finance-profile"] });
    setProfile(body.profile ?? parsed);
    return body.profile ?? parsed;
  };

  const runPreview = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const validated = await save();
      const res = await apiRequest("POST", "/api/finance/p6-personal-finance", validated);
      const result = await res.json() as PersonalFinanceSnapshot;
      setSnapshot(result);
      setNotice("Saved to this Project and calculated with the deterministic Personal Finance engine.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to calculate Personal Finance snapshot.");
    } finally {
      setBusy(false);
    }
  };

  const analyze = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const validated = stageOnly ? p6PersonalFinanceRequestSchema.parse(profile) : await save();
      onAnalyze(validated);
      setNotice(stageOnly ? "Inputs staged for this Chat. Choose Send to calculate." : "Profile staged for one governed Personal Finance conversation request.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to stage Personal Finance analysis.");
    } finally {
      setBusy(false);
    }
  };

  const updateAccount = (index: number, patch: Partial<P6PersonalAccount>) => {
    setProfile((current) => ({ ...current, accounts: current.accounts.map((row, i) => i === index ? { ...row, ...patch } : row) }));
  };
  const updateTransaction = (index: number, patch: Partial<P6PersonalTransaction>) => {
    setProfile((current) => ({ ...current, transactions: current.transactions.map((row, i) => i === index ? { ...row, ...patch } : row) }));
  };
  const updateDebt = (index: number, patch: Partial<P6Debt>) => {
    setProfile((current) => ({ ...current, debts: current.debts.map((row, i) => i === index ? { ...row, ...patch } : row) }));
  };
  const updateGoal = (index: number, patch: Partial<P6Goal>) => {
    setProfile((current) => ({ ...current, goals: current.goals.map((row, i) => i === index ? { ...row, ...patch } : row) }));
  };

  return (
    <details open={stageOnly ? true : undefined} className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.025] p-4" data-personal-finance-project-surface="true">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-ui text-[12px] font-semibold text-foreground">Personal Finance & Wealth</div>
            <div className="mt-1 max-w-2xl font-ui text-[10px] leading-4 text-muted-foreground">
              {stageOnly ? "Enter only values you know. Inputs stay in this Chat draft until you choose Send; no Project profile is saved and no model is called by this form." : "User-owned accounts, transactions, debt, goals and retirement assumptions. Saved locally with this Project as an excluded resource; never added to ordinary AI context automatically."}
            </div>
          </div>
          <span className="rounded-full border border-emerald-300/20 px-2.5 py-1 font-terminal text-[10px] text-emerald-200">DETERMINISTIC</span>
        </div>
      </summary>

      <div className="mt-4 space-y-3">
        {profileQuery.isLoading && <div className="font-ui text-[10px] text-muted-foreground">Loading Project profile…</div>}
        {profileQuery.isError && <div role="alert" className="font-ui text-[10px] text-red-300">Unable to load the saved Personal Finance profile.</div>}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="As-of date" type="date" value={profile.asOf} onChange={(value) => setProfile((current) => ({ ...current, asOf: value }))} />
          <div className="rounded-md border border-border/50 bg-black/15 px-3 py-2">
            <div className="font-ui text-[10px] text-muted-foreground">Working currency</div>
            <div className="mt-1 font-ui text-[12px] font-semibold text-foreground">{baseCurrency}</div>
            <div className="mt-1 font-ui text-[9px] text-muted-foreground">Multiple currencies are allowed but are not FX-normalized by this engine.</div>
          </div>
        </div>

        <Section title="Accounts & balance sheet" detail="Enter current balances exactly as supplied by you or an imported source. Liability balances may be positive or negative; LiOS treats liability kinds as liabilities." onAdd={() => setProfile((current) => ({
          ...current,
          accounts: [...current.accounts, { id: `account-${current.accounts.length + 1}`, kind: "bank", balance: 0, currency: baseCurrency }],
        }))}>
          {profile.accounts.map((account, index) => (
            <div key={`${account.id}-${index}`} className="grid gap-2 rounded-lg border border-border/45 p-2 md:grid-cols-[1.2fr_1fr_1fr_.7fr_auto]">
              <Field label="Account ID / label" value={account.id} onChange={(value) => updateAccount(index, { id: value })} />
              <label className="font-ui text-[10px] text-muted-foreground"><span className="mb-1 block">Kind</span><select value={account.kind} onChange={(event) => updateAccount(index, { kind: event.target.value as P6PersonalAccount["kind"] })} className="w-full rounded-md border border-border/60 bg-[#090909] px-2.5 py-2 font-ui text-[11px] text-foreground">{ACCOUNT_KINDS.map((kind) => <option key={kind} value={kind}>{kind.replaceAll("_", " ")}</option>)}</select></label>
              <Field label="Balance" type="number" step={0.01} value={account.balance} onChange={(value) => updateAccount(index, { balance: numeric(value) })} />
              <Field label="Currency" value={account.currency} onChange={(value) => updateAccount(index, { currency: value.toUpperCase() })} />
              <button type="button" aria-label={`Remove account ${account.id}`} onClick={() => setProfile((current) => ({ ...current, accounts: current.accounts.filter((_, i) => i !== index) }))} className="self-end rounded-md px-2 py-2 font-ui text-[10px] text-red-300">Remove</button>
            </div>
          ))}
          {!profile.accounts.length && <div className="font-ui text-[10px] text-muted-foreground">No accounts added. Net worth will remain zero until balances are supplied.</div>}
        </Section>

        <Section title="Recent transactions" detail="Cash flow uses only transactions in the trailing month ending on the as-of date. Positive amounts are income; negative amounts are expenses." onAdd={() => setProfile((current) => ({
          ...current,
          transactions: [...current.transactions, { id: `transaction-${current.transactions.length + 1}`, at: current.asOf, amount: 0, category: "uncategorized", accountId: current.accounts[0]?.id ?? "account" }],
        }))}>
          {profile.transactions.map((transaction, index) => (
            <div key={`${transaction.id}-${index}`} className="grid gap-2 rounded-lg border border-border/45 p-2 md:grid-cols-[1fr_.8fr_.8fr_1fr_1fr_auto]">
              <Field label="Transaction ID" value={transaction.id} onChange={(value) => updateTransaction(index, { id: value })} />
              <Field label="Date" type="date" value={transaction.at} onChange={(value) => updateTransaction(index, { at: value })} />
              <Field label="Amount" type="number" step={0.01} value={transaction.amount} onChange={(value) => updateTransaction(index, { amount: numeric(value) })} />
              <Field label="Category" value={transaction.category} onChange={(value) => updateTransaction(index, { category: value })} />
              <Field label="Account ID" value={transaction.accountId} onChange={(value) => updateTransaction(index, { accountId: value })} />
              <button type="button" aria-label={`Remove transaction ${transaction.id}`} onClick={() => setProfile((current) => ({ ...current, transactions: current.transactions.filter((_, i) => i !== index) }))} className="self-end rounded-md px-2 py-2 font-ui text-[10px] text-red-300">Remove</button>
            </div>
          ))}
          {!profile.transactions.length && <div className="font-ui text-[10px] text-muted-foreground">No transaction observations supplied. LiOS will not invent income or expenses.</div>}
        </Section>

        <Section title="Debt payoff" detail="Projection uses principal, stated annual rate and your explicit monthly payment." onAdd={() => setProfile((current) => ({
          ...current,
          debts: [...current.debts, { id: `debt-${current.debts.length + 1}`, principal: 0, annualRate: 0, monthlyPayment: 1, currency: baseCurrency }],
        }))}>
          {profile.debts.map((debt, index) => (
            <div key={`${debt.id}-${index}`} className="grid gap-2 rounded-lg border border-border/45 p-2 md:grid-cols-[1fr_1fr_.9fr_1fr_.7fr_auto]">
              <Field label="Debt ID / label" value={debt.id} onChange={(value) => updateDebt(index, { id: value })} />
              <Field label="Principal" type="number" min={0} step={0.01} value={debt.principal} onChange={(value) => updateDebt(index, { principal: Math.max(0, numeric(value)) })} />
              <Field label="Annual rate %" type="number" min={0} step={0.01} value={percent(debt.annualRate)} onChange={(value) => updateDebt(index, { annualRate: numeric(value) / 100 })} />
              <Field label="Monthly payment" type="number" min={0.01} step={0.01} value={debt.monthlyPayment} onChange={(value) => updateDebt(index, { monthlyPayment: Math.max(0.01, numeric(value)) })} />
              <Field label="Currency" value={debt.currency} onChange={(value) => updateDebt(index, { currency: value.toUpperCase() })} />
              <button type="button" aria-label={`Remove debt ${debt.id}`} onClick={() => setProfile((current) => ({ ...current, debts: current.debts.filter((_, i) => i !== index) }))} className="self-end rounded-md px-2 py-2 font-ui text-[10px] text-red-300">Remove</button>
            </div>
          ))}
        </Section>

        <Section title="Goals" detail="Goal projection uses only your current amount, monthly contribution, return assumption and target date." onAdd={() => setProfile((current) => ({
          ...current,
          goals: [...current.goals, { id: `goal-${current.goals.length + 1}`, targetAmount: 1, currentAmount: 0, monthlyContribution: 0, annualReturnAssumption: 0, targetDate: current.asOf, currency: baseCurrency }],
        }))}>
          {profile.goals.map((goal, index) => (
            <div key={`${goal.id}-${index}`} className="grid gap-2 rounded-lg border border-border/45 p-2 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_.8fr_.7fr_auto]">
              <Field label="Goal ID / label" value={goal.id} onChange={(value) => updateGoal(index, { id: value })} />
              <Field label="Target amount" type="number" min={0.01} step={0.01} value={goal.targetAmount} onChange={(value) => updateGoal(index, { targetAmount: Math.max(0.01, numeric(value)) })} />
              <Field label="Current amount" type="number" min={0} step={0.01} value={goal.currentAmount} onChange={(value) => updateGoal(index, { currentAmount: Math.max(0, numeric(value)) })} />
              <Field label="Monthly contribution" type="number" min={0} step={0.01} value={goal.monthlyContribution} onChange={(value) => updateGoal(index, { monthlyContribution: Math.max(0, numeric(value)) })} />
              <Field label="Return %" type="number" step={0.01} value={percent(goal.annualReturnAssumption)} onChange={(value) => updateGoal(index, { annualReturnAssumption: numeric(value) / 100 })} />
              <Field label="Target date" type="date" value={goal.targetDate} onChange={(value) => updateGoal(index, { targetDate: value })} />
              <button type="button" aria-label={`Remove goal ${goal.id}`} onClick={() => setProfile((current) => ({ ...current, goals: current.goals.filter((_, i) => i !== index) }))} className="self-end rounded-md px-2 py-2 font-ui text-[10px] text-red-300">Remove</button>
            </div>
          ))}
        </Section>

        <Section title="Retirement" detail="Optional deterministic projection. Every return, inflation, spending and withdrawal assumption remains visible and editable.">
          <label className="flex items-center gap-2 font-ui text-[10px] text-foreground">
            <input type="checkbox" checked={Boolean(profile.retirement)} onChange={(event) => setProfile((current) => ({
              ...current,
              retirement: event.target.checked ? {
                currentAge: 35,
                retirementAge: 60,
                currentPortfolio: 0,
                monthlyContribution: 0,
                annualReturnAssumption: 0.07,
                annualInflationAssumption: 0.04,
                annualRetirementSpendingToday: 0,
                withdrawalRate: 0.04,
              } : null,
            }))} />
            Include retirement projection
          </label>
          {profile.retirement && (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {([
                ["Current age", "currentAge", profile.retirement.currentAge, 1],
                ["Retirement age", "retirementAge", profile.retirement.retirementAge, 1],
                ["Current portfolio", "currentPortfolio", profile.retirement.currentPortfolio, 0.01],
                ["Monthly contribution", "monthlyContribution", profile.retirement.monthlyContribution, 0.01],
                ["Annual return %", "annualReturnAssumption", Number(percent(profile.retirement.annualReturnAssumption)), 0.01],
                ["Inflation %", "annualInflationAssumption", Number(percent(profile.retirement.annualInflationAssumption)), 0.01],
                ["Annual spending today", "annualRetirementSpendingToday", profile.retirement.annualRetirementSpendingToday, 0.01],
                ["Withdrawal rate %", "withdrawalRate", Number(percent(profile.retirement.withdrawalRate)), 0.01],
              ] as const).map(([label, key, value, step]) => (
                <Field key={key} label={label} type="number" step={step} value={value} onChange={(raw) => setProfile((current) => {
                  if (!current.retirement) return current;
                  const next = numeric(raw);
                  const rateField = key === "annualReturnAssumption" || key === "annualInflationAssumption" || key === "withdrawalRate";
                  return { ...current, retirement: { ...current.retirement, [key]: rateField ? next / 100 : next } as P6RetirementProjectionInput };
                })} />
              ))}
            </div>
          )}
        </Section>

        {snapshot && (
          <section className="rounded-xl border border-emerald-300/20 bg-emerald-300/[0.025] p-3" aria-label="Deterministic Personal Finance snapshot">
            <div className="font-ui text-[11px] font-semibold text-foreground">Deterministic snapshot · {snapshot.asOf}</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Net worth", snapshot.netWorth],
                ["Assets", snapshot.assets],
                ["Liabilities", snapshot.liabilities],
                ["Trailing cash flow", snapshot.trailingMonthlyCashFlow],
              ].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-border/45 p-2"><div className="font-ui text-[9px] text-muted-foreground">{label}</div><div className="mt-1 font-ui text-[12px] font-semibold text-foreground">{money(Number(value))}</div></div>)}
            </div>
            <div className="mt-2 font-ui text-[10px] text-muted-foreground">
              Income {money(snapshot.trailingMonthlyIncome)} · expenses {money(snapshot.trailingMonthlyExpenses)} · savings rate {snapshot.savingsRate === null ? "N/A" : `${money(snapshot.savingsRate * 100)}%`}
            </div>
            {snapshot.retirement && <div className="mt-2 font-ui text-[10px] text-muted-foreground">Retirement funded ratio {snapshot.retirement.fundedRatio === null ? "N/A" : `${money(snapshot.retirement.fundedRatio * 100)}%`} · funding gap {money(snapshot.retirement.fundingGap)}</div>}
            {!!snapshot.warnings.length && <div className="mt-2 rounded-md border border-amber-300/15 p-2 font-ui text-[10px] text-amber-100">{snapshot.warnings.join(" · ")}</div>}
          </section>
        )}

        {notice && <div role="status" className="font-ui text-[10px] text-muted-foreground">{notice}</div>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border/45 pt-3">
          {!stageOnly && <>
            <button type="button" disabled={busy} onClick={() => void save().then(() => setNotice("Personal Finance profile saved to this Project.")).catch((error) => setNotice(error instanceof Error ? error.message : "Unable to save profile."))} className="rounded-md border border-border/60 px-3 py-2 font-ui text-[10px] text-foreground disabled:opacity-40">Save profile</button>
            <button type="button" disabled={busy} onClick={() => void runPreview()} className="rounded-md border border-emerald-300/25 px-3 py-2 font-ui text-[10px] text-emerald-200 disabled:opacity-40">Run deterministic snapshot</button>
          </>}
          <button type="button" disabled={busy} onClick={() => void analyze()} className="min-h-10 rounded-md bg-amber-300 px-3 py-2 font-ui text-sm font-semibold text-black disabled:opacity-40">{stageOnly ? "Stage inputs for this Chat" : "Analyze in Project chat"}</button>
        </div>
      </div>
    </details>
  );
}
