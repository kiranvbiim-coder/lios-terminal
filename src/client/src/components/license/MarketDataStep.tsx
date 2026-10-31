import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, TrendingUp } from "lucide-react";
import { SETUP_STATUS_KEY, type AiSetupStatus } from "@/lib/aiConnection";
import { COMMUNITY_CONSENT_KEY, dismissMarketDataStep, enableYahooMarketData } from "@/lib/marketDataStep";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

/**
 * Asks once which market-data source may serve prices. Yahoo needs the person's explicit consent (an unofficial,
 * delayed source); the checkbox starts unchecked and nothing is saved until they confirm it.
 */
export default function MarketDataStep({ setup, userId, onDone }: { setup: AiSetupStatus | undefined; userId: number | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useYahoo = async () => {
    setBusy(true); setError(null);
    try {
      await enableYahooMarketData(setup);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SETUP_STATUS_KEY }),
        queryClient.invalidateQueries({ queryKey: COMMUNITY_CONSENT_KEY }),
        // Anything already shown without prices must refetch now that a source is selected.
        queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0] ?? "").startsWith("/api/finance") }),
      ]);
      onDone();
    } catch {
      setError("Market data could not be turned on. Check your connection and try again.");
    } finally { setBusy(false); }
  };

  const later = () => { dismissMarketDataStep(userId); onDone(); };

  return (
    <main className="flex min-h-screen w-screen items-center justify-center bg-background p-4 text-foreground" data-testid="market-data-step">
      <section className="w-full max-w-xl space-y-6 rounded-lg border border-border bg-card p-6 sm:p-8" aria-labelledby="market-data-title">
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-[hsl(38,95%,55%)]" aria-hidden="true" />
            <h1 id="market-data-title" className="font-ui text-xl font-semibold">Choose your market data</h1>
          </div>
          <p className="font-ui text-sm leading-relaxed text-muted-foreground">
            Prices, charts and company data come from sources you choose. LiOS never uses a source you have not selected, and it never invents a price.
          </p>
        </header>

        <div className="space-y-3 rounded-md border border-border/70 p-4">
          <div className="font-ui text-sm font-semibold">Yahoo Finance · free, delayed</div>
          <label className="flex items-start gap-3 font-ui text-sm leading-relaxed text-muted-foreground">
            <input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} className={`mt-1 ${focusRing}`} data-testid="market-data-consent" />
            <span>I agree to use community Yahoo / yfinance access. It is an unofficial source, so prefer a licensed provider when you have one.</span>
          </label>
          <button type="button" disabled={!consent || busy} onClick={() => void useYahoo()} data-testid="market-data-use-yahoo"
            className={`flex w-full items-center justify-center gap-2 rounded-md bg-[hsl(38,95%,55%)] px-4 py-2.5 font-ui text-sm font-semibold text-black disabled:opacity-40 ${focusRing}`}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Use Yahoo Finance
          </button>
        </div>

        {error && <p role="alert" className="font-ui text-sm text-red-300">{error}</p>}

        <button type="button" disabled={busy} onClick={later} data-testid="market-data-later"
          className={`w-full rounded-md border border-border px-4 py-2.5 font-ui text-sm text-muted-foreground hover:text-foreground disabled:opacity-40 ${focusRing}`}>
          I'll add provider keys later
        </button>
        <p className="font-ui text-xs leading-relaxed text-muted-foreground">
          Without a source, prices and charts stay empty and say so. You can add Yahoo or your own provider keys any time in Connections.
        </p>
      </section>
    </main>
  );
}
