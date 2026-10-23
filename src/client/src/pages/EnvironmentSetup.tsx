import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, ChevronRight, Clock, KeyRound, Mic, Package, Plug, ShieldCheck, TerminalSquare, Upload, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { getDesktopWorkspaceBridge, type VoiceRuntimeFileKind } from "@/lib/desktopWorkspace";

interface ConnectorCapability {
  contractFamily: string;
  fields?: string[];
  coverage?: string;
}

interface ConnectorDefinition {
  id: string;
  name: string;
  category: string;
  sourceType: string;
  authMode: string;
  custodyMode: string;
  envKey?: string;
  vaultKey?: string;
  capabilities: ConnectorCapability[];
  setupGuide: string;
  builtIn: boolean;
  description?: string;
}

interface ConnectorHealth {
  connectorId: string;
  state: "catalog_only" | "adapter_available" | "credential_configured" | "live_verified" | "degraded" | "rate_limited" | "disabled";
  detail: string;
  checkedAt: string;
  adapterImplemented: boolean;
  lastVerifiedAt: string | null;
}

interface AIProviderOption {
  id: string;
  name: string;
  available: boolean;
  isLocal: boolean;
  models: string[];
  credentialName: string;
  requiresExternalConfig: boolean;
  defaultModel: string;
  allowCustomModel: boolean;
}

interface AIVerificationResult {
  ok: true;
  provider: string;
  model: string;
  latencyMs: number;
  verifiedAt: string;
  detail: string;
}

interface SetupResponse {
  setupNeeded: boolean;
  setup: {
    selectedConnectorIds: string[];
    pythonRuntimeId: string;
    pythonPackIds: string[];
    aiProviderId: string | null;
    aiModelId: string | null;
    completedAt: string | null;
  } | null;
  connectors: {
    connectors: ConnectorDefinition[];
    health: ConnectorHealth[];
  };
  aiProviders: AIProviderOption[];
}

interface RuntimeResponse {
  profiles: Array<{ id: string; name: string; description: string; supported: boolean; recommended: boolean; requiresPath: boolean }>;
  packs: Array<{ id: string; name: string; description: string; packages: string[]; engines: string[]; installed: boolean }>;
  status: {
    state: "ready" | "partial" | "unavailable";
    runtimeId: string;
    pythonVersion: string | null;
    packages: Record<string, string>;
    installedPacks: string[];
    missingPackages: string[];
    detail: string;
  };
}

interface VoiceSetupResponse {
  transcriptionProviderReady: boolean;
  recordingReady: boolean;
  whisperExecutable: { available: boolean; name: string | null };
  model: { available: boolean; name: string | null };
  ffmpeg: { available: boolean; name: string | null };
  transcriptionProviders: string[];
  speechProviders: string[];
}

interface SavedSourceConnection {
  id: number;
  connectorId: string;
  name: string;
  sourceType: string;
  config: Record<string, string | number | boolean | null>;
  credentialRef: string | null;
  status: string;
  statusDetail: string | null;
}

interface Props {
  session: { name: string };
  onComplete: () => void;
  onLogout: () => void;
}

const HEALTH_COLOR: Record<ConnectorHealth["state"], string> = {
  catalog_only: "text-muted-foreground",
  adapter_available: "text-muted-foreground",
  credential_configured: "text-cyan-400",
  live_verified: "text-emerald-400",
  degraded: "text-amber-400",
  rate_limited: "text-orange-400",
  disabled: "text-muted-foreground",
};

const HEALTH_ICON: Record<ConnectorHealth["state"], typeof CheckCircle2> = {
  catalog_only: KeyRound,
  adapter_available: KeyRound,
  credential_configured: ShieldCheck,
  live_verified: CheckCircle2,
  degraded: Activity,
  rate_limited: Clock,
  disabled: XCircle,
};

