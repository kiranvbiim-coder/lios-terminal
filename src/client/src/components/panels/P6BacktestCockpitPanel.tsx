import { useMemo } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { P6BacktestLifecycle, P6BacktestResult } from "@shared/p6FinanceContracts";
import { buildBacktestCockpitModel } from "@/lib/backtestCockpit";

function pct(value: number | null): string {
  return value === null ? "—" : (value * 100).toFixed(2) + "%";
}

export function P6BacktestCockpitPanel(props: { result: P6BacktestResult; lifecycle: P6BacktestLifecycle }) {
  const model = useMemo(() => buildBacktestCockpitModel(props.result, props.lifecycle), [props.result, props.lifecycle]);
  const curve = useMemo(() => model.equity.map((point, index) => ({
    at: point.at.slice(0, 10),
    equity: point.value,
    benchmark: model.benchmark[index]?.value ?? null,
    drawdown: (model.drawdown[index]?.value ?? 0) * 100,
    exposure: (model.exposure[index]?.value ?? 0) * 100,
  })), [model]);

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-4" aria-label="Backtest Cockpit">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Historical simulation</p>
          <h2 className="text-lg font-semibold">Backtest Cockpit</h2>
          <p className="mt-1 text-xs text-muted-foreground">{model.stateLabel} · {model.reproducibility.engineId} · {model.reproducibility.reproducibilityHash.slice(0, 12)}…</p>
        </div>
        <div className="rounded-md border px-3 py-2 text-xs">
          <div>Point-in-time: {model.reproducibility.pointInTimeVerified ? "verified" : "not verified"}</div>
          <div>Live performance: no</div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        {model.headline.slice(0, 12).map((item) => (
          <div key={item.label} className="rounded-lg border bg-card/60 p-3">
            <div className="text-[11px] text-muted-foreground">{item.label}</div>
            <div className="mt-1 font-mono text-sm font-semibold">
              {item.format === "percent" ? pct(item.value) : item.value === null ? "—" : item.format === "integer" ? Math.round(item.value) : item.value.toFixed(2)}
            </div>
          </div>
        ))}
      </div>

      <div className="h-72 rounded-lg border bg-card/40 p-3">
        <div className="mb-2 text-xs font-medium">Equity vs benchmark</div>
        <ResponsiveContainer width="100%" height="90%">
          <LineChart data={curve}>
            <XAxis dataKey="at" hide />
            <YAxis width={70} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line dataKey="equity" dot={false} strokeWidth={2} />
            <Line dataKey="benchmark" dot={false} strokeWidth={1} strokeDasharray="4 4" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border bg-card/40 p-3">
          <div className="mb-2 text-xs font-medium">Execution assumptions</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <dt className="text-muted-foreground">Fees</dt><dd className="font-mono">{model.costs.feesBps} bps</dd>
            <dt className="text-muted-foreground">Slippage</dt><dd className="font-mono">{model.costs.slippageBps} bps</dd>
            <dt className="text-muted-foreground">Cost impact</dt><dd className="font-mono">{pct(model.costs.costImpact)}</dd>
            <dt className="text-muted-foreground">Execution</dt><dd className="font-mono">{props.result.assumptions.execution.replaceAll("_", " ")}</dd>
          </dl>
        </div>
        <div className="rounded-lg border bg-card/40 p-3">
          <div className="mb-2 text-xs font-medium">Warnings / provenance</div>
          {model.reproducibility.warnings.length ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {model.reproducibility.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
            </ul>
          ) : <p className="text-xs text-muted-foreground">No engine warnings.</p>}
        </div>
      </div>

      <div className="rounded-lg border bg-card/40">
        <div className="border-b px-3 py-2 text-xs font-medium">Trades</div>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background/95 text-muted-foreground"><tr><th className="p-2 text-left">Executed</th><th className="p-2 text-left">Side</th><th className="p-2 text-right">Price</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Fees</th><th className="p-2 text-left">Reason</th></tr></thead>
            <tbody>
              {model.trades.map((trade, index) => <tr key={trade.executedAt + "-" + index} className="border-t"><td className="p-2">{trade.executedAt.slice(0, 10)}</td><td className="p-2 uppercase">{trade.side}</td><td className="p-2 text-right font-mono">{trade.price.toFixed(4)}</td><td className="p-2 text-right font-mono">{trade.quantity.toFixed(4)}</td><td className="p-2 text-right font-mono">{trade.fees.toFixed(2)}</td><td className="p-2">{trade.reason}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
