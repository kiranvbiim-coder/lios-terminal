import { useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, Search, Shield, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  buildPersistableDataProviderConnection,
  normalizeConnectionTestResult,
  validateDataProviderDraft,
  type DataProviderAuthMode,
  type DataProviderMethod,
  type DataProviderSetupDraft,
  type NormalizedConnectionTestResult,
} from "@shared/connectionCenter";
import type { SourceFieldProfile } from "@shared/sourceDiscovery";

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

interface ApiDiscoveryResult {
  endpoint: string;
  protocol: "rest" | "graphql" | "soap";
  httpStatus: number;
  responsePath: string | null;
  retrievedAt: string;
  fields: SourceFieldProfile[];
  previewRows: Array<Record<string, unknown>>;
  observedRows: number;
  truncated: boolean;
}

const STEPS = ["Provider", "Authentication", "Test", "Discover", "Review"] as const;
const inputClass = "w-full border border-border bg-[#0b0b0b] px-3 py-2 font-terminal text-[10px] text-foreground outline-none focus:border-[hsl(38,95%,50%)]/60";

let credentialReferenceCounter = 0;

function createCredentialReference(): string {
  // This is an opaque vault key, not an analytical random source. A monotonic
  // process-local suffix keeps the reference deterministic within a running
  // wizard process and outside the quant-data classification surface.
  const suffix = `${Date.now().toString(36)}_${(++credentialReferenceCounter).toString(36)}`;
  return `api_custom_${suffix}`;
}

