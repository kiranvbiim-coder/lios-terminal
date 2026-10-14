import { useEffect, useRef, useState } from "react";
import { useQuotes } from "@/lib/useFinance";
import { formatPrice, formatPct, TAPE_SYMBOLS } from "@/lib/finance";

interface Props {
  onSymbol: (sym: string) => void;
}

export default function TickerTape({ onSymbol }: Props) {
  const { data: quotes } = useQuotes(TAPE_SYMBOLS);
  const trackRef = useRef<HTMLDivElement>(null);

  // Auto-scroll animation
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let pos = 0;
    const speed = 0.6; // px per frame
    let raf: number;
    const animate = () => {
      pos += speed;
      if (pos >= el.scrollWidth / 2) pos = 0;
      el.style.transform = `translateX(-${pos}px)`;
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [quotes]);

  const items = quotes || TAPE_SYMBOLS.map(s => ({ symbol: s, price: 0, changePercent: 0, change: 0 }));
  // Duplicate for seamless loop
  const doubled = [...items, ...items];

  return (
    <div data-testid="equity-ticker-tape" className="h-6 bg-[#050505] border-b border-border overflow-hidden relative shrink-0">
      <div
        ref={trackRef}
        className="flex items-center gap-0 whitespace-nowrap will-change-transform"
        style={{ width: "max-content" }}
      >
        {doubled.map((q: any, i) => (
          <button
            key={`${q.symbol}-${i}`}
            onClick={() => onSymbol(q.symbol)}
            className="flex items-center gap-1.5 px-3 h-6 border-r border-border/50 hover:bg-white/5 group cursor-pointer"
          >
            <span className="font-terminal text-[9px] font-semibold text-[hsl(38,95%,55%)] group-hover:text-[hsl(38,95%,65%)]">
              {q.symbol.replace("^", "").replace("=F", "").replace("-USD", "")}
            </span>
            <span className="font-terminal text-[9px] text-foreground tabular-nums">
              {q.price ? formatPrice(q.price) : "—"}
            </span>
            {q.changePercent !== undefined && (
              <span className={`font-terminal text-[9px] tabular-nums ${q.changePercent >= 0 ? "text-up" : "text-down"}`}>
                {q.changePercent >= 0 ? "▲" : "▼"}{Math.abs(q.changePercent).toFixed(2)}%
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
