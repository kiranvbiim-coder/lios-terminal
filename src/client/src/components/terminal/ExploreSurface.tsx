import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowRight,
  BarChart3,
  Check,
  Clock3,
  Command,
  Database,
  Filter,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import {
  buildQuantSeries,
  type DynamicAnalyticsField,
} from "@shared/waveCContracts";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import type { ViewMode } from "@/lib/terminalTypes";
import { useAudience } from "@/lib/audience";
import {
  FusionActionButton,
  FusionFreshnessBadge,
  FusionPanel,
  FusionSourceBadge,
  FusionStateBlock,
  FusionStatusBadge,
} from "./FusionPrimitives";

type ExploreCategory = "all" | "market" | "quality" | "financials" | "macro";

interface Props {
  activeSymbol?: string;
  catalog: DynamicAnalyticsField[];
  selectedFieldIds: string[];
  selectedLabels: string[];
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onOpenChart: () => void;
  onToggleMetric: (id: string) => void;
}

const CATEGORIES: readonly { id: ExploreCategory; label: string }[] = [
  { id: "all", label: "All fields" },
  { id: "market", label: "Market" },
  { id: "quality", label: "Quality" },
  { id: "financials", label: "Financials" },
  { id: "macro", label: "Macro" },
];

const EXAMPLES = ["market cap", "P/E ratio", "free cash flow", "return on equity"];

const QUICK_ACTIONS: readonly {
  label: string;
  detail: string;
  view: ViewMode;
  tone: "accent" | "amber" | "green";
  icon: typeof TrendingUp;
}[] = [
  { label: "Company snapshot", detail: "Price, profile and key facts", view: "quote", tone: "accent", icon: TrendingUp },
  { label: "Financial health", detail: "Statements and cash-flow history", view: "financialstatements", tone: "green", icon: Database },
  { label: "Intrinsic value", detail: "Open an editable valuation model", view: "valuation", tone: "amber", icon: BarChart3 },
  { label: "Peer context", detail: "Compare against a selected peer set", view: "peercomp", tone: "accent", icon: Filter },
];

function fieldCategory(field: DynamicAnalyticsField): Exclude<ExploreCategory, "all"> {
  const value = `${field.id} ${field.family ?? ""}`.toLowerCase();
  if (value.includes("macro") || value.includes("economic") || value.includes("inflation") || value.includes("rate")) return "macro";
  if (value.includes("financial") || value.includes("statement") || value.includes("cash") || value.includes("debt") || value.includes("revenue")) return "financials";
  if (value.includes("quality") || value.includes("return") || value.includes("margin") || value.includes("roic") || value.includes("roe")) return "quality";
  return "market";
}

function fieldKindLabel(field: DynamicAnalyticsField): string {
  if (field.kind === "canonical") return "CANONICAL";
  if (field.kind === "metric") return "METRIC";
  return "EXTENDED";
}

function fieldTypeLabel(field: DynamicAnalyticsField): string {
  return field.unit ?? field.type.replaceAll("_", " ").toUpperCase();
}

