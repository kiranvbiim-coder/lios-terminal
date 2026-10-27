import { useState, useEffect } from "react";
import {
  Clock, Plus, MessageSquare, Send, CheckCircle2, ChevronRight, ReceiptText,
  Circle, CircleDot, CircleSlash, Calendar, FileText, ShieldCheck, ShieldAlert, ShieldQuestion, Briefcase,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import type { DomainInfo } from "@/lib/domains";
import { ADVISORY_SERVICE_EXPLANATIONS, ADVISORY_SERVICE_STEPS } from "@/lib/advisoryDiscoveryPolicy";

/**
 * Client consulting and engagement workflows on the existing
 * /api/client/consulting/* and /api/client/engagements/* routes.
 */

// ─── Types (mirrors shared/schema.ts's inferred shapes via clientRoutes.ts) ─
interface ConsultingQuoteItem {
  id: number;
  amount: number | null;
  currency: string;
  proposedTimelineDays: number | null;
  notes: string;
  status: "proposed" | "accepted" | "declined" | "superseded";
  createdAt: string;
  respondedAt: string | null;
}
interface ConsultingApprovalItem {
  id: number;
  solutionBody: string;
}
interface ConsultingCommentItem {
  id: number;
  message: string;
  createdAt: string;
  authorName: string;
  authorRole: string;
}
interface ConsultingRequestItem {
  id: number;
  title: string;
  description: string;
  packType: string | null;
  slaHours: number | null;
  slaDeadline: string | null;
  status: string;
  createdAt: string;
  domainId: number;
  domainName: string;
}
interface ConsultingRequestDetail extends ConsultingRequestItem {
  approvals: ConsultingApprovalItem[];
  comments: ConsultingCommentItem[];
  quotes: ConsultingQuoteItem[];
}

// Decision/Project Packs (Major Bet, Roadmap Rev.3): "pre-packaged workflow
// templates (Investment Decision Pack, Market Entry Pack, M&A Intelligence
// Pack) instead of a blank request every time." Purely client-side pre-fill
// -- picking one sets title/description to a structured starting point the
// client edits before submitting; packType rides along so it stays
// attributable afterward (see shared/schema.ts's consultingRequestPackEnum).
const PACK_TEMPLATES: Record<string, { label: string; title: string; description: string }> = {
  investment_decision: {
    label: "Investment Decision Pack",
    title: "Investment Decision: ",
    description: `## Investment Thesis\n[What's being decided, and why now]\n\n## Capital at Risk\n[Amount and currency]\n\n## Time Horizon\n[Expected holding period or decision window]\n\n## Key Risks to Evaluate\n[What could make this go wrong]\n\n## Decision Owner\n[Who signs off on this]`,
  },
  market_entry: {
    label: "Market Entry Pack",
    title: "Market Entry: ",
    description: `## Target Market\n[Country, region, or segment]\n\n## Entry Rationale\n[Why this market, why now]\n\n## Competitive Landscape\n[Known incumbents, rough market share]\n\n## Regulatory / Currency Risk\n[Anything specific to this market]\n\n## Success Criteria\n[What "working" looks like in year one]`,
  },
  ma_intelligence: {
    label: "M&A Intelligence Pack",
    title: "M&A Intelligence: ",
    description: `## Target / Counterparty\n[Company being evaluated]\n\n## Strategic Rationale\n[Why this deal makes sense]\n\n## Deal Structure (if known)\n[Cash / stock / earnout, rough size]\n\n## Key Diligence Questions\n[What needs verifying before proceeding]\n\n## Decision Owner\n[Who signs off on this]`,
  },
};

interface HealthTrend {
  direction: "improving" | "stable" | "declining";
  recentActivityCount: number;
  priorActivityCount: number;
}
interface Engagement {
  id: number;
  title: string;
  engagementModel: "strategy" | "one" | "vantage";
  status: string;
  startDate: string | null;
  domainName: string;
  health: "on_track" | "attention" | "at_risk";
  healthTrend: HealthTrend | null;
}
interface WorkstreamItem {
  id: number;
  title: string;
  description: string | null;
  status: "not_started" | "in_progress" | "blocked" | "completed";
  ownerAdminName: string | null;
}
interface DeliverableItem {
  id: number;
  title: string;
  status: "draft" | "in_review" | "delivered" | "approved";
  createdAt: string;
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
const DECISION_ROOM_DISPLAY_FIELDS: Array<{ key: keyof DeliverableItem; label: string }> = [
  { key: "decisionQuestion", label: "Decision Question" },
  { key: "dataUsed", label: "Data Used" },
  { key: "modelUsed", label: "Model Used" },
  { key: "keyAssumptions", label: "Key Assumptions" },
  { key: "keyRisks", label: "Key Risks" },
  { key: "scenarios", label: "Scenarios" },
  { key: "recommendation", label: "Recommendation" },
  { key: "decisionOwner", label: "Decision Owner" },
];
interface MeetingItem {
  id: number;
  title: string;
  scheduledAt: string;
  status: string;
}
interface WorkstreamCommentItem {
  id: number;
  message: string;
  createdAt: string;
  authorName: string;
}
interface WorkstreamDetail extends WorkstreamItem {
  deliverables: DeliverableItem[];
  meetings: MeetingItem[];
  comments: WorkstreamCommentItem[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function fmtDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function SlaBadge({ deadline, status }: { deadline: string | null; status: string }) {
  const [timeLeft, setTimeLeft] = useState("");
  const [colorClass, setColorClass] = useState("text-up border-up");

  useEffect(() => {
    function update() {
      if (status === "completed" || status === "resolved") {
        setTimeLeft("RESOLVED"); setColorClass("text-cyan border-cyan"); return;
      }
      if (!deadline) {
        setTimeLeft("PENDING QUOTE"); setColorClass("text-muted-foreground border-border"); return;
      }
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft("SLA BREACHED"); setColorClass("text-down border-down animate-pulse"); return;
      }
      const totalHours = diff / 3_600_000;
      const hours = Math.floor(totalHours);
      const mins = Math.floor((diff % 3_600_000) / 60_000);
      setTimeLeft(`${hours}h ${mins}m remaining`);
      setColorClass(totalHours < 4 ? "text-down border-down" : totalHours < 12 ? "text-[hsl(38,95%,55%)] border-[hsl(38,95%,55%)]" : "text-up border-up");
    }
    update();
    const t = setInterval(update, 30000);
    return () => clearInterval(t);
  }, [deadline, status]);

  return (
    <span className={`font-terminal inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] uppercase tracking-wider border ${colorClass}`}>
      <Clock className="w-3 h-3" />{timeLeft}
    </span>
  );
}

// ─── Projects tab ───────────────────────────────────────────────────────────
const ENGAGEMENT_MODEL_LABEL: Record<Engagement["engagementModel"], string> = { strategy: "Limuria Strategy", one: "Limuria One", vantage: "Limuria Vantage" };
const ENGAGEMENT_MODEL_SECTION_LABEL: Record<Engagement["engagementModel"], string> = { strategy: "Workstreams", one: "Focus Areas", vantage: "Initiatives" };
const WORKSTREAM_STATUS_ICON: Record<WorkstreamItem["status"], typeof Circle> = { not_started: Circle, in_progress: CircleDot, blocked: CircleSlash, completed: CheckCircle2 };
const WORKSTREAM_STATUS_CLASS: Record<WorkstreamItem["status"], string> = { not_started: "text-muted-foreground", in_progress: "text-[hsl(38,95%,55%)]", blocked: "text-down", completed: "text-up" };
const HEALTH_CONFIG: Record<Engagement["health"], { icon: typeof ShieldCheck; label: string; className: string }> = {
  on_track: { icon: ShieldCheck, label: "On Track", className: "text-up border-up/40" },
  attention: { icon: ShieldQuestion, label: "Needs Attention", className: "text-[hsl(38,95%,55%)] border-[hsl(38,95%,55%)]/40" },
  at_risk: { icon: ShieldAlert, label: "At Risk", className: "text-down border-down/40" },
};
// Quality Gate (Major Bet) replaced the old 4-stage deliverableStatusEnum
// with 7 granular internal review stages (see shared/schema.ts's
// DELIVERABLE_GATE_SEQUENCE) -- staff-facing detail a client has no reason
// to see stage-by-stage. Collapse anything between draft and delivered into
// one "In Review" label here, same coarse vocabulary this panel always
// showed clients.
function clientDeliverableGroup(status: string): "draft" | "in_review" | "delivered" {
  if (status === "draft") return "draft";
  if (status === "delivered") return "delivered";
  return "in_review";
}
const DELIVERABLE_STATUS_CLASS: Record<string, string> = { draft: "text-muted-foreground border-border", in_review: "text-[hsl(38,95%,55%)] border-[hsl(38,95%,55%)]", delivered: "text-cyan border-cyan" };
const DELIVERABLE_STATUS_LABEL: Record<string, string> = { draft: "draft", in_review: "in review", delivered: "delivered" };

function ProjectsTab() {
  const [engagements, setEngagements] = useState<Engagement[] | null>(null);
  const [selectedEngagementId, setSelectedEngagementId] = useState<number | null>(null);
  const [workstreams, setWorkstreams] = useState<WorkstreamItem[] | null>(null);
  const [selectedWorkstreamId, setSelectedWorkstreamId] = useState<number | null>(null);
  const [detail, setDetail] = useState<WorkstreamDetail | null>(null);
  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);
  const [expandedDeliverableId, setExpandedDeliverableId] = useState<number | null>(null);

  useEffect(() => {
    getJson<Engagement[]>("/api/client/engagements").then((rows) => {
      setEngagements(rows);
      if (rows.length) setSelectedEngagementId(rows[0].id);
    }).catch(() => setEngagements([]));
  }, []);

  useEffect(() => {
    if (!selectedEngagementId) return;
    setWorkstreams(null);
    setSelectedWorkstreamId(null);
    getJson<WorkstreamItem[]>(`/api/client/engagements/${selectedEngagementId}/workstreams`).then((rows) => {
      setWorkstreams(rows);
      if (rows.length) setSelectedWorkstreamId(rows[0].id);
    }).catch(() => setWorkstreams([]));
  }, [selectedEngagementId]);

  useEffect(() => {
    if (!selectedWorkstreamId) { setDetail(null); return; }
    getJson<WorkstreamDetail>(`/api/client/workstreams/${selectedWorkstreamId}`).then(setDetail).catch(() => setDetail(null));
  }, [selectedWorkstreamId]);

  async function handleSendComment() {
    if (!commentText.trim() || !selectedWorkstreamId) return;
    setPosting(true);
    try {
      const res = await apiRequest("POST", `/api/client/workstreams/${selectedWorkstreamId}/comments`, { message: commentText.trim() });
      const comment: WorkstreamCommentItem = await res.json();
      setCommentText("");
      setDetail((d) => d ? { ...d, comments: [comment, ...d.comments] } : d);
    } finally {
      setPosting(false);
    }
  }

  const selectedEngagement = engagements?.find((e) => e.id === selectedEngagementId) ?? null;

  if (engagements === null) return <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">Loading projects...</div>;
  if (engagements.length === 0) return (
    <div className="p-8 text-center text-sm text-muted-foreground border border-dashed border-border">
      No active projects yet. Your Limuria relationship team will set one up here once an engagement begins.
    </div>
  );

  return (
    <div className="space-y-4">
      {engagements.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          {engagements.map((e) => (
            <button key={e.id} onClick={() => setSelectedEngagementId(e.id)}
              className={`font-terminal px-3 py-1.5 border text-[10px] uppercase tracking-wider transition-colors ${e.id === selectedEngagementId ? "bg-[hsl(38,95%,50%)/15%] text-[hsl(38,95%,55%)] border-[hsl(38,95%,50%)/40%]" : "text-muted-foreground border-border hover:text-foreground"}`}>
              {e.title}
            </button>
          ))}
        </div>
      )}

      {selectedEngagement && (
        <div className="bg-[#0d0d0d] border border-border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-foreground">{selectedEngagement.title}</h3>
              <span className="font-terminal text-[9px] uppercase tracking-wider text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)/10%] px-1.5 py-0.5">
                {ENGAGEMENT_MODEL_LABEL[selectedEngagement.engagementModel]}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedEngagement.domainName}{selectedEngagement.startDate && ` · Started ${fmtDate(selectedEngagement.startDate)}`}
            </p>
          </div>
          {(() => {
            const h = HEALTH_CONFIG[selectedEngagement.health];
            const HealthIcon = h.icon;
            const trend = selectedEngagement.healthTrend;
            const trendFlagged = trend?.direction === "declining" && selectedEngagement.health === "attention";
            return (
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`font-terminal flex items-center gap-1.5 text-[9px] uppercase tracking-wider border px-2 py-1 ${h.className}`}>
                  <HealthIcon className="w-3 h-3" /> {h.label}
                </span>
                {trendFlagged && (
                  <span className="font-terminal text-[8.5px] text-muted-foreground">Activity down — {trend!.recentActivityCount} vs {trend!.priorActivityCount} events, prior 2 weeks</span>
                )}
              </div>
            );
          })()}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className={selectedWorkstreamId ? "lg:col-span-4 space-y-2" : "lg:col-span-12 space-y-2"}>
          <div className="font-terminal text-[9px] uppercase tracking-wider text-muted-foreground px-1">
            {selectedEngagement ? ENGAGEMENT_MODEL_SECTION_LABEL[selectedEngagement.engagementModel] : "Workstreams"}
          </div>
          {workstreams === null ? (
            <div className="p-6 text-center text-sm text-muted-foreground animate-pulse">Loading...</div>
          ) : workstreams.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground border border-dashed border-border">Nothing here yet.</div>
          ) : (
            workstreams.map((ws) => {
              const Icon = WORKSTREAM_STATUS_ICON[ws.status];
              const isSelected = ws.id === selectedWorkstreamId;
              return (
                <div key={ws.id} onClick={() => setSelectedWorkstreamId(ws.id)}
                  className={`p-3 bg-[#0d0d0d] border cursor-pointer transition-colors ${isSelected ? "border-[hsl(38,95%,50%)/50%]" : "border-border hover:border-border"}`}>
                  <div className="flex items-start gap-2.5">
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${WORKSTREAM_STATUS_CLASS[ws.status]}`} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">{ws.title}</div>
                      {ws.description && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ws.description}</div>}
                      <div className="font-terminal text-[9px] uppercase tracking-wider text-muted-foreground mt-1.5">
                        {ws.status.replace("_", " ")}{ws.ownerAdminName && ` · ${ws.ownerAdminName}`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {selectedWorkstreamId && (
          <div className="lg:col-span-8 space-y-3">
            {!detail ? (
              <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">Loading workstream...</div>
            ) : (
              <>
                <div className="bg-[#0d0d0d] border border-border p-4">
                  <h4 className="font-terminal text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-3">
                    <FileText className="w-3.5 h-3.5" /> Deliverables ({detail.deliverables.length})
                  </h4>
                  {detail.deliverables.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Nothing delivered yet for this workstream.</div>
                  ) : (
                    <div className="space-y-2">
                      {detail.deliverables.map((d) => {
                        const group = clientDeliverableGroup(d.status);
                        const isExpanded = expandedDeliverableId === d.id;
                        const filledFields = d.isDecisionRoom ? DECISION_ROOM_DISPLAY_FIELDS.filter((f) => d[f.key]) : [];
                        return (
                          <div key={d.id} className="py-2 border-b border-border/50 last:border-0">
                            <div
                              className={`flex items-center justify-between gap-3 ${d.isDecisionRoom ? "cursor-pointer" : ""}`}
                              onClick={() => d.isDecisionRoom && setExpandedDeliverableId(isExpanded ? null : d.id)}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm text-foreground truncate">{d.title}</span>
                                  {d.isDecisionRoom && (
                                    <span className="font-terminal text-[8px] uppercase tracking-wider px-1.5 py-0.5 border border-[hsl(38,95%,50%)]/30 text-[hsl(38,95%,55%)] shrink-0">Decision Room</span>
                                  )}
                                </div>
                                <div className="text-[10px] text-muted-foreground">{d.deliveredAt ? `Delivered ${fmtDate(d.deliveredAt)}` : `Created ${fmtDate(d.createdAt)}`}</div>
                              </div>
                              <span className={`font-terminal text-[9px] uppercase tracking-wider border px-1.5 py-0.5 shrink-0 ${DELIVERABLE_STATUS_CLASS[group]}`}>{DELIVERABLE_STATUS_LABEL[group]}</span>
                            </div>
                            {isExpanded && filledFields.length > 0 && (
                              <div className="mt-2 p-3 bg-background/60 border border-border/40 space-y-2">
                                {filledFields.map((f) => (
                                  <div key={f.key}>
                                    <div className="font-terminal text-[8px] uppercase tracking-wider text-[hsl(38,95%,55%)]">{f.label}</div>
                                    <div className="text-xs text-foreground whitespace-pre-wrap mt-0.5">{d[f.key] as string}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="bg-[#0d0d0d] border border-border p-4">
                  <h4 className="font-terminal text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-3">
                    <Calendar className="w-3.5 h-3.5" /> Meetings ({detail.meetings.length})
                  </h4>
                  {detail.meetings.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No meetings scheduled for this workstream.</div>
                  ) : (
                    <div className="space-y-2">
                      {detail.meetings.map((m) => (
                        <div key={m.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0">
                          <div className="min-w-0">
                            <div className="text-sm text-foreground truncate">{m.title}</div>
                            <div className="text-[10px] text-muted-foreground">{fmtDateTime(m.scheduledAt)}</div>
                          </div>
                          <span className="font-terminal text-[9px] uppercase tracking-wider text-muted-foreground border border-border px-1.5 py-0.5 shrink-0">{m.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-[#0d0d0d] border border-border p-4">
                  <h4 className="font-terminal text-[9px] uppercase tracking-wider text-muted-foreground mb-3">Notes &amp; Updates</h4>
                  <div className="flex gap-2 mb-3">
                    <Input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Post an update or question..." className="flex-1"
                      onKeyDown={(e) => { if (e.key === "Enter") handleSendComment(); }} />
                    <Button onClick={handleSendComment} disabled={posting} size="icon"><Send className="w-4 h-4" /></Button>
                  </div>
                  {detail.comments.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No updates yet.</div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {detail.comments.map((c) => (
                        <div key={c.id} className="p-3 bg-muted/30 border border-border/30 text-xs">
                          <div className="flex justify-between text-muted-foreground font-mono-num mb-1 text-[10px]"><span>{c.authorName}</span><span>{fmtDateTime(c.createdAt)}</span></div>
                          <p className="text-foreground">{c.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main panel ─────────────────────────────────────────────────────────────
export default function AdvisoryPanel() {
  const [requests, setRequests] = useState<ConsultingRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ConsultingRequestDetail | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"projects" | "requests" | "invoices">("projects");

  const [domains, setDomains] = useState<DomainInfo[]>([]);
  const [formDomainId, setFormDomainId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [packType, setPackType] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [respondingQuoteId, setRespondingQuoteId] = useState<number | null>(null);

  const loadRequests = () => {
    setLoading(true);
    getJson<ConsultingRequestItem[]>("/api/client/consulting/requests")
      .then(setRequests).catch(() => setRequests([])).finally(() => setLoading(false));
  };

  useEffect(() => { loadRequests(); }, []);

  useEffect(() => {
    getJson<DomainInfo[]>("/api/client/dashboard/domains")
      .then((rows) => { setDomains(rows); if (rows.length) setFormDomainId(rows[0].id); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedRequestId) {
      getJson<ConsultingRequestDetail>(`/api/client/consulting/requests/${selectedRequestId}`)
        .then(setDetail).catch(() => setDetail(null));
    } else {
      setDetail(null);
    }
  }, [selectedRequestId]);

  const startAdvisoryBrief = (packKey?: string) => {
    const pack = packKey ? PACK_TEMPLATES[packKey] : null;
    if (pack) {
      setTitle(pack.title);
      setDescription(pack.description);
      setPackType(packKey!);
    }
    setActiveTab("requests");
    setShowNewModal(true);
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim() || !formDomainId) return;
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/client/consulting/requests", { domainId: formDomainId, title, description, packType: packType ?? undefined });
      setTitle(""); setDescription(""); setPackType(null); setShowNewModal(false);
      loadRequests();
    } catch {
      alert("Failed to submit request.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendComment = async () => {
    if (!commentText.trim() || !selectedRequestId) return;
    try {
      const res = await apiRequest("POST", `/api/client/consulting/requests/${selectedRequestId}/comments`, { message: commentText });
      const newComment: ConsultingCommentItem = await res.json();
      setCommentText("");
      if (detail) setDetail({ ...detail, comments: [newComment, ...detail.comments] });
    } catch {
      alert("Failed to post comment.");
    }
  };

  const handleQuoteResponse = async (quoteId: number, action: "accept" | "decline") => {
    if (!selectedRequestId) return;
    setRespondingQuoteId(quoteId);
    try {
      const res = await apiRequest("POST", `/api/client/consulting/requests/${selectedRequestId}/quotes/${quoteId}/${action}`);
      const updated: ConsultingQuoteItem = await res.json();
      setDetail((d) => d ? { ...d, quotes: d.quotes.map((q) => (q.id === quoteId ? updated : q)) } : d);
      loadRequests();
    } catch {
      alert(`Failed to ${action} quote.`);
    } finally {
      setRespondingQuoteId(null);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-[hsl(38,95%,55%)]" />
          <span className="panel-label">ADVISORY</span>
        </div>
        <button type="button" onClick={() => startAdvisoryBrief()}
          className="flex min-h-10 items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 font-ui text-sm font-semibold text-foreground hover:bg-white/[.04]">
          <Plus className="w-3 h-3" /> SUBMIT QUERY
        </button>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        {(["projects", "requests", "invoices"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`font-terminal px-3 py-1.5 border text-[10px] uppercase tracking-wider transition-colors ${activeTab === tab ? "bg-[hsl(38,95%,50%)/15%] text-[hsl(38,95%,55%)] border-[hsl(38,95%,50%)/40%]" : "text-muted-foreground border-border hover:text-foreground"}`}>
            {tab === "projects" ? "Projects" : tab === "requests" ? `Advisory Requests (${requests.length})` : "Invoices & Billing"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
        {activeTab === "invoices" && (
          <div className="space-y-4">
            <div className="bg-[#0d0d0d] border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground">Billing Ledger &amp; Invoices</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Each advisory request is scoped and priced individually by a consultant, not auto-billed at submission.</p>
            </div>
            <div className="p-8 text-center text-sm text-muted-foreground border border-dashed border-border">
              Billing details will appear here once your advisory team issues a quote for a request.
            </div>
          </div>
        )}

        {activeTab === "projects" && (
          <div className="space-y-6">
            <section className="rounded-2xl border border-border/70 bg-card/30 p-4 sm:p-6"
              aria-label="Limuria professional advisory services">
              <div className="max-w-3xl">
                <p className="font-ui text-xs text-muted-foreground">Limuria consulting · Optional professional engagement</p>
                <h2 className="mt-2 font-ui text-xl font-semibold tracking-[-0.02em] text-foreground">When a decision deserves a second perspective</h2>
                <p className="mt-2 font-ui text-sm leading-6 text-muted-foreground">
                  Self-service LiOS analysis remains yours. You can separately request human support to
                  evaluate assumptions, frame diligence and work toward a decision-ready deliverable.
                  Scope, pricing and turnaround are proposed for your review before any engagement.
                </p>
              </div>
              <details className="mt-5 rounded-xl border border-border/65 p-3">
                <summary className="min-h-10 cursor-pointer px-2 py-2 font-ui text-sm font-semibold text-foreground">
                  Explore common advisory briefs
                </summary>
                <div className="mt-2 grid gap-3 md:grid-cols-3">
                  {Object.entries(PACK_TEMPLATES).map(([key, pack]) => (
                    <article key={key} className="flex min-w-0 flex-col rounded-xl border border-border/60 bg-background/40 p-4">
                      <h3 className="font-ui text-sm font-semibold text-foreground">{pack.label}</h3>
                      <p className="mt-2 flex-1 font-ui text-[13px] leading-5 text-muted-foreground">
                        {ADVISORY_SERVICE_EXPLANATIONS[key as keyof typeof ADVISORY_SERVICE_EXPLANATIONS]}
                      </p>
                      <button type="button" className="mt-4 min-h-11 rounded-lg border border-border px-3 font-ui text-sm text-foreground hover:border-foreground/40"
                        onClick={() => startAdvisoryBrief(key)}>
                        Start an editable brief
                      </button>
                    </article>
                  ))}
                </div>
                <ol className="mt-4 list-inside list-decimal space-y-1 rounded-lg bg-background/30 px-3 py-3 font-ui text-xs leading-5 text-muted-foreground">
                  {ADVISORY_SERVICE_STEPS.map(step => <li key={step}>{step}</li>)}
                </ol>
                <p className="mt-2 font-ui text-xs text-muted-foreground">
                  No Project, file, source, conversation or analysis is attached automatically. Briefs remain editable until you submit.
                </p>
              </details>
            </section>
            <ProjectsTab />
          </div>
        )}

        {activeTab === "requests" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className={selectedRequestId ? "lg:col-span-5 space-y-2.5" : "lg:col-span-12 space-y-2.5"}>
              <div className="font-terminal text-[9px] uppercase tracking-wider text-muted-foreground px-1">Active &amp; Past Enquiries ({requests.length})</div>
              {loading ? (
                <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">Loading queries...</div>
              ) : requests.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground border border-dashed border-border">No queries submitted yet. Click "Submit Query" to open your first advisory request.</div>
              ) : (
                requests.map((req) => {
                  const isSelected = req.id === selectedRequestId;
                  return (
                    <div key={req.id} onClick={() => setSelectedRequestId(req.id)}
                      className={`p-3 bg-[#0d0d0d] border cursor-pointer transition-colors ${isSelected ? "border-[hsl(38,95%,50%)/50%]" : "border-border hover:border-border"}`}>
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-terminal text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-muted text-muted-foreground">{req.domainName}</span>
                          {req.packType && PACK_TEMPLATES[req.packType] && (
                            <span className="font-terminal text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-[hsl(38,95%,50%)/30%] text-[hsl(38,95%,55%)]">{PACK_TEMPLATES[req.packType].label}</span>
                          )}
                        </div>
                        <SlaBadge deadline={req.slaDeadline} status={req.status} />
                      </div>
                      <h4 className="font-semibold text-sm text-foreground line-clamp-1">{req.title}</h4>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{req.description}</p>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30 text-xs text-muted-foreground">
                        <span className="font-terminal uppercase tracking-wider text-[9px] bg-muted/50 px-1.5 py-0.5">{req.slaHours !== null ? `${req.slaHours}h SLA` : "Awaiting quote"}</span>
                        <span className="flex items-center gap-1 text-[hsl(38,95%,55%)]">View <ChevronRight className="w-3 h-3" /></span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {selectedRequestId && (
              <div className="lg:col-span-7 space-y-4 p-4 bg-[#0d0d0d] border border-border">
                {detail ? (
                  <div className="space-y-5">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-terminal text-[9px] uppercase tracking-wider bg-[hsl(38,95%,50%)/10%] text-[hsl(38,95%,55%)] px-2 py-1">{detail.domainName}</span>
                        <SlaBadge deadline={detail.slaDeadline} status={detail.status} />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground">{detail.title}</h3>
                      <p className="text-[10px] text-muted-foreground mt-1">Submitted {new Date(detail.createdAt).toLocaleString()}</p>
                    </div>

                    <div className="p-3 bg-background/60 border border-border/40 text-sm leading-relaxed whitespace-pre-wrap text-foreground">{detail.description}</div>

                    {detail.quotes.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2"><ReceiptText className="w-4 h-4 text-[hsl(38,95%,55%)]" /> Pricing &amp; Quotes</h4>
                        <div className="space-y-2">
                          {detail.quotes.map((q) => (
                            <div key={q.id} className={`p-3 border ${q.status === "proposed" ? "border-[hsl(38,95%,50%)/40%] bg-[hsl(38,95%,50%)/5%]" : "bg-muted/20 border-border/30"}`}>
                              <div className="flex items-center justify-between gap-3 mb-2">
                                <span className="text-sm font-medium font-mono-num text-foreground">
                                  {q.currency} {q.amount?.toLocaleString() ?? "—"}
                                  {q.proposedTimelineDays !== null && <span className="text-[10px] text-muted-foreground"> · {q.proposedTimelineDays}d</span>}
                                </span>
                                <span className={`font-terminal text-[9px] uppercase tracking-wider px-1.5 py-0.5 border ${q.status === "accepted" ? "text-up border-up" : q.status === "proposed" ? "text-[hsl(38,95%,55%)] border-[hsl(38,95%,50%)/40%]" : q.status === "declined" ? "text-down border-down/40" : "text-muted-foreground border-border"}`}>{q.status}</span>
                              </div>
                              <p className="text-xs text-muted-foreground mb-2">{q.notes}</p>
                              {q.status === "proposed" && (
                                <div className="flex gap-2">
                                  <Button onClick={() => handleQuoteResponse(q.id, "accept")} disabled={respondingQuoteId === q.id} size="sm">Accept Quote</Button>
                                  <Button onClick={() => handleQuoteResponse(q.id, "decline")} disabled={respondingQuoteId === q.id} variant="outline" size="sm">Decline</Button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2"><CheckCircle2 className="w-4 h-4 text-up" /> Delivered Solution</h4>
                      {detail.approvals.length === 0 ? (
                        <div className="p-3 bg-muted/20 border border-border/30 text-xs text-muted-foreground text-center">Advisory team is preparing your response. You will be notified as soon as it is submitted.</div>
                      ) : (
                        detail.approvals.map((app) => (
                          <div key={app.id} className="p-3 bg-up/5 border border-up space-y-2">
                            <div className="font-terminal text-[9px] uppercase tracking-wider text-up">Official Expert Response</div>
                            <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{app.solutionBody}</div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="space-y-2.5 pt-3 border-t border-border/40">
                      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2"><MessageSquare className="w-4 h-4 text-[hsl(38,95%,55%)]" /> Clarifications &amp; Notes</h4>
                      <div className="flex gap-2">
                        <Input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Ask a clarification question..." className="flex-1" />
                        <Button onClick={handleSendComment} size="icon"><Send className="w-4 h-4" /></Button>
                      </div>
                      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                        {detail.comments.map((c) => (
                          <div key={c.id} className="p-2.5 bg-muted/30 border border-border/30 text-xs">
                            <div className="flex justify-between text-muted-foreground font-mono-num mb-1 text-[10px]"><span>{c.authorName}</span><span>{new Date(c.createdAt).toLocaleTimeString()}</span></div>
                            <p className="text-foreground">{c.message}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">Loading request details...</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 overflow-y-auto" onClick={() => setShowNewModal(false)}>
          <div className="w-full max-w-lg my-8 p-6 bg-[#0d0d0d] border border-border shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground">Submit New Advisory Query</h3>
            <form onSubmit={handleCreateRequest} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Domain Specialty</label>
                {domains.length > 1 ? (
                  <select
                    value={formDomainId ?? ""}
                    onChange={(e) => setFormDomainId(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-muted border border-border font-medium text-foreground focus:outline-none"
                  >
                    {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                ) : (
                  <div className="px-3 py-2 bg-muted border border-border font-medium text-foreground">{domains[0]?.name ?? "Finance"}</div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Start From a Pack (optional)</label>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(PACK_TEMPLATES).map(([key, pack]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setPackType(key);
                        setTitle(pack.title);
                        setDescription(pack.description);
                      }}
                      className={`px-2 py-1 border text-[10px] font-terminal uppercase tracking-wider transition-colors ${
                        packType === key
                          ? "border-[hsl(38,95%,50%)/50%] bg-[hsl(38,95%,50%)/10%] text-[hsl(38,95%,55%)]"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {pack.label}
                    </button>
                  ))}
                  {packType && (
                    <button type="button" onClick={() => { setPackType(null); setTitle(""); setDescription(""); }}
                      className="px-2 py-1 border border-border text-[10px] font-terminal uppercase tracking-wider text-muted-foreground hover:text-foreground">
                      Clear
                    </button>
                  )}
                </div>
                {packType && <p className="text-[10px] text-muted-foreground mt-1">Template loaded below — edit freely before submitting.</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Query Title</label>
                <Input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q3 Hedging strategy for Forex exposure" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">Query Description &amp; Details</label>
                <textarea required rows={packType ? 8 : 4} value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="Provide context, metrics, or specific questions for our advisory team..."
                  className="w-full px-3 py-2 border border-input bg-background focus:outline-none focus:ring-1 focus:ring-[hsl(38,95%,50%)] text-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">A consultant will review this request and send you a scoped quote with pricing and turnaround time before any work begins.</p>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowNewModal(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting || !formDomainId}>{submitting ? "Submitting..." : "Confirm & Submit"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
