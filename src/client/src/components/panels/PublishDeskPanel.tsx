import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Send, Plus, CheckCircle2, Radio, Ban, Power, ListTree } from "lucide-react";
import type { DomainSlug } from "@/lib/domains";

interface Props {
  role: string;
  defaultDomain: DomainSlug;
}

interface Organization {
  id: number;
  name: string;
}

interface ContentItem {
  id: number;
  authorUserId: number;
  title: string;
  body: string;
  contentType: string;
  visibility: string;
  status: "draft" | "pending_review" | "approved" | "published" | "suppressed";
  isAiGenerated: boolean;
  createdAt: string;
  publishedAt: string | null;
  suppressedAt: string | null;
}

interface AuditEvent {
  id: number;
  userId: number | null;
  eventType: string;
  details: Record<string, unknown>;
  createdAt: string;
}

const STATUS_STYLE: Record<ContentItem["status"], string> = {
  draft: "text-muted-foreground border-border",
  pending_review: "text-amber-500 border-amber-800/60 bg-amber-950/20",
  approved: "text-[hsl(186,80%,55%)] border-[hsl(186,80%,55%)]/40 bg-[hsl(186,80%,55%)]/5",
  published: "text-green-500 border-green-800/60 bg-green-950/20",
  suppressed: "text-red-500 border-red-800/60 bg-red-950/20",
};

const canReview = (role: string) => role === "internal_admin" || role === "internal_compliance";

