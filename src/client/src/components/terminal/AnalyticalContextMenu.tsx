import { useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ArrowRight, Columns2, Database, ExternalLink, Layers3, MonitorUp } from "lucide-react";
import {
  createAnalyticalContext, getOpenWithActions, getSendToActions,
  type AnalyticalOpenMode, type CompatibleAnalyticalAction,
} from "@/lib/terminalActionContracts";
import type { ViewMode } from "@/lib/terminalTypes";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import { useTerminalContextProjection } from "@/lib/terminalContext";

interface Props {
  x: number;
  y: number;
  view: ViewMode;
  symbol?: string;
  isInternal: boolean;
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onEvidence: () => void;
  onClose: () => void;
}

function ActionRow({ action, onChoose }: { action: CompatibleAnalyticalAction; onChoose: (mode: AnalyticalOpenMode) => void }) {
  return (
    <div className="group grid grid-cols-[1fr_auto] border-b border-border/50 last:border-b-0 hover:bg-white/[0.03]">
      <button onClick={() => onChoose(action.suggestedMode)} className="min-w-0 px-2 py-2 text-left"><div className="font-terminal text-[8px] text-foreground">{action.label}</div><div className="mt-0.5 truncate font-terminal text-[6px] uppercase tracking-widest text-cyan-300/70">{action.relationship} · {action.reason}</div></button>
      <div className="flex items-center pr-1"><button onClick={() => onChoose("tab")} title="Open in new tab" className="p-1 text-muted-foreground hover:text-foreground"><ExternalLink className="h-3 w-3" /></button><button onClick={() => onChoose("split-right")} title="Split right" className="p-1 text-muted-foreground hover:text-foreground"><Columns2 className="h-3 w-3" /></button></div>
    </div>
  );
}

export default function AnalyticalContextMenu({ x, y, view, symbol, isInternal, onOpen, onEvidence, onClose }: Props) {
  const opener = useRef(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const capability = getTerminalCapability(view);
  const universalContext = useTerminalContextProjection({ view, symbol });
  const context = createAnalyticalContext(view, universalContext.entity?.symbol ?? symbol);
  const openWith = getOpenWithActions(view, isInternal);
  const sendTo = getSendToActions(view, isInternal);

  const choose = (action: CompatibleAnalyticalAction, mode: AnalyticalOpenMode) => {
    onOpen(action.view, mode, action.symbolAware ? context.symbol : undefined);
    onClose();
  };

  const left = Math.max(8, Math.min(x, typeof window !== "undefined" ? window.innerWidth - 370 : x));
  const top = Math.max(8, Math.min(y, typeof window !== "undefined" ? window.innerHeight - 520 : y));
  const timeLabel = universalContext.time.mode === "as-known-on" && universalContext.time.asOfDate
    ? `AS KNOWN ON ${universalContext.time.asOfDate}`
    : "LATEST CONTEXT";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[360px] max-w-[calc(100vw-16px)] gap-0 bg-[#080808] p-0 pr-0" style={{ left, top, transform: "none" }} onCloseAutoFocus={(event) => {
        if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus({ preventScroll: true }); }
      }}>
        <header className="flex items-start gap-2 border-b border-border p-2.5 pr-12"><Layers3 className="mt-0.5 h-3.5 w-3.5 text-cyan-300" /><div className="min-w-0 flex-1"><DialogTitle className="truncate font-terminal text-sm font-bold text-foreground">{context.symbol ? `${context.symbol} · ` : ""}{capability.label}</DialogTitle><DialogDescription className="mt-1 font-terminal text-xs text-muted-foreground">Context-aware actions from the Tool Graph · {timeLabel}. No hidden data transformations.</DialogDescription></div></header>
        <button onClick={() => { onEvidence(); onClose(); }} className="flex w-full items-center gap-2 border-b border-border px-2.5 py-2 text-left font-terminal text-[8px] text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"><Database className="h-3 w-3 text-cyan-300" /> INSPECT EVIDENCE & CALC RECEIPTS</button>
        {openWith.length > 0 && <section><div className="flex items-center gap-1.5 border-b border-border bg-black/30 px-2 py-1.5 font-terminal text-[7px] tracking-widest text-muted-foreground"><ArrowRight className="h-3 w-3" /> OPEN WITH</div>{openWith.slice(0, 6).map((action) => <ActionRow key={`open-${action.view}`} action={action} onChoose={(mode) => choose(action, mode)} />)}</section>}
        {sendTo.length > 0 && <section><div className="flex items-center gap-1.5 border-y border-border bg-black/30 px-2 py-1.5 font-terminal text-[7px] tracking-widest text-muted-foreground"><MonitorUp className="h-3 w-3" /> SEND TO / MONITOR</div>{sendTo.slice(0, 6).map((action) => <ActionRow key={`send-${action.view}`} action={action} onChoose={(mode) => choose(action, mode)} />)}</section>}
      </DialogContent>
    </Dialog>
  );
}
