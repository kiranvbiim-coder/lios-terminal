import { useState, useRef, useEffect } from "react";
import { Download, ChevronDown } from "lucide-react";

// Two-format counterpart to ExportButton -- a small dropdown offering both
// XLSX and PDF for panels that build the same ExportSheet[] shape for both
// (see exportXlsx.ts / exportPdf.ts). Kept as a separate component rather
// than changing ExportButton so existing single-format call sites are
// unaffected; use this one for new/updated panels that want both formats.
export function ExportMenuButton({ onExportXlsx, onExportPdf }: { onExportXlsx: () => void; onExportPdf: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Export this worksheet"
        className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%] hover:bg-[hsl(38,95%,50%)/10%] transition-colors"
      >
        <Download className="w-3 h-3" />
        EXPORT
        <ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-20 border border-border bg-[#0a0a0a] shadow-lg min-w-[100px]">
          <button
            onClick={() => { onExportXlsx(); setOpen(false); }}
            className="block w-full text-left px-3 py-1.5 font-terminal text-[8px] tracking-widest text-muted-foreground hover:text-foreground hover:bg-white/5"
          >
            XLSX
          </button>
          <button
            onClick={() => { onExportPdf(); setOpen(false); }}
            className="block w-full text-left px-3 py-1.5 font-terminal text-[8px] tracking-widest text-muted-foreground hover:text-foreground hover:bg-white/5"
          >
            PDF
          </button>
        </div>
      )}
    </div>
  );
}