export default function PublishDeskPanel({ role, defaultDomain }: Props) {
  const [showAudit, setShowAudit] = useState(false);
  const qc = useQueryClient();

  const { data: content = [] } = useQuery<ContentItem[]>({
    queryKey: ["/api/content"],
    queryFn: async () => (await apiRequest("GET", "/api/content")).json(),
  });

  const { data: killSwitch } = useQuery<{ suppressed: boolean }>({
    queryKey: ["/api/admin/ai-kill-switch"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/ai-kill-switch")).json(),
    enabled: canReview(role),
  });

  const { data: auditEvents = [] } = useQuery<AuditEvent[]>({
    queryKey: ["/api/admin/audit-events"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/audit-events")).json(),
    enabled: showAudit && canReview(role),
  });

  const transition = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: string }) => {
      await apiRequest("POST", `/api/content/${id}/${action}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/content"] }),
  });

  const toggleKillSwitch = useMutation({
    mutationFn: async (suppressed: boolean) => {
      await apiRequest("POST", "/api/admin/ai-kill-switch", { suppressed });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/ai-kill-switch"] }),
  });

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <Send className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">PUBLISH DESK</span>
        <span className="font-terminal text-[9px] text-muted-foreground ml-2">{content.length} ITEMS</span>

        <div className="ml-auto flex items-center gap-2">
          {canReview(role) && killSwitch && (
            <button
              onClick={() => toggleKillSwitch.mutate(!killSwitch.suppressed)}
              className={`flex items-center gap-1.5 px-2.5 py-1 font-terminal text-[8.5px] font-bold uppercase tracking-widest border ${
                killSwitch.suppressed
                  ? "border-red-700 bg-red-950/40 text-red-400 animate-pulse"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
              title="Instantly suppress every AI-generated item platform-wide, pending review"
            >
              <Power className="w-3 h-3" /> {killSwitch.suppressed ? "AI CONTENT SUPPRESSED" : "AI KILL SWITCH"}
            </button>
          )}
          {canReview(role) && (
            <button onClick={() => setShowAudit((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1 font-terminal text-[8.5px] uppercase tracking-widest border border-border text-muted-foreground hover:text-foreground">
              <ListTree className="w-3 h-3" /> AUDIT TRAIL
            </button>
          )}
        </div>
      </div>

      {showAudit ? (
        <AuditTrailView events={auditEvents} />
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <NewDraftForm role={role} qc={qc} defaultDomain={defaultDomain} />

          <div className="space-y-2">
            {content.map((item) => (
              <ContentRow key={item.id} item={item} role={role} onAction={(action) => transition.mutate({ id: item.id, action })} />
            ))}
            {!content.length && <div className="font-terminal text-[10px] text-muted-foreground text-center py-6">No content yet. Create a draft above.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

const DOMAIN_OPTIONS: { value: DomainSlug; label: string }[] = [
  { value: "finance", label: "Finance" },
  { value: "economics_policy", label: "Economics & Public Policy" },
  { value: "supply_chain", label: "Operations & Supply Chain Logistics" },
  { value: "environment_sustainability", label: "Environment & Sustainability" },
  { value: "marketing_pr", label: "Marketing, PR & Communications" },
  { value: "tourism_hospitality", label: "Tourism & Hospitality" },
];

function NewDraftForm({ role, qc, defaultDomain }: { role: string; qc: ReturnType<typeof useQueryClient>; defaultDomain: DomainSlug }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [contentType, setContentType] = useState("note");
  const [domainSlug, setDomainSlug] = useState<DomainSlug>(defaultDomain === "shared" ? "finance" : defaultDomain);
  const [organizationIds, setOrganizationIds] = useState<number[]>([]);

  const { data: orgs = [] } = useQuery<Organization[]>({
    queryKey: ["/api/admin/organizations"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/organizations")).json(),
  });

  const createMut = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/content", {
        title, body, contentType, domainSlug,
        visibility: organizationIds.length ? "specific_orgs" : "all_clients",
        organizationIds,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/content"] });
      setTitle(""); setBody(""); setOrganizationIds([]);
    },
  });

  if (role !== "internal_admin" && role !== "internal_analyst") return null;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (title && body) createMut.mutate(); }}
      className="p-3 border border-border bg-[#070707] space-y-2"
    >
      <div className="flex items-center gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
          className="flex-1 bg-[#0d0d0d] border border-border px-2 py-1.5 font-terminal text-[10px] focus:outline-none focus:border-[hsl(38,95%,50%)]/50" />
        <select value={contentType} onChange={(e) => setContentType(e.target.value)}
          className="bg-[#0d0d0d] border border-border px-2 py-1.5 font-terminal text-[10px] focus:outline-none">
          <option value="note">note</option>
          <option value="brief">brief</option>
          <option value="trade_idea">trade_idea</option>
          <option value="report">report</option>
        </select>
        <select value={domainSlug} onChange={(e) => setDomainSlug(e.target.value as DomainSlug)}
          className="bg-[#0d0d0d] border border-border px-2 py-1.5 font-terminal text-[10px] focus:outline-none"
          title="Which workspace domain this content belongs to">
          {DOMAIN_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Content body..." rows={3}
        className="w-full bg-[#0d0d0d] border border-border px-2 py-1.5 font-terminal text-[10px] focus:outline-none focus:border-[hsl(38,95%,50%)]/50 resize-none" />
      <div className="flex items-center gap-3">
        <span className="font-terminal text-[8.5px] text-muted-foreground uppercase">Visible to:</span>
        <div className="flex flex-wrap gap-1.5">
          {orgs.map((org) => (
            <label key={org.id} className="flex items-center gap-1 font-terminal text-[9px] text-muted-foreground">
              <input
                type="checkbox"
                checked={organizationIds.includes(org.id)}
                onChange={(e) => setOrganizationIds((prev) => e.target.checked ? [...prev, org.id] : prev.filter((id) => id !== org.id))}
              />
              {org.name}
            </label>
          ))}
          {!orgs.length && <span className="font-terminal text-[9px] text-muted-foreground">No orgs yet — leave unchecked for all clients.</span>}
        </div>
        <button type="submit" className="ml-auto flex items-center gap-1.5 h-[26px] px-3 bg-[hsl(38,95%,50%)] text-black font-terminal text-[9px] font-bold uppercase tracking-wider">
          <Plus className="w-3 h-3" /> Save draft
        </button>
      </div>
    </form>
  );
}

function ContentRow({ item, role, onAction }: { item: ContentItem; role: string; onAction: (action: string) => void }) {
  const isAuthor = false; // author check happens server-side; client just offers the buttons that make sense per status
  const isReviewer = canReview(role);
  const canEditWorkflow = role === "internal_admin" || role === "internal_analyst";

  return (
    <div className="p-3 border border-border bg-[#070707] space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-terminal text-[11px] text-foreground font-bold">{item.title}</span>
            <span className={`font-terminal text-[8px] px-1.5 py-0.5 border uppercase tracking-widest ${STATUS_STYLE[item.status]}`}>{item.status.replace("_", " ")}</span>
            <span className="font-terminal text-[8px] text-muted-foreground uppercase">{item.contentType}</span>
            {item.isAiGenerated && <span className="font-terminal text-[8px] text-[hsl(186,80%,55%)] uppercase">AI</span>}
          </div>
          <p className="font-terminal text-[9.5px] text-muted-foreground mt-1 max-w-2xl">{item.body}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {item.status === "draft" && canEditWorkflow && (
            <ActionButton icon={Send} label="Submit" onClick={() => onAction("submit")} />
          )}
          {item.status === "pending_review" && isReviewer && (
            <ActionButton icon={CheckCircle2} label="Approve" onClick={() => onAction("approve")} />
          )}
          {item.status === "approved" && isReviewer && (
            <ActionButton icon={Radio} label="Publish" onClick={() => onAction("publish")} />
          )}
          {item.status !== "suppressed" && isReviewer && (
            <ActionButton icon={Ban} label="Suppress" onClick={() => onAction("suppress")} danger />
          )}
        </div>
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, danger }: { icon: any; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 font-terminal text-[8.5px] font-bold uppercase tracking-widest border ${
        danger ? "border-red-800/60 text-red-500 hover:bg-red-950/20" : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="w-3 h-3" /> {label}
    </button>
  );
}

function AuditTrailView({ events }: { events: AuditEvent[] }) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <table className="w-full font-terminal text-[9.5px]">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border">
            <th className="py-1.5 font-normal uppercase tracking-widest">Time</th>
            <th className="py-1.5 font-normal uppercase tracking-widest">Event</th>
            <th className="py-1.5 font-normal uppercase tracking-widest">Details</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-b border-border/40">
              <td className="py-1.5 text-muted-foreground whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
              <td className="py-1.5 text-[hsl(38,95%,55%)]">{e.eventType}</td>
              <td className="py-1.5 text-muted-foreground">{JSON.stringify(e.details)}</td>
            </tr>
          ))}
          {!events.length && <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">No audit events yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
