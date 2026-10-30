import { Briefcase, Calculator, LineChart, Maximize2, Newspaper, PanelRight, Table2 } from "lucide-react";
import type { ChatAnalysisCard as ChatAnalysisCardModel, ChatAnalysisCardKind } from "@/lib/chatAnalysisHandoff";

const ICONS: Record<ChatAnalysisCardKind, typeof LineChart> = {
  chart: LineChart,
  table: Table2,
  news: Newspaper,
  portfolio: Briefcase,
  model: Calculator,
};

/** Compact Workbench suggestion under a Chat answer: open beside Chat or expand to full Workbench. */
export default function ChatAnalysisCard({ card, disabled, onOpen, onExpand }: {
  card: ChatAnalysisCardModel;
  disabled?: boolean;
  onOpen: () => void;
  onExpand: () => void;
}) {
  const Icon = ICONS[card.kind];
  const name = `${card.title}${card.symbol ? ` · ${card.symbol}` : ""}`;
  return (
    <div className="flex justify-start" data-testid="chat-analysis-card">
      <section aria-label={`${name} in Workbench`} className="flex w-full max-w-[85%] items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.04] px-3 py-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-300/10 text-amber-200" aria-hidden="true"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-ui text-sm font-medium text-foreground">{card.title}</p>
          <p className="truncate font-ui text-xs text-muted-foreground">{card.symbol ? `${card.symbol} · ` : ""}Opens in Workbench with this conversation kept</p>
        </div>
        <button type="button" disabled={disabled} onClick={onOpen} aria-label={`Open ${name} beside Chat`}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border/70 px-3 font-ui text-xs hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 disabled:opacity-40">
          <PanelRight className="h-3.5 w-3.5" aria-hidden="true" /> Open
        </button>
        <button type="button" disabled={disabled} onClick={onExpand} aria-label={`Expand ${name} to full Workbench`}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-amber-400 px-3 font-ui text-xs text-black focus-visible:outline focus-visible:outline-2 disabled:opacity-40">
          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /> Expand
        </button>
      </section>
    </div>
  );
}
