import { useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAlerts, alertsUrlFor } from "@/lib/useAlerts";
import { BellRing, Plus, Trash2, Bell, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Alert } from "@shared/schema";
import { useAudience } from "@/lib/audience";

interface Props { onSymbol: (sym: string) => void; role?: string }

// See useAlerts.ts: internal alerts are personal (/api/alerts); the client
// build shares one alert list per org (/api/client/dashboard/alerts,
// client_admin-only writes) -- canEdit hides the create/delete UI for a
// client_user rather than letting them click controls that 403.

type AlertMetric = "price" | "trailingPE" | "forwardPE" | "priceToBook" | "beta" | "debtToEquity" | "returnOnEquity" | "dividendYield";
type AlertDirection = "above" | "below";

const ALERT_METRIC_OPTIONS: Array<{ value: AlertMetric; label: string; unit: string }> = [
  { value: "price", label: "PRICE", unit: "$" },
  { value: "trailingPE", label: "TRAILING P/E", unit: "x" },
  { value: "forwardPE", label: "FORWARD P/E", unit: "x" },
  { value: "priceToBook", label: "PRICE/BOOK", unit: "x" },
  { value: "beta", label: "BETA", unit: "" },
  { value: "debtToEquity", label: "DEBT/EQUITY", unit: "x" },
  { value: "returnOnEquity", label: "ROE", unit: "%" },
  { value: "dividendYield", label: "DIV YIELD", unit: "%" },
];

function parseCondition(condition: string): { metric: AlertMetric; direction: AlertDirection } {
  if (condition === "above" || condition === "below") return { metric: "price", direction: condition };
  const [metric, direction] = condition.split(":") as [AlertMetric, AlertDirection];
  return { metric, direction };
}

function alertMetricLabel(condition: string) {
  const parsed = parseCondition(condition);
  return ALERT_METRIC_OPTIONS.find((option) => option.value === parsed.metric)?.label ?? "PRICE";
}

function alertDirectionLabel(condition: string) {
  return parseCondition(condition).direction === "above" ? "ABOVE" : "BELOW";
}

function formatAlertThreshold(condition: string, value: number) {
  const metric = parseCondition(condition).metric;
  if (metric === "price") return `$${value.toFixed(2)}`;
  if (metric === "returnOnEquity" || metric === "dividendYield") return `${(value * 100).toFixed(2)}%`;
  return value.toFixed(2);
}

