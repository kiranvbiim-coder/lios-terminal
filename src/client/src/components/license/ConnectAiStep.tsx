import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Cpu, Loader2, LogOut, Sparkles } from "lucide-react";
import {
  CONNECT_AI_PROVIDER_IDS,
  aiConnectionErrorText,
  aiProviderLabel,
  allowAiForChat,
  detectLocalModels,
  refreshAiConnection,
  saveCloudKey,
  verifyAiSelection,
  type AiProviderChoice,
  type AiSetupStatus,
} from "@/lib/aiConnection";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
const fieldCls = `w-full border border-border bg-black/40 px-3 py-2 font-ui text-sm text-foreground placeholder:text-muted-foreground/60 ${focusRing}`;

type LocalSearch = { state: "idle" | "searching" | "found" | "missing"; endpoint?: string; models: string[] };

/** Provider cards, key or local server, Verify, then Continue (the user's permission to use this AI in Chat). */
export function ConnectAiPanel({ setup, onConnected }: { setup: AiSetupStatus | undefined; onConnected: () => void }) {
  const queryClient = useQueryClient();
  const providers = CONNECT_AI_PROVIDER_IDS
    .map((id) => setup?.aiProviders.find((provider) => provider.id === id))
    .filter((provider): provider is AiProviderChoice => Boolean(provider));
  const savedProviderId = setup?.setup?.aiProviderId ?? null;
  const [providerId, setProviderId] = useState<string | null>(savedProviderId && providers.some((item) => item.id === savedProviderId) ? savedProviderId : null);
  const provider = providers.find((item) => item.id === providerId) ?? null;
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [address, setAddress] = useState("");
  const [local, setLocal] = useState<LocalSearch>({ state: "idle", models: [] });
  const [busy, setBusy] = useState<null | "verify" | "continue">(null);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchSeq = useRef(0);
  const name = provider ? aiProviderLabel(provider) : "";

  const findLocal = async (target: AiProviderChoice, chosenAddress?: string) => {
    const seq = ++searchSeq.current;
    setLocal({ state: "searching", models: [] });
    setError(null);
    try {
      const found = await detectLocalModels(target, chosenAddress);
      if (seq !== searchSeq.current) return;
      setLocal({ state: found.models.length ? "found" : "missing", endpoint: found.endpoint, models: found.models });
      setModel((current) => found.models.includes(current) ? current : found.models[0] ?? "");
      if (!found.models.length) setError(`${aiProviderLabel(target)} is running but has no models yet. Download a model in ${aiProviderLabel(target)}, then try again.`);
    } catch (failure) {
      if (seq !== searchSeq.current) return;
      setLocal({ state: "missing", models: [] });
      setError(`${aiProviderLabel(target)} was not found. Open it on this computer, or enter its address, then try again. ${aiConnectionErrorText(failure, aiProviderLabel(target))}`);
    } finally {
      if (seq === searchSeq.current) await refreshAiConnection(queryClient);
    }
  };

  const choose = (next: AiProviderChoice) => {
    if (busy) return;
    searchSeq.current += 1;
    setProviderId(next.id);
    setKey("");
    setAddress("");
    setVerified(false);
    setError(null);
    setLocal({ state: "idle", models: [] });
    setModel(next.isLocal ? "" : (next.id === savedProviderId && setup?.setup?.aiModelId) || next.defaultModel);
    if (next.isLocal) void findLocal(next);
  };

  // Resume a saved local choice with a fresh search when the step opens.
  useEffect(() => {
    if (provider?.isLocal && local.state === "idle") void findLocal(provider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canVerify = Boolean(provider && model.trim() && !busy && (provider.isLocal ? local.state === "found" : key.trim() || provider.available));

  const verify = async () => {
    if (!provider || !canVerify) return;
    setBusy("verify");
    setError(null);
    setVerified(false);
    try {
      if (!provider.isLocal && key.trim()) await saveCloudKey(provider, key);
      await verifyAiSelection({ setup, provider, model, endpoint: local.endpoint });
      setKey("");
      setVerified(true);
    } catch (failure) {
      setError(aiConnectionErrorText(failure, name));
    } finally {
      await refreshAiConnection(queryClient);
      setBusy(null);
    }
  };

  const proceed = async () => {
    if (!verified || busy) return;
    setBusy("continue");
    setError(null);
    try {
      await allowAiForChat(queryClient);
      onConnected();
    } catch (failure) {
      setVerified(false);
      setError(`${aiConnectionErrorText(failure, name)} Check the connection again, then continue.`);
    } finally {
      await refreshAiConnection(queryClient);
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5" data-testid="connect-ai-panel">
      <div role="radiogroup" aria-label="Choose your AI" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {providers.map((item) => {
          const selected = item.id === providerId;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`connect-ai-card-${item.id}`}
              disabled={busy !== null}
              onClick={() => choose(item)}
              className={`flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-md border px-3 py-2 text-left transition-colors disabled:opacity-50 ${focusRing} ${selected ? "border-[hsl(38,95%,50%)] bg-[hsl(38,95%,50%)]/10" : "border-border hover:border-[hsl(38,95%,50%)]/50 hover:bg-white/[0.03]"}`}
            >
              <span className="font-ui text-sm font-semibold text-foreground">{aiProviderLabel(item)}</span>
              <span className="font-ui text-[11px] text-muted-foreground">{item.isLocal ? "On this computer" : item.available ? "Key saved" : "Your API key"}</span>
            </button>
          );
        })}
      </div>

      {provider && !provider.isLocal && (
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="font-ui text-sm text-muted-foreground">{name} API key</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              data-testid="connect-ai-key"
              value={key}
              onChange={(event) => { setKey(event.target.value); setVerified(false); setError(null); }}
              placeholder={provider.available ? "Saved — paste a new key to replace it" : "Paste your key"}
              disabled={busy !== null}
              maxLength={10_000}
              className={fieldCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="font-ui text-sm text-muted-foreground">Model</span>
            <input
              data-testid="connect-ai-model"
              list={`connect-ai-models-${provider.id}`}
              value={model}
              onChange={(event) => { setModel(event.target.value); setVerified(false); setError(null); }}
              disabled={busy !== null}
              maxLength={200}
              className={fieldCls}
            />
            <datalist id={`connect-ai-models-${provider.id}`}>
              {provider.models.map((item) => <option key={item} value={item} />)}
            </datalist>
          </label>
          <p className="font-ui text-xs text-muted-foreground">Your key is stored securely on this computer and is never shown again.</p>
        </div>
      )}

      {provider?.isLocal && (
        <div className="space-y-3" data-testid="connect-ai-local">
          <p role="status" className="flex items-center gap-2 font-ui text-sm text-muted-foreground">
            {local.state === "searching" && <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Looking for {name} on this computer…</>}
            {local.state === "found" && <><Cpu className="h-4 w-4 text-emerald-400" aria-hidden="true" /> Found {name} with {local.models.length} {local.models.length === 1 ? "model" : "models"}.</>}
            {local.state === "missing" && <>{name} is not available yet.</>}
          </p>
          {local.state === "found" && (
            <label className="block space-y-1">
              <span className="font-ui text-sm text-muted-foreground">Model</span>
              <select data-testid="connect-ai-local-model" value={model} onChange={(event) => { setModel(event.target.value); setVerified(false); }} disabled={busy !== null} className={fieldCls}>
                {local.models.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          )}
          {local.state === "missing" && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="url"
                aria-label={`${name} address`}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder={provider.endpointEnvironmentManaged ? "Set by your administrator" : provider.defaultEndpoint}
                disabled={busy !== null || provider.endpointEnvironmentManaged}
                maxLength={2_000}
                className={fieldCls}
              />
              <button type="button" onClick={() => void findLocal(provider, address)} disabled={busy !== null}
                className={`shrink-0 rounded-md border border-border px-4 py-2 font-ui text-sm hover:bg-white/[0.04] disabled:opacity-50 ${focusRing}`}>
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      {provider && (
        <div className="space-y-3 border-t border-border/60 pt-4">
          {!verified ? (
            <button type="button" onClick={() => void verify()} disabled={!canVerify} data-testid="connect-ai-verify"
              className={`flex w-full items-center justify-center gap-2 rounded-md border border-[hsl(38,95%,50%)]/70 px-4 py-2.5 font-ui text-sm font-semibold text-[hsl(38,95%,60%)] hover:bg-[hsl(38,95%,50%)]/10 disabled:opacity-45 ${focusRing}`}>
              {busy === "verify" ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking {name}…</> : `Verify ${name}`}
            </button>
          ) : (
            <>
              <p role="status" className="flex items-center gap-2 font-ui text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {name} is connected and answered a test message.</p>
              <p className="font-ui text-xs leading-relaxed text-muted-foreground" data-testid="connect-ai-consent">
                {provider.isLocal
                  ? `When you continue, your messages and the context you choose to share are sent to ${name} on this computer to answer them.`
                  : `When you continue, your messages and the context you choose to share are sent to ${name} under your own account to answer them.`}
              </p>
              <button type="button" onClick={() => void proceed()} disabled={busy !== null} data-testid="connect-ai-continue"
                className={`flex w-full items-center justify-center gap-2 rounded-md bg-[hsl(38,95%,50%)] px-4 py-2.5 font-ui text-sm font-semibold text-black hover:bg-[hsl(38,95%,58%)] disabled:opacity-50 ${focusRing}`}>
                {busy === "continue" ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Starting Chat…</> : "Continue"}
              </button>
            </>
          )}
          {!verified && !provider.isLocal && <p className="font-ui text-xs text-muted-foreground">Verify sends one short test message to {name}; it may count toward your plan.</p>}
        </div>
      )}
      {error && <p role="alert" className="font-ui text-sm text-rose-300">{error}</p>}
    </div>
  );
}

/** Full-screen first-run step: Chat stays closed until an AI is connected. Sign out stays available. */
export default function ConnectAiStep({ setup, onConnected, onLogout }: { setup: AiSetupStatus | undefined; onConnected: () => void; onLogout: () => void | Promise<void> }) {
  return (
    <main className="flex min-h-screen w-screen items-center justify-center bg-[#030303] p-4 text-foreground" data-testid="connect-ai-step">
      <section className="w-full max-w-2xl space-y-6 rounded-lg border border-border bg-[#070707] p-6 sm:p-8" aria-labelledby="connect-ai-title">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[hsl(38,95%,55%)]" aria-hidden="true" />
              <h1 id="connect-ai-title" className="font-ui text-xl font-semibold">Connect your AI</h1>
            </div>
            <p className="max-w-lg font-ui text-sm leading-relaxed text-muted-foreground">
              LiOS works with the AI you choose. Use your own key from a cloud provider, or an AI app running on this computer.
            </p>
          </div>
          <button type="button" onClick={() => void onLogout()} className={`flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-ui text-xs text-muted-foreground hover:text-foreground ${focusRing}`}>
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out
          </button>
        </header>
        {setup
          ? <ConnectAiPanel setup={setup} onConnected={onConnected} />
          : <p role="status" className="font-ui text-sm text-muted-foreground">Loading AI choices…</p>}
      </section>
    </main>
  );
}
