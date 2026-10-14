import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Clock, MessageSquare, CheckCircle, UserCheck, Layers, FileText, Send, AlertTriangle, ChevronRight, Plus, RefreshCw, Bookmark } from "lucide-react";

// Mirrors AdvisoryPanel.tsx's PACK_TEMPLATES labels (Decision/Project Packs,
// Major Bet) -- just the display label here since staff never author a
// pack, only see which one a client started from.
const PACK_LABEL: Record<string, string> = {
  investment_decision: "Investment Decision Pack",
  market_entry: "Market Entry Pack",
  ma_intelligence: "M&A Intelligence Pack",
};

interface ConsultingQuote {
  id: number;
  amount: number | null;
  currency: string;
  proposedTimelineDays: number | null;
  notes: string;
  status: "proposed" | "accepted" | "declined" | "superseded";
  createdAt: string;
  respondedAt: string | null;
}

interface ConsultingRequest {
  id: number;
  title: string;
  description: string;
  packType: string | null;
  // Null until a quote is proposed/accepted -- there's no fixed pricing
  // tier, a consultant scopes and quotes each request individually (see
  // ConsultingQuote above).
  slaHours: number | null;
  slaDeadline: string | null;
  status: "pending" | "assigned" | "quoted" | "accepted" | "in_progress" | "completed" | "escalated" | "resolved";
  createdAt: string;
  organizationName: string;
  domainName: string;
  domainSlug: string;
  assignedAdminId: number | null;
  assignedAdminName: string | null;
  quotes: ConsultingQuote[];
}

interface ConsultingTemplate {
  id: number;
  title: string;
  category: string;
  templateBody: string;
  domainSlug: string;
  usageCount: number;
}

function SlaBadge({ deadline, status }: { deadline: string | null; status: string }) {
  const [timeLeft, setTimeLeft] = useState("");
  const [colorClass, setColorClass] = useState("border-emerald-500/30 text-emerald-400 bg-emerald-500/10");

  useEffect(() => {
    function calculate() {
      if (status === "completed" || status === "resolved") {
        setTimeLeft("RESOLVED");
        setColorClass("border-blue-500/30 text-blue-400 bg-blue-500/10");
        return;
      }

      if (!deadline) {
        setTimeLeft("NO QUOTE YET");
        setColorClass("border-border/50 text-muted-foreground bg-transparent");
        return;
      }

      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft("SLA BREACHED");
        setColorClass("border-rose-500/50 text-rose-400 bg-rose-500/20 animate-pulse");
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeLeft(`${hours}h ${mins}m`);

      if (hours < 4) {
        setColorClass("border-rose-500/40 text-rose-400 bg-rose-500/10");
      } else if (hours < 12) {
        setColorClass("border-amber-500/40 text-amber-400 bg-amber-500/10");
      } else {
        setColorClass("border-emerald-500/40 text-emerald-400 bg-emerald-500/10");
      }
    }

    calculate();
    const timer = setInterval(calculate, 30000);
    return () => clearInterval(timer);
  }, [deadline, status]);

  return (
    <span className={`inline-flex items-center gap-1 font-terminal text-[10px] px-2 py-0.5 border ${colorClass}`}>
      <Clock className="w-3 h-3" /> {timeLeft}
    </span>
  );
}

