import { useEffect, useRef } from "react";
import { useQuotes } from "@/lib/useFinance";
import { formatPrice, getCurrencySymbol } from "@/lib/finance";

interface Props {
  onSymbol: (sym: string) => void;
}

const MACRO_SYMBOLS = [
  "EURUSD=X", "USDJPY=X", "GBPUSD=X", "USDINR=X",
  "GC=F", "CL=F", "SI=F",
  "BTC-USD", "ETH-USD"
];

const MACRO_LABELS: Record<string, string> = {
  "EURUSD=X": "EUR/USD",
  "USDJPY=X": "USD/JPY",
  "GBPUSD=X": "GBP/USD",
  "USDINR=X": "USD/INR",
  "GC=F": "GOLD",
  "CL=F": "CRUDE WTI",
  "SI=F": "SILVER",
  "BTC-USD": "BTC",
  "ETH-USD": "ETH"
};

export default function MacroTickerTape({ onSymbol }: Props) {
  const { data: quotes, isLoading, isError } = useQuotes(MACRO_SYMBOLS);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = el.closest(".terminal-root");
    let pos = 0;
    let raf = 0;
    const animate = () => {
      pos += 0.55;
      if (pos >= el.scrollWidth / 2) pos = 0;
      el.style.transform = `translateX(-${pos}px)`;
      raf = requestAnimationFrame(animate);
    };
    const syncMotion = () => {
      cancelAnimationFrame(raf);
      pos = 0;
      el.style.transform = "";
      if (!media.matches && root?.getAttribute("data-reduced-motion") !== "true") raf = requestAnimationFrame(animate);
    };
    const observer = new MutationObserver(syncMotion);
    if (root) observer.observe(root, { attributes: true, attributeFilter: ["data-reduced-motion"] });
    media.addEventListener("change", syncMotion);
    syncMotion();
    return () => { cancelAnimationFrame(raf); observer.disconnect(); media.removeEventListener("change", syncMotion); el.style.transform = ""; };
  }, [quotes]);

  const items = quotes ?? [];
  const doubled = [...items, ...items];

  return (
    <div data-testid="macro-ticker-tape" className="h-6 bg-[#040404] border-t border-border/80 overflow-hidden relative shrink-0 flex items-center">
      {!items.length && <p role="status" className="px-3 text-xs">{isLoading ? "Loading macro ticker…" : isError ? "Macro ticker unavailable. Check connected sources." : "No macro ticker observations available."}</p>}
      <div
        ref={trackRef}
        className="flex items-center gap-0 whitespace-nowrap will-change-transform"
        style={{ width: "max-content" }}
      >
        {doubled.map((q, i) => {
          const isUp = q.changePercent >= 0;
          const label = MACRO_LABELS[q.symbol] || q.symbol;
          const currencySymbol = getCurrencySymbol(q.symbol);
          
          return (
            <button
              key={`${q.symbol}-${i}`}
              onClick={() => onSymbol(q.symbol)}
              className="flex items-center gap-1.5 px-4 h-6 border-r border-border/40 hover:bg-white/5 group cursor-pointer"
            >
              <span className="font-terminal text-[12px] font-bold text-[hsl(186,80%,55%)] group-hover:text-[hsl(186,80%,65%)] tracking-wider">
                {label}
              </span>
              <span className="font-terminal text-[12px] text-foreground font-semibold tabular-nums">
                {q.price ? `${currencySymbol}${formatPrice(q.price)}` : "—"}
              </span>
              {q.changePercent != null && Number.isFinite(q.changePercent) && (
                <span className={`font-terminal text-[12px] tabular-nums font-bold ${isUp ? "text-up" : "text-down"}`}>
                  {isUp ? "▲" : "▼"}{Math.abs(q.changePercent).toFixed(2)}%
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
