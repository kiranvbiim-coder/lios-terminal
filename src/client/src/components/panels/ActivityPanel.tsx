import { useState, useEffect } from "react";
import {
  FileCheck, FilePlus, Calendar, CalendarCheck, Coins, FileQuestion, CheckCircle2, XCircle, History, ShieldCheck,
} from "lucide-react";

/**
 * Activity Timeline + Audit Trail. Uses the existing
 * /api/client/dashboard/activity and /api/client/dashboard/audit-log routes.
 * Audit Trail is client_admin-only server-side (requireRole), so
 * its tab is hidden rather than shown-and-403ing for a client_user --
 * same pattern as canEdit in WatchlistPanel/AlertsPanel, just gating a
 * whole tab instead of a form.
 */

interface ActivityEvent {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  timestamp: string;
}
interface AuditLogEntry {
  id: number;
  eventType: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  userName: string | null;
  userEmail: string | null;
}

const TYPE_ICON: Record<string, typeof FileCheck> = {
  deliverable_delivered: FileCheck,
  deliverable_created: FilePlus,
  meeting_scheduled: Calendar,
  meeting_completed: CalendarCheck,
  meeting_cancelled: Calendar,
  credit_grant: Coins,
  credit_debit: Coins,
  credit_adjustment: Coins,
  credit_refund: Coins,
  quote_proposed: FileQuestion,
  quote_accepted: CheckCircle2,
  quote_declined: XCircle,
};

const AUDIT_EVENT_LABEL: Record<string, string> = {
  login: "Signed in",
  logout: "Signed out",
  watchlist_add: "Added to watchlist",
  watchlist_remove: "Removed from watchlist",
  alert_add: "Created price alert",
  alert_remove: "Removed price alert",
  quote_accepted: "Accepted quote",
  quote_declined: "Declined quote",
  csv_export: "Exported holdings CSV",
};

function fmtRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtAuditDetails(eventType: string, details: Record<string, unknown> | null): string {
  if (!details) return "";
  if (eventType === "watchlist_add" || eventType === "watchlist_remove" || eventType === "alert_remove") return String(details.symbol ?? "");
  if (eventType === "alert_add") return `${details.symbol} ${details.condition} $${details.price}`;
  if (eventType === "csv_export") return String(details.portfolioName ?? "");
  if (eventType === "quote_accepted" || eventType === "quote_declined") return details.amount ? `$${details.amount}` : "";
  return "";
}

function TimelineTab() {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  useEffect(() => {
    fetch("/api/client/dashboard/activity").then((r) => (r.ok ? r.json() : [])).then(setEvents).catch(() => setEvents([]));
  }, []);

  if (events === null) return <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">Loading activity...</div>;
  if (events.length === 0) return <div className="p-8 text-center text-sm text-muted-foreground border border-dashed border-border">Nothing has happened on your engagement yet.</div>;

  return (
    <div className="bg-[#0d0d0d] border border-border">
      {events.map((e, idx) => {
        const Icon = TYPE_ICON[e.type] ?? FileQuestion;
        return (
          <div key={e.id} className={`flex items-start gap-3 px-4 py-2.5 ${idx !== events.length - 1 ? "border-b border-border/60" : ""}`}>
            <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[hsl(38,95%,55%)]" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-foreground">{e.title}</div>
              {e.detail && <div className="text-[10px] text-muted-foreground mt-0.5">{e.detail}</div>}
            </div>
            <span className="font-terminal text-[9px] text-muted-foreground shrink-0 tabular-nums">{fmtRelative(e.timestamp)}</span>
          </div>
        );
      })}
    </div>
  );
}

function AuditTrailTab() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  useEffect(() => {
    fetch("/api/client/dashboard/audit-log").then((r) => (r.ok ? r.json() : [])).then(setEntries).catch(() => setEntries([]));
  }, []);

  if (entries === null) return <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">Loading audit trail...</div>;
  if (entries.length === 0) return <div className="p-8 text-center text-sm text-muted-foreground border border-dashed border-border">No account activity recorded yet.</div>;

  return (
    <div>
      <p className="text-[10px] text-muted-foreground mb-2 px-1">Who on your team did what, and when.</p>
      <div className="bg-[#0d0d0d] border border-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="font-terminal text-[9px] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="text-left px-4 py-2 font-medium">User</th>
              <th className="text-left px-4 py-2 font-medium">Action</th>
              <th className="text-left px-4 py-2 font-medium">Details</th>
              <th className="text-right px-4 py-2 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-2.5 text-foreground whitespace-nowrap">{e.userName ?? "Unknown"}</td>
                <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{AUDIT_EVENT_LABEL[e.eventType] ?? e.eventType}</td>
                <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[220px]">{fmtAuditDetails(e.eventType, e.details)}</td>
                <td className="px-4 py-2.5 text-right font-terminal text-[10px] text-muted-foreground whitespace-nowrap tabular-nums">{fmtDateTime(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ActivityPanel({ role }: { role?: string }) {
  const canSeeAudit = role === "client_admin";
  const [tab, setTab] = useState<"timeline" | "audit">("timeline");

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-[hsl(38,95%,55%)]" />
          <span className="panel-label">ACTIVITY</span>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <button onClick={() => setTab("timeline")}
          className={`font-terminal px-3 py-1.5 border text-[10px] uppercase tracking-wider transition-colors ${tab === "timeline" ? "bg-[hsl(38,95%,50%)/15%] text-[hsl(38,95%,55%)] border-[hsl(38,95%,50%)/40%]" : "text-muted-foreground border-border hover:text-foreground"}`}>
          Timeline
        </button>
        {canSeeAudit && (
          <button onClick={() => setTab("audit")}
            className={`font-terminal px-3 py-1.5 border text-[10px] uppercase tracking-wider transition-colors flex items-center gap-1.5 ${tab === "audit" ? "bg-[hsl(38,95%,50%)/15%] text-[hsl(38,95%,55%)] border-[hsl(38,95%,50%)/40%]" : "text-muted-foreground border-border hover:text-foreground"}`}>
            <ShieldCheck className="w-3 h-3" /> Audit Trail
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
        {tab === "timeline" || !canSeeAudit ? <TimelineTab /> : <AuditTrailTab />}
      </div>
    </div>
  );
}