export default function AddAnyDataProviderWizard({ onClose, onSaved }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [method, setMethod] = useState<DataProviderMethod>("GET");
  const [authMode, setAuthMode] = useState<DataProviderAuthMode>("bearer");
  const [credential, setCredential] = useState("");
  const [credentialRef] = useState(createCredentialReference);
  const [responsePath, setResponsePath] = useState("");
  const [pageParam, setPageParam] = useState("");
  const [pageSizeParam, setPageSizeParam] = useState("");
  const [pageSize, setPageSize] = useState(100);
  const [maxPages, setMaxPages] = useState(10);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<NormalizedConnectionTestResult | null>(null);
  const [discovery, setDiscovery] = useState<ApiDiscoveryResult | null>(null);
  const [finalized, setFinalized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = useMemo<DataProviderSetupDraft>(() => ({
    name,
    endpoint,
    protocol: "rest",
    method,
    authMode,
    credential,
    credentialRef: authMode === "none" ? null : credentialRef,
    responsePath,
    pageParam,
    pageSizeParam,
    pageSize,
    maxPages,
  }), [name, endpoint, method, authMode, credential, credentialRef, responsePath, pageParam, pageSizeParam, pageSize, maxPages]);

  const baseValidation = useMemo(() => validateDataProviderDraft(draft), [draft]);
  const testValidation = useMemo(
    () => validateDataProviderDraft({ ...draft, credentialRef: null }, { requireCredential: true }),
    [draft],
  );

  function invalidateVerification(): void {
    setTestResult(null);
    setDiscovery(null);
  }

  async function removeProvisionalConnection(id: number | null): Promise<void> {
    if (!id || finalized) return;
    try {
      await apiRequest("DELETE", `/api/setup/source-connections/${id}`);
    } catch {
      // Best effort. A failed cleanup remains truthfully configured/unverified.
    }
  }

  async function handleClose(): Promise<void> {
    if (testing || discovering) return;
    await removeProvisionalConnection(connectionId);
    onClose();
  }

  async function persistProvisional(): Promise<number> {
    if (authMode !== "none" && credential.trim()) {
      await apiRequest("PUT", `/api/setup/credentials/${credentialRef}`, {
        value: credential.trim(),
        label: `API: ${name.trim()}`,
      });
    }
    const payload = buildPersistableDataProviderConnection(
      draft,
      authMode === "none" ? null : credentialRef,
    );
    const saveResponse = await apiRequest("PUT", "/api/setup/source-connections", {
      ...(connectionId ? { id: connectionId } : {}),
      ...payload,
    });
    const saved = await saveResponse.json() as { connection?: { id?: number } };
    const provisionalId = saved.connection?.id ?? null;
    if (!provisionalId) throw new Error("The setup service did not return a connection identifier.");
    setConnectionId(provisionalId);
    return provisionalId;
  }

  async function handleTest(): Promise<void> {
    if (!testValidation.valid) {
      setError(testValidation.issues[0]?.message ?? "Complete the required fields before testing.");
      return;
    }
    setTesting(true);
    setError(null);
    setTestResult(null);
    setDiscovery(null);
    try {
      const provisionalId = await persistProvisional();
      const testResponse = await apiRequest("POST", "/api/setup/source-connections/test", { connectionId: provisionalId });
      const testBody = await testResponse.json() as { status?: string; detail?: string };
      const normalized = normalizeConnectionTestResult(testBody.status, testBody.detail);
      setTestResult(normalized);
      if (!normalized.verified) {
        setError("The provider is configured but not live verified. Fix the connection and test again before discovery.");
      }
    } catch (cause) {
      setTestResult({ state: "test_failed", detail: cause instanceof Error ? cause.message : "Connection test failed.", verified: false });
      setError("LiOS could not verify this provider. No connected status will be claimed.");
    } finally {
      setTesting(false);
    }
  }

  async function handleDiscover(): Promise<void> {
    if (!connectionId || !testResult?.verified) {
      setError("Live verification is required before schema discovery.");
      return;
    }
    setDiscovering(true);
    setError(null);
    try {
      // Every config/auth edit invalidates testResult above, so this connectionId
      // is exactly the configuration that was live verified. Re-saving here
      // would incorrectly downgrade the persisted healthy state to configured.
      const response = await apiRequest("POST", "/api/setup/source-connections/api/discover", { connectionId });
      const discovered = await response.json() as ApiDiscoveryResult;
      setDiscovery(discovered);
    } catch (cause) {
      setDiscovery(null);
      setError(cause instanceof Error ? cause.message : "LiOS could not discover object records from this endpoint.");
    } finally {
      setDiscovering(false);
    }
  }

  function next(): void {
    setError(null);
    if (step === 0 && !baseValidation.valid) {
      setError(baseValidation.issues[0]?.message ?? "Complete provider details.");
      return;
    }
    if (step === 1 && !testValidation.valid) {
      setError(testValidation.issues[0]?.message ?? "Complete authentication details.");
      return;
    }
    if (step === 2 && !testResult?.verified) {
      setError("A live-verified connection test is required before discovery.");
      return;
    }
    if (step === 3 && !discovery) {
      setError("Run schema discovery before review.");
      return;
    }
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  }

  function back(): void {
    if (testing || discovering) return;
    setError(null);
    setStep((current) => Math.max(0, current - 1));
  }

  function finish(): void {
    if (!connectionId || !testResult?.verified || !discovery) {
      setError("Verify and discover the provider before keeping it as connected.");
      return;
    }
    setFinalized(true);
    onSaved();
  }

  const busy = testing || discovering;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4" onClick={() => { if (!busy) void handleClose(); }}>
      <section className="w-full max-w-3xl border border-border bg-[#070707] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="add-any-provider-title" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-border p-5">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-[hsl(38,95%,55%)]" aria-hidden="true" />
              <h2 id="add-any-provider-title" className="font-terminal text-[12px] uppercase tracking-[0.18em] text-foreground">Add Any Data Provider</h2>
            </div>
            <p className="mt-2 font-terminal text-[8px] leading-relaxed text-muted-foreground">Configure → verify → discover a REST/JSON provider. Credentials remain in LiOS credential custody; the saved connection stores only a reference.</p>
          </div>
          <button type="button" onClick={() => void handleClose()} disabled={busy} className="font-terminal text-[9px] text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30" aria-label="Close provider wizard">✕</button>
        </header>

        <div className="grid grid-cols-5 border-b border-border">
          {STEPS.map((label, index) => (
            <div key={label} className={`px-2 py-2 text-center font-terminal text-[7px] uppercase tracking-widest ${index === step ? "bg-[hsl(38,95%,50%)]/10 text-[hsl(38,95%,55%)]" : index < step ? "text-emerald-400" : "text-muted-foreground"}`}>
              {index + 1}. {label}
            </div>
          ))}
        </div>

        <div className="min-h-[340px] p-5">
          {step === 0 && (
            <div className="space-y-4">
              <div><label className="font-terminal text-[8px] uppercase tracking-wider text-muted-foreground" htmlFor="provider-name">Provider name</label><input id="provider-name" value={name} onChange={(event) => { setName(event.target.value); invalidateVerification(); }} placeholder="My licensed data provider" className={`${inputClass} mt-1`} autoFocus /></div>
              <div className="grid gap-3 md:grid-cols-[120px_1fr]">
                <div><label className="font-terminal text-[8px] uppercase tracking-wider text-muted-foreground" htmlFor="provider-method">Method</label><select id="provider-method" value={method} onChange={(event) => { setMethod(event.target.value as DataProviderMethod); invalidateVerification(); }} className={`${inputClass} mt-1`}><option value="GET">GET</option><option value="POST">POST</option></select></div>
                <div><label className="font-terminal text-[8px] uppercase tracking-wider text-muted-foreground" htmlFor="provider-endpoint">REST/JSON endpoint</label><input id="provider-endpoint" value={endpoint} onChange={(event) => { setEndpoint(event.target.value); invalidateVerification(); }} placeholder="https://api.provider.example/v1/data" className={`${inputClass} mt-1`} /></div>
              </div>
              <div><label className="font-terminal text-[8px] uppercase tracking-wider text-muted-foreground" htmlFor="provider-response-path">Response path (optional)</label><input id="provider-response-path" value={responsePath} onChange={(event) => { setResponsePath(event.target.value); invalidateVerification(); }} placeholder="data.results" className={`${inputClass} mt-1`} /><p className="mt-1 font-terminal text-[7px] text-muted-foreground">Use dot notation when records are nested. Prototype-related paths are blocked.</p></div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div><label className="font-terminal text-[7px] uppercase text-muted-foreground">Page param</label><input value={pageParam} onChange={(event) => { setPageParam(event.target.value); invalidateVerification(); }} placeholder="page" className={`${inputClass} mt-1`} /></div>
                <div><label className="font-terminal text-[7px] uppercase text-muted-foreground">Size param</label><input value={pageSizeParam} onChange={(event) => { setPageSizeParam(event.target.value); invalidateVerification(); }} placeholder="limit" className={`${inputClass} mt-1`} /></div>
                <div><label className="font-terminal text-[7px] uppercase text-muted-foreground">Page size</label><input type="number" min={1} max={1000} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); invalidateVerification(); }} className={`${inputClass} mt-1`} /></div>
                <div><label className="font-terminal text-[7px] uppercase text-muted-foreground">Max pages</label><input type="number" min={1} max={50} value={maxPages} onChange={(event) => { setMaxPages(Number(event.target.value)); invalidateVerification(); }} className={`${inputClass} mt-1`} /></div>
              </div>
              {!baseValidation.valid && (name || endpoint) && <div className="border border-amber-500/30 bg-amber-500/5 px-3 py-2 font-terminal text-[8px] text-amber-300">{baseValidation.issues[0]?.message}</div>}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div><label className="font-terminal text-[8px] uppercase tracking-wider text-muted-foreground" htmlFor="provider-auth">Authentication</label><select id="provider-auth" value={authMode} onChange={(event) => { setAuthMode(event.target.value as DataProviderAuthMode); setCredential(""); invalidateVerification(); }} className={`${inputClass} mt-1`}><option value="bearer">Bearer token</option><option value="x-api-key">X-API-Key header</option><option value="none">No authentication</option></select></div>
              {authMode !== "none" && <div><label className="font-terminal text-[8px] uppercase tracking-wider text-muted-foreground" htmlFor="provider-credential">Credential</label><input id="provider-credential" type="password" value={credential} onChange={(event) => { setCredential(event.target.value); invalidateVerification(); }} placeholder="Paste credential" autoComplete="off" className={`${inputClass} mt-1`} /><p className="mt-1 font-terminal text-[8px] leading-relaxed text-muted-foreground">Saved connection stores only <span className="text-foreground">{credentialRef}</span>.</p></div>}
              <div className="border border-cyan-500/20 bg-cyan-500/[0.03] px-3 py-2 font-terminal text-[8px] leading-relaxed text-cyan-200">BYOD boundary: raw credentials never enter the persisted provider config.</div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="border border-border bg-[#0b0b0b] p-4"><p className="font-terminal text-[9px] font-bold uppercase tracking-wider text-foreground">Verify connectivity</p><p className="mt-2 font-terminal text-[8px] leading-relaxed text-muted-foreground">LiOS creates a provisional configured record because the existing test service requires a connection ID. Only an explicit healthy/live-verified result advances to discovery.</p><button type="button" onClick={() => void handleTest()} disabled={testing || !testValidation.valid} className="mt-4 inline-flex items-center gap-2 border border-[hsl(38,95%,50%)]/50 px-4 py-2 font-terminal text-[9px] uppercase tracking-wider text-[hsl(38,95%,55%)] disabled:opacity-40">{testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{testing ? "Testing..." : testResult ? "Test Again" : "Test Connection"}</button></div>
              {testResult && <div className={`flex items-start gap-2 border px-3 py-3 ${testResult.verified ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300" : "border-rose-500/30 bg-rose-500/5 text-rose-300"}`}>{testResult.verified ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}<div><p className="font-terminal text-[8px] font-bold uppercase tracking-wider">{testResult.verified ? "Live verified" : testResult.state.replaceAll("_", " ")}</p><p className="mt-1 font-terminal text-[8px] leading-relaxed">{testResult.detail}</p></div></div>}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="border border-border bg-[#0b0b0b] p-4"><p className="font-terminal text-[9px] font-bold uppercase tracking-wider text-foreground">Discover schema</p><p className="mt-2 font-terminal text-[8px] leading-relaxed text-muted-foreground">LiOS fetches one bounded sample page, extracts object records at the configured response path, and infers field names/types/nullability. This is discovery metadata—not a V4-07 canonical mapping.</p><button type="button" onClick={() => void handleDiscover()} disabled={discovering || !testResult?.verified} className="mt-4 inline-flex items-center gap-2 border border-[hsl(38,95%,50%)]/50 px-4 py-2 font-terminal text-[9px] uppercase tracking-wider text-[hsl(38,95%,55%)] disabled:opacity-40">{discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}{discovering ? "Discovering..." : discovery ? "Discover Again" : "Discover Fields"}</button></div>
              {discovery && <div className="border border-emerald-500/25 bg-emerald-500/[0.03] p-3"><div className="flex flex-wrap gap-3 font-terminal text-[8px] uppercase tracking-wider text-emerald-300"><span>{discovery.fields.length} fields</span><span>{discovery.observedRows} sampled rows</span><span>HTTP {discovery.httpStatus}</span>{discovery.truncated && <span className="text-amber-300">sample truncated</span>}</div><div className="mt-3 grid gap-2 md:grid-cols-2">{discovery.fields.slice(0, 24).map(field => <div key={field.name} className="flex items-center justify-between gap-2 border border-border/60 px-2 py-1 font-terminal text-[7px]"><span className="truncate text-foreground" title={field.name}>{field.name}</span><span className="uppercase text-muted-foreground">{field.type}{field.nullable ? " · nullable" : ""}</span></div>)}</div>{discovery.fields.length > 24 && <p className="mt-2 font-terminal text-[7px] text-muted-foreground">+{discovery.fields.length - 24} more discovered fields remain available to the data layer.</p>}</div>}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <div className="border border-emerald-500/30 bg-emerald-500/5 p-4"><div className="flex items-center gap-2 text-emerald-300"><CheckCircle2 className="h-4 w-4" /><span className="font-terminal text-[9px] font-bold uppercase tracking-wider">Verified + discovered</span></div><p className="mt-2 font-terminal text-[8px] leading-relaxed text-muted-foreground">Connectivity and sample schema are verified. Canonical field mapping, entitlement depth and analytical integration remain explicit V4-07/V4-08 work and are not fabricated here.</p></div>
              <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 border border-border bg-[#0b0b0b] p-4 font-terminal text-[8px]"><dt className="uppercase text-muted-foreground">Provider</dt><dd className="text-foreground">{name}</dd><dt className="uppercase text-muted-foreground">Endpoint</dt><dd className="break-all text-foreground">{endpoint}</dd><dt className="uppercase text-muted-foreground">Method</dt><dd className="text-foreground">{method}</dd><dt className="uppercase text-muted-foreground">Response path</dt><dd className="text-foreground">{responsePath || "Root payload"}</dd><dt className="uppercase text-muted-foreground">Auth</dt><dd className="text-foreground">{authMode}</dd><dt className="uppercase text-muted-foreground">Discovered fields</dt><dd className="text-foreground">{discovery?.fields.length ?? 0}</dd><dt className="uppercase text-muted-foreground">Credential</dt><dd className="text-foreground">{authMode === "none" ? "None" : `${credentialRef} (reference only)`}</dd></dl>
            </div>
          )}

          {error && <div className="mt-4 border border-rose-500/30 bg-rose-500/5 px-3 py-2 font-terminal text-[8px] text-rose-300" role="alert">{error}</div>}
        </div>

        <footer className="flex items-center justify-between border-t border-border p-4">
          <button type="button" onClick={step === 0 ? () => void handleClose() : back} disabled={busy} className="inline-flex items-center gap-1 border border-border px-3 py-2 font-terminal text-[8px] uppercase tracking-wider text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30">{step > 0 && <ChevronLeft className="h-3 w-3" />} {step === 0 ? "Cancel" : "Back"}</button>
          {step < STEPS.length - 1 ? <button type="button" onClick={next} disabled={busy || (step === 2 && !testResult?.verified) || (step === 3 && !discovery)} className="inline-flex items-center gap-1 border border-[hsl(38,95%,50%)]/50 bg-[hsl(38,95%,50%)]/10 px-4 py-2 font-terminal text-[8px] uppercase tracking-wider text-[hsl(38,95%,55%)] disabled:opacity-40">Continue <ChevronRight className="h-3 w-3" /></button> : <button type="button" onClick={finish} disabled={busy} className="inline-flex items-center gap-1 border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 font-terminal text-[8px] uppercase tracking-wider text-emerald-300 disabled:opacity-40"><CheckCircle2 className="h-3 w-3" /> Finish & Keep Connection</button>}
        </footer>
      </section>
    </div>
  );
}
