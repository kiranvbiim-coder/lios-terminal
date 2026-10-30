import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { AiModelAccessState } from "@/lib/aiModelAccess";

export interface MasterAiSessionState {
  state: "on" | "off";
  mode: "manual" | "ai_assist" | "ai_build" | "ai_scenario";
  updatedAt?: string | null;
}

interface MasterAiSettingsProps {
  /** Jumps to the primary AI provider/model selector. */
  onChangeProvider?: () => void;
  providerName?: string;
  providerAvailable: boolean;
  modelId: string;
  modelAccess: AiModelAccessState;
  chatVerified: boolean;
  selectionBusy?: boolean;
  onBeforeEnable: () => Promise<void>;
  onSavingChange: (pending: boolean) => void;
}

export default function MasterAiSettings({ providerName, providerAvailable, modelId, modelAccess, chatVerified, selectionBusy = false, onBeforeEnable, onSavingChange, onChangeProvider }: MasterAiSettingsProps) {
  const queryClient = useQueryClient();
  const forcedOffAttemptRef = useRef<string | null>(null);
  const stateQuery = useQuery<MasterAiSessionState>({
    queryKey: ["/api/wave-c/ai/state"],
    queryFn: async () => (await apiRequest("GET", "/api/wave-c/ai/state")).json(),
    staleTime: 5_000,
  });
  const saveMutation = useMutation({
    onMutate: () => onSavingChange(true),
    mutationFn: async (state: MasterAiSessionState["state"]) => {
      if (state === "on") await onBeforeEnable();
      const mode = stateQuery.data?.mode ?? "manual";
      return (await apiRequest("PUT", "/api/wave-c/ai/state", { state, mode })).json() as Promise<MasterAiSessionState>;
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(["/api/wave-c/ai/state"], saved);
      await queryClient.invalidateQueries({ queryKey: ["/api/setup/status"] });
    },
    onSettled: async () => {
      onSavingChange(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/wave-c/ai/state"] });
    },
  });

  const enabled = stateQuery.data?.state === "on";
  const modelBlocked = modelAccess === "blocked";
  const providerReady = providerAvailable && Boolean(modelId.trim()) && !modelBlocked && chatVerified && !selectionBusy;

  useEffect(() => {
    const blockedKey = modelBlocked ? modelId.trim() : "";
    if (!blockedKey) {
      forcedOffAttemptRef.current = null;
      return;
    }
    if (!enabled || saveMutation.isPending || forcedOffAttemptRef.current === blockedKey) return;
    forcedOffAttemptRef.current = blockedKey;
    saveMutation.mutate("off");
  }, [enabled, modelBlocked, modelId, saveMutation.isPending]);

  const chatAiName = `${providerName ?? "Your AI"} · ${modelId.trim()}`;

  return (
    <section className="border border-border/60 bg-black/20 p-3 space-y-3" data-testid="connection-master-ai-settings">
      <div className="flex items-center gap-2">
        <Bot className="h-3.5 w-3.5 text-[hsl(38,95%,55%)]" />
        <h3 className="font-terminal text-[8px] uppercase tracking-widest text-foreground">AI for Chat</h3>
      </div>

      {stateQuery.isPending ? (
        <p className="font-terminal text-[8px] text-muted-foreground" role="status">Checking which AI Chat uses…</p>
      ) : enabled && providerAvailable && modelId.trim() && !modelBlocked ? (
        <p className="font-terminal text-[8px] text-emerald-300" role="status" data-testid="master-ai-in-use">Chat is using {chatAiName}</p>
      ) : providerReady ? (
        <div className="flex items-center justify-between gap-3">
          <p className="font-terminal text-[8px] text-foreground">{chatAiName} is verified.</p>
          <button
            type="button"
            data-testid="master-ai-use-for-chat"
            disabled={!stateQuery.data || saveMutation.isPending}
            onClick={() => saveMutation.mutate("on")}
            className="shrink-0 border border-[hsl(38,95%,50%)]/60 px-3 py-1.5 font-terminal text-[9px] uppercase text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10 disabled:opacity-45"
          >
            Use for Chat
          </button>
        </div>
      ) : (
        <p className="font-terminal text-[8px] text-muted-foreground" role="status">
          {modelBlocked
            ? "Your provider did not list the selected model. Choose another model to use Chat."
            : "Choose a provider and model, then verify it above to use it for Chat."}
        </p>
      )}

      <div className="flex items-start gap-1.5 border-t border-border/50 pt-2">
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
        <p className="font-terminal text-[7px] leading-relaxed text-muted-foreground">
          Your messages and only the context allowed for the active Project are sent to the AI you chose to answer them. Review your provider's terms and your Project permissions.
        </p>
      </div>

      {onChangeProvider && (
        <button type="button" onClick={onChangeProvider} data-testid="master-ai-change-provider" className="font-terminal text-[7px] underline underline-offset-2 text-[hsl(38,95%,55%)] hover:text-[hsl(38,95%,70%)]">
          Change provider or model
        </button>
      )}
      {stateQuery.isError && <p className="font-terminal text-[7px] text-rose-300" role="alert">Your AI setting could not be loaded. Try again shortly.</p>}
      {saveMutation.isError && <p className="font-terminal text-[7px] text-rose-300" role="alert">Your AI setting could not be saved. Check it above and try again.</p>}
      {saveMutation.isPending && <p className="font-terminal text-[7px] text-muted-foreground" role="status">Saving…</p>}
    </section>
  );
}
