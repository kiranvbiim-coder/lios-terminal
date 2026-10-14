import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BookOpenCheck, Check, ChevronRight, ExternalLink, FileDiff, FileText,
  GitCompareArrows, Link2, Newspaper, Plus, RefreshCw, Save, Search,
  ShieldCheck, StickyNote, ArrowRight,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { buildDecisionCaseBridgePayload, buildDecisionEngineHandoffUrl } from "@/lib/researchDecisionBridge";
import { AdvancedManualWorkflow } from "./advancedMacroForecastResearch";
import EventOwnershipImpactView from "./EventOwnershipImpactView";

type InvestigationStatus = "draft" | "active" | "review" | "completed" | "archived";
type EvidenceKind = "fact" | "claim" | "calculation" | "interpretation" | "counterargument" | "unknown";

interface SourceQuality {
  authority: number;
  directness: number;
  recency: number;
  corroboration: number;
  extractionConfidence: number;
}

interface Evidence {
  id: number;
  investigationId: number;
  evidenceType: "filing" | "news" | "official_data" | "market_data" | "model_output" | "uploaded_document" | "internal_note" | "claim";
  evidenceKind: EvidenceKind;
  title: string;
  excerpt: string | null;
  annotation: string | null;
  sourceName: string;
  provider: string;
  sourceUrl: string | null;
  sourceExternalId: string | null;
  publishedAt: string | null;
  effectiveAt: string | null;
  retrievedAt: string;
  sourceQuality: SourceQuality;
  relevanceScore: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface Investigation {
  id: number;
  title: string;
  question: string;
  thesis: string | null;
  status: InvestigationStatus;
  primarySymbol: string | null;
  subjectLabel: string | null;
  tags: string[];
  ownerUserId: number;
  organizationId: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface InvestigationDetail extends Investigation {
  evidence: Evidence[];
  relationships: Relationship[];
  briefs: BriefHeader[];
  savedSearches: SavedSearch[];
}

interface Relationship {
  id: number;
  fromEvidenceId: number;
  toEvidenceId: number;
  relationshipType: "supports" | "contradicts" | "supersedes" | "derived_from" | "affects" | "cites";
  note: string | null;
}

interface BriefHeader { id: number; title: string; snapshotHash: string; createdAt: string }
interface Brief extends BriefHeader { markdown: string; evidenceSnapshot: Evidence[]; citations: Array<{ label: string; title: string; issues: string[] }> }
interface SavedSearch { id: number; name: string; query: string; filters: Record<string, unknown> }
interface TimelineEvent { id: string; eventType: string; timestamp: string; title: string; provenance: string; evidenceId?: number; briefId?: number }
interface ChangedResponse { comparedToBriefId: number | null; baseline: boolean; added: Evidence[]; removed: Evidence[]; modified: Evidence[]; newlyStale: Evidence[] }
interface SearchResult extends Omit<Evidence, "id" | "investigationId" | "annotation" | "createdAt"> {
  resultId: string;
  metadata: Record<string, unknown>;
}
interface SearchResponse {
  results: SearchResult[];
  sources: Array<{ sourceClass: string; status: "ok" | "unavailable" | "not_requested"; count: number; message?: string }>;
}

interface Props {
  symbol: string;
  role: string;
  starterQuestion?: string;
  starterSymbol?: string;
}


const STATUSES: InvestigationStatus[] = ["draft", "active", "review", "completed", "archived"];
const VIEWS = ["evidence", "timeline", "changes", "briefs", "advanced", "events"] as const;
type ResearchView = typeof VIEWS[number];

function formatDate(value: string | null | undefined) {
  if (!value) return "Not dated";
  return new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function qualityScore(quality: SourceQuality) {
  return Math.round((
    quality.authority * 0.3
    + quality.directness * 0.25
    + quality.recency * 0.15
    + quality.corroboration * 0.15
    + quality.extractionConfidence * 0.15
  ) * 100);
}

function statusClass(status: InvestigationStatus) {
  if (status === "active") return "text-cyan-300 border-cyan-400/30 bg-cyan-400/5";
  if (status === "review") return "text-amber-300 border-amber-400/30 bg-amber-400/5";
  if (status === "completed") return "text-emerald-300 border-emerald-400/30 bg-emerald-400/5";
  if (status === "archived") return "text-muted-foreground border-border bg-white/[0.02]";
  return "text-foreground border-border bg-white/[0.02]";
}

export default function ResearchIntelligencePanel({ symbol, role, starterQuestion, starterSymbol }: Props) {
  const canAuthor = role === "internal_admin" || role === "internal_analyst";
  const researchSymbol = starterSymbol?.trim().toUpperCase() || symbol?.trim().toUpperCase() || "";
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<InvestigationStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState(starterQuestion?.trim() || "");
  const [thesis, setThesis] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [view, setView] = useState<ResearchView>("evidence");
  const [researchQuery, setResearchQuery] = useState(starterQuestion?.trim() || "");
  const [sourceClasses, setSourceClasses] = useState(["filing", "news", "official_data", "published_content", "private_data"]);
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);
  const [annotationId, setAnnotationId] = useState<number | null>(null);
  const [annotation, setAnnotation] = useState("");
  const [fromEvidenceId, setFromEvidenceId] = useState("");
  const [toEvidenceId, setToEvidenceId] = useState("");
  const [relationshipType, setRelationshipType] = useState<Relationship["relationshipType"]>("supports");
  const [selectedBriefId, setSelectedBriefId] = useState<number | null>(null);
  const [decisionHandoff, setDecisionHandoff] = useState<{ id: number; title: string } | null>(null);
  const appliedStarterRef = useRef<string | null>(null);

  useEffect(() => {
    const nextQuestion = starterQuestion?.trim() || "";
    const nextSymbol = starterSymbol?.trim().toUpperCase() || "";
    if (!nextQuestion && !nextSymbol) return;
    const key = `${nextQuestion}\u0000${nextSymbol}`;
    if (appliedStarterRef.current === key) return;
    appliedStarterRef.current = key;
    setQuestion(nextQuestion);
    setResearchQuery(nextQuestion);
    setShowCreate(canAuthor);
  }, [canAuthor, starterQuestion, starterSymbol]);

  const investigationUrl = statusFilter === "all"
    ? "/api/research/investigations"
    : `/api/research/investigations?status=${statusFilter}`;
  const { data: investigations = [], isLoading } = useQuery<Investigation[]>({ queryKey: [investigationUrl] });
  const { data: detail, isLoading: detailLoading } = useQuery<InvestigationDetail>({
    queryKey: [`/api/research/investigations/${selectedId}`],
    enabled: selectedId !== null,
  });
  const { data: timeline = [] } = useQuery<TimelineEvent[]>({
    queryKey: [`/api/research/investigations/${selectedId}/timeline`],
    enabled: selectedId !== null && view === "timeline",
  });
  const { data: changed } = useQuery<ChangedResponse>({
    queryKey: [`/api/research/investigations/${selectedId}/what-changed`],
    enabled: selectedId !== null && view === "changes",
  });
  const { data: briefs = [] } = useQuery<Brief[]>({
    queryKey: [`/api/research/investigations/${selectedId}/briefs`],
    enabled: selectedId !== null && view === "briefs",
  });

  useEffect(() => {
    if (!selectedId && investigations.length) setSelectedId(investigations[0].id);
    if (selectedId && !investigations.some((item) => item.id === selectedId)) {
      setSelectedId(investigations[0]?.id ?? null);
    }
  }, [investigations, selectedId]);
  useEffect(() => {
    setSelectedBriefId(null);
    setDecisionHandoff(null);
  }, [selectedId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return investigations;
    return investigations.filter((item) => [item.title, item.question, item.primarySymbol, item.subjectLabel]
      .some((value) => value?.toLowerCase().includes(query)));
  }, [investigations, search]);

  async function refreshResearch(id?: number) {
    await queryClient.invalidateQueries({ queryKey: [investigationUrl] });
    await queryClient.invalidateQueries({ queryKey: ["/api/research/investigations"] });
    if (id ?? selectedId) {
      await queryClient.invalidateQueries({ queryKey: [`/api/research/investigations/${id ?? selectedId}`] });
      await queryClient.invalidateQueries({ queryKey: [`/api/research/investigations/${id ?? selectedId}/timeline`] });
      await queryClient.invalidateQueries({ queryKey: [`/api/research/investigations/${id ?? selectedId}/what-changed`] });
      await queryClient.invalidateQueries({ queryKey: [`/api/research/investigations/${id ?? selectedId}/briefs`] });
    }
  }

  const createInvestigation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/research/investigations", {
        title,
        question,
        thesis: thesis.trim() || null,
        primarySymbol: researchSymbol || null,
        subjectLabel: researchSymbol || null,
        status: "active",
        tags: researchSymbol ? [researchSymbol] : [],
      });
      return response.json() as Promise<Investigation>;
    },
    onSuccess: async (created) => {
      setTitle(""); setQuestion(""); setThesis(""); setShowCreate(false); setSelectedId(created.id);
      await refreshResearch(created.id);
      setFeedback("Investigation created.");
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "Could not create investigation."),
  });

  const updateStatus = useMutation({
    mutationFn: async (status: InvestigationStatus) => {
      if (!selectedId) return;
      await apiRequest("PATCH", `/api/research/investigations/${selectedId}`, { status });
    },
    onSuccess: async () => { await refreshResearch(); setFeedback("Investigation status updated."); },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "Could not update status."),
  });

  const addEvidence = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (!selectedId) throw new Error("Select an investigation first.");
      await apiRequest("POST", `/api/research/investigations/${selectedId}/evidence`, payload);
    },
    onSuccess: async () => { await refreshResearch(); setFeedback("Evidence attached with provenance."); },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Could not attach evidence.";
      setFeedback(message.includes("409") ? "That evidence is already attached." : message);
    },
  });

  const addNote = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Select an investigation first.");
      await apiRequest("POST", `/api/research/investigations/${selectedId}/evidence`, {
        evidenceType: "internal_note",
        evidenceKind: "interpretation",
        title: noteTitle,
        excerpt: note,
        sourceName: "Limuria internal research",
        provider: "Limuria",
        metadata: { symbol },
      });
    },
    onSuccess: async () => { setNoteTitle(""); setNote(""); await refreshResearch(); setFeedback("Internal note added."); },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "Could not add note."),
  });

  const runSearch = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/research/search", {
        query: researchQuery,
        investigationId: selectedId,
        filters: { entity: detail?.primarySymbol || symbol || undefined, sourceClasses },
        limit: 20,
      });
      return response.json() as Promise<SearchResponse>;
    },
    onSuccess: (response) => { setSearchResponse(response); setFeedback(`Search returned ${response.results.length} normalized results.`); },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "Research search failed."),
  });

  const saveSearch = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/research/saved-searches", {
      investigationId: selectedId,
      name: researchQuery || `${detail?.primarySymbol || symbol} source monitor`,
      query: researchQuery,
      filters: { entity: detail?.primarySymbol || symbol || undefined, sourceClasses },
    }),
    onSuccess: async () => { await refreshResearch(); setFeedback("Search saved to this investigation."); },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "Could not save search."),
  });

  const updateAnnotation = useMutation({
    mutationFn: async () => {
      if (!annotationId) throw new Error("Select evidence to annotate.");
      await apiRequest("PATCH", `/api/research/evidence/${annotationId}`, { annotation: annotation.trim() || null });
    },
    onSuccess: async () => { setAnnotationId(null); setAnnotation(""); await refreshResearch(); setFeedback("Evidence annotation updated."); },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "Could not update annotation."),
  });

  const createRelationship = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Select an investigation.");
      await apiRequest("POST", `/api/research/investigations/${selectedId}/relationships`, {
        fromEvidenceId: Number(fromEvidenceId), toEvidenceId: Number(toEvidenceId), relationshipType,
      });
    },
    onSuccess: async () => { setFromEvidenceId(""); setToEvidenceId(""); await refreshResearch(); setFeedback("Evidence relationship recorded."); },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "Could not create relationship."),
  });

  const generateBrief = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Select an investigation.");
      return apiRequest("POST", `/api/research/investigations/${selectedId}/briefs`, {});
    },
    onSuccess: async () => { setView("briefs"); await refreshResearch(); setFeedback("Reproducible evidence brief generated."); },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "Could not generate brief."),
  });
  const createDecisionCase = useMutation({
    mutationFn: async (briefTitle?: string) => {
      if (!detail) throw new Error("Select an investigation first.");
      const response = await apiRequest("POST", "/api/decisions", buildDecisionCaseBridgePayload(detail, briefTitle));
      return response.json() as Promise<{ id: number; title: string }>;
    },
    onSuccess: async (created) => {
      setDecisionHandoff(created);
      setFeedback(`Decision case #${created.id} linked to investigation #${detail?.id}.`);
      await queryClient.invalidateQueries({ queryKey: ["/api/decisions"] });
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "Could not create linked decision case."),
  });

  const exportBrief = useMutation({
    mutationFn: async (briefId: number) => apiRequest("POST", `/api/research/briefs/${briefId}/publishing-draft`, { domainSlug: "finance", visibility: detail?.organizationId ? "specific_orgs" : "all_clients" }),
    onSuccess: () => setFeedback("Publishing draft created. It must pass review before client delivery."),
    onError: (error) => setFeedback(error instanceof Error ? error.message : "Could not create publishing draft."),
  });

  const attachedExternalIds = useMemo(() => new Set(detail?.evidence.map((item) => item.sourceExternalId).filter(Boolean)), [detail]);

  return (
    <div className="h-full min-h-0 flex flex-col bg-[#050505] text-foreground">
      <header className="shrink-0 min-h-12 px-4 py-2 border-b border-border bg-[#080808] flex flex-wrap items-center gap-3">
        <BookOpenCheck className="w-4 h-4 text-amber-400" />
        <div className="min-w-0 mr-auto">
          <div className="font-terminal text-[11px] tracking-[0.16em] uppercase">Research Investigation Ledger</div>
          <div className="font-terminal text-[8px] text-muted-foreground uppercase">Evidence, provenance, challenge, and decision foundation</div>
        </div>
        {feedback && <span className="font-terminal text-[9px] text-amber-300 max-w-80 truncate" title={feedback}>{feedback}</span>}
        {canAuthor && (
          <button onClick={() => setShowCreate((value) => !value)} className="h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[9px] uppercase flex items-center gap-1.5 hover:bg-amber-400/10">
            <Plus className="w-3.5 h-3.5" /> New investigation
          </button>
        )}
      </header>

      {showCreate && (
        <form className="shrink-0 border-b border-border bg-[#070707] p-3 grid grid-cols-1 lg:grid-cols-[220px_1fr_1fr_auto] gap-2 items-end" onSubmit={(event) => { event.preventDefault(); createInvestigation.mutate(); }}>
          <label className="font-terminal text-[8px] text-muted-foreground uppercase">Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} className="mt-1 h-8 w-full bg-black border border-border px-2 text-[10px] text-foreground outline-none focus:border-amber-400/60" />
          </label>
          <label className="font-terminal text-[8px] text-muted-foreground uppercase">Decision question
            <input value={question} onChange={(event) => setQuestion(event.target.value)} required maxLength={5000} className="mt-1 h-8 w-full bg-black border border-border px-2 text-[10px] text-foreground outline-none focus:border-amber-400/60" />
          </label>
          <label className="font-terminal text-[8px] text-muted-foreground uppercase">Starting thesis
            <input value={thesis} onChange={(event) => setThesis(event.target.value)} maxLength={10000} className="mt-1 h-8 w-full bg-black border border-border px-2 text-[10px] text-foreground outline-none focus:border-amber-400/60" />
          </label>
          <button disabled={createInvestigation.isPending} className="h-8 px-4 bg-amber-400 text-black font-terminal text-[9px] font-bold uppercase disabled:opacity-50">Create</button>
        </form>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="min-h-0 border-r border-border flex flex-col bg-[#060606]">
          <div className="p-2 border-b border-border space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-muted-foreground" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="SEARCH INVESTIGATIONS" className="w-full h-8 pl-7 pr-2 bg-black border border-border font-terminal text-[9px] outline-none focus:border-amber-400/50" />
            </div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as InvestigationStatus | "all")} className="w-full h-8 bg-black border border-border px-2 font-terminal text-[9px] uppercase outline-none">
              <option value="all">All statuses</option>
              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? <div className="p-4 font-terminal text-[9px] text-muted-foreground">Loading investigations...</div> : filtered.length === 0 ? (
              <div className="p-5 font-terminal text-[9px] text-muted-foreground leading-relaxed">No investigation matches this view.</div>
            ) : filtered.map((item) => (
              <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full text-left p-3 border-b border-border/70 hover:bg-white/[0.03] ${selectedId === item.id ? "bg-amber-400/[0.06] border-l-2 border-l-amber-400" : "border-l-2 border-l-transparent"}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`px-1.5 py-0.5 border font-terminal text-[7px] uppercase ${statusClass(item.status)}`}>{item.status}</span>
                  {item.primarySymbol && <span className="font-mono text-[9px] text-amber-300">{item.primarySymbol}</span>}
                  <ChevronRight className="ml-auto w-3 h-3 text-muted-foreground" />
                </div>
                <div className="font-terminal text-[10px] leading-snug line-clamp-2">{item.title}</div>
                <div className="mt-1 font-terminal text-[8px] text-muted-foreground">Updated {formatDate(item.updatedAt)}</div>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto">
          {!selectedId ? (
            <div className="h-full flex items-center justify-center p-8 font-terminal text-[10px] text-muted-foreground">Select or create an investigation.</div>
          ) : detailLoading || !detail ? (
            <div className="p-6 font-terminal text-[10px] text-muted-foreground">Loading evidence ledger...</div>
          ) : (
            <>
              <section className="p-4 border-b border-border bg-[#070707]">
                <div className="flex flex-wrap gap-2 items-center mb-3">
                  <span className={`px-2 py-1 border font-terminal text-[8px] uppercase ${statusClass(detail.status)}`}>{detail.status}</span>
                  {detail.primarySymbol && <span className="font-mono text-[11px] text-amber-300">{detail.primarySymbol}</span>}
                  <span className="font-terminal text-[8px] text-muted-foreground">#{detail.id}</span>
                  {canAuthor && (
                    <select value={detail.status} onChange={(event) => updateStatus.mutate(event.target.value as InvestigationStatus)} className="ml-auto h-7 bg-black border border-border px-2 font-terminal text-[8px] uppercase outline-none">
                      {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  )}
                </div>
                <h2 className="font-terminal text-[15px] leading-snug">{detail.title}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {canAuthor && <button
                    type="button"
                    onClick={() => createDecisionCase.mutate(undefined)}
                    disabled={createDecisionCase.isPending}
                    className="h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[8px] uppercase flex items-center gap-1.5 hover:bg-amber-400/10 disabled:opacity-40"
                  >
                    <ArrowRight className="w-3.5 h-3.5" /> Create linked decision case
                  </button>}
                  {decisionHandoff && <div className="flex flex-wrap items-center gap-2 border border-emerald-400/30 bg-emerald-400/[0.04] px-2 py-1.5 font-terminal text-[8px] text-emerald-300">
                    <span>CASE #{decisionHandoff.id} LINKED</span>
                    <a
                      href={buildDecisionEngineHandoffUrl(detail.primarySymbol || symbol)}
                      className="flex items-center gap-1 text-amber-300 hover:underline"
                    >
                      Open Decision Engine / receipts <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>}
                </div>
                <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 border border-border">
                  <div className="p-3 border-b xl:border-b-0 xl:border-r border-border">
                    <div className="font-terminal text-[8px] text-muted-foreground uppercase mb-1">Decision question</div>
                    <p className="text-[12px] leading-relaxed">{detail.question}</p>
                  </div>
                  <div className="p-3">
                    <div className="font-terminal text-[8px] text-muted-foreground uppercase mb-1">Working thesis</div>
                    <p className="text-[12px] leading-relaxed">{detail.thesis || "No thesis recorded yet."}</p>
                  </div>
                </div>
              </section>

              <nav className="h-10 px-2 border-b border-border flex items-stretch sticky top-0 bg-[#060606] z-10">
                {VIEWS.map((item) => (
                  <button key={item} onClick={() => setView(item)} className={`px-3 border-b-2 font-terminal text-[8px] uppercase ${view === item ? "border-amber-400 text-amber-300" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                    {item}
                  </button>
                ))}
                <span className="ml-auto self-center pr-2 font-mono text-[8px] text-muted-foreground">{detail.evidence.length} evidence / {detail.relationships.length} links</span>
              </nav>

              {view === "evidence" && <section>
                {detail.evidence.length === 0 ? (
                  <div className="p-8 text-center font-terminal text-[9px] text-muted-foreground">No evidence attached. Run a source search or add an internal note.</div>
                ) : detail.evidence.map((item) => {
                  const score = qualityScore(item.sourceQuality);
                  return (
                    <article key={item.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 p-4 border-b border-border/70">
                      <div className="w-7 h-7 border border-border flex items-center justify-center text-amber-300 bg-white/[0.02]">
                        {item.evidenceType === "filing" ? <FileText className="w-3.5 h-3.5" /> : item.evidenceType === "news" ? <Newspaper className="w-3.5 h-3.5" /> : <StickyNote className="w-3.5 h-3.5" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-terminal text-[8px] text-muted-foreground uppercase">{item.evidenceType.replace("_", " ")} / {item.evidenceKind}</span>
                          <span className={`font-mono text-[8px] ${score >= 80 ? "text-emerald-300" : score >= 60 ? "text-amber-300" : "text-muted-foreground"}`}>SOURCE {score}/100</span>
                          <span className="ml-auto font-terminal text-[8px] text-muted-foreground">{formatDate(item.publishedAt || item.createdAt)}</span>
                        </div>
                        <h3 className="mt-1 font-terminal text-[11px] leading-snug">{item.title}</h3>
                        {item.excerpt && <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed line-clamp-4">{item.excerpt}</p>}
                        {item.annotation && <p className="mt-2 border-l-2 border-amber-400/50 pl-2 text-[10px] leading-relaxed">{item.annotation}</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-3 font-terminal text-[8px] text-muted-foreground">
                          <span>{item.sourceName}</span><span>{item.provider}</span><span>Published {formatDate(item.publishedAt)}</span><span>Effective {formatDate(item.effectiveAt)}</span><span>Retrieved {formatDate(item.retrievedAt)}</span>
                          {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-amber-300 flex items-center gap-1 hover:underline">Open source <ExternalLink className="w-3 h-3" /></a>}
                          {canAuthor && <button onClick={() => { setAnnotationId(item.id); setAnnotation(item.annotation || ""); }} className="text-amber-300 hover:underline">Annotate</button>}
                        </div>
                        {annotationId === item.id && <form onSubmit={(event) => { event.preventDefault(); updateAnnotation.mutate(); }} className="mt-2 flex gap-2">
                          <input autoFocus value={annotation} onChange={(event) => setAnnotation(event.target.value)} maxLength={10000} placeholder="ANALYST ANNOTATION" className="h-8 min-w-0 flex-1 bg-black border border-border px-2 text-[10px] outline-none focus:border-amber-400/50" />
                          <button disabled={updateAnnotation.isPending} title="Save annotation" className="w-8 h-8 border border-amber-400/40 text-amber-300 flex items-center justify-center"><Save className="w-3.5 h-3.5" /></button>
                        </form>}
                      </div>
                    </article>
                  );
                })}
                {detail.relationships.length > 0 && <div className="border-t border-border">
                  <div className="px-4 py-2 font-terminal text-[8px] uppercase text-muted-foreground">Evidence graph</div>
                  {detail.relationships.map((relationship) => <div key={relationship.id} className="px-4 py-2 border-t border-border/60 font-terminal text-[9px] flex items-center gap-2">
                    <span>E{relationship.fromEvidenceId}</span><GitCompareArrows className="w-3 h-3 text-amber-300" /><span className="text-amber-300 uppercase">{relationship.relationshipType.replace("_", " ")}</span><span>E{relationship.toEvidenceId}</span>
                  </div>)}
                </div>}
              </section>}

              {view === "advanced" && <section className="p-4 space-y-3">
                <div className="font-mono text-[8px] text-muted-foreground">ADVANCED RESEARCH MODELS retain the investigation ledger as the source of record. Import only reviewed claim/catalyst fields; these controls never infer evidence stance or a catalyst from a headline.</div>
                <AdvancedManualWorkflow spec={{ family: "research", model: "evidence-graph", label: "EVIDENCE GRAPH ASSESSMENT", instructions: "Paste claims with claimId, text, and evidence entries (sourceId, reliabilityScore, stance, strength). Link IDs to this investigation's evidence ledger before run." }} />
                <AdvancedManualWorkflow spec={{ family: "research", model: "catalyst-monitor", label: "CATALYST MONITOR", instructions: "Paste catalysts with name, currentValue, triggerValue, and direction. Values are manual/reviewed inputs, not inferred live news." }} />
              </section>}
              {view === "timeline" && <section>
                {timeline.length === 0 ? <div className="p-8 text-center font-terminal text-[9px] text-muted-foreground">No timeline events yet.</div> : timeline.map((event) => <div key={event.id} className="grid grid-cols-[90px_minmax(0,1fr)] gap-3 p-4 border-b border-border/70">
                  <div className="font-mono text-[8px] text-muted-foreground">{formatDate(event.timestamp)}</div>
                  <div><div className="font-terminal text-[8px] uppercase text-amber-300">{event.eventType.replaceAll("_", " ")}</div><div className="mt-1 text-[11px]">{event.title}</div><div className="mt-1 font-terminal text-[8px] text-muted-foreground">{event.provenance}</div></div>
                </div>)}
              </section>}

              {view === "events" && <EventOwnershipImpactView symbol={detail.primarySymbol || symbol} compact />}

              {view === "changes" && <section className="p-4 space-y-5">
                {!changed ? <div className="font-terminal text-[9px] text-muted-foreground">Calculating evidence delta...</div> : <>
                  <div className="flex items-center gap-2 font-terminal text-[9px]"><FileDiff className="w-4 h-4 text-amber-300" /> Compared with {changed.comparedToBriefId ? `brief #${changed.comparedToBriefId}` : "the initial baseline"}</div>
                  {(["added", "modified", "removed", "newlyStale"] as const).map((group) => <div key={group}>
                    <div className="font-terminal text-[8px] uppercase text-muted-foreground mb-2">{group.replace(/([A-Z])/g, " $1")} ({changed[group].length})</div>
                    {changed[group].length === 0 ? <div className="border-t border-border py-2 text-[10px] text-muted-foreground">None.</div> : changed[group].map((item) => <div key={`${group}-${item.id}`} className="border-t border-border py-2 text-[10px]">E{item.id} / {item.title}</div>)}
                  </div>)}
                </>}
              </section>}

              {view === "briefs" && <section>
                <div className="p-3 border-b border-border flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-amber-300" />
                  <span className="font-terminal text-[8px] uppercase text-muted-foreground">Frozen, reproducible evidence snapshots</span>
                  {canAuthor && <button onClick={() => generateBrief.mutate()} disabled={!detail.evidence.length || generateBrief.isPending} className="ml-auto h-8 px-3 border border-amber-400/40 text-amber-300 font-terminal text-[8px] uppercase disabled:opacity-40">Generate brief</button>}
                </div>
                {briefs.length === 0 ? <div className="p-8 text-center font-terminal text-[9px] text-muted-foreground">No brief snapshots generated.</div> : briefs.map((brief) => <article key={brief.id} className={`border-b border-border ${selectedBriefId === brief.id ? "bg-amber-400/[0.03]" : ""}`}>
                  <div className="p-3 flex flex-wrap items-center gap-2">
                    <span className="font-terminal text-[9px]">{brief.title}</span>
                    <span className="font-mono text-[8px] text-muted-foreground">{brief.snapshotHash.slice(0, 12)}</span>
                    {canAuthor && <button
                      type="button"
                      onClick={() => { setSelectedBriefId(brief.id); createDecisionCase.mutate(brief.title); }}
                      disabled={createDecisionCase.isPending}
                      className="ml-auto h-7 px-2 border border-amber-400/40 text-amber-300 font-terminal text-[8px] uppercase hover:bg-amber-400/10 disabled:opacity-40"
                    >
                      Create linked case
                    </button>}
                    {canAuthor && <button onClick={() => exportBrief.mutate(brief.id)} className="h-7 px-2 border border-border font-terminal text-[8px] uppercase hover:text-amber-300">Send to publishing</button>}
                  </div>
                  <pre className="whitespace-pre-wrap break-words border-t border-border bg-black/40 p-4 text-[10px] leading-relaxed font-terminal">{brief.markdown}</pre>
                </article>)}
              </section>}
            </>
          )}
        </main>

        <aside className="min-h-0 border-l border-border bg-[#060606] overflow-y-auto">
          <div className="h-10 px-3 border-b border-border flex items-center gap-2 sticky top-0 bg-[#060606] z-10">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-terminal text-[9px] uppercase">Research sources / {detail?.primarySymbol || symbol}</span>
            <button onClick={() => runSearch.mutate()} disabled={!selectedId || runSearch.isPending} title="Refresh search" className="ml-auto w-7 h-7 border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"><RefreshCw className={`w-3.5 h-3.5 ${runSearch.isPending ? "animate-spin" : ""}`} /></button>
          </div>

          {!canAuthor && <div className="p-3 border-b border-border font-terminal text-[8px] text-muted-foreground leading-relaxed">Compliance review mode. Evidence and lifecycle controls are read-only.</div>}

          <form className="p-3 border-b border-border space-y-2" onSubmit={(event) => { event.preventDefault(); runSearch.mutate(); }}>
            <div className="relative"><Search className="absolute left-2 top-2 w-3.5 h-3.5 text-muted-foreground" /><input value={researchQuery} onChange={(event) => setResearchQuery(event.target.value)} placeholder="SEARCH FILINGS, NEWS, RESEARCH" className="w-full h-8 pl-7 pr-2 bg-black border border-border font-terminal text-[9px] outline-none focus:border-amber-400/50" /></div>
            <div className="grid grid-cols-2 gap-1">
              {["filing", "news", "official_data", "published_content", "private_data"].map((source) => <label key={source} className="h-7 px-2 border border-border flex items-center gap-2 font-terminal text-[7px] uppercase text-muted-foreground">
                <input type="checkbox" checked={sourceClasses.includes(source)} onChange={() => setSourceClasses((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source])} />{source.replace("_", " ")}
              </label>)}
            </div>
            <div className="flex gap-2"><button disabled={!selectedId || runSearch.isPending || sourceClasses.length === 0} className="h-8 min-w-0 flex-1 bg-amber-400 text-black font-terminal text-[8px] font-bold uppercase disabled:opacity-40">Search sources</button>{canAuthor && <button type="button" onClick={() => saveSearch.mutate()} disabled={!selectedId || saveSearch.isPending || sourceClasses.length === 0} title="Save search" className="w-8 h-8 border border-border text-muted-foreground hover:text-amber-300 disabled:opacity-40 flex items-center justify-center"><Save className="w-3.5 h-3.5" /></button>}</div>
            {detail?.savedSearches.map((saved) => <button type="button" key={saved.id} onClick={() => { setResearchQuery(saved.query); setSearchResponse(null); }} className="w-full text-left font-terminal text-[8px] text-muted-foreground hover:text-amber-300 truncate">Saved / {saved.name}</button>)}
          </form>

          {searchResponse && <section className="border-b border-border">
            <div className="px-3 py-2 flex flex-wrap gap-1">{searchResponse.sources.map((source) => <span key={source.sourceClass} title={source.message} className={`px-1.5 py-0.5 border font-terminal text-[7px] uppercase ${source.status === "unavailable" ? "border-red-400/40 text-red-300" : source.status === "ok" ? "border-emerald-400/30 text-emerald-300" : "border-border text-muted-foreground"}`}>{source.sourceClass.replace("_", " ")} {source.count}</span>)}</div>
            {searchResponse.results.length === 0 ? <div className="p-3 border-t border-border font-terminal text-[8px] text-muted-foreground">No source returned a matching result.</div> : searchResponse.results.map((item) => {
              const attached = attachedExternalIds.has(item.sourceExternalId);
              return <div key={item.resultId} className="px-3 py-2 border-t border-border/60 flex items-start gap-2">
                <div className="min-w-0 flex-1"><div className="font-terminal text-[9px] leading-snug line-clamp-2">{item.title}</div><div className="mt-1 font-mono text-[7px] text-muted-foreground">{item.sourceName} / {formatDate(item.publishedAt || item.retrievedAt)}</div></div>
                {canAuthor && <button disabled={!selectedId || attached || addEvidence.isPending} title={attached ? "Already attached" : "Attach evidence"} onClick={() => addEvidence.mutate({ ...item })} className="shrink-0 w-7 h-7 border border-border flex items-center justify-center disabled:opacity-30 hover:text-amber-300">{attached ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}</button>}
              </div>;
            })}
          </section>}

          {canAuthor && detail && detail.evidence.length >= 2 && <form className="p-3 border-b border-border space-y-2" onSubmit={(event) => { event.preventDefault(); createRelationship.mutate(); }}>
            <div className="font-terminal text-[8px] text-muted-foreground uppercase flex items-center gap-1.5"><Link2 className="w-3 h-3" /> Relate evidence</div>
            <div className="grid grid-cols-[1fr_110px_1fr] gap-1"><select required value={fromEvidenceId} onChange={(event) => setFromEvidenceId(event.target.value)} className="h-8 min-w-0 bg-black border border-border px-1 font-terminal text-[8px]"><option value="">FROM</option>{detail.evidence.map((item) => <option key={item.id} value={item.id}>E{item.id}</option>)}</select><select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value as Relationship["relationshipType"])} className="h-8 min-w-0 bg-black border border-border px-1 font-terminal text-[7px] uppercase">{["supports", "contradicts", "supersedes", "derived_from", "affects", "cites"].map((item) => <option key={item}>{item}</option>)}</select><select required value={toEvidenceId} onChange={(event) => setToEvidenceId(event.target.value)} className="h-8 min-w-0 bg-black border border-border px-1 font-terminal text-[8px]"><option value="">TO</option>{detail.evidence.map((item) => <option key={item.id} value={item.id}>E{item.id}</option>)}</select></div>
            <button disabled={createRelationship.isPending || fromEvidenceId === toEvidenceId} className="h-8 w-full border border-border font-terminal text-[8px] uppercase disabled:opacity-40 hover:text-amber-300">Record relationship</button>
          </form>}

          {canAuthor && (
            <form className="p-3 space-y-2" onSubmit={(event) => { event.preventDefault(); addNote.mutate(); }}>
              <div className="font-terminal text-[8px] text-muted-foreground uppercase flex items-center gap-1.5"><StickyNote className="w-3 h-3" /> Internal research note</div>
              <input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} required maxLength={500} placeholder="NOTE TITLE" className="h-8 w-full bg-black border border-border px-2 font-terminal text-[9px] outline-none focus:border-amber-400/50" />
              <textarea value={note} onChange={(event) => setNote(event.target.value)} required maxLength={20000} placeholder="INTERPRETATION, OPEN QUESTION, OR COUNTERARGUMENT" className="min-h-24 w-full resize-y bg-black border border-border p-2 text-[10px] outline-none focus:border-amber-400/50" />
              <button disabled={!selectedId || addNote.isPending} className="h-8 w-full border border-amber-400/40 text-amber-300 font-terminal text-[9px] uppercase disabled:opacity-40 hover:bg-amber-400/10">Add to evidence ledger</button>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
