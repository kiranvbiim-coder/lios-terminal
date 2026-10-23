import { useTerminalArtifactContext, useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useQuotes } from "@/lib/useFinance";
import { formatPrice, formatBig, pctClass, getCurrencySymbol } from "@/lib/finance";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Trash2, Star, SlidersHorizontal } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { WatchlistItem } from "@shared/schema";
import { useAudience } from "@/lib/audience";

interface Props {
  activeSymbol?: string;
  onSymbol: (sym: string) => void;
  role?: string;
}

type WatchlistColumn = "symbol" | "name" | "price" | "change" | "marketCap" | "volume";
type WatchlistPreset = "compact" | "trading" | "fundamentals" | "full" | "custom";

const ALL_COLUMNS: WatchlistColumn[] = ["symbol", "name", "price", "change", "marketCap", "volume"];
const VISIBLE_PRESETS = ["compact", "trading", "fundamentals", "full"] as const;
const PRESET_COLUMNS: Record<Exclude<WatchlistPreset, "custom">, WatchlistColumn[]> = {
  compact: ["symbol", "price", "change"],
  trading: ["symbol", "name", "price", "change", "volume"],
  fundamentals: ["symbol", "name", "price", "change", "marketCap"],
  full: ALL_COLUMNS,
};
const COLUMN_LABEL: Record<WatchlistColumn, string> = {
  symbol: "TICKER",
  name: "NAME",
  price: "PRICE",
  change: "CHG%",
  marketCap: "MKTCAP",
  volume: "VOLUME",
};
const COLUMN_WIDTH: Record<WatchlistColumn, string> = {
  symbol: "minmax(82px,1.05fr)",
  name: "minmax(150px,2.2fr)",
  price: "minmax(92px,1fr)",
  change: "minmax(88px,1fr)",
  marketCap: "minmax(102px,1.2fr)",
  volume: "minmax(92px,1fr)",
};
const PRESET_STORAGE_KEY = "lios-watchlist-grid-preset-v1";
const CUSTOM_COLUMNS_STORAGE_KEY = "lios-watchlist-grid-columns-v1";

function loadPreset(): WatchlistPreset {
  if (typeof window === "undefined") return "trading";
  const value = window.localStorage.getItem(PRESET_STORAGE_KEY);
  return value === "compact" || value === "trading" || value === "fundamentals" || value === "full" || value === "custom"
    ? value
    : "trading";
}

function loadCustomColumns(): WatchlistColumn[] {
  if (typeof window === "undefined") return [...ALL_COLUMNS];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CUSTOM_COLUMNS_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [...ALL_COLUMNS];
    const valid = ALL_COLUMNS.filter((column) => parsed.includes(column));
    return valid.includes("symbol") ? valid : ["symbol", ...valid];
  } catch {
    return [...ALL_COLUMNS];
  }
}

// Internal watchlists are personal to each analyst (/api/watchlist, keyed
// off req.user.id); the client build shares one watchlist per org instead
// (/api/client/dashboard/watchlist, requireFullClient) -- writes there are
// client_admin-only server-side, so canEdit below hides the add/remove UI
// for a client_user rather than letting them click controls that 403.

