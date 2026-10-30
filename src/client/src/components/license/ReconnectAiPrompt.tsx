import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, PlugZap } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  aiConnectionErrorText,
  aiProviderLabel,
  reconnectSavedAi,
  savedAiProvider,
  type AiChatPermission,
  type AiSetupStatus,
} from "@/lib/aiConnection";
import { ConnectAiPanel } from "./ConnectAiStep";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

/** Shown above the Chat composer when the AI must be reconnected; the typed message stays in the box. */
export default function ReconnectAiPrompt({ setup, permission, onReconnected }: {
  setup: AiSetupStatus | undefined;
  permission: AiChatPermission | undefined;
  onReconnected: () => void;
}) {
  const queryClient = useQueryClient();
  const saved = savedAiProvider(setup);
  const name = saved ? aiProviderLabel(saved.provider) : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);

  const reconnect = async () => {
    if (busy || !saved) return;
    setBusy(true);
    setError(null);
    try {
      await reconnectSavedAi(queryClient, setup, permission);
      onReconnected();
    } catch (failure) {
      setError(aiConnectionErrorText(failure, name ?? "Your AI"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="region" aria-label="Reconnect AI" data-testid="reconnect-ai-prompt" className="mb-2 rounded-md border border-[hsl(38,95%,50%)]/50 bg-[hsl(38,95%,50%)]/[0.06] p-3 font-ui text-sm text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <PlugZap className="h-4 w-4 shrink-0 text-[hsl(38,95%,55%)]" aria-hidden="true" />
        <span role="status" className="min-w-0 flex-1">
          {name ? `Reconnect ${name} to continue. Your message is kept.` : "Connect an AI to use Chat. Your message is kept."}
        </span>
        {saved && (
          <button type="button" onClick={() => void reconnect()} disabled={busy} data-testid="reconnect-ai-saved"
            className={`flex items-center gap-1.5 rounded-md bg-[hsl(38,95%,50%)] px-3 py-1.5 text-xs font-semibold text-black hover:bg-[hsl(38,95%,58%)] disabled:opacity-50 ${focusRing}`}>
            {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Checking {name}…</> : `Reconnect ${name}`}
          </button>
        )}
        <button type="button" onClick={() => setChoosing(true)} disabled={busy} data-testid="reconnect-ai-choose"
          className={`rounded-md border border-border px-3 py-1.5 text-xs hover:bg-white/[0.04] disabled:opacity-50 ${focusRing}`}>
          {saved ? "Choose another AI" : "Choose an AI"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
      <Dialog open={choosing} onOpenChange={setChoosing}>
        <DialogContent className="dark max-w-2xl border-border bg-[#070707] text-foreground">
          <DialogHeader>
            <DialogTitle className="font-ui text-base">Connect your AI</DialogTitle>
            <DialogDescription className="font-ui text-sm text-muted-foreground">
              Use your own key from a cloud provider, or an AI app running on this computer.
            </DialogDescription>
          </DialogHeader>
          {choosing && <ConnectAiPanel setup={setup} onConnected={() => { setChoosing(false); setError(null); onReconnected(); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
