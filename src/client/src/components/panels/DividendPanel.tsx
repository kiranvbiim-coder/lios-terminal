import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useQuotes } from "@/lib/useFinance";
import { useLseDividends } from "@/lib/useLse";
import { DollarSign, Plus, X } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import type { Quote } from "@/lib/finance";

interface Props { onSymbol: (symbol: string) => void; onNav: (view: ViewMode) => void; }
const DEFAULT_DIV_STOCKS = ["JNJ","KO","PEP","PG","MMM","T","VZ","MO","PM","CVX","XOM","ABT","MCD","WMT","ABBV","O","SPG","D","NEE","SO"];
const MIN_DIV_STOCKS = 3;
const MAX_DIV_STOCKS = 30;

function DividendObservations({ symbol, quote, onSymbol, onRemove }: {
  symbol: string; quote?: Quote; onSymbol: (symbol: string) => void; onRemove?: () => void;
}) {
  const query = useLseDividends(symbol);
  const rows = query.data ?? [];
  return <section className="rounded border border-border p-3" aria-label={`${symbol} dividend observations`}>
    <header className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => onSymbol(symbol)} className="min-h-10 font-semibold text-primary underline">{symbol}</button>
      <span className="text-sm text-muted-foreground">Observed quote: {quote ? `${quote.price} ${quote.currency || "currency unavailable"}` : "unavailable"}</span>
      {onRemove && <button type="button" onClick={onRemove} aria-label={`Remove ${symbol}`} className="ml-auto min-h-10 px-2"><X className="h-4 w-4"/></button>}
    </header>
    {query.isError && <div role="alert" className="text-sm text-amber-200">Dividend refresh failed. Retained observations, if present, may be older; no freshness or calendar completeness is inferred. <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="min-h-10 underline">Retry {symbol}</button></div>}
    {!rows.length ? query.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading dividend observations…</p>
      : !query.isError ? <p className="text-sm text-muted-foreground">No dividend observations available. This does not establish that the company pays no dividends or has no upcoming dates.</p> : null
      : <div className="overflow-auto" role="region" aria-label={`${symbol} recorded dividends`} tabIndex={0}>
        <table className="w-full text-left text-sm"><thead><tr>{["Effective date","Amount per share","Currency","Declaration date","Record date","Payment date","Reported frequency"].map(label => <th key={label} className="p-2 text-muted-foreground">{label}</th>)}</tr></thead>
          <tbody>{rows.map((row,index) => <tr key={`${row.effective_date}:${index}`} className="border-t border-border/40">
            <td className="p-2">{row.effective_date || "Unavailable"}</td><td className="p-2 tabular-nums">{Number.isFinite(row.dividend_amount) ? row.dividend_amount : "Unavailable"}</td><td className="p-2">{row.currency || "Unavailable"}</td>
            <td className="p-2">{row.declaration_date || "Unavailable"}</td><td className="p-2">{row.record_date || "Unavailable"}</td><td className="p-2">{row.payment_date || "Unavailable"}</td><td className="p-2">{row.frequency || "Unavailable"}</td>
          </tr>)}</tbody>
        </table>
      </div>}
  </section>;
}

export default function DividendPanel({ onSymbol }: Props) {
  const [stocks,setStocks] = useTerminalArtifactState<string[]>("DividendPanel.DIV_STOCKS",DEFAULT_DIV_STOCKS);
  const [tickerInput,setTickerInput] = useTerminalArtifactState("DividendPanel.tickerInput","");
  const quotes = useQuotes(stocks);
  const addStock = () => {
    const symbol = tickerInput.trim().toUpperCase();
    if (symbol && !stocks.includes(symbol) && stocks.length < MAX_DIV_STOCKS) { setStocks(previous => [...previous,symbol]); setTickerInput(""); }
  };
  return <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
    <header className="flex flex-wrap items-center gap-2 border-b border-border p-3">
      <DollarSign className="h-4 w-4 text-primary"/><h2 className="text-sm font-semibold">Dividend Intelligence</h2>
      <label className="ml-auto text-sm">Add ticker <input aria-label="Dividend ticker" value={tickerInput} onChange={event => setTickerInput(event.target.value.toUpperCase())} onKeyDown={event => { if(event.key === "Enter") addStock(); }} disabled={stocks.length >= MAX_DIV_STOCKS} className="min-h-10 w-28 rounded border border-border bg-background px-2"/></label>
      <button type="button" onClick={addStock} disabled={stocks.length >= MAX_DIV_STOCKS || !tickerInput.trim()} className="flex min-h-10 items-center gap-1 rounded border border-border px-3 disabled:opacity-50"><Plus className="h-4 w-4"/>Add</button>
    </header>
    <div className="flex-1 space-y-3 overflow-auto p-3">
      <p className="text-sm text-muted-foreground">Recorded dividend observations from the existing connected-data authority. Coverage and freshness are not established by an empty response. Effective dates are shown as returned, not relabelled as ex-dividend dates. Quotes do not establish dividend policy.</p>
      <p className="text-sm text-amber-200">Annual dividends, forward yield, payout ratios, growth streaks and future-calendar completeness are unavailable from this observation contract; none are invented or inferred from P/E.</p>
      {quotes.isError && <p role="alert" className="text-sm text-amber-200">Quote observations unavailable. Dividend reads are independent.</p>}
      {stocks.map(symbol => <DividendObservations key={symbol} symbol={symbol} quote={quotes.data?.find(quote => quote.symbol === symbol)} onSymbol={onSymbol} onRemove={stocks.length > MIN_DIV_STOCKS ? () => setStocks(previous => previous.filter(value => value !== symbol)) : undefined}/>)}
    </div>
  </div>;
}
