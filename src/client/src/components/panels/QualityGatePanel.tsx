import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { ArrowRight, Undo2, Plus, ChevronDown, ChevronRight, History, ShieldCheck, Landmark } from "lucide-react";

/**
 * Quality Gate, formalized (Major Bet, Roadmap Rev.3 §10) -- "make the
 * deliverable/approval flow explicit: data validation -> calculation
 * validation -> assumption validation -> citation validation -> consultant
 * review -> senior review -> 'Approved for Client Delivery.'" Before this,
 * deliverableStatusEnum had four stages (draft/in_review/delivered/approved)
 * that no route or UI ever actually transitioned -- the table was empty in
 * every environment. See shared/schema.ts's DELIVERABLE_GATE_SEQUENCE (the
 * single source of truth for stage order, read by both this panel and
 * server/adminRoutes.ts's advance/reject routes) and its deliverableGateEvents
 * table (every transition logged with who and, for a reject, why).
 *
 * Internal only -- there is still no engagement/workstream management UI at
 * all ("thin CRUD" per adminRoutes.ts's own comment), so this panel includes
 * a minimal cascading create form rather than assuming deliverables already
 * exist to manage.
 */

const GATE_SEQUENCE = [
  "draft", "data_validation", "calculation_validation", "assumption_validation",
  "citation_validation", "consultant_review", "senior_review", "approved_for_delivery", "delivered",
] as const;

function stageLabel(status: string) {
  return status.replace(/_/g, " ");
}

interface DeliverableRow {
  id: number;
  title: string;
  description: string | null;
  status: string;
  workstreamId: number;
  workstreamTitle: string;
  engagementId: number;
  engagementTitle: string;
  organizationName: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  isDecisionRoom: boolean;
  decisionQuestion: string | null;
  dataUsed: string | null;
  modelUsed: string | null;
  keyAssumptions: string | null;
  keyRisks: string | null;
  scenarios: string | null;
  recommendation: string | null;
  decisionOwner: string | null;
}

// Decision Room (Major Bet, Roadmap Rev.3) -- "a premium Deliverable subtype
// for major decisions in one artifact," the same structure the roadmap's own
// AI-validator table calls a Decision Receipt (question -> data used -> model
// used -> assumptions -> risks -> scenarios -> recommendation -> decision
// owner), just filled in as real fields rather than left an idea.
const DECISION_ROOM_FIELDS: Array<{ key: keyof DeliverableRow; label: string }> = [
  { key: "decisionQuestion", label: "Decision Question" },
  { key: "dataUsed", label: "Data Used" },
  { key: "modelUsed", label: "Model Used" },
  { key: "keyAssumptions", label: "Key Assumptions" },
  { key: "keyRisks", label: "Key Risks" },
  { key: "scenarios", label: "Scenarios" },
  { key: "recommendation", label: "Recommendation" },
  { key: "decisionOwner", label: "Decision Owner" },
];

function DecisionRoomView({ deliverable }: { deliverable: DeliverableRow }) {
  const filled = DECISION_ROOM_FIELDS.filter((f) => deliverable[f.key]);
  if (filled.length === 0) return null;
  return (
    <div className="space-y-2 py-2">
      {filled.map((f) => (
        <div key={f.key}>
          <div className="font-terminal text-[8px] uppercase tracking-wider text-[hsl(38,95%,55%)]">{f.label}</div>
          <div className="text-xs text-foreground whitespace-pre-wrap mt-0.5">{deliverable[f.key] as string}</div>
        </div>
      ))}
    </div>
  );
}

interface GateEvent {
  id: number;
  action: "advance" | "reject";
  fromStatus: string;
  toStatus: string;
  notes: string | null;
  createdAt: string;
  performedByName: string;
}

interface EngagementOption { id: number; title: string; organizationName: string }
interface WorkstreamOption { id: number; title: string }

function GateProgress({ status }: { status: string }) {
  const idx = GATE_SEQUENCE.indexOf(status as (typeof GATE_SEQUENCE)[number]);
  return (
    <div className="flex items-center gap-1">
      {GATE_SEQUENCE.map((s, i) => (
        <div
          key={s}
          title={stageLabel(s)}
          className={`w-2.5 h-2.5 rounded-full ${
            i < idx ? "bg-up" : i === idx ? "bg-[hsl(38,95%,55%)]" : "bg-border"
          }`}
        />
      ))}
    </div>
  );
}