export default function WatchlistPanel({ activeSymbol, onSymbol, role }: Props) {
  const terminal = useTerminalArtifactContext();
  const isClient = useAudience() === "client";
  const WATCHLIST_URL = isClient ? "/api/client/dashboard/watchlist" : "/api/watchlist";
  const [addSym, setAddSym] = useTerminalArtifactState("WatchlistPanel.addSym", "");
  const [addName, setAddName] = useTerminalArtifactState("WatchlistPanel.addName", "");
  const [preset, setPreset] = useTerminalArtifactState<WatchlistPreset>("WatchlistPanel.preset", () => terminal ? "trading" : loadPreset());
  const [customColumns, setCustomColumns] = useTerminalArtifactState<WatchlistColumn[]>("WatchlistPanel.customColumns", () => terminal ? [...ALL_COLUMNS] : loadCustomColumns());
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const qc = useQueryClient();
  const canEdit = !isClient || role === "client_admin";

  const { data: watchlist = [], isLoading: wLoad } = useQuery<WatchlistItem[]>({
    queryKey: [WATCHLIST_URL],
    queryFn: async () => {
      const res = await fetch(WATCHLIST_URL);
      return res.json();
    },
  });

  const symbols = watchlist.map(w => w.symbol);
  const { data: quotes } = useQuotes(symbols);

  const addMut = useMutation({
    mutationFn: async ({ symbol, name }: { symbol: string; name: string }) => {
      await apiRequest("POST", WATCHLIST_URL, { symbol, name });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [WATCHLIST_URL] }); setAddSym(""); setAddName(""); },
  });

  const removeMut = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `${WATCHLIST_URL}/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [WATCHLIST_URL] }),
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = addSym.trim().toUpperCase();
    if (!sym) return;
    addMut.mutate({ symbol: sym, name: addName.trim() || sym });
  };

  const quoteMap = new Map((quotes || []).map((q: any) => [q.symbol, q]));
  const visibleColumns = preset === "custom" ? customColumns : PRESET_COLUMNS[preset];
  const gridTemplateColumns = useMemo(
    () => `${visibleColumns.map((column) => COLUMN_WIDTH[column]).join(" ")}${canEdit ? " 30px" : ""}`,
    [canEdit, visibleColumns],
  );
  const minGridWidth = visibleColumns.length <= 3 ? 390 : visibleColumns.length <= 5 ? 680 : 820;

  const selectPreset = (next: Exclude<WatchlistPreset, "custom">) => {
    setPreset(next);
    setCustomizeOpen(false);
    if (!terminal && typeof window !== "undefined") window.localStorage.setItem(PRESET_STORAGE_KEY, next);
  };

  const toggleCustomColumn = (column: WatchlistColumn) => {
    if (column === "symbol") return;
    const next = customColumns.includes(column)
      ? customColumns.filter((item) => item !== column)
      : ALL_COLUMNS.filter((item) => item === "symbol" || customColumns.includes(item) || item === column);
    setCustomColumns(next);
    setPreset("custom");
    if (!terminal && typeof window !== "undefined") {
      window.localStorage.setItem(CUSTOM_COLUMNS_STORAGE_KEY, JSON.stringify(next));
      window.localStorage.setItem(PRESET_STORAGE_KEY, "custom");
    }
  };

  const renderPresetControls = () => (
    <>
      {VISIBLE_PRESETS.map((item) => (
        <button key={item} type="button" className="lios-grid-preset" data-active={preset === item} onClick={() => selectPreset(item)}>
          {item}
        </button>
      ))}
      <button
        type="button"
        className="lios-grid-preset"
        data-active={customizeOpen || preset === "custom"}
        aria-expanded={customizeOpen}
        onClick={() => setCustomizeOpen((open) => !open)}
      >
        COLUMNS
      </button>
    </>
  );

  const renderCell = (column: WatchlistColumn, w: WatchlistItem, q: any) => {
    if (column === "symbol") return <span key={column} className="font-terminal text-[11px] font-bold text-[hsl(38,95%,55%)]">{w.symbol}</span>;
    if (column === "name") return <span key={column} className="truncate font-terminal text-[10px] text-muted-foreground">{q?.name || w.name}</span>;
    if (column === "price") return <span key={column} className="text-right font-terminal text-[11px] tabular-nums">{q ? `${getCurrencySymbol(q.symbol)}${formatPrice(q.price)}` : "—"}</span>;
    if (column === "change") {
      return (
        <span key={column} className={`text-right font-terminal text-[11px] tabular-nums font-semibold ${q ? pctClass(q.changePercent) : "text-muted-foreground"}`}>
          {q ? `${q.changePercent >= 0 ? "▲" : "▼"}${Math.abs(q.changePercent).toFixed(2)}%` : "—"}
        </span>
      );
    }
    if (column === "marketCap") return <span key={column} className="text-right font-terminal text-[10px] tabular-nums text-muted-foreground">{q ? formatBig(q.marketCap, q.symbol) : "—"}</span>;
    return <span key={column} className="text-right font-terminal text-[10px] tabular-nums text-muted-foreground">{q?.volume !== undefined ? `${(q.volume / 1e6).toFixed(1)}M` : "—"}</span>;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <Star className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">WATCHLIST</span>
        <span className="font-terminal text-[9px] text-muted-foreground ml-2">{watchlist.length} SYMBOLS</span>
        <div className="ml-auto hidden items-center gap-1 sm:flex" aria-label="Watchlist view preset">
          <SlidersHorizontal className="mr-1 h-3 w-3 text-muted-foreground" />
          {renderPresetControls()}
        </div>
      </div>

      {canEdit && (
        <form onSubmit={handleAdd} className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0" data-workstation-toolbar>
          <span className="font-terminal text-[9px] text-muted-foreground shrink-0">ADD</span>
          <input
            value={addSym}
            onChange={e => setAddSym(e.target.value.toUpperCase())}
            placeholder="TICKER"
            className="w-20 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%]"
            data-testid="watchlist-sym-input"
          />
          <input
            value={addName}
            onChange={e => setAddName(e.target.value)}
            placeholder="NAME (optional)"
            className="flex-1 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%]"
          />
          <button
            type="submit"
            disabled={!addSym.trim() || addMut.isPending}
            className="flex items-center gap-1.5 px-3 py-1 bg-[hsl(38,95%,50%)/15%] border border-[hsl(38,95%,50%)/40%] font-terminal text-[10px] text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)/25%] disabled:opacity-40 transition-colors"
            data-testid="watchlist-add-btn"
          >
            <Plus className="w-3 h-3" /> ADD
          </button>
        </form>
      )}

      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-[#070707] px-4 py-1.5 scrollbar-thin sm:hidden" aria-label="Watchlist view preset">
        {renderPresetControls()}
      </div>

      {customizeOpen && (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border/60 bg-[#060606] px-4 py-1.5 scrollbar-thin" aria-label="Custom watchlist columns">
          <span className="shrink-0 font-terminal text-[7px] tracking-widest text-muted-foreground">CUSTOM COLUMNS</span>
          {ALL_COLUMNS.map((column) => (
            <button
              key={column}
              type="button"
              disabled={column === "symbol"}
              onClick={() => toggleCustomColumn(column)}
              className="lios-grid-preset"
              data-active={preset === "custom" && customColumns.includes(column)}
              aria-pressed={preset === "custom" && customColumns.includes(column)}
            >
              {COLUMN_LABEL[column]}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <div style={{ minWidth: minGridWidth }}>
          <div className="lios-analytical-grid-header grid gap-px px-4 py-1.5 sticky top-0 z-10" style={{ gridTemplateColumns }}>
            {visibleColumns.map((column) => (
              <span key={column} className={`font-terminal text-[8px] tracking-wider text-muted-foreground ${column === "symbol" || column === "name" ? "text-left" : "text-right"}`}>
                {COLUMN_LABEL[column]}
              </span>
            ))}
            {canEdit && <span aria-hidden="true" />}
          </div>

          {wLoad ? (
            Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-9 mx-4 my-1 bg-border" />)
          ) : watchlist.map((w) => {
            const q = quoteMap.get(w.symbol) as any;
            const isActive = w.symbol === activeSymbol;
            return (
              <div
                key={w.id}
                className={`lios-analytical-grid-row grid gap-px px-4 py-2 border-b border-border/50 items-center cursor-pointer group ${isActive ? "bg-amber-500/10 border-l-2 border-l-[hsl(38,95%,55%)] font-semibold" : ""}`}
                style={{ gridTemplateColumns }}
                onClick={() => onSymbol(w.symbol)}
                data-testid={`watchlist-row-${w.symbol}`}
                data-analytical-row
                data-analytical-role="input"
              >
                {visibleColumns.map((column) => renderCell(column, w, q))}
                {canEdit && (
                  <button
                    onClick={e => { e.stopPropagation(); removeMut.mutate(w.id); }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-[hsl(0,80%,60%)] transition-all p-1"
                    data-testid={`watchlist-remove-${w.symbol}`}
                    aria-label={`Remove ${w.symbol} from watchlist`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