export default function ExploreSurface({
  activeSymbol,
  catalog,
  selectedFieldIds,
  selectedLabels,
  onOpen,
  onOpenChart,
  onToggleMetric,
}: Props) {
  const isClient = useAudience() === "client";
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ExploreCategory>("all");
  const [activeResult, setActiveResult] = useState(0);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const filteredResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return catalog
      .filter((field) => category === "all" || fieldCategory(field) === category)
      .filter((field) => !normalized || field.searchableText.includes(normalized))
      .slice(0, 16);
  }, [catalog, category, query]);

  const numericCount = useMemo(() => catalog.filter((field) => field.numeric).length, [catalog]);
  const selectedQuantCount = selectedFieldIds.filter((id) => Boolean(buildQuantSeries(id))).length;
  const activeResultField = filteredResults[activeResult];

  useEffect(() => {
    setActiveResult(0);
  }, [category, query]);

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResult((current) => Math.min(current + 1, Math.max(0, filteredResults.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResult((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter" && activeResultField) {
      event.preventDefault();
      onToggleMetric(activeResultField.id);
    } else if (event.key === "Escape") {
      setQuery("");
      inputRef.current?.blur();
    }
  };

  return (
    <section className="lios-phase2-explore" data-testid="explore-surface" aria-label="Explore data and analysis">
      <header className="lios-phase2-explore-hero">
        <div className="lios-phase2-explore-heading">
          <div className="flex flex-wrap items-center gap-2">
            <FusionStatusBadge kind="status" tone="accent">DISCOVERY / DATA</FusionStatusBadge>
            <FusionFreshnessBadge state="ready" />
            {activeSymbol && <FusionSourceBadge source={`${activeSymbol.toUpperCase()} CONTEXT`} />}
          </div>
          <div className="mt-3 flex items-start gap-3">
            <div className="lios-phase2-explore-mark" aria-hidden="true"><Command className="h-4 w-4" /></div>
            <div>
              <h2 className="font-ui text-[15px] font-semibold tracking-tight text-foreground">Explore the terminal through intent</h2>
              <p className="mt-1 max-w-2xl font-ui text-[8px] leading-relaxed text-muted-foreground">
                Find a field, select the evidence you need, and send it into a chart or analysis. Your active symbol stays with you.
              </p>
            </div>
          </div>
        </div>
        <div className="lios-phase2-explore-stats" aria-label="Explore coverage">
          <div><span>AVAILABLE FIELDS</span><strong>{catalog.length}</strong></div>
          <div><span>NUMERIC SERIES</span><strong>{numericCount}</strong></div>
          <div><span>SELECTED</span><strong className={selectedFieldIds.length ? "is-active" : undefined}>{selectedFieldIds.length}</strong></div>
        </div>
        <div className="lios-phase2-explore-search" data-active={query.length > 0 ? "true" : undefined}>
          <Search className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="SEARCH METRICS, FIELDS OR EVIDENCE..."
            aria-label="Search analytics fields"
            aria-controls="explore-results"
            aria-activedescendant={activeResultField ? `explore-field-${activeResultField.id.replaceAll(".", "-")}` : undefined}
            className="min-w-0 flex-1 bg-transparent font-terminal text-[9px] text-foreground outline-none placeholder:text-muted-foreground/55"
          />
          {query && <button type="button" onClick={() => setQuery("")} className="lios-phase2-explore-clear" aria-label="Clear Explore search"><X className="h-3 w-3" /></button>}
          <span className="lios-phase2-explore-shortcut"><kbd>⌘</kbd><kbd>K</kbd></span>
        </div>
        <div className="lios-phase2-explore-examples" aria-label="Search examples">
          <span>TRY</span>
          {EXAMPLES.map((example) => <button key={example} type="button" onClick={() => setQuery(example)}>{example}</button>)}
        </div>
      </header>

      <div className="lios-phase2-explore-layout">
        <FusionPanel className="lios-phase2-explore-results" id="explore-results">
          <div className="lios-phase2-explore-section-head">
            <div>
              <div className="lios-phase1-eyebrow">DATA &amp; METRICS</div>
              <h3>Build a view from evidence</h3>
            </div>
            <span className="lios-phase2-explore-result-count">{filteredResults.length} MATCHES</span>
          </div>
          <div className="lios-phase2-explore-tabs" role="tablist" aria-label="Explore field categories">
            {CATEGORIES.map((item) => <button key={item.id} type="button" role="tab" aria-selected={category === item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}
          </div>
          {filteredResults.length === 0 ? (
            <FusionStateBlock state="empty" detail="Try a broader search or choose another field category.">
              NO MATCHING FIELDS
            </FusionStateBlock>
          ) : (
            <div className="lios-phase2-explore-result-list">
              {filteredResults.map((field, index) => {
                const selected = selectedFieldIds.includes(field.id);
                return (
                  <button
                    key={field.id}
                    id={`explore-field-${field.id.replaceAll(".", "-")}`}
                    type="button"
                    className="lios-phase2-explore-result"
                    data-selected={selected ? "true" : undefined}
                    data-active={activeResult === index ? "true" : undefined}
                    onMouseEnter={() => setActiveResult(index)}
                    onClick={() => onToggleMetric(field.id)}
                    aria-pressed={selected}
                  >
                    <span className="lios-phase2-explore-result-icon" aria-hidden="true">{selected ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}</span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="flex items-center gap-2">
                        <strong>{field.label}</strong>
                        <small>{fieldKindLabel(field)}</small>
                      </span>
                      <span className="mt-1 block truncate font-terminal text-[7px] text-muted-foreground">{isClient ? fieldTypeLabel(field) : `${field.id} · ${fieldTypeLabel(field)}`}</span>
                    </span>
                    <span className="lios-phase2-explore-result-family">{field.family ?? "GENERAL"}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="lios-phase2-explore-keyline"><span><kbd>↑</kbd><kbd>↓</kbd> NAVIGATE</span><span><kbd>ENTER</kbd> SELECT</span><span><kbd>⌘</kbd><kbd>K</kbd> FOCUS</span></div>
        </FusionPanel>

        <aside className="lios-phase2-explore-aside">
          <FusionPanel className="lios-phase2-explore-selection">
            <div className="lios-phase2-explore-section-head">
              <div><div className="lios-phase1-eyebrow">ACTIVE WORKSPACE</div><h3>{activeSymbol ? activeSymbol.toUpperCase() : "NO SYMBOL"}</h3></div>
              <Sparkles className="h-4 w-4 text-amber-300" aria-hidden="true" />
            </div>
            <p className="lios-phase2-explore-panel-copy">{activeSymbol ? "Selected fields stay attached to this symbol as you move into analysis." : "Open a company or security first to send selected series into a chart."}</p>
            <div className="lios-phase2-explore-chip-list">
              {selectedLabels.length ? selectedLabels.map((label) => <FusionStatusBadge key={label} tone="accent">{label}</FusionStatusBadge>) : <span className="font-terminal text-[7px] text-muted-foreground">SELECT A FIELD TO BEGIN</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <FusionActionButton variant="accent" onClick={onOpenChart} disabled={!activeSymbol || selectedQuantCount === 0}><BarChart3 className="mr-1 inline h-3 w-3" />OPEN CHART <span className="ml-1 opacity-65">{selectedQuantCount || 0}</span></FusionActionButton>
              {!isClient && <FusionActionButton onClick={() => onOpen("quantlab", "current")}><ArrowRight className="mr-1 inline h-3 w-3" />QUANT LAB</FusionActionButton>}
            </div>
          </FusionPanel>

          <FusionPanel className="lios-phase2-explore-quick">
            <div className="lios-phase2-explore-section-head"><div><div className="lios-phase1-eyebrow">NEXT ACTIONS</div><h3>Move from discovery</h3></div><Clock3 className="h-4 w-4 text-cyan-300" aria-hidden="true" /></div>
            <div className="lios-phase2-explore-quick-list">
              {QUICK_ACTIONS.map((action) => { const Icon = action.icon; const disabled = !activeSymbol; return <button key={action.view} type="button" disabled={disabled} onClick={() => onOpen(action.view, "current", activeSymbol)} className="lios-phase2-explore-quick-action" data-tone={action.tone}><span className="lios-phase2-explore-quick-icon"><Icon className="h-3.5 w-3.5" /></span><span><strong>{action.label}</strong><small>{disabled ? "Choose a symbol to continue" : action.detail}</small></span><ArrowRight className="ml-auto h-3 w-3" /></button>; })}
            </div>
          </FusionPanel>
        </aside>
      </div>
    </section>
  );
}