export default function AlertsPanel({ onSymbol, role }: Props) {
  const audience = useAudience();
  const isClient = audience === "client";
  const ALERTS_URL = alertsUrlFor(audience);
  const [sym, setSym] = useTerminalArtifactState("AlertsPanel.sym", "");
  const [condition, setCondition] = useTerminalArtifactState<"above" | "below">("AlertsPanel.condition", "above");
  const [metric, setMetric] = useTerminalArtifactState<AlertMetric>("AlertsPanel.metric", "price");
  const [price, setPrice] = useTerminalArtifactState("AlertsPanel.price", "");
  const [toastAlerts, setToastAlerts] = useState<Alert[]>([]);
  const prevTriggeredIds = useRef<Set<number>>(new Set());
  const qc = useQueryClient();
  const canEdit = !isClient || role === "client_admin";

  const { data: alerts = [], isLoading } = useAlerts();

  // Detect newly triggered alerts and show toast
  useEffect(() => {
    const nowTriggered = alerts.filter((a) => a.triggered);
    const newOnes = nowTriggered.filter((a) => !prevTriggeredIds.current.has(a.id));
    if (newOnes.length > 0) {
      setToastAlerts((prev) => [...prev, ...newOnes]);
      newOnes.forEach((a) => prevTriggeredIds.current.add(a.id));
      // Auto-dismiss after 8s
      setTimeout(() => {
        setToastAlerts((prev) => prev.filter((t) => !newOnes.find((n) => n.id === t.id)));
      }, 8000);
    }
    // Update known triggered set
    nowTriggered.forEach((a) => prevTriggeredIds.current.add(a.id));
  }, [alerts]);

  const addMut = useMutation({
    mutationFn: async (data: { symbol: string; condition: string; price: number }) => {
      await apiRequest("POST", ALERTS_URL, data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [ALERTS_URL] }); setSym(""); setPrice(""); }
  });

  const delMut = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `${ALERTS_URL}/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [ALERTS_URL] }),
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sym.trim() || !price) return;
    const rawThreshold = parseFloat(price);
    const threshold = metric === "returnOnEquity" || metric === "dividendYield" ? rawThreshold / 100 : rawThreshold;
    addMut.mutate({ symbol: sym.trim().toUpperCase(), condition: metric === "price" ? condition : `${metric}:${condition}`, price: threshold });
  };

  const active = alerts.filter(a => !a.triggered);
  const triggered = alerts.filter(a => a.triggered);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      {/* Toast notification area */}
      {toastAlerts.length > 0 && (
        <div className="absolute top-16 right-4 z-50 flex flex-col gap-2 pointer-events-none">
          {toastAlerts.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 px-4 py-3 bg-[#0a0800] border border-[hsl(38,95%,50%)] shadow-lg shadow-[hsl(38,95%,50%)/20%] font-terminal animate-pulse"
              style={{ animation: "pulse 1s ease-in-out 3" }}
            >
              <BellRing className="w-4 h-4 text-[hsl(38,95%,55%)]" />
              <div>
                <div className="text-[10px] font-bold text-[hsl(38,95%,55%)]">ALERT TRIGGERED</div>
                <div className="text-[9px] text-foreground">
                  {t.symbol} {alertMetricLabel(t.condition)} {alertDirectionLabel(t.condition)} {formatAlertThreshold(t.condition, t.price)}
                </div>
              </div>
              <button
                className="ml-2 text-muted-foreground hover:text-foreground pointer-events-auto"
                onClick={() => setToastAlerts((prev) => prev.filter((x) => x.id !== t.id))}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <BellRing className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">MARKET / FUNDAMENTAL ALERTS</span>
        <span className="font-terminal text-[9px] text-[hsl(142,71%,45%)] ml-2">{active.length} ACTIVE</span>
        {triggered.length > 0 && (
          <span className="font-terminal text-[9px] text-[hsl(38,95%,55%)] ml-1">{triggered.length} TRIGGERED</span>
        )}
      </div>
      {/* Create alert form -- hidden for a client_user, who is read-only on
          the shared org alert list (writes are client_admin-only server-side). */}
      {canEdit && (
        <form onSubmit={handleAdd} className="flex items-center gap-2 px-4 py-3 border-b border-border bg-[#070707] shrink-0">
          <span className="font-terminal text-[9px] text-muted-foreground shrink-0">WHEN</span>
          <input
            value={sym}
            onChange={e => setSym(e.target.value.toUpperCase())}
            placeholder="TICKER"
            className="w-20 bg-[#0d0d0d] border border-border px-2 py-1.5 font-terminal text-[10px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%]"
            data-testid="alert-sym-input"
          />
          <select
            value={metric}
            onChange={e => setMetric(e.target.value as AlertMetric)}
            className="bg-[#0d0d0d] border border-border px-2 py-1.5 font-terminal text-[10px] focus:outline-none"
          >
            {ALERT_METRIC_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select
            value={condition}
            onChange={e => setCondition(e.target.value as "above" | "below")}
            className="bg-[#0d0d0d] border border-border px-2 py-1.5 font-terminal text-[10px] focus:outline-none"
          >
            <option value="above">CROSSES ABOVE</option>
            <option value="below">DROPS BELOW</option>
          </select>
          <span className="font-terminal text-[9px] text-muted-foreground">{ALERT_METRIC_OPTIONS.find((option) => option.value === metric)?.unit}</span>
          <input
            type="number"
            value={price}
            onChange={e => setPrice(e.target.value)}
            placeholder="0.00"
            step="0.01"
            className="w-24 bg-[#0d0d0d] border border-border px-2 py-1.5 font-terminal text-[10px] focus:outline-none focus:border-[hsl(38,95%,50%)/50%]"
            data-testid="alert-price-input"
          />
          <button
            type="submit"
            disabled={!sym.trim() || !price || addMut.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[hsl(38,95%,50%)/15%] border border-[hsl(38,95%,50%)/40%] font-terminal text-[10px] text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)/25%] disabled:opacity-40 transition-colors"
            data-testid="alert-add-btn"
          >
            <Plus className="w-3 h-3" /> CREATE ALERT
          </button>
        </form>
      )}

      {/* Active alerts */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isLoading ? (
          Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-12 mx-4 my-2 bg-border" />)
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <Bell className="w-8 h-8 text-muted-foreground/30" />
            <span className="font-terminal text-xs text-muted-foreground">NO ALERTS SET</span>
          </div>
        ) : (
          <>
            {active.length > 0 && (
              <div>
                <div className="px-4 py-2 font-terminal text-[9px] tracking-widest text-[hsl(142,71%,45%)] border-b border-border bg-[#0a0a0a]">
                  ACTIVE ALERTS
                </div>
                {active.map(a => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 hover:bg-white/5 group" data-testid={`alert-${a.id}`}>
                    <div className="w-2 h-2 rounded-full bg-[hsl(142,71%,45%)] animate-pulse shrink-0" />
                    <button onClick={() => onSymbol(a.symbol)} className="font-terminal text-[11px] font-bold text-[hsl(38,95%,55%)] hover:underline">
                      {a.symbol}
                    </button>
                    <span className={`font-terminal text-[10px] ${parseCondition(a.condition).direction === "above" ? "text-up" : "text-down"}`}>
                      {alertMetricLabel(a.condition)} {parseCondition(a.condition).direction === "above" ? "ABOVE" : "BELOW"}
                    </span>
                    <span className="font-terminal text-[11px] tabular-nums font-semibold">{formatAlertThreshold(a.condition, a.price)}</span>
                    <span className="font-terminal text-[8px] text-muted-foreground ml-2">SET {new Date(a.createdAt).toLocaleDateString()}</span>
                    {canEdit && (
                      <button
                        onClick={() => delMut.mutate(a.id)}
                        className="ml-auto opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-[hsl(0,80%,60%)] transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {triggered.length > 0 && (
              <div>
                <div className="px-4 py-2 font-terminal text-[9px] tracking-widest text-[hsl(38,95%,55%)] border-b border-border bg-[#0a0a0a]">
                  TRIGGERED
                </div>
                {triggered.map(a => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 opacity-60 group hover:opacity-80">
                    <div className="w-2 h-2 rounded-full border border-muted-foreground shrink-0" />
                    <span className="font-terminal text-[11px] font-bold text-muted-foreground">{a.symbol}</span>
                    <span className="font-terminal text-[10px] text-muted-foreground">{alertMetricLabel(a.condition)} {alertDirectionLabel(a.condition)} {formatAlertThreshold(a.condition, a.price)}</span>
                    {a.triggerPrice !== null && (
                      <span className="font-terminal text-[10px] text-[hsl(38,95%,55%)]">LAST {formatAlertThreshold(a.condition, a.triggerPrice)}</span>
                    )}
                    <span className="font-terminal text-[9px] text-[hsl(38,95%,55%)] ml-2">
                      {a.triggeredAt ? `TRIGGERED ${new Date(a.triggeredAt).toLocaleString()}` : "TRIGGERED"}
                    </span>
                    {canEdit && (
                      <button onClick={() => delMut.mutate(a.id)} className="ml-auto opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-[hsl(0,80%,60%)] transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