function GateLogList({ deliverableId }: { deliverableId: number }) {
  const { data: log = [] } = useQuery<GateEvent[]>({
    queryKey: [`/api/admin/deliverables/${deliverableId}/gate-log`],
    queryFn: async () => (await fetch(`/api/admin/deliverables/${deliverableId}/gate-log`)).json(),
  });

  if (log.length === 0) return <p className="font-terminal text-[9px] text-muted-foreground py-2">No gate activity yet.</p>;

  return (
    <div className="space-y-1.5 py-2">
      {log.map((e) => (
        <div key={e.id} className="flex items-start gap-2 font-terminal text-[9px]">
          {e.action === "advance" ? <ArrowRight className="w-3 h-3 text-up shrink-0 mt-0.5" /> : <Undo2 className="w-3 h-3 text-down shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <span className="text-foreground">{stageLabel(e.fromStatus)} → {stageLabel(e.toStatus)}</span>
            <span className="text-muted-foreground"> — {e.performedByName}, {new Date(e.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            {e.notes && <div className="text-muted-foreground italic mt-0.5">"{e.notes}"</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function QualityGatePanel({ role }: { role: string }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<DeliverableRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createEngagementId, setCreateEngagementId] = useState<number | null>(null);
  const [createWorkstreamId, setCreateWorkstreamId] = useState<number | null>(null);
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createIsDecisionRoom, setCreateIsDecisionRoom] = useState(false);
  const [decisionFields, setDecisionFields] = useState<Record<string, string>>({});

  const { data: deliverableRows = [], isLoading } = useQuery<DeliverableRow[]>({
    queryKey: ["/api/admin/deliverables"],
    queryFn: async () => (await fetch("/api/admin/deliverables")).json(),
  });

  const { data: engagements = [] } = useQuery<EngagementOption[]>({
    queryKey: ["/api/admin/engagements"],
    queryFn: async () => (await fetch("/api/admin/engagements")).json(),
    enabled: showCreate,
  });

  const { data: workstreams = [] } = useQuery<WorkstreamOption[]>({
    queryKey: [`/api/admin/workstreams?engagementId=${createEngagementId}`],
    queryFn: async () => (await fetch(`/api/admin/workstreams?engagementId=${createEngagementId}`)).json(),
    enabled: showCreate && !!createEngagementId,
  });

  const advanceMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("PATCH", `/api/admin/deliverables/${id}/advance`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/deliverables"] }),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) =>
      apiRequest("PATCH", `/api/admin/deliverables/${id}/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/deliverables"] });
      setRejectTarget(null);
      setRejectReason("");
    },
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/admin/deliverables", {
        workstreamId: createWorkstreamId, title: createTitle, description: createDescription || undefined,
        isDecisionRoom: createIsDecisionRoom || undefined,
        ...(createIsDecisionRoom
          ? Object.fromEntries(DECISION_ROOM_FIELDS.map((f) => [f.key, decisionFields[f.key]?.trim() || undefined]))
          : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/deliverables"] });
      setShowCreate(false);
      setCreateEngagementId(null); setCreateWorkstreamId(null); setCreateTitle(""); setCreateDescription("");
      setCreateIsDecisionRoom(false); setDecisionFields({});
    },
  });

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="panel-label flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> QUALITY GATE</div>
          <div className="font-terminal text-[9px] text-muted-foreground mt-1">Data validation → calculation validation → assumption validation → citation validation → consultant review → senior review → approved for delivery.</div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 border border-[hsl(38,95%,50%)/40%] text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)/10%] hover:bg-[hsl(38,95%,50%)/20%] text-[10px] font-terminal uppercase transition-colors"
        >
          <Plus className="w-3 h-3" /> New Deliverable
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center font-terminal text-sm text-muted-foreground animate-pulse">Loading deliverables...</div>
      ) : deliverableRows.length === 0 ? (
        <div className="p-8 text-center font-terminal text-sm text-muted-foreground border border-dashed border-border">No deliverables yet across any engagement.</div>
      ) : (
        <div className="space-y-2">
          {deliverableRows.map((d) => {
            const idx = GATE_SEQUENCE.indexOf(d.status as (typeof GATE_SEQUENCE)[number]);
            const isFinal = idx === GATE_SEQUENCE.length - 1;
            const nextRequiresAdmin = d.status === "senior_review" && role !== "internal_admin";
            return (
              <div key={d.id} className="border border-border/60 bg-[#080808]">
                <div className="p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setExpanded(expanded === d.id ? null : d.id)} className="text-muted-foreground hover:text-foreground">
                          {expanded === d.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                        <span className="text-sm text-foreground font-semibold">{d.title}</span>
                        {d.isDecisionRoom && (
                          <span className="flex items-center gap-1 font-terminal text-[8px] uppercase tracking-wider px-1.5 py-0.5 border border-[hsl(38,95%,50%)]/30 text-[hsl(38,95%,55%)]">
                            <Landmark className="w-2.5 h-2.5" /> Decision Room
                          </span>
                        )}
                      </div>
                      <div className="font-terminal text-[9px] text-muted-foreground mt-1 ml-5">{d.organizationName} · {d.engagementTitle} · {d.workstreamTitle}</div>
                      <div className="ml-5 mt-2"><GateProgress status={d.status} /></div>
                      <div className="font-terminal text-[8px] uppercase tracking-wider text-[hsl(38,95%,55%)] mt-1 ml-5">{stageLabel(d.status)}</div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {!isFinal && (
                        <button
                          onClick={() => advanceMutation.mutate(d.id)}
                          disabled={advanceMutation.isPending || nextRequiresAdmin}
                          title={nextRequiresAdmin ? "Senior review sign-off requires an admin account." : undefined}
                          className="flex items-center gap-1.5 px-2 py-1 border border-up/40 text-up bg-up/10 hover:bg-up/20 text-[9px] font-terminal uppercase transition-colors disabled:opacity-40"
                        >
                          <ArrowRight className="w-3 h-3" /> {d.status === "senior_review" ? "Sign Off" : "Advance"}
                        </button>
                      )}
                      {d.status !== "draft" && d.status !== "delivered" && (
                        <button
                          onClick={() => setRejectTarget(d)}
                          className="flex items-center gap-1.5 px-2 py-1 border border-down/40 text-down bg-down/10 hover:bg-down/20 text-[9px] font-terminal uppercase transition-colors"
                        >
                          <Undo2 className="w-3 h-3" /> Send Back
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {expanded === d.id && (
                  <div className="border-t border-border/60 px-3">
                    {d.isDecisionRoom && (
                      <>
                        <div className="flex items-center gap-1.5 font-terminal text-[9px] text-muted-foreground pt-2"><Landmark className="w-3 h-3" /> DECISION ROOM</div>
                        <DecisionRoomView deliverable={d} />
                      </>
                    )}
                    <div className="flex items-center gap-1.5 font-terminal text-[9px] text-muted-foreground pt-2"><History className="w-3 h-3" /> GATE LOG</div>
                    <GateLogList deliverableId={d.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setRejectTarget(null)}>
          <div className="w-full max-w-md p-6 bg-[#0d0d0d] border border-border shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground">Send "{rejectTarget.title}" Back to Draft</h3>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Why is this being sent back?</label>
              <textarea required rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Assumption on FX rate doesn't match the latest FRED data"
                className="w-full px-3 py-2 border border-input bg-background focus:outline-none focus:ring-1 focus:ring-[hsl(38,95%,50%)] text-foreground text-sm" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setRejectTarget(null)} className="px-3 py-1.5 border border-border text-xs font-terminal uppercase text-muted-foreground hover:text-foreground">Cancel</button>
              <button
                onClick={() => rejectReason.trim() && rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason.trim() })}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                className="px-3 py-1.5 border border-down/40 bg-down/10 text-down text-xs font-terminal uppercase disabled:opacity-40"
              >
                {rejectMutation.isPending ? "Sending back..." : "Send Back"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 overflow-y-auto" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-lg my-8 p-6 bg-[#0d0d0d] border border-border shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground">New Deliverable</h3>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Engagement</label>
              <select
                value={createEngagementId ?? ""}
                onChange={(e) => { setCreateEngagementId(Number(e.target.value) || null); setCreateWorkstreamId(null); }}
                className="w-full px-3 py-2 bg-muted border border-border font-terminal text-xs text-foreground focus:outline-none"
              >
                <option value="">Select an engagement...</option>
                {engagements.map((e) => <option key={e.id} value={e.id}>{e.organizationName} — {e.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Workstream</label>
              <select
                value={createWorkstreamId ?? ""}
                onChange={(e) => setCreateWorkstreamId(Number(e.target.value) || null)}
                disabled={!createEngagementId}
                className="w-full px-3 py-2 bg-muted border border-border font-terminal text-xs text-foreground focus:outline-none disabled:opacity-40"
              >
                <option value="">{createEngagementId ? "Select a workstream..." : "Pick an engagement first"}</option>
                {workstreams.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Title</label>
              <input type="text" required value={createTitle} onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="e.g. Q3 Market Entry Analysis"
                className="w-full px-3 py-2 border border-input bg-background focus:outline-none focus:ring-1 focus:ring-[hsl(38,95%,50%)] text-foreground text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Description (optional)</label>
              <textarea rows={2} value={createDescription} onChange={(e) => setCreateDescription(e.target.value)}
                className="w-full px-3 py-2 border border-input bg-background focus:outline-none focus:ring-1 focus:ring-[hsl(38,95%,50%)] text-foreground text-sm" />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={createIsDecisionRoom} onChange={(e) => setCreateIsDecisionRoom(e.target.checked)} className="accent-[hsl(38,95%,50%)]" />
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Landmark className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" /> This is a Decision Room — a major decision, bundled in one artifact</span>
            </label>

            {createIsDecisionRoom && (
              <div className="space-y-3 p-3 border border-[hsl(38,95%,50%)]/20 bg-[hsl(38,95%,50%)]/5">
                {DECISION_ROOM_FIELDS.map((f) => (
                  <div key={f.key}>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">{f.label}</label>
                    <textarea rows={f.key === "decisionOwner" ? 1 : 2} value={decisionFields[f.key] ?? ""}
                      onChange={(e) => setDecisionFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      className="w-full px-3 py-1.5 border border-input bg-background focus:outline-none focus:ring-1 focus:ring-[hsl(38,95%,50%)] text-foreground text-xs" />
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 border border-border text-xs font-terminal uppercase text-muted-foreground hover:text-foreground">Cancel</button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={!createWorkstreamId || createTitle.trim().length < 2 || createMutation.isPending}
                className="px-3 py-1.5 border border-[hsl(38,95%,50%)/40%] bg-[hsl(38,95%,50%)/10%] text-[hsl(38,95%,55%)] text-xs font-terminal uppercase disabled:opacity-40"
              >
                {createMutation.isPending ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