export default function EnvironmentSetup({ session, onComplete, onLogout }: Props) {
  const [selectedConnectorIds, setSelectedConnectorIds] = useState<string[]>([]);
  const [keyValues, setKeyValues] = useState<Record<string, string>>({});
  const [pythonRuntimeId, setPythonRuntimeId] = useState("lios-managed");
  const [pythonPackIds, setPythonPackIds] = useState<string[]>(["core"]);
  const [aiProviderId, setAiProviderId] = useState("");
  const [aiModelId, setAiModelId] = useState("");
  const [sourceEndpoints, setSourceEndpoints] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [aiVerification, setAiVerification] = useState<AIVerificationResult | null>(null);
  const [configuringVoice, setConfiguringVoice] = useState<VoiceRuntimeFileKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const desktopBridge = useMemo(() => getDesktopWorkspaceBridge(), []);

  const setupQuery = useQuery<SetupResponse>({
    queryKey: ["/api/setup/status"],
    queryFn: async () => (await apiRequest("GET", "/api/setup/status")).json(),
    staleTime: 30_000,
  });

  const runtimeQuery = useQuery<RuntimeResponse>({
    queryKey: ["/api/setup/python-runtime"],
    queryFn: async () => (await apiRequest("GET", "/api/setup/python-runtime")).json(),
    staleTime: 30_000,
  });

  const voiceSetupQuery = useQuery<VoiceSetupResponse>({
    queryKey: ["/api/voice/setup"],
    queryFn: async () => (await apiRequest("GET", "/api/voice/setup")).json(),
    staleTime: 10_000,
  });

  const connectors = setupQuery.data?.connectors.connectors ?? [];
  const healthById = useMemo(() => new Map((setupQuery.data?.connectors.health ?? []).map((h) => [h.connectorId, h])), [setupQuery.data]);
  const keyedConnectors = connectors.filter((connector) => connector.vaultKey);
  const connectorCredentialNames = useMemo(() => new Set(keyedConnectors.map((connector) => connector.vaultKey!)), [keyedConnectors]);
  const aiProviders = setupQuery.data?.aiProviders ?? [];
  const selectedAiProvider = aiProviders.find((provider) => provider.id === aiProviderId) ?? null;
  const firstCompletionNeedsAiVerification = Boolean(selectedAiProvider && !setupQuery.data?.setup?.completedAt && !aiVerification);
  const configurableSources = connectors.filter((connector) => ["private_api", "database", "cloud_storage"].includes(connector.sourceType));

  const sourceConnectionQuery = useQuery<SavedSourceConnection[]>({
    queryKey: ["/api/setup/source-connections"],
    queryFn: async () => (await apiRequest("GET", "/api/setup/source-connections")).json(),
    staleTime: 30_000,
  });

  useEffect(() => {
    const previous = setupQuery.data?.setup;
    if (previous) {
      setSelectedConnectorIds(previous.selectedConnectorIds);
      setPythonRuntimeId(previous.pythonRuntimeId);
      setPythonPackIds(previous.pythonPackIds);
      setAiProviderId(previous.aiProviderId ?? "");
      setAiModelId(previous.aiModelId ?? "");
      return;
    }
    // No-key public sources give a useful terminal without requiring setup credentials.
    setSelectedConnectorIds(connectors.filter((connector) => connector.authMode === "none").map((connector) => connector.id));
  }, [setupQuery.data, connectors]);

  useEffect(() => {
    const saved = sourceConnectionQuery.data ?? [];
    if (!saved.length) return;
    setSourceEndpoints((current) => {
      const next = { ...current };
      for (const connection of saved) {
        const endpoint = connection.config.endpoint;
        if (typeof endpoint === "string") next[connection.connectorId] = endpoint;
      }
      return next;
    });
  }, [sourceConnectionQuery.data]);

  useEffect(() => {
    const installed = runtimeQuery.data?.status.installedPacks;
    if (installed?.length && pythonPackIds.length === 1 && pythonPackIds[0] === "core") setPythonPackIds(installed);
  }, [runtimeQuery.data, pythonPackIds]);

  useEffect(() => {
    setAiVerification(null);
    if (!selectedAiProvider) {
      setAiModelId("");
      return;
    }
    if (!aiModelId.trim()) {
      setAiModelId(selectedAiProvider.defaultModel || selectedAiProvider.models[0] || "");
      return;
    }
    if (!selectedAiProvider.allowCustomModel && !selectedAiProvider.models.includes(aiModelId)) {
      setAiModelId(selectedAiProvider.defaultModel || selectedAiProvider.models[0] || "");
    }
  }, [selectedAiProvider?.id]);

  function toggleConnector(id: string): void {
    setSelectedConnectorIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function togglePack(id: string): void {
    setPythonPackIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function configureVoiceRuntime(kind: VoiceRuntimeFileKind): Promise<void> {
    if (!desktopBridge?.configureVoiceRuntimeFile) {
      setError("Local voice runtime file selection is available in the installed LiOS desktop app.");
      return;
    }
    setConfiguringVoice(kind);
    setError(null);
    try {
      const result = await desktopBridge.configureVoiceRuntimeFile(kind);
      if (result.cancelled) return;
      await apiRequest("POST", "/api/voice/setup/refresh");
      await voiceSetupQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not configure the local voice runtime.");
    } finally {
      setConfiguringVoice(null);
    }
  }

  async function saveSelectedAiCredential(): Promise<void> {
    if (!selectedAiProvider) return;
    const aiCredential = keyValues[selectedAiProvider.credentialName]?.trim();
    if (!aiCredential) return;
    await apiRequest("PUT", `/api/setup/credentials/${selectedAiProvider.credentialName}`, {
      value: aiCredential,
      label: selectedAiProvider.name,
    });
    setKeyValues(current => {
      const next = { ...current };
      delete next[selectedAiProvider.credentialName];
      return next;
    });
  }

  async function testAiProvider(): Promise<void> {
    if (!selectedAiProvider) return;
    setTestingAi(true);
    setAiVerification(null);
    setError(null);
    try {
      await saveSelectedAiCredential();
      await apiRequest("PUT", "/api/setup/status", {
        aiProviderId: selectedAiProvider.id,
        aiModelId: aiModelId.trim() || selectedAiProvider.defaultModel,
      });
      const response = await apiRequest("POST", "/api/setup/ai/test", {
        provider: selectedAiProvider.id,
        model: aiModelId.trim() || selectedAiProvider.defaultModel,
      });
      const result = await response.json() as AIVerificationResult;
      setAiVerification(result);
      await setupQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live AI verification failed.");
    } finally {
      setTestingAi(false);
    }
  }

  async function saveSetup(complete: boolean): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      for (const connector of keyedConnectors) {
        const value = keyValues[connector.vaultKey!]?.trim();
        if (!value) continue;
        await apiRequest("PUT", `/api/setup/credentials/${connector.vaultKey}`, { value, label: connector.name });
      }
      if (selectedAiProvider) {
        await saveSelectedAiCredential();
      }
      for (const connector of connectors.filter((item) => selectedConnectorIds.includes(item.id))) {
        const endpoint = sourceEndpoints[connector.id]?.trim();
        const needsEndpoint = connector.sourceType === "private_api" || connector.sourceType === "cloud_storage" || connector.sourceType === "database";
        if (needsEndpoint && !endpoint) continue;
        const sourceResponse = await apiRequest("PUT", "/api/setup/source-connections", {
          connectorId: connector.id,
          name: connector.name,
          sourceType: connector.sourceType,
          config: endpoint ? { endpoint } : {},
          credentialRef: connector.vaultKey ?? null,
        });
        const sourceBody: unknown = await sourceResponse.json();
        if (sourceBody && typeof sourceBody === "object" && "connection" in sourceBody) {
          const connection = sourceBody.connection;
          if (connection && typeof connection === "object" && "id" in connection && typeof connection.id === "number") {
            await apiRequest("POST", "/api/setup/source-connections/test", { connectionId: connection.id });
          }
        }
      }
      await apiRequest("PUT", "/api/setup/status", {
        selectedConnectorIds,
        pythonRuntimeId,
        pythonPackIds: pythonPackIds.length ? pythonPackIds : ["core"],
        aiProviderId: aiProviderId || null,
        aiModelId: aiProviderId ? (aiModelId.trim() || selectedAiProvider?.defaultModel || null) : null,
        complete,
      });
      if (complete) onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save environment setup.");
    } finally {
      setSaving(false);
    }
  }

  if (setupQuery.isLoading) {
    return <SetupShell session={session} onLogout={onLogout}><SetupMessage text="LOADING DATA ENVIRONMENT..." /></SetupShell>;
  }
  if (setupQuery.isError || !setupQuery.data) {
    return <SetupShell session={session} onLogout={onLogout}><SetupMessage text="Could not load setup services. Refresh to try again." error /></SetupShell>;
  }

  return (
    <SetupShell session={session} onLogout={onLogout}>
      <div className="w-full max-w-6xl space-y-5 overflow-y-auto max-h-[calc(100vh-130px)] pr-1">
        <div className="flex items-end justify-between border-b border-border pb-3">
          <div>
            <div className="flex items-center gap-2 mb-2"><TerminalSquare className="w-4 h-4 text-[hsl(38,95%,55%)]" /><span className="font-terminal text-[12px] tracking-[0.2em] text-foreground uppercase">Data Environment Gateway</span></div>
            <p className="font-terminal text-[10px] text-muted-foreground">Configure providers, private sources, Python engines, optional local voice, and optional AI before entering the terminal.</p>
          </div>
          <span className="font-terminal text-[9px] text-emerald-400">LOCAL-FIRST · USER CONTROLLED</span>
        </div>

        <section className="border border-border bg-[#070707] p-4">
          <div className="flex items-center gap-2 mb-3"><Plug className="w-4 h-4 text-[hsl(38,95%,55%)]" /><h2 className="font-terminal text-[10px] uppercase tracking-widest text-foreground">1. Data Providers and Sources</h2><span className="font-terminal text-[9px] text-muted-foreground ml-auto">{selectedConnectorIds.length} selected</span></div>
          <p className="font-terminal text-[9px] text-muted-foreground mb-3">Select the sources LiOS may use. Public sources require no key. Keys are encrypted locally and never shown again.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {connectors.map((connector) => {
              const health = healthById.get(connector.id);
              const Icon = HEALTH_ICON[health?.state ?? "catalog_only"];
              const selected = selectedConnectorIds.includes(connector.id);
              return (
                <button key={connector.id} type="button" onClick={() => toggleConnector(connector.id)} className={`text-left border p-3 transition-colors ${selected ? "border-[hsl(38,95%,50%)]/60 bg-[hsl(38,95%,50%)]/5" : "border-border hover:border-border/80"}`}>
                  <div className="flex items-center gap-2"><Icon className={`w-3.5 h-3.5 ${HEALTH_COLOR[health?.state ?? "catalog_only"]}`} /><span className="font-terminal text-[9px] font-bold uppercase text-foreground truncate">{connector.name}</span><span className={`ml-auto font-terminal text-[8px] uppercase ${HEALTH_COLOR[health?.state ?? "catalog_only"]}`}>{health?.state ?? "catalog_only"}</span></div>
                  <div className="font-terminal text-[8px] text-muted-foreground uppercase mt-1">{connector.category} · {connector.sourceType} · {connector.custodyMode}</div>
                  {connector.description && <p className="font-terminal text-[8px] normal-case leading-relaxed text-muted-foreground/85 mt-1.5">{connector.description}</p>}
                  <div className="flex gap-1 mt-2 flex-wrap">{connector.capabilities.slice(0, 4).map((cap) => <span key={cap.contractFamily} className="font-terminal text-[7px] px-1 border border-border text-muted-foreground">{cap.contractFamily}</span>)}</div>
                  {selected && <div className="font-terminal text-[8px] text-[hsl(38,95%,55%)] mt-2">SELECTED FOR CONTRACT RESOLUTION</div>}
                </button>
              );
            })}
          </div>
        </section>

        {keyedConnectors.length > 0 && (
          <section className="border border-border bg-[#070707] p-4">
            <div className="flex items-center gap-2 mb-3"><KeyRound className="w-4 h-4 text-[hsl(38,95%,55%)]" /><h2 className="font-terminal text-[10px] uppercase tracking-widest text-foreground">2. Provider Keys</h2><span className="font-terminal text-[9px] text-muted-foreground ml-auto">ENCRYPTED VAULT</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {keyedConnectors.map((connector) => (
                <label key={connector.id} className="flex flex-col gap-1"><span className="font-terminal text-[8px] text-muted-foreground uppercase">{connector.name} · {connector.vaultKey}</span><input type="password" value={keyValues[connector.vaultKey!] ?? ""} onChange={(event) => setKeyValues((current) => ({ ...current, [connector.vaultKey!]: event.target.value }))} placeholder={connector.setupGuide} className="bg-[#0d0d0d] border border-border px-2 py-2 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/60" autoComplete="off" /></label>
              ))}
            </div>
          </section>
        )}
        {configurableSources.length > 0 && (
          <section className="border border-border bg-[#070707] p-4">
            <div className="flex items-center gap-2 mb-3"><Upload className="w-4 h-4 text-[hsl(38,95%,55%)]" /><h2 className="font-terminal text-[10px] uppercase tracking-widest text-foreground">3. Private Source Connections</h2><span className="font-terminal text-[9px] text-muted-foreground ml-auto">CONFIGURATION ONLY · NO RAW ROWS</span></div>
            <p className="font-terminal text-[9px] text-muted-foreground mb-3">Configure a private API or database endpoint. LiOS stores only safe connection metadata and a vault credential reference; connection tests never log credentials.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {configurableSources.map((connector) => (
                <label key={connector.id} className="flex flex-col gap-1"><span className="font-terminal text-[8px] text-muted-foreground uppercase">{connector.name} · {connector.sourceType}</span><input value={sourceEndpoints[connector.id] ?? ""} onChange={(event) => setSourceEndpoints((current) => ({ ...current, [connector.id]: event.target.value }))} placeholder={connector.sourceType === "database" ? "https://database-gateway.example" : "https://private-api.example/v1"} className="bg-[#0d0d0d] border border-border px-2 py-2 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/60" /></label>
              ))}
            </div>
          </section>
        )}

        <section className="border border-border bg-[#070707] p-4">
          <div className="flex items-center gap-2 mb-3"><Package className="w-4 h-4 text-[hsl(38,95%,55%)]" /><h2 className="font-terminal text-[10px] uppercase tracking-widest text-foreground">4. Python Runtime and Libraries</h2><span className={`font-terminal text-[9px] ml-auto ${runtimeQuery.data?.status.state === "ready" ? "text-emerald-400" : "text-amber-400"}`}>{runtimeQuery.data?.status.state?.toUpperCase() ?? "CHECKING"}</span></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-1 space-y-2"><label className="font-terminal text-[8px] text-muted-foreground uppercase">Runtime profile</label><select value={pythonRuntimeId} onChange={(event) => setPythonRuntimeId(event.target.value)} className="w-full bg-[#0d0d0d] border border-border px-2 py-2 font-terminal text-[9px] text-foreground focus:outline-none">{runtimeQuery.data?.profiles.filter((profile) => profile.supported).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.recommended ? " (recommended)" : ""}</option>)}</select><p className="font-terminal text-[8px] text-muted-foreground">{runtimeQuery.data?.profiles.find((profile) => profile.id === pythonRuntimeId)?.description}</p></div>
            <div className="lg:col-span-2"><div className="font-terminal text-[8px] text-muted-foreground uppercase mb-2">Engine packs</div><div className="grid grid-cols-2 md:grid-cols-4 gap-2">{runtimeQuery.data?.packs.map((pack) => { const active = pythonPackIds.includes(pack.id); return <button key={pack.id} type="button" onClick={() => togglePack(pack.id)} className={`text-left border p-2 ${active ? "border-emerald-500/50 bg-emerald-500/5" : "border-border"}`}><div className="font-terminal text-[8px] text-foreground">{active ? "✓ " : ""}{pack.name}</div><div className="font-terminal text-[7px] text-muted-foreground mt-1">{pack.packages.slice(0, 3).join(", ")}</div></button>; })}</div></div>
          </div>
          <div className="font-terminal text-[8px] text-muted-foreground mt-3">{runtimeQuery.data?.status.detail ?? "Checking Python sidecar and installed libraries..."}</div>
        </section>

        <section className="border border-border bg-[#070707] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Mic className="w-4 h-4 text-[hsl(38,95%,55%)]" />
            <h2 className="font-terminal text-[10px] uppercase tracking-widest text-foreground">5. Local Voice Runtime</h2>
            <span className={`font-terminal text-[9px] ml-auto ${voiceSetupQuery.data?.recordingReady ? "text-emerald-400" : "text-amber-400"}`}>
              {voiceSetupQuery.isLoading ? "CHECKING" : voiceSetupQuery.data?.recordingReady ? "READY" : "OPTIONAL SETUP"}
            </span>
          </div>
          <p className="font-terminal text-[9px] text-muted-foreground mb-3">
            Voice input stays local when you bring a whisper.cpp executable and model. Browser/Electron microphone recordings are normally WebM, so ffmpeg is also required for automatic WAV conversion. LiOS stores only your selected local paths and never uploads these files.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {([
              ["whisperExecutable", "whisper.cpp", voiceSetupQuery.data?.whisperExecutable],
              ["model", "Whisper model", voiceSetupQuery.data?.model],
              ["ffmpeg", "ffmpeg", voiceSetupQuery.data?.ffmpeg],
            ] as const).map(([kind, label, status]) => (
              <div key={kind} className="border border-border bg-[#0b0b0b] p-3">
                <div className="flex items-center gap-2">
                  {status?.available ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-amber-400" />}
                  <span className="font-terminal text-[9px] text-foreground">{label}</span>
                </div>
                <div className="font-terminal text-[8px] text-muted-foreground mt-1 truncate">{status?.available ? status.name : "Not configured"}</div>
                <button
                  type="button"
                  onClick={() => void configureVoiceRuntime(kind)}
                  disabled={!desktopBridge?.configureVoiceRuntimeFile || configuringVoice !== null}
                  className="mt-3 border border-border px-2.5 py-1.5 font-terminal text-[8px] uppercase text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  {configuringVoice === kind ? "Selecting..." : status?.available ? "Change file" : "Choose file"}
                </button>
              </div>
            ))}
          </div>
          {!desktopBridge?.configureVoiceRuntimeFile && (
            <p className="font-terminal text-[8px] text-muted-foreground mt-3">Native file selection is available in the installed LiOS desktop app. Development/server environments may also use the documented LIOS_WHISPER_CPP_BIN, LIOS_WHISPER_MODEL and LIOS_FFMPEG_BIN settings.</p>
          )}
          {voiceSetupQuery.data?.transcriptionProviderReady && !voiceSetupQuery.data?.recordingReady && (
            <p className="font-terminal text-[8px] text-amber-300 mt-3">Whisper is ready for WAV input, but normal microphone recordings still need ffmpeg before LiOS can transcribe them.</p>
          )}
          {voiceSetupQuery.data?.recordingReady && (
            <p className="font-terminal text-[8px] text-emerald-300 mt-3">Local microphone transcription is ready. Registered transcription providers: {voiceSetupQuery.data.transcriptionProviders.join(", ") || "none"}.</p>
          )}
          <p className="font-terminal text-[8px] text-muted-foreground mt-2">Speech output remains opt-in. Available local/output providers: {voiceSetupQuery.data?.speechProviders.join(", ") || "none detected on this platform"}.</p>
        </section>

        <section className="border border-border bg-[#070707] p-4">
          <div className="flex items-center gap-2 mb-3"><ShieldCheck className="w-4 h-4 text-[hsl(38,95%,55%)]" /><h2 className="font-terminal text-[10px] uppercase tracking-widest text-foreground">6. AI Provider</h2><span className="font-terminal text-[9px] text-muted-foreground ml-auto">LIVE VERIFICATION REQUIRED FOR CONFIDENCE</span></div>
          <p className="font-terminal text-[9px] text-muted-foreground mb-3">Connect your own AI provider, choose the model LiOS should use, then run a tiny live probe before entering the terminal. The probe sends no Project data.</p>
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-end">
            <label className="flex flex-col gap-1">
              <span className="font-terminal text-[8px] text-muted-foreground uppercase">Provider</span>
              <select value={aiProviderId} onChange={(event) => setAiProviderId(event.target.value)} className="bg-[#0d0d0d] border border-border px-2 py-2 font-terminal text-[9px] text-foreground focus:outline-none">
                <option value="">AI disabled</option>
                {aiProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.isLocal ? " (local)" : ""}{provider.available ? " · configured" : ""}</option>)}
              </select>
            </label>
            {selectedAiProvider && (
              <label className="flex flex-col gap-1">
                <span className="font-terminal text-[8px] text-muted-foreground uppercase">Model</span>
                {selectedAiProvider.allowCustomModel ? (
                  <input
                    value={aiModelId}
                    onChange={(event) => { setAiModelId(event.target.value); setAiVerification(null); }}
                    list={`ai-models-${selectedAiProvider.id}`}
                    placeholder={selectedAiProvider.defaultModel}
                    className="bg-[#0d0d0d] border border-border px-2 py-2 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/60"
                  />
                ) : (
                  <select value={aiModelId} onChange={(event) => { setAiModelId(event.target.value); setAiVerification(null); }} className="bg-[#0d0d0d] border border-border px-2 py-2 font-terminal text-[9px] text-foreground focus:outline-none">
                    {selectedAiProvider.models.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                )}
                <datalist id={`ai-models-${selectedAiProvider.id}`}>{selectedAiProvider.models.map((model) => <option key={model} value={model} />)}</datalist>
              </label>
            )}
            {selectedAiProvider && (
              <button
                type="button"
                onClick={() => void testAiProvider()}
                disabled={testingAi || saving}
                className="border border-cyan-400/40 bg-cyan-400/5 px-3 py-2 font-terminal text-[9px] uppercase text-cyan-300 hover:bg-cyan-400/10 disabled:opacity-50"
              >
                {testingAi ? "Testing..." : "Test live AI"}
              </button>
            )}
          </div>
          {selectedAiProvider && !connectorCredentialNames.has(selectedAiProvider.credentialName) && (
            <div className="mt-3 max-w-xl space-y-1">
              <label className="font-terminal text-[8px] text-muted-foreground uppercase">{selectedAiProvider.name} credential / endpoint</label>
              <input
                type="password"
                value={keyValues[selectedAiProvider.credentialName] ?? ""}
                onChange={(event) => { setKeyValues((current) => ({ ...current, [selectedAiProvider.credentialName]: event.target.value })); setAiVerification(null); }}
                placeholder={selectedAiProvider.isLocal ? "Local runtime base URL" : "Provider API credential"}
                className="w-full bg-[#0d0d0d] border border-border px-2 py-2 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/60"
                autoComplete="off"
              />
              {selectedAiProvider.requiresExternalConfig && <p className="font-terminal text-[8px] text-amber-300">This provider also requires non-secret endpoint/deployment configuration on the target runtime.</p>}
              <p className="font-terminal text-[8px] text-muted-foreground">Stored in the encrypted credential vault; the value is never returned to the renderer after save.</p>
            </div>
          )}
          {selectedAiProvider && connectorCredentialNames.has(selectedAiProvider.credentialName) && (
            <p className="mt-3 font-terminal text-[8px] text-muted-foreground">This AI credential uses the matching provider-key field above. Enter or replace it there, then run the live test.</p>
          )}
          {aiVerification && (
            <div className="mt-3 border border-emerald-500/35 bg-emerald-500/5 px-3 py-2">
              <div className="font-terminal text-[9px] text-emerald-300">LIVE VERIFIED · {aiVerification.provider} · {aiVerification.model} · {aiVerification.latencyMs} ms</div>
              <div className="mt-1 font-terminal text-[8px] text-muted-foreground">{aiVerification.detail}</div>
            </div>
          )}
        </section>

        {error && <div className="border border-rose-500/40 bg-rose-500/5 px-3 py-2 font-terminal text-[9px] text-rose-300">{error}</div>}
        <div className="flex items-center justify-between pb-4"><span className="font-terminal text-[8px] text-muted-foreground">You can change these bindings later from the Data Environment panel.</span><div className="flex gap-2"><button type="button" onClick={() => void saveSetup(false)} disabled={saving} className="border border-border px-3 py-2 font-terminal text-[9px] uppercase text-muted-foreground hover:text-foreground">Save Setup</button><button type="button" onClick={() => void saveSetup(true)} disabled={saving || firstCompletionNeedsAiVerification} title={firstCompletionNeedsAiVerification ? "Run Test live AI successfully, or clear the AI provider selection." : undefined} className="flex items-center gap-1 border border-[hsl(38,95%,50%)] bg-[hsl(38,95%,50%)]/10 px-4 py-2 font-terminal text-[9px] uppercase text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/20 disabled:cursor-not-allowed disabled:opacity-40">{saving ? "Saving..." : firstCompletionNeedsAiVerification ? "Verify AI to Enter" : "Enter LiOS Terminal"}<ChevronRight className="w-3 h-3" /></button></div></div>
      </div>
    </SetupShell>
  );
}

function SetupShell({ session, onLogout, children }: { session: { name: string }; onLogout: () => void; children: React.ReactNode }) {
  return <div className="dark min-h-screen bg-[#030303] flex flex-col items-center px-6 py-8"><div className="w-full max-w-6xl flex items-center justify-between mb-5"><div className="font-terminal text-[9px] text-muted-foreground uppercase tracking-widest">Welcome, {session.name}</div><button type="button" onClick={onLogout} className="font-terminal text-[9px] text-muted-foreground hover:text-rose-400 uppercase tracking-widest">Sign out</button></div>{children}</div>;
}

function SetupMessage({ text, error = false }: { text: string; error?: boolean }) {
  return <div className={`font-terminal text-[10px] ${error ? "text-rose-400" : "text-muted-foreground animate-pulse"}`}>{text}</div>;
}
