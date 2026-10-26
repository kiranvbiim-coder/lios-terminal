import { asyncSurfaceStatus, resolveAsyncSurfaceState } from "@/lib/asyncSurfaceState";
import AsyncSurfaceNotice from "@/components/terminal/AsyncSurfaceNotice";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { type CatalogProvider } from "@/lib/providerCatalog";
import { connectionRecoveryPresentation, isConnectorConnectable, summarizeConnectionCenter } from "@/lib/connectionCenterPresentation";
import { chooseConnectionProviders, connectionPickerStatus, returnFromConnectionCenter } from "@/lib/connectionProviderPicker";
import { aiModelAccessMessage, resolveAiModelAccess } from "@/lib/aiModelAccess";
import { normalizeProviderApiCredential } from "@shared/providerCredentialNormalize";
import type { RuntimeLifecyclePreview, RuntimeLifecycleRequest } from "@shared/runtimeLifecycle";
import {
  CheckCircle2, XCircle, AlertTriangle, KeyRound, Database, Globe, Cloud, Upload,
  Plus, RefreshCw, ChevronDown, ChevronRight, Terminal, Plug, Zap,
  Search, ExternalLink, Shield, Bot,
} from "lucide-react";
import DataImportWizard from "@/components/DataImportWizard";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ProviderConflictPanel from "@/components/panels/ProviderConflictPanel";
import DataSourcesPanel from "@/components/panels/DataSourcesPanel";
import { getDesktopWorkspaceBridge, type DesktopWorkspaceInfo } from "@/lib/desktopWorkspace";
import LocalVoiceRuntimeSettings from "@/components/settings/LocalVoiceRuntimeSettings";
import MasterAiSettings, { type MasterAiSessionState } from "@/components/settings/MasterAiSettings";
import LicenseSettings from "@/components/settings/LicenseSettings";
import BackupSettings from "@/components/settings/BackupSettings";
import DevicesSettings from "@/components/settings/DevicesSettings";
import DataFolderSettings from "@/components/settings/DataFolderSettings";

// ── Types ──────────────────────────────────────────────────────────────────

interface ConnectorCapability { contractFamily: string; fields?: string[]; coverage?: string; }
interface ConnectorDef {
  id: string; name: string; category: string; sourceType: string;
  authMode: string; custodyMode: string; adapterImplemented?: boolean;
  envKey?: string; vaultKey?: string;
  capabilities: ConnectorCapability[]; setupGuide: string; builtIn: boolean;
  rateLimits?: string; description?: string; websiteUrl?: string; freeTier?: boolean;
}
interface ConnectorHealth {
  connectorId: string;
  state: string;
  detail: string;
  checkedAt: string;
  lastVerifiedAt?: string | null;
}
interface AiProviderOption {
  id: string;
  name: string;
  available: boolean;
  isLocal: boolean;
  models: string[];
  defaultModel?: string;
  allowCustomModel?: boolean;
  credentialName: string;
  defaultEndpoint?: string;
  endpointEnvironmentManaged?: boolean;
}
interface SetupResponse {
  setupNeeded: boolean;
  setup: {
    selectedConnectorIds: string[];
    providerStackOrder?: string[];
    pythonRuntimeId: string;
    pythonEnvironmentPath?: string | null;
    pythonPackIds: string[];
    aiProviderId: string | null;
    aiModelId: string | null;
  } | null;
  connectors: { connectors: ConnectorDef[]; health: ConnectorHealth[] };
  aiProviders: AiProviderOption[];
}
interface ChatVerification {
  ok: true;
  provider: string;
  model: string;
  endpoint?: string;
  verifiedAt: string;
  detail: string;
  verifiedCapabilities: ["chat"];
}
interface SavedConnection {
  id: number; connectorId: string; name: string; sourceType: string;
  config: Record<string, string | number | boolean | null>;
  credentialRef: string | null; status: string; statusDetail: string | null;
  lastTestedAt: string | null; lastHealthyAt: string | null;
}
interface RuntimeReleasePack {
  id: "core" | "research" | "quant" | "modeling" | "data-lab" | "local-ai";
  name: string;
  description: string;
  includedManagedPackIds: string[];
  capabilities: string[];
  defaultEnabled: boolean;
  requiresNetwork: boolean;
  requiresUserCredential: boolean;
  releaseNotes: string[];
}
interface RuntimeResponse {
  profiles: Array<{ id: string; name: string; description: string; supported: boolean; recommended: boolean }>;
  packs: Array<{ id: string; name: string; description?: string; packages: string[]; installed: boolean }>;
  releasePacks: RuntimeReleasePack[];
  managedState: ManagedRuntimeStateView | null;
  managedRuntimeReadiness: { state: string; ready: boolean; reasons: string[] };
  doctorRepairPlan?: { summary: string; executionStatus: string; executionBlocker: string | null; requiresConfirmation: boolean };
  status: { state: string; detail: string; installedPacks: string[] };
}
interface ManagedRuntimeStateView {
  selectedPackIds: string[];
  selectedReleasePackIds: string[];
  installedAt: string;
  hashVerified: boolean;
  verificationWarnings: string[];
  rollbackPath: string | null;
}
interface SandboxImageReadiness {
  state: "ready" | "missing_release" | "integrity_failed" | "engine_unavailable" | "image_missing" | "incompatible" | "repair_failed";
  ready: boolean;
  image: string | null;
  repairAction: "none" | "load" | "reinstall_app" | "install_engine" | "retry";
  reason: string;
}
interface Props {
  session: { email: string; role: string; name: string };
  onComplete: () => void;
  onLogout: () => void;
  embedded?: boolean;
  initialConnectorId?: string | null;
}

const READINESS_CONNECTOR_IDS = ["fred", "simfin", "finnhub", "world_bank"] as const;
const READINESS_FALLBACK_NAMES: Record<typeof READINESS_CONNECTOR_IDS[number], string> = {
  fred: "FRED",
  simfin: "SimFin",
  finnhub: "Finnhub",
  world_bank: "World Bank",
};

type ReadinessTone = "live" | "configured" | "cached" | "public" | "unavailable";

interface ProviderReadiness {
  label: string;
  tone: ReadinessTone;
  detail: string;
}

function providerReadiness(connector: ConnectorDef | undefined, health: ConnectorHealth | undefined): ProviderReadiness {
  const state = health?.state ?? "unavailable";
  const isPublic = connector?.sourceType === "public_api" || connector?.id === "world_bank";
  const cached = state === "cached_fallback" || /cache|fallback/i.test(health?.detail ?? "");

  if (isPublic) {
    if (state === "live_verified") return { label: "PUBLIC / NO KEY · LIVE VERIFIED", tone: "live", detail: health?.detail ?? "Public data endpoint verified live." };
    if (cached) return { label: "PUBLIC / NO KEY · CACHED FALLBACK", tone: "cached", detail: health?.detail ?? "Live endpoint unavailable; using an explicitly reported cached fallback." };
    if (state === "degraded" || state === "rate_limited" || state === "disabled" || state === "unavailable") {
      return { label: "PUBLIC / NO KEY · UNAVAILABLE", tone: "unavailable", detail: health?.detail ?? "No live status is available." };
    }
    return { label: "PUBLIC / NO KEY", tone: "public", detail: health?.detail ?? "No credential is required; live verification has not been reported." };
  }

  if (state === "live_verified") return { label: "LIVE VERIFIED", tone: "live", detail: health?.detail ?? "Most recent live check succeeded." };
  if (state === "credential_configured") return { label: "CONFIGURED CREDENTIAL", tone: "configured", detail: health?.detail ?? "Credential is configured; no live check has been reported." };
  if (cached) return { label: "CACHED FALLBACK", tone: "cached", detail: health?.detail ?? "Live endpoint unavailable; using an explicitly reported cached fallback." };
  return { label: "UNAVAILABLE", tone: "unavailable", detail: health?.detail ?? "Credential or live provider status is unavailable." };
}

function readinessToneClass(tone: ReadinessTone): string {
  switch (tone) {
    case "live": return "text-emerald-400 border-emerald-500/30 bg-emerald-500/5";
    case "configured": return "text-cyan-400 border-cyan-500/30 bg-cyan-500/5";
    case "cached": return "text-amber-400 border-amber-500/30 bg-amber-500/5";
    case "public": return "text-teal-400 border-teal-500/30 bg-teal-500/5";
    case "unavailable": return "text-rose-400 border-rose-500/30 bg-rose-500/5";
  }
}

function formatHealthTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
type ModalType = null | "provider" | "database" | "api" | "storage" | "import";
type CategoryTab = "all" | "market" | "fundamentals" | "macro" | "filings" | "ai" | "crypto" | "alt_data" | "storage";

const CATEGORY_TABS: { key: CategoryTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "market", label: "Market Data" },
  { key: "fundamentals", label: "Fundamentals" },
  { key: "macro", label: "Macro" },
  { key: "filings", label: "Filings" },
  { key: "ai", label: "AI" },
  { key: "crypto", label: "Crypto" },
];

const CATEGORY_COLORS: Record<string, string> = {
  market: "border-blue-500/50 text-blue-400",
  fundamentals: "border-violet-500/50 text-violet-400",
  macro: "border-teal-500/50 text-teal-400",
  filings: "border-orange-500/50 text-orange-400",
  ai: "border-pink-500/50 text-pink-400",
  crypto: "border-yellow-500/50 text-yellow-400",
  research: "border-cyan-500/50 text-cyan-400",
  platform: "border-indigo-500/50 text-indigo-400",
  private_data: "border-gray-500/50 text-gray-400",
  operations: "border-gray-500/50 text-gray-400",
};

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  healthy: CheckCircle2, configured: AlertTriangle, degraded: AlertTriangle,
  unreachable: XCircle, invalid: XCircle, not_configured: KeyRound,
};
const STATUS_COLOR: Record<string, string> = {
  healthy: "text-emerald-400", configured: "text-blue-400", degraded: "text-amber-400",
  unreachable: "text-rose-400", invalid: "text-rose-400", not_configured: "text-muted-foreground",
};
const STATUS_BORDER: Record<string, string> = {
  healthy: "border-emerald-500/30", configured: "border-blue-500/30", degraded: "border-amber-500/30",
  unreachable: "border-rose-500/30", invalid: "border-rose-500/30",
};

const FREE_SOURCE_IDS = ["sec_edgar", "world_bank", "imf", "bls"];

// Connectors to hide from the catalog (they're accessed via dedicated modals)
const META_CONNECTOR_IDS = new Set(["database", "private_api", "file_upload"]);

// ── Shared UI pieces ───────────────────────────────────────────────────────

const inputCls = "min-h-11 w-full rounded-md border border-border bg-[#0d0d0d] px-3 py-2 font-ui text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block font-ui text-sm font-medium text-muted-foreground">{label}</span>{children}</label>;
}

function ActionRow({ testing, saving, canAct, onTest, onSave, saveLabel }: { testing: boolean; saving: boolean; canAct: boolean; onTest: () => void; onSave: () => void; saveLabel?: string }) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <button onClick={onTest} disabled={!canAct || testing || saving} className="min-h-11 rounded-md border border-border px-3 py-2 font-ui text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40">
        {testing ? "Testing..." : "Test Connection"}
      </button>
      <button onClick={onSave} disabled={!canAct || saving || testing} className="min-h-11 rounded-md border border-primary bg-primary/10 px-4 py-2 font-ui text-sm font-semibold text-primary hover:bg-primary/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40">
        {saving ? "Saving..." : saveLabel ?? "Save Connection"}
      </button>
    </div>
  );
}

function ResultBanner({ ok, detail }: { ok: boolean; detail: string }) {
  return (
    <div role={ok ? "status" : "alert"} className={`rounded border px-3 py-2 font-ui text-sm ${ok ? "border-emerald-500/40 text-emerald-400" : "border-rose-500/40 text-rose-400"}`}>
      {ok ? "✓ " : "✗ "}{detail}
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        className="max-h-[min(90dvh,760px)] w-[calc(100vw-24px)] max-w-lg gap-4 overflow-y-auto overscroll-contain rounded-xl border-border bg-[#0a0a0a] p-4 text-foreground shadow-2xl sm:p-6"
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (opener?.isConnected && !opener.matches(":disabled,[aria-disabled=true]")) {
            opener.focus();
          } else {
            document.querySelector<HTMLElement>('[data-testid="connection-primary-actions"] button:not(:disabled), #ai-provider-select:not(:disabled)')?.focus();
          }
        }}
      >
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="font-ui text-lg font-semibold tracking-tight">{title}</DialogTitle>
          <DialogDescription className="sr-only">Configure this connection using the existing LiOS credential and source controls.</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const colors = CATEGORY_COLORS[category] ?? "border-gray-500/50 text-gray-400";
  const label = category === "private_data" ? "Private" : category.charAt(0).toUpperCase() + category.slice(1);
  return <span className={`font-terminal text-[7px] px-1.5 py-0.5 border uppercase ${colors}`}>{label}</span>;
}


// ── Connect Provider Modal ─────────────────────────────────────────────────