export default function ConsultingAdminInboxPanel({ role }: { role: string }) {
  const qc = useQueryClient();
  const [selectedDomain, setSelectedDomain] = useState<string>("all");
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [solutionBody, setSolutionBody] = useState("");
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  // Quote Form State
  const [quoteAmount, setQuoteAmount] = useState("");
  const [quoteCurrency, setQuoteCurrency] = useState("INR");
  const [quoteTimelineDays, setQuoteTimelineDays] = useState("");
  const [quoteNotes, setQuoteNotes] = useState("");

  // Template Form State
  const [newTplTitle, setNewTplTitle] = useState("");
  const [newTplCategory, setNewTplCategory] = useState("General");
  const [newTplBody, setNewTplBody] = useState("");
  const [newTplDomainId, setNewTplDomainId] = useState<number>(1);

  // Fetch Requests
  const { data: requests = [], isLoading: loadingRequests, refetch: refetchRequests } = useQuery<ConsultingRequest[]>({
    queryKey: ["/api/admin/consulting/requests", selectedDomain],
    queryFn: async () => {
      const url = selectedDomain === "all"
        ? "/api/admin/consulting/requests"
        : `/api/admin/consulting/requests?domain=${selectedDomain}`;
      return (await apiRequest("GET", url)).json();
    },
  });

  // Fetch Templates
  const { data: templates = [], refetch: refetchTemplates } = useQuery<ConsultingTemplate[]>({
    queryKey: ["/api/admin/consulting/templates", selectedDomain],
    queryFn: async () => {
      const url = selectedDomain === "all"
        ? "/api/admin/consulting/templates"
        : `/api/admin/consulting/templates?domain=${selectedDomain}`;
      return (await apiRequest("GET", url)).json();
    },
  });

  // Assign Request Mutation
  const assignMutation = useMutation({
    mutationFn: async ({ requestId, adminId }: { requestId: number; adminId: number | null }) => {
      await apiRequest("PATCH", `/api/admin/consulting/requests/${requestId}/assign`, { assignedAdminId: adminId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/consulting/requests"] });
    },
  });

  // Consultant Triage (Phase 6): explicit "resolve without an engagement"
  // or "escalate to a Project" decision -- see adminRoutes.ts's
  // /triage route for why these two statuses existed in the schema but
  // were previously unreachable.
  const triageMutation = useMutation({
    mutationFn: async ({ requestId, decision }: { requestId: number; decision: "resolved" | "escalated" }) => {
      await apiRequest("PATCH", `/api/admin/consulting/requests/${requestId}/triage`, { decision });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/consulting/requests"] });
    },
  });

  // Propose Quote Mutation
  const quoteMutation = useMutation({
    mutationFn: async ({ requestId, amount, currency, proposedTimelineDays, notes }: {
      requestId: number; amount?: number; currency: string; proposedTimelineDays?: number; notes: string;
    }) => {
      await apiRequest("POST", `/api/admin/consulting/requests/${requestId}/quotes`, { amount, currency, proposedTimelineDays, notes });
    },
    onSuccess: () => {
      setQuoteAmount(""); setQuoteTimelineDays(""); setQuoteNotes("");
      qc.invalidateQueries({ queryKey: ["/api/admin/consulting/requests"] });
    },
  });

  // Submit Solution Mutation
  const solutionMutation = useMutation({
    mutationFn: async ({ requestId, body }: { requestId: number; body: string }) => {
      await apiRequest("POST", `/api/admin/consulting/requests/${requestId}/approvals`, { solutionBody: body });
    },
    onSuccess: () => {
      setSolutionBody("");
      setSelectedRequestId(null);
      qc.invalidateQueries({ queryKey: ["/api/admin/consulting/requests"] });
    },
  });

  // Create Template Mutation
  const createTemplateMutation = useMutation({
    mutationFn: async (data: { domainId: number; title: string; category: string; templateBody: string }) => {
      await apiRequest("POST", "/api/admin/consulting/templates", data);
    },
    onSuccess: () => {
      setShowTemplateModal(false);
      setNewTplTitle("");
      setNewTplBody("");
      qc.invalidateQueries({ queryKey: ["/api/admin/consulting/templates"] });
    },
  });

  const selectedReq = requests.find((r) => r.id === selectedRequestId);

  const applyTemplate = (bodyText: string) => {
    setSolutionBody((prev) => (prev ? `${prev}\n\n${bodyText}` : bodyText));
  };

  return (
    <div className="h-full flex flex-col bg-[#050505] text-foreground font-terminal overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-[hsl(38,95%,55%)]" />
          <span className="panel-label">CONSULTING UNIFIED INBOX & SLA TRACKER</span>
          <span className="font-terminal text-[9px] text-muted-foreground ml-2">
            ({requests.length} Active Queries)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetchRequests()}
            className="p-1 hover:bg-muted/20 text-muted-foreground hover:text-foreground rounded transition-colors"
            title="Refresh Requests"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowTemplateModal(true)}
            className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-terminal border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10"
          >
            <Plus className="w-3 h-3" /> NEW TEMPLATE
          </button>
        </div>
      </div>

      {/* Domain Filters */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-[#090909] overflow-x-auto text-[10px] font-terminal shrink-0">
        {[
          { slug: "all", label: "ALL DOMAINS" },
          { slug: "finance", label: "FINANCE" },
          { slug: "economics_policy", label: "ECONOMICS & POLICY" },
          { slug: "supply_chain", label: "SUPPLY CHAIN" },
          { slug: "environment_sustainability", label: "ESG & SUSTAINABILITY" },
          { slug: "marketing_pr", label: "MARKETING & PR" },
          { slug: "tourism_hospitality", label: "TOURISM" },
        ].map((d) => (
          <button
            key={d.slug}
            onClick={() => setSelectedDomain(d.slug)}
            className={`px-2.5 py-0.5 border whitespace-nowrap ${
              selectedDomain === d.slug
                ? "border-[hsl(38,95%,50%)] text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10"
                : "border-border/50 text-muted-foreground hover:text-foreground"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Content Workspace */}
      <div className="flex-1 grid grid-cols-12 overflow-hidden">
        {/* Left List Pane */}
        <div className={`${selectedRequestId ? "col-span-5" : "col-span-12"} border-r border-border overflow-y-auto p-2 space-y-2`}>
          {loadingRequests ? (
            <div className="p-8 text-center text-xs font-terminal text-muted-foreground animate-pulse">Loading queries...</div>
          ) : requests.length === 0 ? (
            <div className="p-8 text-center text-xs font-terminal text-muted-foreground border border-dashed border-border/50">
              No consulting queries found for this domain.
            </div>
          ) : (
            requests.map((req) => {
              const isSelected = req.id === selectedRequestId;
              return (
                <div
                  key={req.id}
                  onClick={() => {
                    setSelectedRequestId(req.id);
                    setSolutionBody("");
                  }}
                  className={`p-3 border cursor-pointer transition-all ${
                    isSelected
                      ? "border-[hsl(38,95%,50%)] bg-[hsl(38,95%,50%)]/5"
                      : "border-border/60 bg-[#080808] hover:border-border hover:bg-[#0c0c0c]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="font-terminal text-[9px] uppercase px-1.5 py-0.2 bg-muted/40 text-muted-foreground">
                        {req.domainName}
                      </span>
                      {req.packType && PACK_LABEL[req.packType] && (
                        <span className="font-terminal text-[9px] uppercase px-1.5 py-0.2 border border-[hsl(38,95%,50%)]/30 text-[hsl(38,95%,55%)]">
                          {PACK_LABEL[req.packType]}
                        </span>
                      )}
                    </div>
                    <SlaBadge deadline={req.slaDeadline} status={req.status} />
                  </div>

                  <div className="font-bold text-xs text-foreground line-clamp-1">{req.title}</div>
                  <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{req.description}</div>

                  <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-border/30 text-[10px] font-terminal text-muted-foreground">
                    <span>Org: <strong className="text-foreground">{req.organizationName}</strong></span>
                    {(() => {
                      const activeQuote = req.quotes.find(q => q.status === "proposed" || q.status === "accepted");
                      if (!activeQuote) return <span>No quote yet</span>;
                      return <span className="capitalize">{activeQuote.status} · {activeQuote.currency} {activeQuote.amount?.toLocaleString() ?? "—"}</span>;
                    })()}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Detail / Response Editor Pane */}
        {selectedReq && (
          <div className="col-span-7 flex flex-col h-full bg-[#070707] overflow-y-auto p-4 space-y-4">
            <div className="border-b border-border pb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-terminal text-[10px] uppercase text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10 px-2 py-0.5 border border-[hsl(38,95%,50%)]/20">
                  {selectedReq.domainName}
                </span>
                <SlaBadge deadline={selectedReq.slaDeadline} status={selectedReq.status} />
              </div>

              <h2 className="text-base font-bold text-foreground mt-1">{selectedReq.title}</h2>
              <div className="text-[10px] font-terminal text-muted-foreground mt-0.5">
                Client Organization: <span className="text-foreground font-semibold">{selectedReq.organizationName}</span> | Submitted: {new Date(selectedReq.createdAt).toLocaleString()}
              </div>
            </div>

            {/* Consultant Triage -- the explicit routing decision, made
                before diving into scoping/quoting. Hidden once a decision
                has already been made or the request reached a terminal
                quote-driven state. */}
            {!["completed", "resolved", "escalated"].includes(selectedReq.status) && (
              <div className="p-2.5 bg-[#0a0a0a] border border-border/50 flex items-center justify-between gap-3">
                <span className="text-[10px] font-terminal text-muted-foreground uppercase tracking-wider">Triage: does this need a paid engagement?</span>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => triageMutation.mutate({ requestId: selectedReq.id, decision: "resolved" })}
                    disabled={triageMutation.isPending}
                    className="flex items-center gap-1.5 px-2.5 py-1 border border-emerald-500/40 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 text-[10px] font-terminal uppercase transition-colors disabled:opacity-50"
                  >
                    <CheckCircle className="w-3 h-3" /> Resolve Directly
                  </button>
                  <button
                    onClick={() => triageMutation.mutate({ requestId: selectedReq.id, decision: "escalated" })}
                    disabled={triageMutation.isPending}
                    className="flex items-center gap-1.5 px-2.5 py-1 border border-amber-500/40 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 text-[10px] font-terminal uppercase transition-colors disabled:opacity-50"
                  >
                    <AlertTriangle className="w-3 h-3" /> Escalate to Project
                  </button>
                </div>
              </div>
            )}

            {/* Request Description */}
            <div className="p-3 bg-[#0a0a0a] border border-border/50 text-xs text-foreground/90 leading-relaxed font-terminal whitespace-pre-wrap">
              {selectedReq.description}
            </div>

            {/* Pricing & Quotes */}
            <div className="space-y-2">
              <div className="text-[10px] font-terminal text-muted-foreground uppercase tracking-wider">Pricing &amp; Quotes</div>

              {selectedReq.quotes.length > 0 && (
                <div className="space-y-1.5">
                  {selectedReq.quotes.map((q) => (
                    <div key={q.id} className="p-2.5 bg-[#0a0a0a] border border-border/50 flex items-center justify-between gap-3 text-[11px]">
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground">
                          {q.currency} {q.amount?.toLocaleString() ?? "—"}
                          {q.proposedTimelineDays !== null && <span className="text-muted-foreground font-normal"> · {q.proposedTimelineDays}d turnaround</span>}
                        </div>
                        <div className="text-muted-foreground truncate">{q.notes}</div>
                      </div>
                      <span className={`font-terminal text-[9px] uppercase px-1.5 py-0.5 border shrink-0 ${
                        q.status === "accepted" ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                        : q.status === "proposed" ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
                        : q.status === "declined" ? "border-rose-500/40 text-rose-400 bg-rose-500/10"
                        : "border-border/50 text-muted-foreground"
                      }`}>
                        {q.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {selectedReq.status !== "completed" && selectedReq.status !== "resolved" && (
                <div className="p-3 bg-[#0a0a0a] border border-border/50 space-y-2">
                  {selectedReq.quotes.some(q => q.status === "proposed") && (
                    <div className="text-[10px] font-terminal text-amber-400">Sending a new quote will supersede the one awaiting response.</div>
                  )}
                  <div className="grid grid-cols-3 gap-1.5">
                    <input
                      type="number"
                      value={quoteAmount}
                      onChange={(e) => setQuoteAmount(e.target.value)}
                      placeholder="Amount"
                      className="col-span-2 px-2 py-1.5 text-xs bg-[#030303] border border-border/80 focus:border-[hsl(38,95%,50%)] focus:outline-none"
                    />
                    <select
                      value={quoteCurrency}
                      onChange={(e) => setQuoteCurrency(e.target.value)}
                      className="px-1.5 py-1.5 text-xs bg-[#030303] border border-border/80 focus:outline-none"
                    >
                      <option value="INR">INR</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                  <input
                    type="number"
                    value={quoteTimelineDays}
                    onChange={(e) => setQuoteTimelineDays(e.target.value)}
                    placeholder="Turnaround (days)"
                    className="w-full px-2 py-1.5 text-xs bg-[#030303] border border-border/80 focus:border-[hsl(38,95%,50%)] focus:outline-none"
                  />
                  <textarea
                    rows={2}
                    value={quoteNotes}
                    onChange={(e) => setQuoteNotes(e.target.value)}
                    placeholder="Scoping notes shown to the client (required)"
                    className="w-full p-2 text-xs bg-[#030303] border border-border/80 focus:border-[hsl(38,95%,50%)] focus:outline-none font-terminal"
                  />
                  <button
                    onClick={() => quoteMutation.mutate({
                      requestId: selectedReq.id,
                      amount: quoteAmount ? Number(quoteAmount) : undefined,
                      currency: quoteCurrency,
                      proposedTimelineDays: quoteTimelineDays ? Number(quoteTimelineDays) : undefined,
                      notes: quoteNotes,
                    })}
                    disabled={quoteNotes.trim().length < 3 || quoteMutation.isPending}
                    className="w-full px-3 py-1.5 bg-[hsl(38,95%,50%)] text-black font-terminal text-[10px] font-bold hover:bg-[hsl(38,95%,55%)] disabled:opacity-50 transition-colors"
                  >
                    {quoteMutation.isPending ? "SENDING..." : "SEND QUOTE"}
                  </button>
                </div>
              )}
            </div>

            {/* Template Selector Bar */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-terminal text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                <span>Domain Solution Templates</span>
                <span className="text-[9px] text-[hsl(38,95%,55%)]">Click template to inject into solution</span>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[10px]">
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => applyTemplate(tpl.templateBody)}
                    className="px-2 py-1 bg-[#101010] border border-border/70 hover:border-[hsl(38,95%,50%)] text-muted-foreground hover:text-foreground text-left shrink-0 transition-colors"
                  >
                    <div className="font-semibold">{tpl.title}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Response Editor */}
            <div className="flex-1 flex flex-col space-y-1.5">
              <label className="text-[10px] font-terminal text-muted-foreground uppercase tracking-wider">
                Expert Response & Advisory Solution
              </label>
              <textarea
                value={solutionBody}
                onChange={(e) => setSolutionBody(e.target.value)}
                placeholder="Draft official expert response or advisory solution here..."
                className="flex-1 min-h-[160px] p-3 text-xs bg-[#030303] border border-border/80 focus:border-[hsl(38,95%,50%)] focus:outline-none font-terminal leading-relaxed"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() =>
                    solutionMutation.mutate({ requestId: selectedReq.id, body: solutionBody })
                  }
                  disabled={!solutionBody.trim() || solutionMutation.isPending}
                  className="px-4 py-2 bg-[hsl(38,95%,50%)] text-black font-terminal text-xs font-bold hover:bg-[hsl(38,95%,55%)] disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  {solutionMutation.isPending ? "SUBMITTING..." : "DELIVER SOLUTION"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* New Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm font-terminal">
          <div className="w-full max-w-lg p-5 bg-[#080808] border border-border shadow-2xl space-y-4 text-xs">
            <h3 className="text-sm font-bold font-terminal text-[hsl(38,95%,55%)]">CREATE DOMAIN SOLUTION TEMPLATE</h3>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-terminal text-muted-foreground mb-1">Target Domain</label>
                <select
                  value={newTplDomainId}
                  onChange={(e) => setNewTplDomainId(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-[#030303] border border-border focus:outline-none"
                >
                  <option value={1}>Finance</option>
                  <option value={2}>Economics & Public Policy</option>
                  <option value={3}>Operations & Supply Chain</option>
                  <option value={4}>Environment & Sustainability</option>
                  <option value={5}>Marketing & PR</option>
                  <option value={6}>Tourism & Hospitality</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-terminal text-muted-foreground mb-1">Template Title</label>
                <input
                  type="text"
                  value={newTplTitle}
                  onChange={(e) => setNewTplTitle(e.target.value)}
                  placeholder="e.g. Foreign Exchange Exposure Hedging Framework"
                  className="w-full px-2.5 py-1.5 bg-[#030303] border border-border focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-terminal text-muted-foreground mb-1">Template Content</label>
                <textarea
                  rows={6}
                  value={newTplBody}
                  onChange={(e) => setNewTplBody(e.target.value)}
                  placeholder="Provide structured template response body..."
                  className="w-full p-2.5 bg-[#030303] border border-border focus:outline-none font-terminal leading-relaxed"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => setShowTemplateModal(false)}
                className="px-3 py-1.5 border border-border font-terminal text-[10px] text-muted-foreground hover:text-foreground"
              >
                CANCEL
              </button>
              <button
                onClick={() =>
                  createTemplateMutation.mutate({
                    domainId: newTplDomainId,
                    title: newTplTitle,
                    category: newTplCategory,
                    templateBody: newTplBody,
                  })
                }
                disabled={!newTplTitle.trim() || !newTplBody.trim() || createTemplateMutation.isPending}
                className="px-3 py-1.5 bg-[hsl(38,95%,50%)] text-black font-terminal text-[10px] font-bold hover:bg-[hsl(38,95%,55%)] disabled:opacity-50"
              >
                SAVE TEMPLATE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
