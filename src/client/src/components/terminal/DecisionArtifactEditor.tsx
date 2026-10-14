import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactContent } from "@shared/artifactContracts";
import { decisionArtifactActionSchema, decisionArtifactContentSchema, decisionArtifactFollowUpSchema } from "@shared/artifactContracts";
import { decisionApprovalMatchesVersion, decisionDraftArrival, decisionDraftSignature, editDecisionRecordText } from "@/lib/decisionArtifactEditorState";
import {
  linkDecisionArtifactApproval, unlinkDecisionArtifactApproval,
  useDecisionArtifactApproval, useDecisionArtifactApprovalOptions,
} from "@/lib/useArtifacts";
import { useQueryClient } from "@tanstack/react-query";

type DecisionContent = Extract<ArtifactContent, { kind: "decision" }>;
const inputClass = "w-full rounded border border-border/50 bg-black/20 px-3 py-2 font-ui text-[13px] outline-none disabled:opacity-50";
const buttonClass = "rounded border border-border/50 px-3 py-1.5 text-[13px] disabled:opacity-40";

function TextField({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (text: string) => void; multiline?: boolean }) {
  return <label className="block space-y-1"><span className="font-ui text-[13px] text-muted-foreground">{label}</span>{multiline
    ? <textarea aria-label={label} className={`${inputClass} min-h-20`} value={value} onChange={event => onChange(event.target.value)} />
    : <input aria-label={label} className={inputClass} value={value} onChange={event => onChange(event.target.value)} />}</label>;
}

