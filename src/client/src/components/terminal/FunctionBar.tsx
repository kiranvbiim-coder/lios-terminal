import type { ViewMode } from "@/lib/terminalTypes";

interface Props {
  onNav: (v: ViewMode) => void;
  onOpenCmd: () => void;
  onOpenLayouts?: () => void;
  onOpenWorkbench?: () => void;
}

export default function FunctionBar({ onNav, onOpenCmd, onOpenLayouts, onOpenWorkbench }: Props) {
  const keys: Array<{ key: string; label: string; sub: string; action: () => void; title: string }> = [
    { key: "F1",  label: "WORK",  sub: "Workbench", action: onOpenWorkbench || onOpenCmd, title: "LiOS Workbench / Help" },
    { key: "F2",  label: "MRKT",  sub: "Market", action: () => onNav("market"), title: "Market Overview" },
    { key: "F3",  label: "QUOTE", sub: "Quote", action: () => onNav("quote"), title: "Quote" },
    { key: "F4",  label: "CHRT",  sub: "Chart", action: () => onNav("chart"), title: "Chart" },
    { key: "F5",  label: "REFR",  sub: "Refresh", action: () => window.location.reload(), title: "Refresh application" },
    { key: "F6",  label: "SCRN",  sub: "Screen", action: () => onNav("screener"), title: "Screener" },
    { key: "F7",  label: "ECON",  sub: "Macro", action: () => onNav("economics"), title: "Economics" },
    { key: "F8",  label: "AI",    sub: "Agent", action: () => onNav("agent"), title: "AI Agent" },
    { key: "F9",  label: "WATCH", sub: "Watch", action: () => onNav("watchlist"), title: "Watchlist" },
    { key: "F10", label: "ALRT",  sub: "Alerts", action: () => onNav("alerts"), title: "Alerts" },
    { key: "F11", label: "PORT",  sub: "Portfolio", action: () => onNav("portfolio"), title: "Portfolio" },
    { key: "F12", label: "LAYOUT", sub: "Scenes", action: onOpenLayouts || onOpenCmd, title: "Analysis scenes and saved layouts" },
  ];

  return (
    <div data-testid="function-bar" className="flex h-7 shrink-0 items-stretch overflow-x-auto border-t border-border/55 bg-[hsl(var(--lios-void)/.94)] scrollbar-none" aria-label="Function keys">
      {keys.map((item) => (
        <button
          key={item.key}
          onClick={item.action}
          title={item.title}
          data-testid={`fkey-${item.key.toLowerCase()}`}
          className="group flex min-w-[58px] flex-1 items-center justify-center gap-1.5 border-r border-border/45 px-1 transition-colors hover:bg-white/[0.035]"
        >
          <span className="lios-pane-code text-[6px] tracking-wide text-amber-300/55 transition-colors group-hover:text-amber-300">{item.key}</span>
          <span className="font-ui hidden truncate text-[7px] font-medium text-muted-foreground/65 transition-colors group-hover:text-foreground sm:inline">{item.sub}</span>
        </button>
      ))}
    </div>
  );
}
