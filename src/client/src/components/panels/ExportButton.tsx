import { Download } from "lucide-react";

// Consistent small "export this worksheet" button, used across every
// calc panel that produces a spreadsheet-shaped result (DCF, LBO, DuPont,
// ratios, DDM, Beneish, Ohlson, comps...) so exporting looks and behaves
// the same everywhere instead of each panel inventing its own button.
export function ExportButton({ onExport, label = "EXPORT XLSX" }: { onExport: () => void; label?: string }) {
  return (
    <button
      onClick={onExport}
      title="Export this worksheet as .xlsx"
      className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%] hover:bg-[hsl(38,95%,50%)/10%] transition-colors"
    >
      <Download className="w-3 h-3" />
      {label}
    </button>
  );
}