function TextList({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  return <section className="space-y-2"><h4 className="text-sm font-semibold">{label}</h4>{values.map((value, index) => <div key={index} className="flex items-start gap-2"><textarea aria-label={`${label} ${index + 1}`} className={`${inputClass} min-h-14`} value={value} onChange={event => onChange(values.map((item, row) => row === index ? event.target.value : item))} /><button type="button" className={buttonClass} aria-label={`Remove ${label} ${index + 1}`} onClick={() => onChange(values.filter((_, row) => row !== index))}>Remove</button></div>)}<button type="button" className={buttonClass} onClick={() => onChange([...values, ""])}>Add {label.toLowerCase()}</button></section>;
}

function ExactRecordEditor({ label, record, onChange }: { label: string; record: Record<string, unknown>; onChange: (record: Record<string, unknown>) => void }) {
  const [key, setKey] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  return <section className="space-y-3 rounded border border-border/40 p-3"><h3 className="text-sm font-semibold">{label}</h3><p className="text-xs text-muted-foreground">Text values remain exact text, including decimals and formulas. Structured, numeric, boolean and null values are retained without conversion.</p>{Object.entries(record).map(([name, value]) => <div key={name} className="space-y-1">{typeof value === "string" ? <TextField label={`${label}: ${name}`} value={value} multiline onChange={text => onChange(editDecisionRecordText(record, name, text))} /> : <div><span className="text-sm text-muted-foreground">{name} · recorded {value === null ? "null" : Array.isArray(value) ? "array" : typeof value} · preserved</span><pre className="mt-1 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(value, null, 2)}</pre></div>}<button type="button" className={buttonClass} aria-label={`Remove ${label}: ${name}`} onClick={() => { const next = { ...record }; delete next[name]; onChange(next); }}>Remove field</button></div>)}<div className="flex items-end gap-2"><TextField label={`New ${label.toLowerCase()} key`} value={key} onChange={setKey} /><button type="button" className={buttonClass} onClick={() => { if (!key || Object.prototype.hasOwnProperty.call(record, key)) { setNotice("Choose a non-empty, unused key."); return; } onChange(editDecisionRecordText(record, key, "")); setKey(""); setNotice(null); }}>Add text field</button></div>{notice && <p role="alert" className="text-sm text-amber-200">{notice}</p>}</section>;
}

function NullableDateField({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  return <TextField label={`${label} (ISO timestamp, blank = none)`} value={value ?? ""} onChange={text => onChange(text === "" ? null : text)} />;
}

function DecisionApprovalInspector({ artifactId, version, contentHash, blocked }: {
  artifactId: string; version: number; contentHash: string; blocked: boolean;
}) {
  const inspection = useDecisionArtifactApproval(artifactId, version, contentHash);
  const options = useDecisionArtifactApprovalOptions(artifactId, version, contentHash);
  const queryClient = useQueryClient();
  const [caseId, setCaseId] = useState("");
  const [receiptId, setReceiptId] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedCase = options.data?.cases.find(item => String(item.id) === caseId);
  const selectedReceipt = selectedCase?.receipts.find(item => String(item.id) === receiptId);
  const recorded = inspection.data;
  const current = !inspection.isFetching && !inspection.isError
    && decisionApprovalMatchesVersion(recorded, { artifactId, version, contentHash }) ? recorded : null;
  const unavailable = inspection.isError || options.isError;
  const mutationBlocked = blocked || busy || !current || inspection.isFetching || options.isFetching || unavailable;
  const changeLink = async (operation: "link" | "unlink") => {
    if (mutationBlocked || busyRef.current) return;
    if (operation === "link" && !selectedReceipt?.eligible) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    try {
      const base = { baseVersion: version, baseHash: contentHash };
      if (operation === "link" && selectedCase && selectedReceipt) {
        await linkDecisionArtifactApproval(artifactId, { ...base, decisionId: selectedCase.id, receiptVersionId: selectedReceipt.id, receiptHash: selectedReceipt.snapshotHash });
      } else if (operation === "unlink") {
        await unlinkDecisionArtifactApproval(artifactId, base);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/artifacts", artifactId, "decision-approval"] });
      setNotice(operation === "link" ? "Existing reviewed receipt linked to this exact Artifact version. No approval was created." : "Approval linkage cleared for this version. The canonical decision review is unchanged.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Decision review linkage could not be changed.");
      await queryClient.invalidateQueries({ queryKey: ["/api/artifacts", artifactId, "decision-approval"] });
    } finally { busyRef.current = false; setBusy(false); }
  };
  return <section aria-label="Canonical decision approval linkage" className="space-y-3 rounded border border-amber-300/20 p-3" data-testid="decision-approval-inspector">
    <h3 className="text-sm font-semibold">Linked receipt approval · server-derived</h3>
    <p className="text-xs text-muted-foreground">Existing Decision cases, receipt versions and reviews are the only approval authority. This reference does not approve the authored Artifact; review remains in the existing Decision case. This inspector links an existing reviewed receipt; it cannot approve, waive, execute or place trades. Editing the body never approves an action.</p>
    <div role="status" aria-live="polite" className="text-sm" data-testid="decision-approval-state">
      {inspection.isFetching ? "Checking linked receipt approval…" : inspection.isError ? "Linked receipt approval unavailable: server inspection failed." : !current ? "Linked receipt approval unavailable: response does not match this version and hash." : `Linked receipt server state: ${current.state.toUpperCase()}`}
      {current?.reason && <p className="mt-1 text-amber-200">{current.reason}</p>}
    </div>
    {current?.link && <dl className="space-y-1 break-all text-xs">
      <div>Linked decision case: {current.link.decisionId} · receipt v{current.link.receiptVersion} · receipt ID {current.link.receiptVersionId}</div>
      <div>Linked receipt hash: {current.link.receiptHash}</div>
      <div>Bound Artifact version: v{current.link.artifactVersion} · hash {current.link.artifactContentHash}</div>
      <div>Recorded server review: {current.link.outcome} · reviewer {current.link.reviewerUserId} · approval ID {current.link.serverApprovalId} · reviewed {current.link.approvedAt} · linked {current.link.linkedAt}</div>
      <div><a className="underline" href={`/api/decisions/${current.link.decisionId}`} target="_blank" rel="noreferrer">Inspect existing Decision review API</a></div>
    </dl>}
    {current?.currentApproval && <p className="break-all text-xs">Current server review: {current.currentApproval.outcome} · review ID {current.currentApproval.serverApprovalId} · reviewer {current.currentApproval.reviewerUserId} · receipt hash {current.currentApproval.receiptHash}</p>}
    {current?.state === "stale" && <p role="alert" className="text-sm text-amber-200">Stale linkage is not current approval. Explicitly select and link an eligible reviewed receipt, or clear the linkage.</p>}
    {blocked && <p className="text-xs text-amber-200">Save or discard the local draft and resolve revision conflicts before changing version-bound review linkage.</p>}
    <label className="block space-y-1 text-sm">Existing owned decision case<select aria-label="Existing decision case" className={inputClass} disabled={mutationBlocked} value={caseId} onChange={event => { setCaseId(event.target.value); setReceiptId(""); }}><option value="">Explicitly select a case</option>{options.data?.cases.map(item => <option key={item.id} value={item.id}>{item.title} · case {item.id} · {item.status}</option>)}</select></label>
    <label className="block space-y-1 text-sm">Existing reviewed receipt<select aria-label="Existing decision receipt" className={inputClass} disabled={mutationBlocked || !selectedCase} value={receiptId} onChange={event => setReceiptId(event.target.value)}><option value="">Explicitly select a receipt</option>{selectedCase?.receipts.map(item => <option key={item.id} value={item.id}>Receipt v{item.version} · ID {item.id} · {item.eligible ? "eligible" : item.reason ?? "ineligible"}</option>)}</select></label>
    {selectedCase && <a className="block text-sm underline" href={`/api/decisions/${selectedCase.id}`} target="_blank" rel="noreferrer">Open selected case's existing review API</a>}
    {selectedReceipt && <div className="space-y-1 text-xs"><p className="break-all">Selected receipt hash: {selectedReceipt.snapshotHash}</p><p>Recorded recommendation: {selectedReceipt.recommendation}</p>{!selectedReceipt.eligible && <p role="alert" className="text-amber-200">{selectedReceipt.reason ?? "This receipt is not eligible for linkage."}</p>}</div>}
    {options.isError && <p role="alert" className="text-sm text-amber-200">Existing receipt choices unavailable. No approval state is inferred.</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={mutationBlocked || !selectedReceipt?.eligible} onClick={() => void changeLink("link")}>Link selected existing review to v{version}</button><button type="button" className={buttonClass} disabled={mutationBlocked || !current?.link} onClick={() => void changeLink("unlink")}>Clear this version's approval link</button><button type="button" className={buttonClass} disabled={busy || inspection.isFetching || options.isFetching} onClick={() => { void inspection.refetch(); void options.refetch(); }}>Refresh server review state</button></div>
    {notice && <p role="status" className="text-sm text-amber-200">{notice}</p>}
  </section>;
}
export default function DecisionArtifactEditor({ artifactId, content: rawIncomingContent, revision, contentHash, onSave }: {
  artifactId: string; content: DecisionContent; revision: number; contentHash: string;
  onSave: (content: ArtifactContent) => Promise<void>;
}) {
  // Read projection supplies historical defaults; the raw canonical version/hash stays unchanged.
  const incomingContent = useMemo(() => ({
    ...rawIncomingContent,
    recommendation: rawIncomingContent.recommendation ?? "",
    dissent: rawIncomingContent.dissent ?? [],
    actions: rawIncomingContent.actions ?? [],
    outcome: rawIncomingContent.outcome ?? null,
    followUp: rawIncomingContent.followUp ?? [],
    caseRef: rawIncomingContent.caseRef ?? null,
  }), [rawIncomingContent]);
  const incomingSignature = useMemo(() => decisionDraftSignature(incomingContent), [incomingContent]);
  const [content, setContent] = useState(incomingContent);
  const [baseVersion, setBaseVersion] = useState(revision);
  const [baseline, setBaseline] = useState(incomingSignature);
  const [conflict, setConflict] = useState(false);

  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const draftRef = useRef(content);
  const baselineRef = useRef(baseline);
  const submittedRef = useRef<string | null>(null);
  const saveRef = useRef(onSave);
  draftRef.current = content;
  baselineRef.current = baseline;
  const draftSignature = useMemo(() => decisionDraftSignature(content), [content]);
  const dirty = draftSignature !== baseline;
  useEffect(() => {
    const incoming = incomingSignature;
    const arrival = decisionDraftArrival({ baseVersion, incomingVersion: revision, baseline: baselineRef.current, draft: decisionDraftSignature(draftRef.current), incoming, submitted: submittedRef.current });
    if (arrival === "unchanged") { if (submittedRef.current === null) saveRef.current = onSave; return; }
    if (arrival === "conflict") { setConflict(true); return; }
    setContent(incomingContent); setBaseline(incoming); setBaseVersion(revision);
    saveRef.current = onSave; submittedRef.current = null; setPending(false); setConflict(false);
  }, [incomingContent, incomingSignature, revision, baseVersion, onSave]);
  const update = <K extends keyof typeof incomingContent>(key: K, value: (typeof incomingContent)[K]) => setContent(current => ({ ...current, [key]: value }));
  const save = async () => {
    if (!dirty || saving || pending || conflict || baseVersion !== revision || submittedRef.current !== null) return;
    const next = draftRef.current;
    const submitted = decisionDraftSignature(next);
    submittedRef.current = submitted; setSaving(true); setNotice(null);
    try {
      await saveRef.current(next);
      setBaseline(submitted); setPending(submittedRef.current !== null);
      setNotice("Decision revision saved. Refreshing canonical version; approval is not implied.");
    } catch (cause) {
      submittedRef.current = null;
      setNotice(cause instanceof Error ? cause.message : "Decision could not be saved. Your draft is retained.");
    } finally { setSaving(false); }
  };
  const reload = () => {
    setContent(incomingContent); setBaseline(incomingSignature); setBaseVersion(revision);
    saveRef.current = onSave; submittedRef.current = null; setPending(false); setConflict(false); setNotice(null);
  };
  return <div className="space-y-4" data-testid="native-decision-artifact-editor">
    <div className="rounded border border-cyan-300/20 p-3"><p className="font-terminal text-xs text-cyan-200">DECISION ARTIFACT · BASE V{baseVersion} · CURRENT V{revision}</p><p className="mt-1 break-all font-terminal text-xs text-muted-foreground">Current canonical content hash: {contentHash}</p><p className="mt-2 text-sm text-muted-foreground">Authored analysis and lifecycle records, not an approval or execution instruction. Saving does not approve a decision, authorize an action, place a trade, or execute anything.</p>{content.caseRef && <p className="mt-2 text-sm">Authored decision case reference: {content.caseRef} · not approval authority</p>}</div>
    <DecisionApprovalInspector key={`${artifactId}:${revision}:${contentHash}`} artifactId={artifactId} version={revision} contentHash={contentHash} blocked={dirty || conflict || baseVersion !== revision || saving || pending} />
    {conflict && <div role="alert" data-testid="decision-revision-conflict" className="rounded border border-amber-300/40 p-3 text-sm text-amber-200">A newer canonical revision arrived. Your local draft was retained; saving and linking are blocked until you reload.<button type="button" className={`${buttonClass} ml-2`} disabled={saving} onClick={reload}>Discard draft and reload canonical revision</button></div>}
    <fieldset disabled={saving || pending || conflict} className="min-w-0 space-y-4">
      <TextField label="Decision objective" value={content.objective} multiline onChange={value => update("objective", value)} />
      <div className="grid gap-4 md:grid-cols-2"><TextList label="What changed" values={content.whatChanged} onChange={value => update("whatChanged", value)} /><TextList label="Why" values={content.why} onChange={value => update("why", value)} /><TextList label="Constraints" values={content.constraints} onChange={value => update("constraints", value)} /><TextList label="Uncertainties" values={content.uncertainties} onChange={value => update("uncertainties", value)} /></div>
      <ExactRecordEditor label="Assumptions" record={content.assumptions} onChange={value => update("assumptions", value)} />
      <section className="space-y-3"><h3 className="text-sm font-semibold">Alternatives</h3>{content.alternatives.map((alternative, index) => <div key={alternative.id} className="space-y-3 rounded border border-border/50 p-3"><p className="break-all text-xs text-muted-foreground">Alternative ID: {alternative.id}</p><TextField label={`Alternative ${index + 1} label`} value={alternative.label} onChange={label => update("alternatives", content.alternatives.map((item, row) => row === index ? { ...item, label } : item))} />{(["expectedOutcomes", "risks", "tradeoffs"] as const).map(key => <TextList key={key} label={`Alternative ${index + 1} ${key}`} values={alternative[key]} onChange={value => update("alternatives", content.alternatives.map((item, row) => row === index ? { ...item, [key]: value } : item))} />)}<button type="button" className={buttonClass} onClick={() => { update("alternatives", content.alternatives.filter((_, row) => row !== index)); if (content.selectedAlternativeId === alternative.id) update("selectedAlternativeId", null); }}>Remove alternative {index + 1}</button></div>)}<button type="button" className={buttonClass} onClick={() => update("alternatives", [...content.alternatives, { id: crypto.randomUUID(), label: "New alternative", expectedOutcomes: [], risks: [], tradeoffs: [] }])}>Add alternative</button>
        <label className="block space-y-1"><span className="text-sm">Selected alternative · authored preference, not approval</span><select aria-label="Selected decision alternative" value={content.selectedAlternativeId ?? ""} className={inputClass} onChange={event => update("selectedAlternativeId", event.target.value || null)}><option value="">None selected</option>{content.selectedAlternativeId && !content.alternatives.some(item => item.id === content.selectedAlternativeId) && <option value={content.selectedAlternativeId}>Unresolved authored reference: {content.selectedAlternativeId}</option>}{content.alternatives.map(item => <option key={item.id} value={item.id}>{item.label} · {item.id}</option>)}</select></label>
      </section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Scenarios</h3>{content.scenarios.map((scenario, index) => <div key={scenario.id} className="space-y-3 rounded border border-border/50 p-3"><p className="break-all text-xs text-muted-foreground">Scenario ID: {scenario.id}</p><TextField label={`Scenario ${index + 1} label`} value={scenario.label} onChange={label => update("scenarios", content.scenarios.map((item, row) => row === index ? { ...item, label } : item))} /><label className="block text-sm">Scenario {index + 1} kind<select className={inputClass} aria-label={`Scenario ${index + 1} kind`} value={scenario.kind} onChange={event => { const kind = decisionArtifactContentSchema.shape.scenarios.removeDefault().element.shape.kind.parse(event.target.value); update("scenarios", content.scenarios.map((item, row) => row === index ? { ...item, kind } : item)); }}>{["base", "bull", "bear", "custom"].map(kind => <option key={kind} value={kind}>{kind}</option>)}</select></label><TextField label={`Scenario ${index + 1} summary`} multiline value={scenario.summary} onChange={summary => update("scenarios", content.scenarios.map((item, row) => row === index ? { ...item, summary } : item))} /><TextField label={`Scenario ${index + 1} Artifact reference`} value={scenario.artifactRef ?? ""} onChange={artifactRef => update("scenarios", content.scenarios.map((item, row) => row === index ? { ...item, artifactRef: artifactRef || null } : item))} /><button type="button" className={buttonClass} onClick={() => update("scenarios", content.scenarios.filter((_, row) => row !== index))}>Remove scenario {index + 1}</button></div>)}<button type="button" className={buttonClass} onClick={() => update("scenarios", [...content.scenarios, { id: crypto.randomUUID(), label: "New scenario", kind: "custom", artifactRef: null, summary: "" }])}>Add scenario</button></section>
      <section className="space-y-3 rounded border border-border/50 p-3"><h3 className="text-sm font-semibold">Reference evidence</h3><p className="text-xs text-muted-foreground">Authored references, not verification of their claims. Canonical source/receipt metadata remains in the Evidence inspector.</p>{(["sources", "models", "scenarios", "backtests", "monitors"] as const).map(key => <TextList key={key} label={`Linked ${key}`} values={content.linkedRefs[key]} onChange={value => update("linkedRefs", { ...content.linkedRefs, [key]: value })} />)}</section>
      <TextField label="Recommendation" value={content.recommendation} multiline onChange={value => update("recommendation", value)} />
      <TextList label="Dissent" values={content.dissent} onChange={value => update("dissent", value)} />
      <div className="grid gap-4 md:grid-cols-2"><TextList label="Next actions" values={content.nextActions} onChange={value => update("nextActions", value)} /><TextList label="Implementation" values={content.implementation} onChange={value => update("implementation", value)} /><TextList label="Monitoring" values={content.monitoring} onChange={value => update("monitoring", value)} /></div>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Actions · authored tracking only</h3>{content.actions.map((action, index) => <div key={action.id} className="space-y-3 rounded border border-border/50 p-3"><p className="text-xs text-muted-foreground">Action ID: {action.id}</p><TextField label={`Action ${index + 1} description`} value={action.description} multiline onChange={description => update("actions", content.actions.map((item, row) => row === index ? { ...item, description } : item))} /><label className="block text-sm">Action {index + 1} tracking status<select aria-label={`Action ${index + 1} tracking status`} className={inputClass} value={action.status} onChange={event => { const status = decisionArtifactActionSchema.shape.status.parse(event.target.value); update("actions", content.actions.map((item, row) => row === index ? { ...item, status } : item)); }}>{["planned", "in_progress", "completed", "blocked", "cancelled"].map(status => <option key={status} value={status}>{status}</option>)}</select></label><TextField label={`Action ${index + 1} assignee`} value={action.assignee ?? ""} onChange={assignee => update("actions", content.actions.map((item, row) => row === index ? { ...item, assignee: assignee || null } : item))} />{(["dueAt", "completedAt"] as const).map(key => <NullableDateField key={key} label={`Action ${index + 1} ${key}`} value={action[key]} onChange={value => update("actions", content.actions.map((item, row) => row === index ? { ...item, [key]: value } : item))} />)}{(["sourceRefs", "artifactRefs"] as const).map(key => <TextList key={key} label={`Action ${index + 1} ${key}`} values={action[key]} onChange={value => update("actions", content.actions.map((item, row) => row === index ? { ...item, [key]: value } : item))} />)}<button type="button" className={buttonClass} onClick={() => update("actions", content.actions.filter((_, row) => row !== index))}>Remove action {index + 1}</button></div>)}<button type="button" className={buttonClass} onClick={() => update("actions", [...content.actions, { id: crypto.randomUUID(), description: "", status: "planned", assignee: null, dueAt: null, completedAt: null, sourceRefs: [], artifactRefs: [] }])}>Add action record</button></section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Outcome · authored observation, not verified execution</h3>{content.outcome ? <div className="space-y-3 rounded border border-border/50 p-3"><TextField label="Outcome summary" multiline value={content.outcome.summary} onChange={summary => { if (content.outcome) update("outcome", { ...content.outcome, summary }); }} /><label className="block text-sm">Outcome status<select aria-label="Outcome status" className={inputClass} value={content.outcome.status} onChange={event => { const status = event.target.value; if (content.outcome && (status === "pending" || status === "observed" || status === "inconclusive")) update("outcome", { ...content.outcome, status }); }}>{["pending", "observed", "inconclusive"].map(status => <option key={status} value={status}>{status}</option>)}</select></label><NullableDateField label="Outcome observedAt" value={content.outcome.observedAt} onChange={observedAt => { if (content.outcome) update("outcome", { ...content.outcome, observedAt }); }} />{(["sourceRefs", "artifactRefs"] as const).map(key => <TextList key={key} label={`Outcome ${key}`} values={content.outcome?.[key] ?? []} onChange={value => { if (content.outcome) update("outcome", { ...content.outcome, [key]: value }); }} />)}<button type="button" className={buttonClass} onClick={() => update("outcome", null)}>Remove outcome record</button></div> : <button type="button" className={buttonClass} onClick={() => update("outcome", { summary: "", status: "pending", observedAt: null, sourceRefs: [], artifactRefs: [] })}>Add outcome record</button>}</section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Follow-up</h3>{content.followUp.map((followUp, index) => <div key={followUp.id} className="space-y-3 rounded border border-border/50 p-3"><p className="text-xs text-muted-foreground">Follow-up ID: {followUp.id}</p><TextField label={`Follow-up ${index + 1} description`} value={followUp.description} multiline onChange={description => update("followUp", content.followUp.map((item, row) => row === index ? { ...item, description } : item))} /><label className="block text-sm">Follow-up {index + 1} status<select aria-label={`Follow-up ${index + 1} status`} className={inputClass} value={followUp.status} onChange={event => { const status = decisionArtifactFollowUpSchema.shape.status.parse(event.target.value); update("followUp", content.followUp.map((item, row) => row === index ? { ...item, status } : item)); }}>{["open", "in_progress", "completed", "cancelled"].map(status => <option key={status} value={status}>{status}</option>)}</select></label>{(["dueAt", "completedAt"] as const).map(key => <NullableDateField key={key} label={`Follow-up ${index + 1} ${key}`} value={followUp[key]} onChange={value => update("followUp", content.followUp.map((item, row) => row === index ? { ...item, [key]: value } : item))} />)}{(["sourceRefs", "artifactRefs"] as const).map(key => <TextList key={key} label={`Follow-up ${index + 1} ${key}`} values={followUp[key]} onChange={value => update("followUp", content.followUp.map((item, row) => row === index ? { ...item, [key]: value } : item))} />)}<button type="button" className={buttonClass} onClick={() => update("followUp", content.followUp.filter((_, row) => row !== index))}>Remove follow-up {index + 1}</button></div>)}<button type="button" className={buttonClass} onClick={() => update("followUp", [...content.followUp, { id: crypto.randomUUID(), description: "", status: "open", dueAt: null, completedAt: null, sourceRefs: [], artifactRefs: [] }])}>Add follow-up record</button></section>
      <div className="flex flex-wrap items-center gap-2"><span role="status" aria-live="polite" className="mr-auto text-sm text-muted-foreground" data-testid="decision-save-status">{notice ?? (dirty ? "Unsaved local decision draft" : "No unsaved decision changes")}</span><button type="button" data-testid="save-decision-revision" className="rounded bg-amber-300 px-3 py-2 text-sm font-semibold text-black disabled:opacity-40" disabled={!dirty || saving || pending || conflict} onClick={() => void save()}>{saving ? "Saving decision revision…" : pending ? "Waiting for canonical revision…" : "Save decision revision"}</button>{dirty && <button type="button" className={buttonClass} onClick={reload}>Discard local changes</button>}</div>
    </fieldset>
  </div>;
}
