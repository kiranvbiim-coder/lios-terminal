// Shared historical-lookback control -- the identical button-group markup
// was hand-copied into AdvancedRiskPanel, AssetPricingPanel, and
// DataStatsExplorerPanel (twice). Extracted here so the visual language for
// "pick how far back to look" stays in sync across every panel that offers
// it, instead of drifting independently each time one gets tweaked.
interface RangeSelectorProps<T extends string> {
  ranges: readonly T[];
  value: T;
  onChange: (range: T) => void;
  className?: string;
}

export function RangeSelector<T extends string>({ ranges, value, onChange, className = "" }: RangeSelectorProps<T>) {
  return (
    <div className={`flex border border-border ${className}`}>
      {ranges.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`px-2 py-1 font-terminal text-[8px] tracking-wider border-r border-border last:border-r-0 ${
            value === r ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)]" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