function ConnectProviderModal({ connector, editing, onClose, onSaved, onModelsDiscovered }: { connector: ConnectorDef; editing?: SavedConnection | null; onClose: () => void; onSaved: () => void; onModelsDiscovered?: (connectorId: string, models: string[] | undefined, complete: boolean | undefined) => void }) {
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string; availableModels?: string[]; availableModelsComplete?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const needsKey = connector.sourceType === "keyed_api";
  const canVerify = connector.sourceType !== "keyed_api" || connector.adapterImplemented !== false;

  async function testCredential(): Promise<{ state: string; detail: string; availableModels?: string[]; availableModelsComplete?: boolean }> {
    if (!canVerify) {
      return { state: "unreachable", detail: `${connector.name} is catalog-only in this build. Choose a provider with a live adapter (for example FRED, Finnhub, LSE, or SimFin).` };
    }
    if (!needsKey) return { state: "healthy", detail: `${connector.name} requires no credential.` };
    const { value, rejection } = normalizeProviderApiCredential(key);
    if (rejection) return { state: "invalid", detail: `${rejection} Nothing was saved.` };
    const response = await apiRequest("POST", "/api/setup/provider-credentials/test", { connectorId: connector.id, credential: value });
    return await response.json() as { state: string; detail: string; availableModels?: string[]; availableModelsComplete?: boolean };
  }

  async function handleTest() {
    if (needsKey && !key.trim()) return;
    if (connector.id === "gemini") onModelsDiscovered?.(connector.id, undefined, undefined);
    setTesting(true); setTestResult(null);
    try {
      const result = await testCredential();
      setTestResult({ ok: result.state === "healthy", detail: result.detail, availableModels: result.availableModels, availableModelsComplete: result.availableModelsComplete });
      if (connector.id === "gemini" && result.availableModels) onModelsDiscovered?.(connector.id, result.availableModels, result.availableModelsComplete === true);
    } catch (err) {
      if (connector.id === "gemini") onModelsDiscovered?.(connector.id, undefined, undefined);
      setTestResult({ ok: false, detail: err instanceof Error ? err.message : "Test failed." });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (needsKey && !key.trim()) return;
    if (connector.id === "gemini") onModelsDiscovered?.(connector.id, undefined, undefined);
    setSaving(true); setTestResult(null);
    try {
      const result = await testCredential();
      if (result.state !== "healthy") {
        setTestResult({ ok: false, detail: `${result.detail} Save is blocked until the credential is verified.` });
        return;
      }
      if (connector.id === "gemini" && result.availableModels) onModelsDiscovered?.(connector.id, result.availableModels, result.availableModelsComplete === true);
      if (needsKey && connector.vaultKey) {
        const saved = normalizeProviderApiCredential(key);
        if (saved.rejection) {
          setTestResult({ ok: false, detail: `${saved.rejection} Save is blocked until the credential is verified.` });
          return;
        }
        await apiRequest("PUT", `/api/setup/credentials/${connector.vaultKey}`, { value: saved.value, label: connector.name });
      }
      await apiRequest("PUT", "/api/setup/source-connections", {
        id: editing?.id,
        connectorId: connector.id, name: connector.name, sourceType: connector.sourceType,
        config: {}, credentialRef: connector.vaultKey ?? null,
      });
      onSaved();
    } catch (err) {
      setTestResult({ ok: false, detail: err instanceof Error ? err.message : "Failed to verify and save." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={editing ? `Update ${connector.name}` : `Connect ${connector.name}`} onClose={() => { if (!saving && !testing) onClose(); }}>
      {/* Description */}
      {connector.description && (
        <p className="mb-3 font-ui text-sm leading-6 text-muted-foreground">{connector.description}</p>
      )}
      {connector.sourceType === "public_api" ? (
        <p className="mb-3 font-ui text-sm leading-6 text-teal-400/90">
          PUBLIC / NO KEY — no credential is required. The Open API URL below is documentation only, not a credential.
        </p>
      ) : (
        <p className="mb-3 font-ui text-sm leading-6 text-muted-foreground">{connector.setupGuide}</p>
      )}

      {/* Website link */}
      {connector.websiteUrl && (
        <a href={connector.websiteUrl} target="_blank" rel="noopener noreferrer"
          className="mb-3 inline-flex min-h-10 items-center gap-1.5 font-ui text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <ExternalLink className="w-3 h-3" /> {connector.sourceType === "public_api" ? "Open API documentation" : "Register / Get API Key"}
        </a>
      )}

      {/* Rate limits */}
      {connector.rateLimits && (
        <p className="mb-3 font-ui text-xs leading-5 text-muted-foreground">
          <span className="text-amber-400/70">Rate limits:</span> {connector.rateLimits}
        </p>
      )}
      {connector.id === "lse" && (
        <p className="mb-3 font-ui text-sm leading-6 text-cyan-400/90">
          Paste the <strong className="font-normal text-cyan-300">Vault API key</strong> from londonstrategicedge.com/data after you create an account. Site login passwords are not API keys.
        </p>
      )}

      <div className="space-y-3">
        {needsKey && (
          <label className="block">
            <span className="font-ui text-sm font-medium text-muted-foreground">API Key</span>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your API key here"
              className={`${inputCls} mt-1`} autoComplete="off" />
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={handleTest} disabled={!canVerify || (needsKey && !key.trim()) || testing || saving} className="min-h-11 rounded-md border border-border px-3 py-2 font-ui text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40">
            {testing ? "Testing..." : "Test Connection"}
          </button>
          <button onClick={handleSave} disabled={!canVerify || (needsKey && !key.trim()) || saving || testing} className="min-h-11 rounded-md border border-primary bg-primary/10 px-4 py-2 font-ui text-sm font-semibold text-primary hover:bg-primary/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40">
            {saving ? "Saving..." : "Save & Connect"}
          </button>
        </div>
        {testResult && <ResultBanner ok={testResult.ok} detail={testResult.detail} />}
        {testResult?.availableModels && (
          <div className="rounded border border-border bg-[#0d0d0d] px-3 py-2 font-ui text-sm leading-6 text-muted-foreground" role="status" data-testid="gemini-model-discovery-result">
            {testResult.availableModels.length > 0
              ? `${testResult.availableModels.length} Gemini chat models were returned${testResult.availableModelsComplete ? "" : " on the first page; more pages exist"}. The list is read-only; no prompt was sent.`
              : testResult.availableModelsComplete
                ? "The key was accepted, but Google returned no models supporting generateContent. No prompt was sent."
                : "The key was accepted, but the first page contained no chat models and more pages exist. No prompt was sent."}
          </div>
        )}
        {!canVerify && (
          <p className="mt-2 font-ui text-sm leading-6 text-amber-400/90">
            This provider is listed for planning only. Live API verification is not available until its adapter ships in a future build.
          </p>
        )}
      </div>

      {/* Capability tags */}
      <div className="mt-4 flex gap-1 flex-wrap">
        {connector.capabilities.map((cap) => (
          <span key={cap.contractFamily} className="font-terminal text-[7px] px-1.5 py-0.5 border border-border text-muted-foreground">
            {cap.contractFamily}{cap.coverage ? ` · ${cap.coverage}` : ""}
          </span>
        ))}
      </div>
    </ModalShell>
  );
}

// ── Add Database Modal ─────────────────────────────────────────────────────

function parseDatabaseEndpoint(endpoint: string, dbType: string): { host: string; port: string; database: string; filePath: string } {
  if (dbType === "sqlite" || dbType === "duckdb") {
    const prefix = `${dbType}://`;
    return { host: "", port: "", database: "", filePath: endpoint.startsWith(prefix) ? endpoint.slice(prefix.length) : "" };
  }
  const match = /^[a-z0-9]+:\/\/([^:/]+):(\d+)\/(.*)$/i.exec(endpoint);
  return match ? { host: match[1], port: match[2], database: match[3], filePath: "" } : { host: "", port: "", database: "", filePath: "" };
}

function AddDatabaseModal({ editing, onClose, onSaved }: { editing?: SavedConnection | null; onClose: () => void; onSaved: () => void }) {
  const initialDbType = (editing?.config.databaseType as "postgresql" | "mysql" | "sqlite" | "duckdb" | undefined) ?? "postgresql";
  const initialParsed = editing ? parseDatabaseEndpoint(String(editing.config.endpoint ?? ""), initialDbType) : { host: "", port: "", database: "", filePath: "" };
  const [name, setName] = useState(editing?.name ?? "");
  const [dbType, setDbType] = useState<"postgresql" | "mysql" | "sqlite" | "duckdb">(initialDbType);
  const [host, setHost] = useState(initialParsed.host);
  const [port, setPort] = useState(initialParsed.port);
  const [database, setDatabase] = useState(initialParsed.database);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [ssl, setSsl] = useState(false);
  const [filePath, setFilePath] = useState(initialParsed.filePath);
  const [schema, setSchema] = useState((editing?.config.schema as string | null | undefined) ?? "");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const isFileDb = dbType === "sqlite" || dbType === "duckdb";
  const endpoint = isFileDb ? `${dbType}://${filePath}` : `${dbType}://${host}:${port || (dbType === "mysql" ? "3306" : "5432")}/${database}`;
  const hasNewCredential = !isFileDb && !!(username.trim() || password.trim());
  const credentialJson = JSON.stringify({ username, password, ssl });
  const effectiveCredentialRef = editing?.credentialRef ?? `db_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

  async function persistCredentialIfNeeded() {
    if (!isFileDb && (hasNewCredential || !editing)) {
      await apiRequest("PUT", `/api/setup/credentials/${effectiveCredentialRef}`, { value: credentialJson, label: `Database: ${name}` });
    }
  }

  async function handleTest() {
    setTesting(true); setResult(null);
    try {
      await persistCredentialIfNeeded();
      const res = await apiRequest("PUT", "/api/setup/source-connections", {
        id: editing?.id,
        connectorId: editing?.connectorId ?? "database", name: name || "Database", sourceType: "database",
        config: { endpoint, databaseType: dbType, schema: schema || null }, credentialRef: isFileDb ? null : effectiveCredentialRef,
      });
      const body = await res.json() as { connection?: { id?: number } };
      if (body.connection?.id) {
        const testRes = await apiRequest("POST", "/api/setup/source-connections/test", { connectionId: body.connection.id });
        const testBody = await testRes.json() as { status?: string; detail?: string };
        setResult({ ok: testBody.status === "healthy", detail: testBody.detail ?? "Unknown" });
      }
    } catch (err) {
      setResult({ ok: false, detail: err instanceof Error ? err.message : "Test failed." });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await persistCredentialIfNeeded();
      await apiRequest("PUT", "/api/setup/source-connections", {
        id: editing?.id,
        connectorId: editing?.connectorId ?? "database", name: name || "Database", sourceType: "database",
        config: { endpoint, databaseType: dbType, schema: schema || null }, credentialRef: isFileDb ? null : effectiveCredentialRef,
      });
      onSaved();
    } catch {
      setResult({ ok: false, detail: "Failed to save." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={editing ? "Edit Database Connection" : "Add Database Connection"} onClose={onClose}>
      <div className="space-y-3">
        <Row label="Connection name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Production DB" className={inputCls} /></Row>
        <Row label="Database type">
          <select value={dbType} onChange={(e) => setDbType(e.target.value as typeof dbType)} className={inputCls}>
            <option value="postgresql">PostgreSQL</option><option value="mysql">MySQL</option>
            <option value="sqlite">SQLite</option><option value="duckdb">DuckDB</option>
          </select>
        </Row>
        {isFileDb ? (
          <Row label="File path"><input value={filePath} onChange={(e) => setFilePath(e.target.value)} placeholder="/path/to/database.db" className={inputCls} /></Row>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Row label="Host"><input value={host} onChange={(e) => setHost(e.target.value)} placeholder="db.example.com" className={inputCls} /></Row>
              <Row label="Port"><input value={port} onChange={(e) => setPort(e.target.value)} placeholder={dbType === "mysql" ? "3306" : "5432"} className={inputCls} /></Row>
              <Row label="Database"><input value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="limuria" className={inputCls} /></Row>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Row label={editing ? "Username (leave blank to keep current)" : "Username"}><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="readonly_user" className={inputCls} /></Row>
              <Row label={editing ? "Password (leave blank to keep current)" : "Password"}><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={inputCls} autoComplete="off" /></Row>
            </div>
            <label className="flex items-center gap-2 font-terminal text-[9px] text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={ssl} onChange={(e) => setSsl(e.target.checked)} className="accent-[hsl(38,95%,50%)]" /> Require SSL
            </label>
          </>
        )}
        <Row label="Schema (optional)"><input value={schema} onChange={(e) => setSchema(e.target.value)} placeholder="public" className={inputCls} /></Row>
        <ActionRow testing={testing} saving={saving} canAct={isFileDb ? !!filePath : !!(host && database && (username.trim() || !!editing))} onTest={handleTest} onSave={handleSave} saveLabel={editing ? "Update Connection" : undefined} />
        {result && <ResultBanner ok={result.ok} detail={result.detail} />}
      </div>
    </ModalShell>
  );
}

// ── Add API Modal ──────────────────────────────────────────────────────────

function AddApiModal({ onClose, onSaved, seed, editing }: { onClose: () => void; onSaved: () => void; seed?: CatalogProvider | null; editing?: SavedConnection | null }) {
  const [name, setName] = useState(editing?.name ?? seed?.name ?? "");
  const [protocol, setProtocol] = useState<"rest" | "graphql" | "soap">((editing?.config.protocol as "rest" | "graphql" | "soap" | undefined) ?? (seed?.category === "ai" ? "rest" : "rest"));
  const [endpoint, setEndpoint] = useState((editing?.config.endpoint as string | undefined) ?? seed?.defaultEndpoint ?? "");
  const [authMode, setAuthMode] = useState<"bearer" | "x-api-key" | "none">((editing?.config.authMode as "bearer" | "x-api-key" | "none" | undefined) ?? (seed?.authType === "none" ? "none" : seed?.authType === "api_key" ? "x-api-key" : "bearer"));
  const [credential, setCredential] = useState("");
  const [pageParam, setPageParam] = useState((editing?.config.pageParam as string | undefined) ?? "");
  const [responsePath, setResponsePath] = useState((editing?.config.responsePath as string | undefined) ?? "");
  const [graphqlQuery, setGraphqlQuery] = useState((editing?.config.graphqlQuery as string | undefined) ?? "");
  const [soapBody, setSoapBody] = useState((editing?.config.soapBody as string | undefined) ?? "");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const effectiveCredentialRef = editing?.credentialRef ?? `api_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

  async function handleTest() {
    setTesting(true); setResult(null);
    try {
      if (credential.trim()) {
        await apiRequest("PUT", `/api/setup/credentials/${effectiveCredentialRef}`, { value: credential.trim(), label: `API: ${name}` });
      }
      const config: Record<string, string | number | boolean | null> = { endpoint, protocol, authMode };
      if (pageParam) config.pageParam = pageParam;
      if (responsePath) config.responsePath = responsePath;
      if (graphqlQuery) config.graphqlQuery = graphqlQuery;
      if (soapBody) config.soapBody = soapBody;
      const res = await apiRequest("PUT", "/api/setup/source-connections", {
        id: editing?.id,
        connectorId: editing?.connectorId ?? "private_api", name: name || "Private API", sourceType: "private_api",
        config, credentialRef: credential.trim() ? effectiveCredentialRef : (editing?.credentialRef ?? null),
      });
      const body = await res.json() as { connection?: { id?: number } };
      if (body.connection?.id) {
        const testRes = await apiRequest("POST", "/api/setup/source-connections/test", { connectionId: body.connection.id });
        const testBody = await testRes.json() as { status?: string; detail?: string };
        setResult({ ok: testBody.status === "healthy", detail: testBody.detail ?? "Unknown" });
      }
    } catch (err) {
      setResult({ ok: false, detail: err instanceof Error ? err.message : "Test failed." });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (credential.trim()) {
        await apiRequest("PUT", `/api/setup/credentials/${effectiveCredentialRef}`, { value: credential.trim(), label: `API: ${name}` });
      }
      const config: Record<string, string | number | boolean | null> = { endpoint, protocol, authMode };
      if (pageParam) config.pageParam = pageParam;
      if (responsePath) config.responsePath = responsePath;
      if (graphqlQuery) config.graphqlQuery = graphqlQuery;
      if (soapBody) config.soapBody = soapBody;
      await apiRequest("PUT", "/api/setup/source-connections", {
        id: editing?.id,
        connectorId: editing?.connectorId ?? "private_api", name: name || "Private API", sourceType: "private_api",
        config, credentialRef: credential.trim() ? effectiveCredentialRef : (editing?.credentialRef ?? null),
      });
      onSaved();
    } catch {
      setResult({ ok: false, detail: "Failed to save." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={editing ? "Edit Custom API Connection" : "Add Custom API Connection"} onClose={onClose}>
      <div className="space-y-3">
        <Row label="Connection name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Data API" className={inputCls} /></Row>
        <div className="grid grid-cols-2 gap-2">
          <Row label="Protocol">
            <select value={protocol} onChange={(e) => setProtocol(e.target.value as typeof protocol)} className={inputCls}>
              <option value="rest">REST</option><option value="graphql">GraphQL</option><option value="soap">SOAP</option>
            </select>
          </Row>
          <Row label="Auth type">
            <select value={authMode} onChange={(e) => setAuthMode(e.target.value as typeof authMode)} className={inputCls}>
              <option value="bearer">Bearer token</option><option value="x-api-key">X-API-Key header</option><option value="none">No auth</option>
            </select>
          </Row>
        </div>
        <Row label="Endpoint URL"><input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.example.com/v1/data" className={inputCls} /></Row>
        {authMode !== "none" && (
          <Row label={editing ? "Credential (leave blank to keep current)" : "Credential"}><input type="password" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="API key or bearer token" className={inputCls} autoComplete="off" /></Row>
        )}
        {protocol === "rest" && (
          <div className="grid grid-cols-2 gap-2">
            <Row label="Page parameter"><input value={pageParam} onChange={(e) => setPageParam(e.target.value)} placeholder="page" className={inputCls} /></Row>
            <Row label="Response JSON path"><input value={responsePath} onChange={(e) => setResponsePath(e.target.value)} placeholder="data.results" className={inputCls} /></Row>
          </div>
        )}
        {protocol === "graphql" && (
          <Row label="GraphQL query"><textarea value={graphqlQuery} onChange={(e) => setGraphqlQuery(e.target.value)} placeholder="{ companies { name revenue } }" rows={3} className={inputCls + " resize-none"} /></Row>
        )}
        {protocol === "soap" && (
          <Row label="SOAP body"><textarea value={soapBody} onChange={(e) => setSoapBody(e.target.value)} placeholder="<Envelope>...</Envelope>" rows={3} className={inputCls + " resize-none"} /></Row>
        )}
        <ActionRow testing={testing} saving={saving} canAct={!!endpoint} onTest={handleTest} onSave={handleSave} saveLabel={editing ? "Update Connection" : undefined} />
        {result && <ResultBanner ok={result.ok} detail={result.detail} />}
      </div>
    </ModalShell>
  );
}

// ── Provider Catalog Card ──────────────────────────────────────────────────

function ProviderCard({
  connector, isConnected, onConnect,
}: {
  connector: ConnectorDef; isConnected: boolean; onConnect: () => void;
}) {
  const canConnect = isConnectorConnectable(connector);
  return (
    <div className="border border-border bg-[#070707] p-4 hover:border-[hsl(38,95%,50%)]/30 transition-colors group">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="font-terminal text-[10px] font-bold uppercase text-foreground leading-tight">{connector.name}</span>
        {isConnected && <KeyRound className="w-3.5 h-3.5 text-cyan-300 shrink-0 mt-0.5" />}
      </div>

      {connector.description && (
        <p className="font-terminal text-[8px] text-muted-foreground mb-2 leading-relaxed line-clamp-2">{connector.description}</p>
      )}

      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <CategoryBadge category={connector.category} />
        {!canConnect && <span className="font-terminal text-[7px] px-1.5 py-0.5 border border-amber-500/30 text-amber-300/90">PLANNED · NO LIVE ADAPTER</span>}
      </div>

      {/* Capability tags */}
      <div className="flex gap-1 flex-wrap mb-3">
        {connector.capabilities.slice(0, 3).map((cap) => (
          <span key={cap.contractFamily} className="font-terminal text-[7px] px-1 py-0.5 border border-border text-muted-foreground/70">
            {cap.contractFamily}
          </span>
        ))}
        {connector.capabilities.length > 3 && (
          <span className="font-terminal text-[7px] px-1 py-0.5 text-muted-foreground/50">+{connector.capabilities.length - 3}</span>
        )}
      </div>

      {isConnected ? (
        <span className="inline-flex items-center gap-1.5 font-terminal text-[8px] uppercase text-cyan-300">
          <KeyRound className="w-3 h-3" /> Saved configuration
        </span>
      ) : canConnect ? (
        <button onClick={onConnect}
          className="font-terminal text-[8px] uppercase px-3 py-1.5 border border-[hsl(38,95%,50%)]/50 text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10 transition-colors">
          Connect
        </button>
      ) : (
        <span className="font-terminal text-[8px] uppercase text-amber-300/80">Catalog only · adapter pending</span>
      )}
    </div>
  );
}

// ── Connection Card ────────────────────────────────────────────────────────

function AddStorageModal({ onClose, onSaved, seed, editing }: { onClose: () => void; onSaved: () => void; seed?: CatalogProvider | null; editing?: SavedConnection | null }) {
  const [name, setName] = useState(editing?.name ?? seed?.name ?? "");
  const [storageType, setStorageType] = useState((editing?.config.storageType as string | undefined) ?? seed?.name ?? "S3");
  const [endpoint, setEndpoint] = useState((editing?.config.endpoint as string | undefined) ?? seed?.defaultEndpoint ?? "");
  const [credential, setCredential] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const effectiveCredentialRef = editing?.credentialRef ?? `custom_storage_${(name || "connection").toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
  async function persist(): Promise<number> {
    if (credential.trim()) await apiRequest("PUT", `/api/setup/credentials/${effectiveCredentialRef}`, { value: credential.trim(), label: `Storage: ${name}` });
    const response = await apiRequest("PUT", "/api/setup/source-connections", {
      id: editing?.id,
      connectorId: editing?.connectorId ?? `custom_storage_${storageType.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
      name: name || storageType, sourceType: "cloud_storage",
      config: { endpoint, storageType }, credentialRef: credential.trim() ? effectiveCredentialRef : (editing?.credentialRef ?? null),
    });
    const body = await response.json() as { connection?: { id?: number } };
    if (!body.connection?.id) throw new Error("Storage connection was not saved.");
    return body.connection.id;
  }
  async function test() {
    setSaving(true);
    try {
      const id = await persist();
      const response = await apiRequest("POST", "/api/setup/source-connections/test", { connectionId: id });
      const body = await response.json() as { status?: string; detail?: string };
      setResult({ ok: body.status === "healthy", detail: body.detail ?? "Storage test completed." });
    } catch (error) {
      setResult({ ok: false, detail: error instanceof Error ? error.message : "Storage test failed." });
    } finally { setSaving(false); }
  }
  async function save() {
    setSaving(true);
    try {
      await persist();
      onSaved();
    } catch (error) {
      setResult({ ok: false, detail: error instanceof Error ? error.message : "Could not save storage connection." });
    } finally { setSaving(false); }
  }
  return (
    <ModalShell title={editing ? "Edit Storage Connection" : "Add Storage Connection"} onClose={onClose}>
      <div className="space-y-3">
        <Row label="Connection name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Data Lake" className={inputCls} /></Row>
        <Row label="Storage type"><select value={storageType} onChange={(e) => setStorageType(e.target.value)} className={inputCls}><option>AWS S3</option><option>Google Cloud Storage</option><option>Azure Blob Storage</option><option>Google Drive</option><option>OneDrive</option><option>SharePoint</option><option>SFTP</option><option>Local Folder</option></select></Row>
        <Row label="Endpoint / bucket / folder"><input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://storage.example.com/path" className={inputCls} /></Row>
        <Row label={editing ? "Credential or access token (leave blank to keep current)" : "Credential or access token (optional)"}><input type="password" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="Paste credential or token" className={inputCls} autoComplete="off" /></Row>
        <ActionRow testing={false} saving={saving} canAct={!!name && !!endpoint} onTest={test} onSave={save} saveLabel={editing ? "Update Connection" : undefined} />
        {result && <ResultBanner ok={result.ok} detail={result.detail} />}
      </div>
    </ModalShell>
  );
}

function ConnectionCard({
  conn, onTest, onEdit, onRemove,
}: {
  conn: SavedConnection;
  onTest: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const Icon = STATUS_ICON[conn.status] ?? KeyRound;
  const color = STATUS_COLOR[conn.status] ?? "text-muted-foreground";
  const borderColor = STATUS_BORDER[conn.status] ?? "border-border";
  const recovery = connectionRecoveryPresentation(conn.status);

  return (
    <div className={`border ${borderColor} bg-[#070707] p-3`} data-connection-state={recovery.needsAttention ? "attention" : "ready"}>
      <div className="flex items-center gap-2">
        <Icon className={`w-3.5 h-3.5 ${color} shrink-0`} />
        <span className="truncate font-ui text-sm font-semibold text-foreground">{conn.name}</span>
        <span className={`ml-auto shrink-0 font-ui text-xs ${color}`}>{conn.status}</span>
      </div>
      <div className="mt-1 font-ui text-xs text-muted-foreground">
        {conn.sourceType}{conn.lastTestedAt ? ` · tested ${new Date(conn.lastTestedAt).toLocaleDateString()}` : ""}
      </div>
      {conn.statusDetail && <div className="mt-1 break-words font-ui text-sm text-muted-foreground">{conn.statusDetail}</div>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={onTest} className={`min-h-10 rounded border border-border px-3 py-2 font-ui text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${recovery.needsAttention ? "text-amber-300 hover:text-amber-200" : "text-muted-foreground hover:text-foreground"}`}>{recovery.testLabel}</button>
        <button onClick={onEdit} className={`min-h-10 rounded border border-border px-3 py-2 font-ui text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${recovery.needsAttention ? "text-amber-300 hover:text-amber-200" : "text-muted-foreground hover:text-foreground"}`}>{recovery.editLabel}</button>
        <button onClick={onRemove} aria-label={`Remove saved connection ${conn.name}`} className="min-h-10 rounded border border-rose-500/30 px-3 py-2 font-ui text-sm text-rose-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Remove</button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function DataConnectionCenter({ session, onComplete, onLogout, embedded = false, initialConnectorId = null }: Props) {
  const qc = useQueryClient();
  const [modal, setModal] = useState<ModalType>(null);
  const [removalTarget, setRemovalTarget] = useState<number | null>(null);
  const [removingConnection, setRemovingConnection] = useState(false);
  const [removalError, setRemovalError] = useState<string | null>(null);
  const removalInFlight = useRef(false);
  const [selectedProvider, setSelectedProvider] = useState<ConnectorDef | null>(null);
  const handledGuidedConnector = useRef<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [aiProviderId, setAiProviderId] = useState("");
  const [aiModelId, setAiModelId] = useState("");
  const [verifiedModelsByProvider, setVerifiedModelsByProvider] = useState<Record<string, { models: string[]; complete: boolean; endpoint?: string }>>({});
  const [localEndpoints, setLocalEndpoints] = useState<Record<string, string>>({});
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [chatVerification, setChatVerification] = useState<ChatVerification | null>(null);
  const [masterBusy, setMasterBusy] = useState(false);
  const setupHydratedRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [pythonRuntimeId, setPythonRuntimeId] = useState("lios-managed");
  const [pythonEnvironmentPath, setPythonEnvironmentPath] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // The chooser owns its own query: browsing one provider must not silently
  // alter the underlying provider catalog filters when focus returns.
  const [providerPickerQuery, setProviderPickerQuery] = useState("");
  const [activeTab, setActiveTab] = useState<CategoryTab>("all");
  const [catalogSeed, setCatalogSeed] = useState<CatalogProvider | null>(null);
  const [editingConnection, setEditingConnection] = useState<SavedConnection | null>(null);
  const [conflictSymbol, setConflictSymbol] = useState("AAPL");
  const [conflictMetric, setConflictMetric] = useState("revenue");
  const [conflictPeriod, setConflictPeriod] = useState("FY2024");
  const [workspaceInfo, setWorkspaceInfo] = useState<DesktopWorkspaceInfo | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  // Save feedback must appear beside the "Continue" buttons; workspaceNotice renders inside Advanced.
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [providerStackOrder, setProviderStackOrder] = useState<string[]>([]);
  const [yahooConsent, setYahooConsent] = useState(false);
  const [publicFillerConsent, setPublicFillerConsent] = useState(false);
  // P10 release-pack UX expands into the existing signed low-level runtime allow-list.
  const [selectedReleasePackIds, setSelectedReleasePackIds] = useState<string[]>(["core"]);
  const [selectedAddonPackIds, setSelectedAddonPackIds] = useState<string[]>([]);
  const [runtimeBusy, setRuntimeBusy] = useState<null | "preview" | "apply">(null);
  const [runtimePreview, setRuntimePreview] = useState<RuntimeLifecyclePreview | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeNotice, setRuntimeNotice] = useState<string | null>(null);
  const setupQuery = useQuery<SetupResponse>({ queryKey: ["/api/setup/status"], queryFn: async () => (await apiRequest("GET", "/api/setup/status")).json(), staleTime: 15_000 });
  const consentQuery = useQuery<{ consents: Array<{ scope: string; active: boolean }> }>({
    queryKey: ["/api/setup/community-data-consent"],
    queryFn: async () => (await apiRequest("GET", "/api/setup/community-data-consent")).json(),
    staleTime: 15_000,
  });
  const aiProviders = setupQuery.data?.aiProviders ?? [];
  // Local providers remain selectable before connection so setup never requires an environment variable.
  const selectableAiProviders = aiProviders.filter((provider) => provider.isLocal || provider.available || provider.id === aiProviderId);
  const selectedAiProvider = aiProviders.find((provider) => provider.id === aiProviderId);
  const modelDiscovery = verifiedModelsByProvider[aiProviderId];
  const modelDiscoveryComplete = modelDiscovery?.complete === true;
  const modelDiscoveryPartial = Boolean(modelDiscovery && !modelDiscovery.complete);
  const verifiedAiModels = modelDiscovery?.models ?? null;
  const aiModels = selectedAiProvider?.isLocal
    ? verifiedAiModels ?? []
    : modelDiscoveryComplete
      ? verifiedAiModels ?? []
      : verifiedAiModels?.length
        ? verifiedAiModels
        : selectedAiProvider?.models ?? [];
  const selectedModelWasReturned = !modelDiscoveryComplete || !aiModelId || Boolean(verifiedAiModels?.includes(aiModelId));
  const aiModelAccess = resolveAiModelAccess({
    modelId: aiModelId,
    discoveredModels: verifiedAiModels,
    discoveryComplete: modelDiscoveryComplete,
  });
  const aiModelBlocked = aiModelAccess === "blocked";
  const continueWithoutAi = Boolean(aiProviderId && (aiModelBlocked || !aiModelId.trim() || aiModelId.trim().length > 200));
  const chatVerified = Boolean(selectedAiProvider?.available && chatVerification?.provider === aiProviderId
    && chatVerification.model === aiModelId.trim()
    && (!selectedAiProvider.isLocal || (modelDiscovery?.endpoint && chatVerification.endpoint === modelDiscovery.endpoint)));
  const connectionsQuery = useQuery<SavedConnection[]>({ queryKey: ["/api/setup/source-connections"], queryFn: async () => (await apiRequest("GET", "/api/setup/source-connections")).json(), staleTime: 15_000 });
  const runtimeQuery = useQuery<RuntimeResponse>({ queryKey: ["/api/setup/python-runtime"], queryFn: async () => (await apiRequest("GET", "/api/setup/python-runtime")).json(), staleTime: 30_000 });
  const sandboxImageQuery = useQuery<SandboxImageReadiness>({
    queryKey: ["/api/setup/sandbox-image"],
    queryFn: async () => (await apiRequest("GET", "/api/setup/sandbox-image")).json(),
    enabled: Boolean(workspaceInfo),
    refetchInterval: (query) => query.state.data?.ready ? false : 10_000,
  });
  const [sandboxRepairBusy, setSandboxRepairBusy] = useState(false);
  const [sandboxRepairError, setSandboxRepairError] = useState<string | null>(null);
  async function repairSandbox(): Promise<void> {
    setSandboxRepairBusy(true);
    setSandboxRepairError(null);
    try {
      const response = await apiRequest("POST", "/api/setup/sandbox-image/repair");
      const result = await response.json() as SandboxImageReadiness;
      await sandboxImageQuery.refetch();
      if (!result.ready) setSandboxRepairError(result.reason);
    } catch (error) {
      setSandboxRepairError(error instanceof Error ? error.message : "Sandbox image repair failed.");
      await sandboxImageQuery.refetch();
    } finally {
      setSandboxRepairBusy(false);
    }
  }
  const [managedState, setManagedState] = useState<ManagedRuntimeStateView | null>(null);

  // Keep the release-pack UI synchronized with the canonical managed-runtime state.
  useEffect(() => {
    const state = runtimeQuery.data?.managedState ?? null;
    setManagedState(state);
    if (state?.selectedReleasePackIds?.length) {
      setSelectedReleasePackIds(Array.from(new Set(["core", ...state.selectedReleasePackIds])));
    } else {
      setSelectedReleasePackIds(["core"]);
    }
    const installed = state?.selectedPackIds ?? runtimeQuery.data?.status.installedPacks ?? [];
    setSelectedAddonPackIds(installed.includes("community-yahoo") ? ["community-yahoo"] : []);
  }, [runtimeQuery.data]);

  function toggleReleasePack(packId: string, checked: boolean): void {
    if (packId === "core") return;
    setSelectedReleasePackIds((current) => (
      checked ? Array.from(new Set([...current, packId])) : current.filter((id) => id !== packId)
    ));
  }

  function toggleManagedAddon(packId: string, checked: boolean): void {
    setSelectedAddonPackIds((current) => (
      checked ? Array.from(new Set([...current, packId])) : current.filter((id) => id !== packId)
    ));
  }

  async function previewRuntimeOperation(request: RuntimeLifecycleRequest): Promise<void> {
    setRuntimeBusy("preview");
    setRuntimeError(null);
    setRuntimeNotice(null);
    setRuntimePreview(null);
    try {
      const response = await apiRequest("POST", "/api/setup/python-runtime/lifecycle/preview", request);
      setRuntimePreview(await response.json() as RuntimeLifecyclePreview);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "Runtime preview is unavailable.");
    } finally {
      setRuntimeBusy(null);
    }
  }

  async function applyRuntimeOperation(): Promise<void> {
    if (!runtimePreview || runtimePreview.blockers.length) return;
    setRuntimeBusy("apply");
    setRuntimeError(null);
    try {
      const response = await apiRequest("POST", "/api/setup/python-runtime/lifecycle/apply", {
        request: runtimePreview.request, operationHash: runtimePreview.operationHash,
        confirmationToken: runtimePreview.confirmationToken, expiresAt: runtimePreview.expiresAt, confirmed: true,
      });
      const payload = await response.json() as { result: { detail: string }; state: ManagedRuntimeStateView | null; readiness: { ready: boolean; state: string } };
      setManagedState(payload.state);
      setRuntimeNotice(`${payload.result.detail} Current readiness: ${payload.readiness.state}.${payload.readiness.ready ? "" : " Runtime remains unavailable; review Doctor. No task was resumed."}`);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "Runtime operation did not complete safely; inspect current Doctor state before retrying.");
    } finally {
      setRuntimePreview(null);
      await runtimeQuery.refetch();
      setRuntimeBusy(null);
    }
  }
  useEffect(() => {
    const bridge = getDesktopWorkspaceBridge();
    if (!bridge) return;
    void bridge.getWorkspaceInfo().then(setWorkspaceInfo).catch(() => setWorkspaceNotice("Desktop workspace metadata is unavailable."));
  }, []);

  const connectors = setupQuery.data?.connectors.connectors ?? [];
  const healthById = useMemo(() => new Map((setupQuery.data?.connectors.health ?? []).map((h) => [h.connectorId, h])), [setupQuery.data]);
  const savedConnections = connectionsQuery.data ?? [];
  const configuredProviderIds = useMemo(() => new Set(savedConnections.map((c) => c.connectorId)), [savedConnections]);

  // Catalog: all connectors except meta-connectors (database, private_api, file_upload)
  const catalogConnectors = useMemo(() => connectors.filter((c) => !META_CONNECTOR_IDS.has(c.id)), [connectors]);

  const pickerProviders = useMemo(() => chooseConnectionProviders(catalogConnectors, providerPickerQuery), [catalogConnectors, providerPickerQuery]);

  // Reuse the exact existing setup forms when Chat names a missing provider.
  // Wait for the authenticated catalog and saved connections before opening
  // the form; an unimplemented or unknown id never installs or executes.
  useEffect(() => {
    if (!initialConnectorId || !setupQuery.data || !connectionsQuery.data
      || handledGuidedConnector.current === initialConnectorId) return;
    handledGuidedConnector.current = initialConnectorId;
    const connector = connectors.find(item => item.id === initialConnectorId);
    if (!connector || !isConnectorConnectable(connector)) {
      setSaveNotice("That provider is not available to connect in this LiOS build. Choose another listed source.");
      return;
    }
    setSaveNotice(null);
    setEditingConnection(connectionsQuery.data.find(connection => connection.connectorId === connector.id) ?? null);
    setSelectedProvider(null);
    setCatalogSeed(null);
    if (connector.sourceType === "file") setModal("import");
    else if (connector.sourceType === "database") setModal("database");
    else if (connector.sourceType === "private_api") setModal("api");
    else if (connector.sourceType === "cloud_storage") setModal("storage");
    else {
      setSelectedProvider(connector);
      setModal("provider");
    }
  }, [initialConnectorId, setupQuery.data, connectionsQuery.data, connectors]);

  const filteredCatalog = useMemo(() => {
    let items = catalogConnectors;
    if (activeTab !== "all") {
      items = items.filter((c) => c.category === activeTab);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.description ?? "").toLowerCase().includes(q),
      );
    }
    return items;
  }, [catalogConnectors, activeTab, searchQuery]);

  const availableCount = Math.max(0, catalogConnectors.filter((connector) => isConnectorConnectable(connector) && !configuredProviderIds.has(connector.id)).length);
  const connectionSummary = summarizeConnectionCenter(connectionsQuery.data, connectionsQuery.isError);

  useEffect(() => {
    if (setupHydratedRef.current || !setupQuery.data) return;
    setupHydratedRef.current = true;
    const setup = setupQuery.data.setup;
    if (!setup) return;
    setAiProviderId(setup.aiProviderId ?? "");
    setAiModelId(setup.aiModelId ?? "");
    setPythonRuntimeId(setup.pythonRuntimeId);
    setPythonEnvironmentPath(setup.pythonEnvironmentPath ?? "");
    if (setup.providerStackOrder?.length) {
      setProviderStackOrder(setup.providerStackOrder);
    } else if (setup.selectedConnectorIds.length) {
      setProviderStackOrder(setup.selectedConnectorIds);
    }
  }, [setupQuery.data]);


  useEffect(() => {
    const consents = consentQuery.data?.consents ?? [];
    setYahooConsent(consents.some((entry) => entry.scope === "yahoo_community" && entry.active));
    setPublicFillerConsent(consents.some((entry) => entry.scope === "public_filler" && entry.active));
  }, [consentQuery.data]);

  const isAiConnection = useCallback((connection: SavedConnection) => connectors.find((item) => item.id === connection.connectorId)?.category === "ai", [connectors]);
  const aiConnections = useMemo(() => savedConnections.filter(isAiConnection), [savedConnections, isAiConnection]);
  const dataConnections = useMemo(() => savedConnections.filter((connection) => !isAiConnection(connection)), [savedConnections, isAiConnection]);
  const aiConnectorsToAdd = useMemo(
    () => connectors.filter((item) => item.category === "ai" && !configuredProviderIds.has(item.id) && isConnectorConnectable(item)),
    [connectors, configuredProviderIds],
  );

  const stackEntries = useMemo(() => {
    const byId = new Map(savedConnections.map((connection) => [connection.connectorId, connection]));
    const ordered = providerStackOrder.filter((id) => byId.has(id));
    for (const connection of savedConnections) {
      if (!ordered.includes(connection.connectorId)) ordered.push(connection.connectorId);
    }
    return ordered.map((id) => byId.get(id)!);
  }, [providerStackOrder, savedConnections]);

  function focusAiProviderSelector() {
    const select = document.getElementById("ai-provider-select");
    select?.scrollIntoView({ block: "center", behavior: "smooth" });
    select?.focus();
  }

  // Source order applies to data sources only; AI providers are chosen in the AI section.
  const dataStackEntries = useMemo(() => stackEntries.filter((entry) => !isAiConnection(entry)), [stackEntries, isAiConnection]);

  function moveStackEntry(connectorId: string, direction: -1 | 1) {
    const dataIds = dataStackEntries.map((entry) => entry.connectorId);
    const index = dataIds.indexOf(connectorId);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= dataIds.length) return;
    const next = [...dataIds];
    [next[index], next[target]] = [next[target], next[index]];
    const aiIds = stackEntries.filter((entry) => isAiConnection(entry)).map((entry) => entry.connectorId);
    setProviderStackOrder([...next, ...aiIds]);
  }

  async function persistCommunityConsent(scope: "yahoo_community" | "public_filler", accept: boolean) {
    await apiRequest("PUT", "/api/setup/community-data-consent", { scope, accept, consentVersion: "v1" });
    await consentQuery.refetch();
  }

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["/api/setup/status"] });
    qc.invalidateQueries({ queryKey: ["/api/wave-c/ai/state"] });
    qc.invalidateQueries({ queryKey: ["/api/setup/source-connections"] });
    qc.invalidateQueries({ queryKey: ["/api/setup/source-registry"] });
  }, [qc]);

  const handleModalSaved = useCallback(() => {
    if (selectedProvider?.category === "ai") setChatVerification(null);
    setModal(null); setSelectedProvider(null); setProviderPickerQuery(""); setCatalogSeed(null); setEditingConnection(null); refresh();
  }, [refresh, selectedProvider]);
  const handleImported = useCallback(async () => {
    await apiRequest("PUT", "/api/setup/source-connections", {
      connectorId: "file_upload",
      name: "Imported data",
      sourceType: "file",
      config: { source: "User BYOD upload" },
      credentialRef: null,
    });
    setModal(null);
    refresh();
  }, [refresh]);

  async function handleTestConnection(connectionId: number) {
    try {
      await apiRequest("POST", "/api/setup/source-connections/test", { connectionId });
      refresh();
    } catch { refresh(); }
  }

  function handleDeleteConnection(connectionId: number) {
    if (removalInFlight.current) return;
    setRemovalError(null); setRemovalTarget(connectionId);
  }
  async function confirmDeleteConnection() {
    if (removalTarget === null || removalInFlight.current) return;
    removalInFlight.current = true; setRemovingConnection(true); setRemovalError(null);
    try {
      await apiRequest("DELETE", `/api/setup/source-connections/${removalTarget}`);
      setRemovalTarget(null); refresh();
    } catch {
      setRemovalError("This connection could not be removed. It remains listed; retry or cancel.");
    } finally {
      removalInFlight.current = false; setRemovingConnection(false);
    }
  }

  function handleEditConnection(conn: SavedConnection) {
    setEditingConnection(conn);
    const def = connectors.find((c) => c.id === conn.connectorId);
    const resolvedType = def?.sourceType ?? conn.sourceType;
    if (def && (resolvedType === "keyed_api" || resolvedType === "public_api" || resolvedType === "sidecar")) {
      setSelectedProvider(def);
      setModal("provider");
    } else if (conn.sourceType === "cloud_storage") {
      setCatalogSeed(null);
      setModal("storage");
    } else if (conn.sourceType === "database") {
      setModal("database");
    } else {
      setCatalogSeed(null);
      setModal("api");
    }
  }

  async function handleEditConnectionById(connectionId: number) {
    const cachedConnection = savedConnections.find((connection) => connection.id === connectionId);
    if (cachedConnection) {
      handleEditConnection(cachedConnection);
      return;
    }

    const refreshedConnections = await connectionsQuery.refetch();
    const refreshedConnection = refreshedConnections.data?.find(
      (connection) => connection.id === connectionId,
    );
    if (refreshedConnection) {
      handleEditConnection(refreshedConnection);
      return;
    }

    setWorkspaceNotice(
      refreshedConnections.error
        ? "Connection details could not be loaded. Check the setup service and retry."
        : "Connection details are no longer available. Refresh the source catalog.",
    );
  }

  async function turnMasterAiOff(): Promise<void> {
    const current = qc.getQueryData<MasterAiSessionState>(["/api/wave-c/ai/state"]);
    if (current?.state === "off") return;
    const response = await apiRequest("PUT", "/api/wave-c/ai/state", { state: "off", mode: current?.mode ?? "manual" });
    const saved = await response.json() as MasterAiSessionState;
    qc.setQueryData(["/api/wave-c/ai/state"], saved);
  }

  async function changeAiSelection(provider: string, model: string): Promise<void> {
    if (aiBusy || saving || masterBusy) return;
    setAiBusy(true);
    setAiNotice(null);
    try {
      await turnMasterAiOff();
      setChatVerification(null);
      setAiProviderId(provider);
      setAiModelId(model);
    } catch (error) {
      setAiNotice(`The selection was not changed because Master AI could not be turned off. ${error instanceof Error ? error.message : ""}`);
    } finally {
      setAiBusy(false);
    }
  }

  async function persistSetup(complete: boolean, withoutAi = false): Promise<void> {
    const response = await apiRequest("PUT", "/api/setup/status", {
      selectedConnectorIds: connectionsQuery.data
        ? Array.from(new Set(connectionsQuery.data.map(connection => connection.connectorId)))
        : setupQuery.data?.setup?.selectedConnectorIds ?? [],
      providerStackOrder: connectionsQuery.data
        ? stackEntries.map(entry => entry.connectorId)
        : setupQuery.data?.setup?.providerStackOrder ?? [],
      pythonRuntimeId,
      pythonEnvironmentPath: pythonEnvironmentPath || null,
      pythonPackIds: runtimeQuery.data?.status.installedPacks ?? setupQuery.data?.setup?.pythonPackIds ?? ["core"],
      aiProviderId: withoutAi ? null : aiProviderId || null,
      aiModelId: !withoutAi && aiProviderId ? aiModelId.trim() || null : null,
      complete,
    });
    const saved = await response.json() as Pick<SetupResponse, "setup" | "setupNeeded">;
    qc.setQueryData<SetupResponse>(["/api/setup/status"], (current) => current ? { ...current, ...saved } : current);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["/api/setup/status"] }),
      qc.invalidateQueries({ queryKey: ["/api/wave-c/ai/state"] }),
    ]);
  }

  async function handleConnectLocal(): Promise<void> {
    const provider = selectedAiProvider;
    if (!provider?.isLocal || !provider.defaultEndpoint || aiBusy || saving || masterBusy) return;
    const saveEndpoint = localEndpoints[provider.id] !== undefined || !provider.available;
    const endpoint = (localEndpoints[provider.id] ?? provider.defaultEndpoint).trim();
    if (saveEndpoint && !endpoint) {
      setAiNotice("Enter the local server endpoint you want to connect. Nothing was saved or contacted.");
      return;
    }
    setAiBusy(true);
    setAiNotice(null);
    setChatVerification(null);
    setVerifiedModelsByProvider((current) => {
      const next = { ...current };
      delete next[provider.id];
      return next;
    });
    if (saveEndpoint) setAiModelId("");
    let endpointSaved = false;
    try {
      if (saveEndpoint) {
        await turnMasterAiOff();
        await apiRequest("PUT", `/api/setup/credentials/${encodeURIComponent(provider.credentialName)}`, {
          value: endpoint,
          label: `${provider.name} endpoint`,
        });
        endpointSaved = true;
      }
      const response = await apiRequest("POST", "/api/setup/ai/models", { provider: provider.id });
      const discovery = await response.json() as { provider: string; endpoint: string; models: string[]; complete: boolean; detail: string };
      setVerifiedModelsByProvider((current) => ({ ...current, [provider.id]: { models: discovery.models, complete: discovery.complete, endpoint: discovery.endpoint } }));
      setLocalEndpoints(current => {
        const next = { ...current };
        delete next[provider.id];
        return next;
      });
      setAiNotice(discovery.detail);
    } catch (error) {
      setAiNotice(`${endpointSaved ? "The endpoint was saved, but models could not be listed. Chat remains unverified." : saveEndpoint ? "The endpoint was not saved." : "The saved endpoint was not changed; models could not be listed."} ${error instanceof Error ? error.message : "Retry when the local server is running."}`);
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["/api/setup/status"] }),
        qc.invalidateQueries({ queryKey: ["/api/wave-c/ai/state"] }),
      ]);
      setAiBusy(false);
    }
  }

  async function handleVerifyAi(): Promise<void> {
    if (!selectedAiProvider?.available || !aiModelId.trim() || aiModelBlocked || aiBusy || saving || masterBusy) return;
    if (selectedAiProvider.isLocal && (!modelDiscovery?.endpoint || !verifiedAiModels?.includes(aiModelId.trim()))) return;
    setAiBusy(true);
    setAiNotice(null);
    setChatVerification(null);
    let permissionOff = false;
    try {
      await turnMasterAiOff();
      permissionOff = true;
      await persistSetup(!setupQuery.data?.setupNeeded);
      const response = await apiRequest("POST", "/api/setup/ai/test", {
        provider: aiProviderId, model: aiModelId.trim(),
        ...(selectedAiProvider.isLocal ? { endpoint: modelDiscovery?.endpoint } : {}),
      });
      const result = await response.json() as ChatVerification;
      setChatVerification(result);
      setAiNotice(result.detail);
    } catch (error) {
      setAiNotice(`Chat remains unverified. ${permissionOff ? "Master AI is OFF." : "Master AI could not be confirmed OFF; its previous permission may remain."} ${error instanceof Error ? error.message : "Verification failed."}`);
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["/api/setup/status"] }),
        qc.invalidateQueries({ queryKey: ["/api/wave-c/ai/state"] }),
      ]);
      setAiBusy(false);
    }
  }

  async function handleDisconnectLocal(): Promise<void> {
    const provider = selectedAiProvider;
    if (!provider?.isLocal || provider.endpointEnvironmentManaged || aiBusy || saving || masterBusy) return;
    setAiBusy(true);
    setAiNotice(null);
    try {
      await turnMasterAiOff();
      await apiRequest("DELETE", `/api/setup/credentials/${encodeURIComponent(provider.credentialName)}`);
      setChatVerification(null);
      setAiModelId("");
      setVerifiedModelsByProvider((current) => {
        const next = { ...current };
        delete next[provider.id];
        return next;
      });
      setAiNotice("Local endpoint disconnected. Master AI is OFF; deterministic tools and your original chat draft remain available.");
    } catch (error) {
      setAiNotice(`Could not disconnect the endpoint. ${error instanceof Error ? error.message : "Retry."}`);
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["/api/setup/status"] }),
        qc.invalidateQueries({ queryKey: ["/api/wave-c/ai/state"] }),
      ]);
      setAiBusy(false);
    }
  }

  /** Return to the already-mounted Chat/Workbench without saving or changing
   * AI selection. The explicit Continue action below still persists setup. */
  const handleReturnToWork = () => returnFromConnectionCenter(onComplete);

  async function handleEnterTerminal() {
    if (aiBusy || masterBusy || saving) return;
    setSaveNotice(null);
    setSaving(true);
    try {
      if (continueWithoutAi) await turnMasterAiOff();
      await persistSetup(true, continueWithoutAi);
      onComplete();
    } catch (error) {
      setSaveNotice(`Your setup could not be saved. ${error instanceof Error ? error.message.slice(0, 160) : "Try again."}`);
    } finally {
      setSaving(false);
    }
  }

  const setupDenied = setupQuery.isError && [401, 403].includes(asyncSurfaceStatus(setupQuery.error) ?? 0);
  const setupReadState = resolveAsyncSurfaceState({ hasData: Boolean(setupQuery.data) && !setupDenied, isPending: setupQuery.isPending, isError: setupQuery.isError, error: setupQuery.error });
  if (setupReadState !== "ready") return <Shell session={session} onLogout={onLogout} embedded={embedded}>
    <AsyncSurfaceNotice surface="connections" state={setupReadState} onRetry={() => void setupQuery.refetch()} retrying={setupQuery.isFetching} onLeave={onComplete} leaveLabel="Return to Chat" />
  </Shell>;

  return (
    <Shell session={session} onLogout={onLogout} embedded={embedded}>
      {setupQuery.isError && !setupDenied && setupQuery.data && <div role="alert" className="mx-auto mb-3 w-full max-w-5xl rounded border border-amber-300/30 p-3 text-sm">
        Connection status could not be refreshed. Showing the last loaded configuration; current availability is unverified. Your open form remains here.
        <button type="button" disabled={setupQuery.isFetching} onClick={() => void setupQuery.refetch()} className="ml-2 min-h-10 underline">Retry connection status</button>
      </div>}
      <div className={embedded ? "w-full space-y-5 pb-8" : "w-full max-w-5xl space-y-5 overflow-y-auto max-h-[calc(100vh-120px)] pr-1"}>

        <div className="flex items-end justify-between border-b border-border pb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Plug className="w-4 h-4 text-[hsl(38,95%,55%)]" />
              <span className="font-terminal text-[12px] tracking-[0.2em] text-foreground uppercase">{embedded ? "Manage sources and providers" : "Data Connection Center"}</span>
            </div>
            <p className="font-ui text-[10px] text-muted-foreground">
              Add the sources you trust when you need them. LiOS can open and start useful work without any connection.
            </p>
          </div>
          <span className="font-terminal text-[7px] px-2 py-0.5 border border-emerald-500/30 text-emerald-400 uppercase tracking-wider flex items-center gap-1 shrink-0">
            <Shield className="w-2.5 h-2.5" /> Local-First
          </span>
        </div>
        <section className="border border-[hsl(38,95%,50%)]/40 bg-[hsl(38,95%,50%)]/[0.04] p-4" data-testid="connection-primary-actions" data-first-use-connections="optional" aria-label="Optional connections: add a source, import data, or continue to LiOS">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                {connectionSummary.state === "attention" || connectionSummary.state === "unavailable"
                  ? <AlertTriangle className="h-4 w-4 text-amber-300" />
                  : connectionSummary.state === "verified" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    : <KeyRound className="h-4 w-4 text-muted-foreground" />}
                <h1 className="font-terminal text-[11px] uppercase tracking-widest text-foreground">{connectionSummary.statusLabel}</h1>
              </div>
              <p className="mt-2 max-w-xl font-terminal text-[9px] leading-relaxed text-muted-foreground">{connectionSummary.statusDetail}</p>
              <p className="mt-1 font-ui text-xs text-muted-foreground">Return to previous work closes Connections without changing your AI setup or sending a request. Use Continue to save setup explicitly. A paused or failed task never resumes on its own.</p>
              {saveNotice && <p role="alert" className="mt-2 max-w-xl border border-rose-500/40 bg-rose-500/[0.05] px-2 py-1.5 font-terminal text-[8px] leading-relaxed text-rose-200">{saveNotice}</p>}
              <div role="status" className="mt-2 flex flex-wrap items-center gap-2 font-terminal text-[8px] uppercase tracking-wider text-foreground/70">
                {connectionsQuery.data && !connectionsQuery.isError && <span>{connectionSummary.savedCount} saved · {connectionSummary.verifiedCount} verified · {connectionSummary.attentionCount} need attention</span>}
                <span>{availableCount} catalog options · availability and rights checked when used</span>
                {connectionSummary.state === "unconfigured" ? <span className="text-cyan-200/75">Optional · start without setup</span> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <button type="button" onClick={handleReturnToWork} disabled={saving || aiBusy || masterBusy || runtimeBusy !== null} data-testid="connection-return-to-work"
                className="min-h-11 rounded border border-border px-3 py-2 font-ui text-sm text-foreground hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40">
                {embedded ? "Return to Chat" : "Return to previous work"}
              </button>
              <button type="button" onClick={handleEnterTerminal} disabled={saving || aiBusy || masterBusy}
                title={continueWithoutAi ? "Continue with AI disabled. You can choose and verify a model later." : undefined}
                className="flex items-center gap-1.5 border border-[hsl(38,95%,50%)]/60 bg-[hsl(38,95%,50%)]/10 px-3 py-2 font-terminal text-[9px] uppercase text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/20 disabled:opacity-40">
                <Terminal className="w-3 h-3" /> {saving ? "Saving..." : embedded ? "Save and return to Chat" : continueWithoutAi ? "Continue without AI" : connectionSummary.ctaLabel}
              </button>
            </div>
          </div>
        </section>

        {/* ── 3. Connect AI ─────────────────────────────────────────── */}
        <section className="border border-[hsl(38,95%,50%)]/25 bg-[hsl(38,95%,50%)]/[0.025] p-4 space-y-4" aria-label="Connect AI" data-testid="connect-ai">
          <div className="flex items-center gap-2 border-b border-border/60 pb-2">
            <Bot className="h-3.5 w-3.5 text-[hsl(38,95%,55%)]" />
            <h2 className="font-terminal text-[10px] uppercase tracking-widest text-foreground">AI</h2>
            <span className="font-terminal text-[7px] uppercase tracking-wider text-muted-foreground">Your provider · your key · your permission</span>
          </div>
          {aiConnections.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2" data-testid="connect-ai-connected">
              {aiConnections.map((conn) => (
                <ConnectionCard key={conn.id} conn={conn} onTest={() => handleTestConnection(conn.id)} onEdit={() => handleEditConnection(conn)} onRemove={() => handleDeleteConnection(conn.id)} />
              ))}
            </div>
          ) : (
            <p className="font-terminal text-[8px] leading-relaxed text-muted-foreground">AI is optional: deterministic analytics work without it. Connect a provider below; existing local servers do not require an API key.</p>
          )}
          {(aiConnectorsToAdd.length > 0 || aiProviders.some((provider) => provider.isLocal)) && (
            <div>
              <span className="mb-1 block font-terminal text-[8px] uppercase text-muted-foreground">Add an AI provider</span>
              <div className="flex flex-wrap gap-2">
                {aiConnectorsToAdd.map((connector) => (
                  <button key={connector.id} type="button" onClick={() => { setEditingConnection(null); setSelectedProvider(connector); setModal("provider"); }}
                    className="flex items-center gap-1.5 border border-border px-2.5 py-1.5 font-terminal text-[8px] uppercase text-muted-foreground hover:border-[hsl(38,95%,50%)]/50 hover:text-foreground">
                    <Plus className="h-3 w-3" /> {connector.name}
                  </button>
                ))}
                {aiProviders.filter((provider) => provider.isLocal).map((provider) => (
                  <button key={provider.id} type="button" onClick={() => void changeAiSelection(provider.id, "")}
                    disabled={aiBusy || saving || masterBusy}
                    data-testid={`connect-ai-${provider.id}`}
                    className="flex items-center gap-1.5 border border-border px-2.5 py-1.5 font-terminal text-[8px] uppercase text-muted-foreground hover:border-[hsl(38,95%,50%)]/50 hover:text-foreground disabled:opacity-40">
                    <Plus className="h-3 w-3" /> {provider.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="space-y-3" data-testid="connect-ai-selection">
      <div>
        <label htmlFor="ai-provider-select" className="mb-1 block font-ui text-sm font-medium text-muted-foreground">Use this provider</label>
        <select id="ai-provider-select" value={aiProviderId} onChange={(event) => void changeAiSelection(event.target.value, "")} disabled={aiBusy || saving || masterBusy} className={inputCls}>
          <option value="">AI disabled — deterministic engines only</option>
          {selectableAiProviders.map((provider) => (
            <option key={provider.id} value={provider.id} disabled={!provider.available && !provider.isLocal}>
              {provider.name}{provider.isLocal ? " (local)" : ""}{provider.available ? "" : " (not connected)"}
            </option>
          ))}
        </select>
        {selectedAiProvider?.isLocal && (
          <div className="mt-3 space-y-2 border border-border/60 p-3" data-testid="connection-local-ai">
            <Row label="Local model server endpoint (on the LiOS Home machine)">
              <input id="local-ai-endpoint" aria-label="Local model server endpoint" type="url"
                value={localEndpoints[aiProviderId] ?? modelDiscovery?.endpoint ?? (selectedAiProvider.available ? "" : selectedAiProvider.defaultEndpoint ?? "")}
                placeholder={selectedAiProvider.available ? "Saved endpoint — list models to inspect" : selectedAiProvider.defaultEndpoint}
                disabled={aiBusy || saving || masterBusy}
                onChange={(event) => {
                  const value = event.target.value;
                  setLocalEndpoints((current) => ({ ...current, [aiProviderId]: value }));
                  setChatVerification(null);
                  setVerifiedModelsByProvider((current) => {
                    const next = { ...current };
                    delete next[aiProviderId];
                    return next;
                  });
                }}
                maxLength={2_000} className={inputCls} />
            </Row>
            <p className="font-terminal text-[8px] leading-relaxed text-muted-foreground">
              List models uses your saved endpoint without changing it. Editing the address and choosing Save endpoint &amp; list models explicitly replaces it. Start your local model server first; no scanning, model download or inference is performed.
              {selectedAiProvider.endpointEnvironmentManaged ? " An operator-managed environment endpoint takes precedence; a different endpoint cannot be selected until that setting is removed." : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void handleConnectLocal()} disabled={aiBusy || saving || masterBusy || (localEndpoints[aiProviderId] !== undefined && !localEndpoints[aiProviderId].trim())}
                data-testid="local-ai-list-models" className="border border-border px-3 py-1.5 font-terminal text-[9px] uppercase disabled:opacity-40">
                {aiBusy ? "Working…" : localEndpoints[aiProviderId] !== undefined || !selectedAiProvider.available ? "Save endpoint & list models" : "List saved endpoint models"}
              </button>
              {selectedAiProvider.available && !selectedAiProvider.endpointEnvironmentManaged && (
                <button type="button" onClick={() => void handleDisconnectLocal()} disabled={aiBusy || saving || masterBusy}
                  data-testid="local-ai-disconnect" className="border border-border px-3 py-1.5 font-terminal text-[9px] uppercase text-rose-300 disabled:opacity-40">
                  Disconnect local endpoint
                </button>
              )}
            </div>
          </div>
        )}
        {aiProviderId && (
          <div className="mt-3">
            <label htmlFor="ai-model-select" className="mb-1 block font-ui text-sm font-medium text-muted-foreground">Model</label>
            {selectedAiProvider?.allowCustomModel && !selectedAiProvider.isLocal && !modelDiscoveryComplete ? (
              <>
                <input
                  id="ai-model-select"
                  data-testid="connection-ai-custom-model"
                  value={aiModelId}
                  onChange={(event) => {
                    setChatVerification(null);
                    setAiModelId(event.target.value);
                    setAiNotice(null);
                    void turnMasterAiOff().catch(() => setAiNotice("The model draft changed, but Master AI could not be confirmed OFF. Resolve the permission error before continuing."));
                  }}
                  disabled={aiBusy || saving || masterBusy}
                  list={`ai-models-${selectedAiProvider.id}`}
                  placeholder={selectedAiProvider.defaultModel ?? "Enter a model available on your provider"}
                  maxLength={200}
                  className={inputCls}
                />
                <datalist id={`ai-models-${selectedAiProvider.id}`}>
                  {aiModels.map((model) => <option key={model} value={model} />)}
                </datalist>
                <p className="mt-2 font-terminal text-[8px] text-muted-foreground" role="note">
                  Enter the exact model identifier available on your connected provider. Suggestions are not a live availability check.
                </p>
              </>
            ) : (
              <select id="ai-model-select" value={aiModelId} onChange={(event) => void changeAiSelection(aiProviderId, event.target.value)} className={inputCls} disabled={aiModels.length === 0 || aiBusy || saving || masterBusy}>
                <option value="">{aiModels.length > 0 ? "Select a model" : "No models available"}</option>
                {aiModelId && !aiModels.includes(aiModelId) && (
                  <option value={aiModelId}>{aiModelId} · {modelDiscoveryComplete ? "not returned by this key" : modelDiscoveryPartial ? "not on first page" : "current selection"}</option>
                )}
                {aiModels.map((model) => (
                  <option key={model} value={model}>
                    {model}{modelDiscoveryComplete && !verifiedAiModels?.includes(model) ? " · unverified" : ""}
                  </option>
                ))}
              </select>
            )}
            {modelDiscoveryComplete ? (
              <p className="mt-2 font-terminal text-[8px] text-emerald-300/80" role="status" data-testid="gemini-model-discovery-status">
                Read-only provider discovery returned {verifiedAiModels?.length ?? 0} {selectedAiProvider?.isLocal ? "model identifiers" : "chat-capable models"}. No prompt was sent; chat, native tools and vision are not verified by this list.
                {verifiedAiModels?.length ? "" : " No model was returned, so curated suggestions are not selectable."}
              </p>
            ) : modelDiscoveryPartial ? (
              <p className="mt-2 border border-amber-500/30 bg-amber-500/[0.04] px-2 py-1.5 font-terminal text-[8px] leading-relaxed text-amber-200" role="status" data-testid="gemini-model-discovery-partial">
                Read-only discovery returned the first page ({verifiedAiModels?.length ?? 0} chat-capable models); more pages exist. A model missing here is not evidence that this key lacks access. No prompt was sent.
              </p>
            ) : aiProviderId === "gemini" ? (
              <p className="mt-2 font-terminal text-[8px] text-muted-foreground" role="note" data-testid="gemini-model-catalog-status">
                Curated suggestions are not verified against your API key. Test or save the Gemini connection to discover models available to that key.
              </p>
            ) : null}
            {modelDiscoveryComplete && aiModelId && !selectedModelWasReturned && (
              <p className="mt-2 border border-rose-500/30 bg-rose-500/[0.04] px-2 py-1.5 font-terminal text-[8px] leading-relaxed text-rose-200" role="alert" data-testid="gemini-model-not-entitled">
                Your selected model was not returned by this key’s complete chat-capable model list. Master AI is forced OFF and this setup cannot be saved until you choose a returned model or disable the AI provider.
              </p>
            )}
            {aiProviderId === "gemini" && /^gemini-2\.5-/.test(aiModelId) && (
              <p className="mt-2 border border-amber-500/30 bg-amber-500/[0.04] px-2 py-1.5 font-terminal text-[8px] leading-relaxed text-amber-200" role="status" data-testid="gemini-legacy-model-guidance">
                Google currently limits Gemini 2.5 access for some new projects. If this model returns HTTP 404, select Gemini 3.5 Flash-Lite or Gemini 3.8 Flash and save your setup.
              </p>
            )}
            <div className="mt-3 space-y-2 border-t border-border/60 pt-3" data-testid="connection-chat-verification">
              <p className="font-terminal text-[8px] leading-relaxed text-muted-foreground">
                Verify chat sends only a fresh public “LIOS_AI_OK_…” acknowledgement challenge and a short connectivity instruction to {selectedAiProvider?.name ?? "the selected provider"} using {aiModelId || "your selected model"}, with a 64-token output limit. No original prompt, project context, files or tool calls are included.
                {selectedAiProvider?.isLocal
                  ? " Loopback alone is not proof of local execution. LiOS checks runtime-reported installed local model metadata before inference and blocks reported remote/cloud or unknown models. You control and must trust that local daemon; its behavior is not cryptographically attested. This chat probe does not verify native tools, vision or provider pricing."
                  : " This is a real provider inference request and may consume quota or incur charges under your provider plan."}
              </p>
              <button type="button" onClick={() => void handleVerifyAi()}
                disabled={!selectedAiProvider?.available || !aiModelId.trim() || aiModelBlocked || aiBusy || saving || masterBusy || Boolean(selectedAiProvider?.isLocal && !modelDiscovery?.endpoint)}
                data-testid="connection-ai-verify-chat" className="border border-border px-3 py-1.5 font-terminal text-[9px] uppercase disabled:opacity-40">
                {aiBusy ? "Working…" : "Verify chat (send test request)"}
              </button>
              <p className={`font-terminal text-[8px] ${chatVerified ? "text-emerald-300" : "text-muted-foreground"}`} role="status" data-testid="connection-ai-chat-status">
                {chatVerified ? `Chat verified for ${chatVerification?.model} at ${formatHealthTime(chatVerification?.verifiedAt)}.` : "Chat unverified for this selection."} Native tool calling and vision remain unverified.
              </p>
            </div>
          </div>
        )}
      </div>
            </div>
            <MasterAiSettings
              providerName={selectedAiProvider?.name}
              providerAvailable={selectedAiProvider?.available === true}
              modelId={aiModelId}
              modelAccess={aiModelAccess}
              chatVerified={chatVerified}
              selectionBusy={aiBusy || saving}
              onBeforeEnable={() => persistSetup(!setupQuery.data?.setupNeeded)}
              onSavingChange={setMasterBusy}
              onChangeProvider={focusAiProviderSelector}
            />
          </div>
          {aiNotice && <p className="font-terminal text-[8px] leading-relaxed text-muted-foreground" role="status" data-testid="connection-ai-notice">{aiNotice}</p>}
        </section>

        {/* ── 4. Connect data ───────────────────────────────────────── */}
        <section className="border border-border bg-[#070707] p-4 space-y-4" aria-label="Connect data" data-testid="connect-data">
          <div className="flex items-center gap-2 border-b border-border/60 pb-2">
            <Database className="h-3.5 w-3.5 text-[hsl(38,95%,55%)]" />
            <h2 className="font-terminal text-[10px] uppercase tracking-widest text-foreground">Data</h2>
            <span className="font-terminal text-[7px] uppercase tracking-wider text-muted-foreground">Connect what you bring · optional</span>
          </div>
          {dataConnections.length > 0 ? (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2" data-testid="connect-data-connected">
              {dataConnections.map((conn) => (
                <ConnectionCard key={conn.id} conn={conn} onTest={() => handleTestConnection(conn.id)} onEdit={() => handleEditConnection(conn)} onRemove={() => handleDeleteConnection(conn.id)} />
              ))}
            </div>
          ) : (
            <p className="font-terminal text-[8px] leading-relaxed text-muted-foreground">No data source connected yet. Add market, filings or macro data, or import your own files, whenever a request needs it.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setSelectedProvider(null); setModal("provider"); }}
              className="flex items-center gap-1.5 border border-[hsl(38,95%,50%)]/60 bg-[hsl(38,95%,50%)]/10 px-3 py-2 font-terminal text-[9px] uppercase text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/20">
              <Plus className="h-3 w-3" /> Connect a data source
            </button>
            <button type="button" onClick={() => setModal("import")}
              className="flex items-center gap-1.5 border border-border px-3 py-2 font-terminal text-[9px] uppercase text-muted-foreground hover:text-foreground">
              <Upload className="h-3 w-3" /> Import files
            </button>
          </div>
          {dataStackEntries.length > 1 && (
            <div className="space-y-2" data-testid="connection-data-stack">
              <div>
                <h3 className="font-terminal text-[9px] uppercase tracking-widest text-foreground">Source order</h3>
                <p className="mt-1 font-terminal text-[8px] leading-relaxed text-muted-foreground">Which source LiOS tries first when more than one can answer the same request.</p>
              </div>
              <ol className="space-y-2">
                {dataStackEntries.map((entry, index) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 border border-border px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-terminal text-[9px] text-foreground">{index + 1}. {entry.name}</div>
                      <div className="font-terminal text-[7px] uppercase text-muted-foreground">{entry.connectorId}</div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" aria-label={`Move ${entry.name} up`} disabled={index === 0} onClick={() => moveStackEntry(entry.connectorId, -1)} className="border border-border px-2 py-1 text-[8px] text-muted-foreground disabled:opacity-30">↑</button>
                      <button type="button" aria-label={`Move ${entry.name} down`} disabled={index === dataStackEntries.length - 1} onClick={() => moveStackEntry(entry.connectorId, 1)} className="border border-border px-2 py-1 text-[8px] text-muted-foreground disabled:opacity-30">↓</button>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>

        {/* ── 5. Voice (optional, collapsed) ────────────────────────── */}
        <details className="border border-border bg-[#070707]" data-testid="connect-voice">
          <summary className="cursor-pointer list-none px-4 py-3 font-terminal text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
            Voice input and output <span className="ml-2 text-[7px] tracking-wider text-muted-foreground/70">Optional · local</span>
          </summary>
          <div className="border-t border-border p-3"><LocalVoiceRuntimeSettings /></div>
        </details>

        <LicenseSettings role={session.role} />
        <BackupSettings role={session.role} />
        <DevicesSettings />
        <DataFolderSettings />

        <div className="border border-border bg-[#070707]">
          <button type="button" onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen} aria-controls="advanced-connection-tools"
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#0d0d0d]">
            <span className="flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-terminal text-[9px] uppercase tracking-widest text-muted-foreground">Advanced</span>
              <span className="font-terminal text-[7px] uppercase tracking-wider text-muted-foreground/70">Providers, runtime, conflicts & diagnostics</span>
            </span>
            {advancedOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        </div>
        {advancedOpen && <div id="advanced-connection-tools" className="space-y-4">

        <section className="border border-border bg-[#070707] p-3" aria-label="Advanced source registry" data-testid="connection-advanced-source-registry">
        <DataSourcesPanel
          onConnectProvider={(connectorId) => {
            setEditingConnection(null);
            const connector = connectors.find((item) => item.id === connectorId);
            if (connector?.sourceType === "file" || connectorId === "file_upload") {
              setModal("import");
              return;
            }
            if (connector?.sourceType === "database") {
              setModal("database");
              return;
            }
            if (connector?.sourceType === "cloud_storage") {
              setCatalogSeed(null);
              setModal("storage");
              return;
            }
            if (connector?.sourceType === "private_api" || connectorId === "private_api") {
              setSelectedProvider(null);
              setCatalogSeed(null);
              setModal("api");
              return;
            }
            setSelectedProvider(connector ?? null);
            setModal("provider");
          }}
          onImportFile={() => { setEditingConnection(null); setModal("import"); }}
          onAddDatabase={() => { setEditingConnection(null); setModal("database"); }}
          onAddApi={() => { setEditingConnection(null); setModal("api"); }}
          onAddStorage={() => { setEditingConnection(null); setCatalogSeed(null); setModal("storage"); }}
          onRefresh={refresh}
          onTestConnection={(connectionId) => { void handleTestConnection(connectionId); }}
          onEditConnection={(connectionId) => {
            void handleEditConnectionById(connectionId);
          }}
          onDeleteConnection={(connectionId) => { void handleDeleteConnection(connectionId); }}
        />
        </section>

        {/* ── 2. Provider health ─────────────────────────────────────── */}

        <section className="border border-border bg-[#070707]" data-testid="connection-provider-health">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-[#0d0d0d] px-4 py-2">
            <span className="font-terminal text-[9px] uppercase tracking-widest text-muted-foreground">Provider Health / Readiness</span>
            <span className="font-terminal text-[8px] uppercase tracking-widest text-muted-foreground">Vault values are never exposed</span>
          </div>
          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
            {READINESS_CONNECTOR_IDS.map((id) => {
              const connector = connectors.find((item) => item.id === id);
              const health = healthById.get(id);
              const readiness = providerReadiness(connector, health);
              const verifiedAt = formatHealthTime(health?.lastVerifiedAt);
              const checkedAt = formatHealthTime(health?.checkedAt);
              return (
                <div key={id} className={`min-w-0 p-3 ${readinessToneClass(readiness.tone)}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-terminal text-[10px] font-bold uppercase tracking-wider text-foreground">
                      {connector?.name ?? READINESS_FALLBACK_NAMES[id]}
                    </span>
                    <span className="text-right font-terminal text-[7px] uppercase tracking-widest">{readiness.label}</span>
                  </div>
                  <p className="mt-2 font-terminal text-[8px] leading-relaxed text-muted-foreground">{readiness.detail}</p>
                  {verifiedAt && (
                    <div className="mt-1 font-terminal text-[7px] uppercase tracking-wider text-muted-foreground">
                      Last live verification: {verifiedAt}
                    </div>
                  )}
                  {!verifiedAt && checkedAt && (
                    <div className="mt-1 font-terminal text-[7px] uppercase tracking-wider text-muted-foreground">
                      Status checked: {checkedAt}
                    </div>
                  )}
                  {id === "world_bank" && (
                    <div className="mt-2 space-y-1">
                      <div className="font-terminal text-[7px] uppercase tracking-wider text-teal-400/90">Public data source · no key required</div>
                      {connector?.websiteUrl && (
                        <a href={connector.websiteUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-terminal text-[7px] uppercase tracking-wider text-[hsl(38,95%,55%)] hover:underline">
                          <ExternalLink className="h-2.5 w-2.5" /> Open API documentation
                        </a>
                      )}
                      <div className="font-terminal text-[7px] leading-relaxed text-muted-foreground/80">The Open API URL is documentation, not a credential.</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="border-t border-border px-4 py-2 font-terminal text-[7px] leading-relaxed text-muted-foreground/80">
            CONFIGURED CREDENTIAL means the encrypted vault prerequisite is present; it does not claim that a live provider call succeeded. Cached fallback and unavailable are shown only when reported by the status response.
          </div>
        </section>

        <section className="border border-border bg-[#070707]" data-testid="connection-provider-conflict">
          <div className="border-b border-border bg-[#0d0d0d] px-4 py-2 font-terminal text-[9px] uppercase tracking-widest text-muted-foreground">
            Provider Conflict Review
          </div>
          <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-3">
            <label className="font-terminal text-[8px] uppercase text-muted-foreground">
              Symbol
              <input value={conflictSymbol} onChange={(event) => setConflictSymbol(event.target.value)} className="mt-1 w-full border border-border bg-transparent px-2 py-1 font-terminal text-[9px] text-foreground" />
            </label>
            <label className="font-terminal text-[8px] uppercase text-muted-foreground">
              Metric
              <input value={conflictMetric} onChange={(event) => setConflictMetric(event.target.value)} className="mt-1 w-full border border-border bg-transparent px-2 py-1 font-terminal text-[9px] text-foreground" />
            </label>
            <label className="font-terminal text-[8px] uppercase text-muted-foreground">
              Period
              <input value={conflictPeriod} onChange={(event) => setConflictPeriod(event.target.value)} className="mt-1 w-full border border-border bg-transparent px-2 py-1 font-terminal text-[9px] text-foreground" />
            </label>
          </div>
          <div className="border-t border-border p-3">
            <ProviderConflictPanel symbol={conflictSymbol} metric={conflictMetric} period={conflictPeriod} />
          </div>
        </section>

        <section className="border border-border bg-[#070707] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-terminal text-[10px] uppercase tracking-widest text-foreground">Other connection types</h2>
              <p className="mt-1 font-terminal text-[8px] text-muted-foreground">Add databases, custom APIs, storage destinations, or AI providers after your first source.</p>
            </div>
            <span className="font-terminal text-[8px] uppercase tracking-wider text-muted-foreground">Optional</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setModal("database")}
              className="flex items-center gap-1.5 border border-border px-3 py-2 font-terminal text-[9px] uppercase text-muted-foreground hover:border-border/80 hover:text-foreground">
              <Database className="w-3 h-3" /> Add Database
            </button>
            <button type="button" onClick={() => setModal("api")}
              className="flex items-center gap-1.5 border border-border px-3 py-2 font-terminal text-[9px] uppercase text-muted-foreground hover:border-border/80 hover:text-foreground">
              <Globe className="w-3 h-3" /> Add Custom API
            </button>
            <button type="button" onClick={() => { setCatalogSeed(null); setModal("storage"); }}
              className="flex items-center gap-1.5 border border-border px-3 py-2 font-terminal text-[9px] uppercase text-muted-foreground hover:border-border/80 hover:text-foreground">
              <Cloud className="w-3 h-3" /> Add Storage
            </button>
            <button type="button" onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 border border-border px-3 py-2 font-terminal text-[9px] uppercase text-muted-foreground hover:border-border/80 hover:text-foreground">
              <Bot className="w-3 h-3" /> Configure AI
            </button>
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={refresh}
            className="flex items-center gap-1.5 border border-border px-3 py-2 font-terminal text-[9px] uppercase text-muted-foreground hover:text-foreground">
            <RefreshCw className="w-3 h-3" /> Refresh status
          </button>
        </div>
        {workspaceInfo && <div className="border border-cyan-500/20 bg-cyan-500/[0.03] px-3 py-2 font-terminal text-[8px] text-muted-foreground">LOCAL WORKSPACE · <span className="text-cyan-300">{workspaceInfo.workspaceId}</span> · DATA AND CONNECTOR FILES STAY ON THIS DEVICE</div>}
        {workspaceNotice && <div className="border border-amber-500/30 bg-amber-500/[0.03] px-3 py-2 font-terminal text-[8px] text-amber-200">{workspaceNotice}</div>}

        {/* ── 4. Provider Catalog ───────────────────────────────────── */}
        <section className="border border-border bg-[#070707] p-4" data-testid="connection-provider-catalog">
          <h2 className="font-terminal text-[10px] uppercase tracking-widest text-foreground mb-3">Provider Catalog</h2>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              aria-label="Search data providers"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search providers..."
              className="w-full bg-[#0d0d0d] border border-border pl-9 pr-3 py-2 font-terminal text-[10px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/60"
            />
          </div>

          {/* Category tabs */}
          <div className="flex flex-wrap gap-1 mb-4 border-b border-border pb-3">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`font-terminal text-[8px] uppercase px-2.5 py-1 transition-colors ${
                  activeTab === tab.key
                    ? "bg-[hsl(38,95%,50%)]/15 text-[hsl(38,95%,55%)] border border-[hsl(38,95%,50%)]/40"
                    : "text-muted-foreground hover:text-foreground border border-transparent hover:border-border"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Provider grid */}
          {filteredCatalog.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {filteredCatalog.map((connector) => (
                <ProviderCard
                  key={connector.id}
                  connector={connector}
                  isConnected={configuredProviderIds.has(connector.id)}
                  onConnect={() => { setEditingConnection(null); setSelectedProvider(connector); setModal("provider"); }}
                />
              ))}
            </div>
          ) : (
            <p className="font-terminal text-[9px] text-muted-foreground py-6 text-center">
              {searchQuery ? "No providers match your search." : "No providers in this category."}
            </p>
          )}
        </section>


        {/* ── 9. Settings (collapsible) ─────────────────────────────── */}
        <button type="button" data-testid="connection-runtime-ai-settings" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen} aria-controls="runtime-ai-settings" className="flex items-center gap-2 w-full text-left font-terminal text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground py-2">
          {settingsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <Zap className="w-3.5 h-3.5 text-[hsl(38,95%,55%)]" /> Runtime & Python packs
        </button>
        {settingsOpen && (
          <div id="runtime-ai-settings" className="border border-border bg-[#070707] p-4 space-y-4">
            {workspaceInfo && (
              <div className="space-y-2 border border-border/60 p-3" data-testid="sandbox-image-readiness">
                <span className="font-terminal text-[8px] text-muted-foreground uppercase block">Governed execution sandbox</span>
                <p className={`font-terminal text-[8px] ${sandboxImageQuery.data?.ready ? "text-emerald-400" : "text-amber-300"}`}>
                  {sandboxImageQuery.data?.ready
                    ? `Ready · ${sandboxImageQuery.data.image}`
                    : sandboxImageQuery.data?.reason ?? (sandboxImageQuery.isLoading ? "Checking packaged image and local container engine…" : "Sandbox status is unavailable.")}
                </p>
                {["load", "retry"].includes(sandboxImageQuery.data?.repairAction ?? "") && (
                  <button type="button" disabled={sandboxRepairBusy || !["internal_admin", "client_admin"].includes(session.role)} onClick={() => { void repairSandbox(); }} className="font-terminal text-[8px] uppercase border border-border px-2 py-1 hover:border-[hsl(38,95%,50%)] disabled:opacity-50">
                    {sandboxRepairBusy ? "Importing packaged image…" : sandboxImageQuery.data?.repairAction === "retry" ? "Retry sandbox image repair" : "Repair from packaged image"}
                  </button>
                )}
                {sandboxImageQuery.data?.repairAction === "install_engine" && <p className="font-terminal text-[8px] text-muted-foreground">Start a local Docker Desktop or Podman engine, then retry. LiOS will not switch to host execution.</p>}
                {sandboxImageQuery.data?.repairAction === "reinstall_app" && <p className="font-terminal text-[8px] text-muted-foreground">Reinstall a signed LiOS release containing the verified sandbox archive; your data folder is preserved.</p>}
                {sandboxRepairError && <p role="alert" className="font-terminal text-[8px] text-red-400">{sandboxRepairError}</p>}
              </div>
            )}
            <div>
              <span className="font-terminal text-[8px] text-muted-foreground uppercase block mb-1">Python runtime</span>
              <select value={pythonRuntimeId} onChange={(e) => setPythonRuntimeId(e.target.value)} className={inputCls}>
                {runtimeQuery.data?.profiles.filter((p) => p.supported).map((p) => <option key={p.id} value={p.id}>{p.name}{p.recommended ? " (recommended)" : ""}</option>)}
              </select>
              <p className="font-terminal text-[8px] text-muted-foreground mt-1">{runtimeQuery.data?.status.detail}</p>
              {pythonRuntimeId === "lios-managed" && runtimeQuery.data?.managedRuntimeReadiness && <div role="status" className="mt-2 border border-border/60 p-2 font-terminal text-[8px]" data-testid="runtime-doctor-diagnosis">
                <p>Managed runtime: {runtimeQuery.data.managedRuntimeReadiness.state}. {runtimeQuery.data.doctorRepairPlan?.summary}</p>
                <p className="mt-1 text-muted-foreground">{runtimeQuery.data.managedRuntimeReadiness.reasons.join(" ")}</p>
                {runtimeQuery.data.doctorRepairPlan?.executionStatus === "blocked" && <p className="mt-1 text-amber-300">Repair blocked: {runtimeQuery.data.doctorRepairPlan.executionBlocker}. No host fallback or automatic installation is authorized.</p>}
                {["internal_admin", "client_admin"].includes(session.role) && <button type="button" disabled={runtimeBusy !== null} onClick={() => void previewRuntimeOperation({ operation: "repair" })} className="mt-2 border border-border px-2 py-1 disabled:opacity-40" data-testid="runtime-doctor-repair">Review saved runtime repair</button>}
              </div>}
              {(pythonRuntimeId === "external-path" || pythonRuntimeId === "remote-service") && (
                <div className="mt-3">
                  <span className="font-terminal text-[8px] text-muted-foreground uppercase block mb-1">Python environment path or remote endpoint</span>
                  <input value={pythonEnvironmentPath} onChange={(e) => setPythonEnvironmentPath(e.target.value)} placeholder={pythonRuntimeId === "remote-service" ? "https://your-python-service.example" : "/path/to/venv"} className={inputCls} />
                  <p className="font-terminal text-[8px] text-muted-foreground mt-1">Use your own Python environment and installed libraries. LiOS records the path; it does not redistribute your packages.</p>
                </div>
              )}
            </div>
            <div className="space-y-2 border border-border/60 p-3">
              <span className="font-terminal text-[8px] text-muted-foreground uppercase block">Community & public filler (opt-in)</span>
              <label className="flex items-start gap-2 font-terminal text-[8px] text-muted-foreground leading-relaxed">
                <input type="checkbox" checked={yahooConsent} onChange={(e) => { void persistCommunityConsent("yahoo_community", e.target.checked); setYahooConsent(e.target.checked); }} />
                <span>Enable community Yahoo / yfinance access (unofficial API — prefer licensed connectors in your stack)</span>
              </label>
              <label className="flex items-start gap-2 font-terminal text-[8px] text-muted-foreground leading-relaxed">
                <input type="checkbox" checked={publicFillerConsent} onChange={(e) => { void persistCommunityConsent("public_filler", e.target.checked); setPublicFillerConsent(e.target.checked); }} />
                <span>Allow delayed public filler sources (e.g. Stooq) at the bottom of the stack when licensed data is unavailable</span>
              </label>
            </div>
            {pythonRuntimeId === "lios-managed" && (
              <div className="space-y-2 border border-border/60 p-3" data-testid="runtime-pack-installer">
                <span className="font-terminal text-[8px] text-muted-foreground uppercase block">LiOS Runtime Packs</span>
                <p className="font-terminal text-[8px] text-muted-foreground leading-relaxed">
                  Choose capabilities, not Python libraries. Core is required, not assumed installed; Research, Quant, Modeling, Data Lab and Local AI are opt-in. LiOS expands these choices into the managed-runtime allow-list. Availability requires verified runtime readiness.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                  {(runtimeQuery.data?.releasePacks ?? []).map((pack) => {
                    const isCore = pack.id === "core";
                    const installed = managedState?.selectedReleasePackIds?.includes(pack.id) || (isCore && Boolean(managedState));
                    return (
                      <label key={pack.id} className="flex items-start gap-2 rounded border border-border/50 bg-black/15 p-2 font-terminal text-[8px] leading-relaxed text-muted-foreground" title={pack.releaseNotes.join(" ")}>
                        <input
                          type="checkbox"
                          checked={isCore || selectedReleasePackIds.includes(pack.id)}
                          disabled={isCore || runtimeBusy !== null}
                          onChange={(e) => toggleReleasePack(pack.id, e.target.checked)}
                        />
                        <span className="min-w-0">
                          <span className="text-foreground">{pack.name}{isCore ? " (required)" : ""}</span>
                          <span className="block mt-0.5 text-[7px]">{pack.description}</span>
                          <span className="block mt-0.5 text-[7px] text-cyan-300/80">{pack.capabilities.slice(0, 5).join(" · ")}</span>
                          {installed && <span className="block mt-0.5 text-[7px] text-emerald-400">Installed selection</span>}
                          {!isCore && ["internal_admin", "client_admin"].includes(session.role) && <button type="button" className="block mt-1 border border-border px-2 py-1 disabled:opacity-40" disabled={runtimeBusy !== null} onClick={(event) => { event.preventDefault(); void previewRuntimeOperation({ operation: "lazy_install", capability: pack.capabilities[0] }); }} data-testid={`runtime-lazy-${pack.id}`}>Review capability installation</button>}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {runtimeQuery.data?.packs.some((pack) => pack.id === "community-yahoo") && (
                  <div className="mt-2 border-t border-border/40 pt-2">
                    <span className="font-terminal text-[7px] uppercase tracking-wider text-muted-foreground">Advanced managed add-on</span>
                    <label className={`mt-1 flex items-start gap-2 font-terminal text-[8px] leading-relaxed ${!yahooConsent ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                      <input
                        type="checkbox"
                        checked={selectedAddonPackIds.includes("community-yahoo")}
                        disabled={!yahooConsent || runtimeBusy !== null}
                        onChange={(e) => toggleManagedAddon("community-yahoo", e.target.checked)}
                      />
                      <span>
                        Community Yahoo / yfinance
                        <span className="block text-[7px]">Unofficial community-data runtime add-on; separate from the six release packs.</span>
                        {!yahooConsent && <span className="block text-[7px] text-[hsl(38,95%,55%)]">Requires the community Yahoo consent above.</span>}
                        {managedState?.selectedPackIds.includes("community-yahoo") && <span className="block text-[7px] text-emerald-400">Installed</span>}
                      </span>
                    </label>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    data-testid="runtime-pack-install"
                    onClick={() => void previewRuntimeOperation({ operation: "install", releasePackIds: selectedReleasePackIds as Extract<RuntimeLifecycleRequest, { operation: "install" }>["releasePackIds"], additionalPackIds: selectedAddonPackIds as ["community-yahoo"] })}
                    disabled={runtimeBusy !== null || !["internal_admin", "client_admin"].includes(session.role)}
                    className="border border-[hsl(38,95%,55%)]/50 text-[hsl(38,95%,55%)] px-2 py-1 font-terminal text-[8px] uppercase tracking-widest hover:bg-[hsl(38,95%,55%)]/10 disabled:opacity-40"
                  >
                    Review selected packs
                  </button>
                  <button
                    type="button"
                    data-testid="runtime-pack-rollback"
                    onClick={() => void previewRuntimeOperation({ operation: "rollback" })}
                    disabled={runtimeBusy !== null || !["internal_admin", "client_admin"].includes(session.role)}
                    className="border border-border text-muted-foreground px-2 py-1 font-terminal text-[8px] uppercase tracking-widest hover:text-foreground disabled:opacity-40"
                  >
                    Review rollback
                  </button>
                  <button type="button" data-testid="runtime-pack-upgrade" onClick={() => void previewRuntimeOperation({ operation: "upgrade" })} disabled={runtimeBusy !== null || !["internal_admin", "client_admin"].includes(session.role)} className="border border-border px-2 py-1 font-terminal text-[8px] disabled:opacity-40">Review safe upgrade</button>
                </div>
                {runtimeBusy && <p role="status" className="font-terminal text-[8px] text-muted-foreground">{runtimeBusy === "preview" ? "Reading current operation and prerequisites; no installation is performed." : "Applying the exact administrator-confirmed operation through the governed runtime authority."}</p>}
                {runtimePreview && <div className="border border-border p-2 font-terminal text-[8px] break-all space-y-1" data-testid="runtime-lifecycle-preview">
                  <p>{runtimePreview.summary}</p>
                  <p>Source state SHA-256: {runtimePreview.sourceStateHash}</p>
                  <p>Target manifest {runtimePreview.targetManifestVersion} SHA-256: {runtimePreview.targetManifestHash}</p>
                  <p>Operation SHA-256: {runtimePreview.operationHash}</p>
                  <p>Release locks: {runtimePreview.releaseLocks.map((lock) => `${lock.packId}: ${lock.sha256 ?? "MISSING"}`).join(" · ")}</p>
                  {runtimePreview.blockers.length > 0 && <p role="status" className="text-amber-300">Blocked prerequisites: {runtimePreview.blockers.join("; ")}. No host fallback, download, repair success or task resumption is implied.</p>}
                  <button type="button" data-testid="runtime-lifecycle-confirm" disabled={runtimeBusy !== null || runtimePreview.blockers.length > 0} onClick={() => void applyRuntimeOperation()} className="border border-border px-2 py-1 disabled:opacity-40">Confirm this exact {runtimePreview.request.operation}</button>
                  <button type="button" disabled={runtimeBusy !== null} onClick={() => setRuntimePreview(null)} className="ml-2 border border-border px-2 py-1">Cancel</button>
                </div>}
                {runtimeError && <p className="font-terminal text-[8px] text-[hsl(0,80%,60%)]" data-testid="runtime-pack-error">{runtimeError}</p>}
                {runtimeNotice && !runtimeError && <p className="font-terminal text-[8px] text-emerald-400">{runtimeNotice}</p>}
                {managedState && (
                  <div className="font-terminal text-[7px] text-muted-foreground space-y-0.5 pt-1 border-t border-border/40">
                    <div>Release packs: {managedState.selectedReleasePackIds.length ? managedState.selectedReleasePackIds.join(", ") : "legacy / low-level selection"}</div>
                    <div>Managed subpacks: {managedState.selectedPackIds.join(", ")}</div>
                    <div>
                      Wheel hash verification:{" "}
                      {managedState.hashVerified
                        ? <span className="text-emerald-400">enforced against the release lock file</span>
                        : <span className="text-[hsl(38,95%,55%)]">not enforced — pinned versions only (no hash lock file shipped for these packs)</span>}
                    </div>
                    {managedState.verificationWarnings.map((warning) => (
                      <div key={warning} className="text-[hsl(38,95%,55%)]">[ALLOW-LIST] {warning}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        </div>}

        {/* ── 10. Footer ────────────────────────────────────────────── */}
        {saveNotice && (
          <div role="alert" data-testid="connection-save-notice" className="border border-rose-500/40 bg-rose-500/[0.05] px-3 py-2 font-terminal text-[8px] leading-relaxed text-rose-200">{saveNotice}</div>
        )}
        <div className="flex items-center justify-between pb-4 pt-2">
          <span className="font-terminal text-[8px] text-muted-foreground">{connectionSummary.statusDetail}</span>
          <button type="button" onClick={handleReturnToWork} disabled={saving || aiBusy || masterBusy || runtimeBusy !== null} data-testid="connection-return-to-work-footer"
            className="min-h-10 rounded border border-border px-3 py-2 font-ui text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            Return to previous work
          </button>
          <button type="button" onClick={handleEnterTerminal} disabled={saving || aiBusy || masterBusy}
            title={continueWithoutAi ? "Continue with AI disabled. You can choose and verify a model later." : undefined}
            className="flex items-center gap-2 border border-[hsl(38,95%,50%)] bg-[hsl(38,95%,50%)]/10 px-5 py-2.5 font-terminal text-[10px] uppercase text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/20 disabled:opacity-40">
            <Terminal className="w-4 h-4" /> {saving ? "Saving..." : continueWithoutAi ? "Continue without AI" : connectionSummary.ctaLabel}
          </button>
        </div>
      </div>

      {/* ── Modals ────────────────────────────────────────────────── */}
      {modal === "provider" && selectedProvider && (
        <ConnectProviderModal
          connector={selectedProvider}
          editing={editingConnection}
          onClose={() => { setModal(null); setSelectedProvider(null); setEditingConnection(null); }}
          onSaved={handleModalSaved}
          onModelsDiscovered={(connectorId, models, complete) => setVerifiedModelsByProvider((current) => {
            if (models === undefined) {
              const next = { ...current };
              delete next[connectorId];
              return next;
            }
            return { ...current, [connectorId]: { models, complete: complete === true } };
          })}
        />
      )}
      {modal === "provider" && !selectedProvider && (
        <ModalShell title="Select a Data Provider" onClose={() => { setModal(null); setProviderPickerQuery(""); }}>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              aria-label="Search providers"
              placeholder="Search providers..."
              className={`${inputCls} pl-9`}
              onChange={(e) => setProviderPickerQuery(e.target.value)}
              value={providerPickerQuery}
            />
          </div>
          <p className="mb-2 font-ui text-xs text-muted-foreground">Choose one provider. Catalog listings do not establish connectivity, source rights or live verification.</p>
          <div className="grid grid-cols-1 gap-2 max-h-[50vh] overflow-y-auto" data-testid="connection-provider-chooser">
            {pickerProviders.map((c) => (
                <button key={c.id} type="button" disabled={!connectionPickerStatus(c, configuredProviderIds.has(c.id)).canSelect} onClick={() => { setEditingConnection(savedConnections.find(connection => connection.connectorId === c.id) ?? null); setSelectedProvider(c); }}
                  className="min-h-11 text-left border border-border hover:border-[hsl(38,95%,50%)]/40 p-3 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 disabled:cursor-not-allowed">
                  <div className="flex items-center gap-2">
                    <span className="font-terminal text-[9px] font-bold uppercase text-foreground">{c.name}</span>
                    {configuredProviderIds.has(c.id) && <span className="font-ui text-xs text-muted-foreground">Saved</span>}
                  </div>
                  {c.description && <p className="font-ui text-xs text-muted-foreground mt-1">{c.description}</p>}
                  <p className="mt-1 font-ui text-xs text-muted-foreground">{connectionPickerStatus(c, configuredProviderIds.has(c.id)).label}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <CategoryBadge category={c.category} />
                  </div>
                </button>
              ))}
            {pickerProviders.length === 0 && <p role="status" className="p-3 font-ui text-sm text-muted-foreground">No provider matches this search. Clear the search or continue without adding a connection.</p>}
          </div>
        </ModalShell>
      )}
      {modal === "database" && <AddDatabaseModal editing={editingConnection} onClose={() => { setModal(null); setEditingConnection(null); }} onSaved={handleModalSaved} />}
      {modal === "import" && <DataImportWizard onClose={() => setModal(null)} onImported={handleImported} />}
      {modal === "api" && <AddApiModal seed={catalogSeed} editing={editingConnection} onClose={() => { setModal(null); setCatalogSeed(null); setEditingConnection(null); }} onSaved={handleModalSaved} />}
      {modal === "storage" && <AddStorageModal seed={catalogSeed} editing={editingConnection} onClose={() => { setModal(null); setCatalogSeed(null); setEditingConnection(null); }} onSaved={handleModalSaved} />}
      {removalTarget !== null && <ModalShell title="Remove saved connection" onClose={() => { if (!removalInFlight.current) setRemovalTarget(null); }}>
        <p className="font-ui text-sm leading-6 text-muted-foreground">Remove {savedConnections.find(connection => connection.id === removalTarget)?.name ?? `saved connection ${removalTarget}`} from LiOS? This does not delete the external source or grant access to another provider.</p>
        {removalError && <p role="alert" className="font-ui text-sm text-rose-300">{removalError}</p>}
        {removingConnection && <p role="status" className="font-ui text-sm text-muted-foreground">Removing connection…</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={removingConnection} onClick={() => setRemovalTarget(null)} className="min-h-11 rounded border border-border px-4 py-2 font-ui text-sm">Cancel</button>
          <button type="button" disabled={removingConnection} onClick={() => void confirmDeleteConnection()} className="min-h-11 rounded border border-rose-400/50 px-4 py-2 font-ui text-sm font-semibold text-rose-200 disabled:opacity-50">{removingConnection ? "Removing…" : "Remove connection"}</button>
        </div>
      </ModalShell>}
    </Shell>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────

function Shell({ session, onLogout, embedded, children }: { session: { name: string }; onLogout: () => void; embedded: boolean; children: React.ReactNode }) {
  if (embedded) return <div className="dark mx-auto w-full min-w-0 max-w-5xl px-4 py-4 sm:px-6">{children}</div>;
  return (
    <div className="dark min-h-screen bg-[#030303] flex flex-col items-center px-6 py-8">
      <div className="w-full max-w-5xl flex items-center justify-between mb-5">
        <div className="font-terminal text-[9px] text-muted-foreground uppercase tracking-widest">Welcome, {session.name}</div>
        <button type="button" onClick={onLogout} className="font-terminal text-[9px] text-muted-foreground hover:text-rose-400 uppercase tracking-widest">Sign out</button>
      </div>
      {children}
    </div>
  );
}
