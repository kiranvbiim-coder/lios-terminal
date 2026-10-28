import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Activity, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useGatewayState } from "@/lib/gateway/GatewayProvider";
import {
  runtimeDoctorSnapshotSchema, summarizeRuntimeDoctor, visibleRuntimeDoctorRecords, type RuntimeDoctorSnapshot,
} from "@/lib/phase4RuntimeDoctor";

/**
 * Live read-only inspection of the existing internal P0 health route.
 * No provision/repair side effects. Client/tenant 403 is not a runtime failure.
 */
export function SystemDoctorDesk() {
  const gatewayState = useGatewayState();
  const [snapshot, setSnapshot] = useState<RuntimeDoctorSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  const summary = summarizeRuntimeDoctor(snapshot);
  const shown = visibleRuntimeDoctorRecords(summary.records, search, attentionOnly);

  const inspect = async () => {
    if (busy) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setSnapshot(null);
    setNotice(null);
    try {
      const response = await fetch("/api/runtime/foundation/health", {
        credentials: "same-origin", cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403
          ? "Internal runtime diagnostics are not available for this account. Use your existing Home/Connections settings."
          : "Live runtime health could not be read. Do not assume a healthy or failed runtime.");
      }
      const raw: unknown = await response.json();
      const parsed = runtimeDoctorSnapshotSchema.safeParse(raw);
      if (!parsed.success) throw new Error("Runtime health returned an unsupported record format.");
      if (!controller.signal.aborted) setSnapshot(parsed.data);
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Runtime health is unavailable.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return <section aria-label="LiOS System Doctor" data-testid="lios-system-doctor" className="space-y-3 rounded-xl border border-border/60 bg-white/[0.015] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h3 className="inline-flex items-center gap-2 font-ui text-base font-semibold text-foreground"><Activity aria-hidden="true" className="h-4 w-4 text-amber-200"/>System Doctor</h3>
      <button type="button" disabled={busy} onClick={() => void inspect()}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border/70 px-3 py-2 font-ui text-sm text-foreground hover:border-amber-300/30 focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:opacity-45">
        <RefreshCw aria-hidden="true" className={"h-4 w-4" + (busy ? " animate-spin" : "")}/>
        {busy ? "Inspecting…" : "Inspect runtime"}
      </button>
    </div>
    <p className="font-ui text-sm leading-6 text-muted-foreground">
      Read-only status for registered components. A registered capability is not necessarily connected, installed or running. Nothing is repaired or executed here.
    </p>
    <div className="flex flex-wrap gap-2 font-ui text-sm" aria-label="Local connectivity observation">
      <span className="rounded-lg border border-border/55 px-3 py-2">Home Gateway: <strong className="text-foreground">{gatewayState}</strong></span>
      <span className="rounded-lg border border-border/55 px-3 py-2">Native installation: <strong className="text-foreground">Not verified here</strong></span>
    </div>
    {notice && <p role="alert" className="rounded-lg border border-amber-300/25 p-3 font-ui text-sm text-amber-100">{notice}</p>}
    {!snapshot && !busy && !notice && <p role="status" className="font-ui text-sm text-muted-foreground">Runtime probes have not been requested in this view.</p>}
    {snapshot && <div className="space-y-3">
      <p role="status" className="font-ui text-sm text-foreground">{summary.checked} registered health reports · {summary.available} available · {summary.impaired} needing attention · {summary.unverified} configurable/not verified</p>
      {summary.checked === 0 && <p className="font-ui text-sm text-muted-foreground">The runtime registry returned no probes. This is not a readiness certificate.</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[180px] flex-1 font-ui text-sm font-medium text-foreground">
          Find a registered component
          <input type="search" value={search} maxLength={120} autoComplete="off"
            onChange={event => setSearch(event.target.value)}
            placeholder="Search component ID or observed state"
            className="mt-2 min-h-11 w-full rounded-lg border border-border/60 bg-background px-3 py-2 font-ui text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"/>
        </label>
        <label className="inline-flex min-h-11 items-center gap-2 font-ui text-sm text-foreground">
          <input type="checkbox" checked={attentionOnly} onChange={event => setAttentionOnly(event.target.checked)}
            className="h-4 w-4 accent-amber-300"/> Needs attention only
        </label>
      </div>
      <p className="font-ui text-xs text-muted-foreground" role="status">
        Showing {Math.min(100, shown.length)} of {shown.length} matching reports, from {summary.checked} returned registry entries. Search changes only this list, not actual health.
      </p>
      {shown.length === 0 && <p className="rounded-lg border border-dashed border-border/60 p-3 font-ui text-sm text-muted-foreground" role="status">
        No observed runtime records match these filters. Clear search or disable “Needs attention only”; no component has been repaired or declared healthy.
      </p>}
      <div className="max-h-72 overflow-auto rounded-lg border border-border/55" aria-label="Individual registered runtime statuses">
        <ul className="divide-y divide-border/45">
          {shown.slice(0, 100).map(record => <li key={record.componentId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 font-ui text-sm">
            <span className="min-w-0 break-all text-foreground">{record.componentId}</span>
            <span className="shrink-0 text-xs capitalize text-muted-foreground">{record.state.replaceAll("_", " ")}</span>
          </li>)}
        </ul>
      </div>
      {shown.length > 100 && <p className="font-ui text-xs text-muted-foreground">Showing the first 100 matches. Narrow the search to find a specific component; no silent full-readiness claim.</p>}
      {summary.impaired > 0 ? <p className="inline-flex items-start gap-2 font-ui text-sm text-amber-200"><TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0"/>Inspect affected providers and governed repair prerequisites before attempting any fix.</p>
        : <p className="inline-flex items-start gap-2 font-ui text-sm text-muted-foreground"><ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0"/>No affected state returned by these probes; this does not establish packaged runtime, model readiness or release acceptance.</p>}
    </div>}
  </section>;
}
