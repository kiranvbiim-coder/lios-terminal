import { ArrowRight, Layers3, Network, SplitSquareHorizontal, X } from "lucide-react";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import { useTerminalContextProjection } from "@/lib/terminalContext";
import { getJourneyForView, getRelatedToolActions } from "@/lib/terminalToolGraph";
import type { TerminalPeekRequest } from "@/lib/terminalPeek";
import type { ViewMode } from "@/lib/terminalTypes";
import { useGuidedMode } from "@/hooks/use-guided-mode";

interface Props {
  request: TerminalPeekRequest;
  isInternal: boolean;
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onClose: () => void;
}

export default function AnalyticalPeek({ request, isInternal, onOpen, onClose }: Props) {
  const capability = getTerminalCapability(request.view);
  const universalContext = useTerminalContextProjection({ view: request.view, symbol: request.symbol });
  const guided = useGuidedMode();
  const journey = getJourneyForView(request.view);
  const related = getRelatedToolActions(request.view, isInternal).slice(0, 3);
  const width = 330;
  const left = Math.max(8, Math.min(request.x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(request.y, window.innerHeight - 320));
  const symbol = universalContext.entity?.symbol;
  const contextMeta = universalContext.time.mode === "as-known-on" && universalContext.time.asOfDate
    ? `${capability.domain} · AS OF ${universalContext.time.asOfDate}`
    : `${capability.domain} · LATEST`;

  return (
    <aside
      className="lios-v4-overlay fixed z-[85] w-[330px] rounded-2xl p-1.5"
      style={{ left, top }}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseLeave={onClose}
      aria-label={`Peek ${request.title ?? capability.label}`}
    >
      <header className="flex items-start gap-3 rounded-xl p-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-400/[0.045] text-cyan-300"><Layers3 className="h-3.5 w-3.5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">{symbol && <span className="lios-symbol text-[8px] font-semibold text-amber-300">{symbol}</span>}<span className="font-ui truncate text-[11px] font-semibold text-foreground">{request.title ?? capability.label}</span></div>
          <div className="font-ui mt-1 text-[7px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">{request.source ?? "context"} peek · {contextMeta}</div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-muted-foreground/55 hover:bg-white/[0.04] hover:text-foreground" aria-label="Close peek"><X className="h-3 w-3" /></button>
      </header>

      <div className="px-3 pb-3">
        <p className="font-ui text-[8px] leading-relaxed text-muted-foreground">{capability.description}</p>
        {guided && capability.guidance && (
          <div className="mt-2 space-y-1 rounded-xl border border-[hsl(38,95%,50%)]/20 bg-[hsl(38,95%,50%)]/[0.035] p-2">
            <p className="font-ui text-[7.5px] leading-relaxed text-muted-foreground"><span className="font-semibold uppercase tracking-wide text-[hsl(38,95%,55%)]">Why — </span>{capability.guidance.why}</p>
            <p className="font-ui text-[7.5px] leading-relaxed text-muted-foreground"><span className="font-semibold uppercase tracking-wide text-cyan-400/90">Outcome — </span>{capability.guidance.outcome}</p>
          </div>
        )}
        {journey && <div className="mt-3 rounded-xl border border-border/50 bg-white/[0.012] p-2.5"><div className="font-ui flex items-center gap-1.5 text-[7px] font-semibold text-cyan-300/75"><Network className="h-3 w-3" /> {journey.journey.label}</div><div className="font-ui mt-1 text-[7px] text-muted-foreground">Stage {journey.stageIndex + 1} of {journey.journey.stages.length} · {journey.journey.stages[journey.stageIndex].label}</div></div>}

        {related.length > 0 && <div className="mt-3"><div className="font-ui text-[7px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">Connected next moves</div><div className="mt-1.5 space-y-1">{related.map((action) => <button key={`${action.relationship}-${action.view}`} onClick={() => { onOpen(action.view, "current", symbol); onClose(); }} className="font-ui flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[8px] text-muted-foreground transition-colors hover:bg-white/[0.03] hover:text-foreground"><span className="min-w-0 flex-1 truncate">{action.label}</span><span className="lios-pane-code text-[6px] text-cyan-300/50">{action.relationship}</span><ArrowRight className="h-2.5 w-2.5" /></button>)}</div></div>}

        <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-border/45 pt-3">
          <button onClick={() => { onOpen(request.view, "current", symbol); onClose(); }} className="font-ui rounded-lg border border-border/55 px-2 py-2 text-[7px] text-muted-foreground transition-colors hover:bg-white/[0.035] hover:text-foreground">Open here</button>
          <button onClick={() => { onOpen(request.view, "tab", symbol); onClose(); }} className="font-ui rounded-lg border border-border/55 px-2 py-2 text-[7px] text-muted-foreground transition-colors hover:bg-white/[0.035] hover:text-foreground">New tab</button>
          <button onClick={() => { onOpen(request.view, "split-right", symbol); onClose(); }} className="font-ui flex items-center justify-center gap-1 rounded-lg border border-border/55 px-2 py-2 text-[7px] text-muted-foreground transition-colors hover:bg-white/[0.035] hover:text-foreground"><SplitSquareHorizontal className="h-2.5 w-2.5" /> Split</button>
        </div>
      </div>
    </aside>
  );
}
