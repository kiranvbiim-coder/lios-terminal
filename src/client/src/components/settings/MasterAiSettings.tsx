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
  const cannotEnable = !enabled && !providerReady;

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

  return (
    <section className="border border-border/60 bg-black/20 p-3 space-y-3" data-testid="connection-master-ai-settings">
      <div className="flex items-center gap-2">
        <Bot className="h-3.5 w-3.5 text-[hsl(38,95%,55%)]" />
        <h3 className="font-terminal text-[8px] uppercase tracking-widest text-foreground">Master AI · BYOAI</h3>
        <span className={`ml-auto font-terminal text-[8px] ${stateQuery.isError ? "text-rose-300" : enabled ? "text-emerald-300" : "text-muted-foreground"}`} role="status">
          {stateQuery.isPending ? "CHECKING" : stateQuery.isError ? "UNAVAILABLE" : enabled ? "ON" : "OFF"}
        </span>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-terminal text-[8px] text-foreground">Allow LiOS to use your connected AI provider</p>
          <p className="font-terminal text-[7px] leading-relaxed text-muted-foreground">
            When enabled, prompts and only context permitted for the active project may be sent to your selected provider. Review provider terms and project permissions. You can turn this off at any time.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Master AI"
          aria-checked={enabled ?? false}
          data-testid="master-ai-switch"
          disabled={stateQuery.isPending || !stateQuery.data || saveMutation.isPending || cannotEnable}
          onClick={() => saveMutation.mutate(enabled ? "off" : "on")}
          className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${enabled ? "border-emerald-400/70 bg-emerald-500/30" : "border-border bg-black/50"}`}
        >
          <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${enabled ? "left-[18px] bg-emerald-300" : "left-0.5 bg-muted-foreground"}`} />
        </button>
      </div>

      <div className="flex items-start gap-1.5 border-t border-border/50 pt-2">
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
        <p className="font-terminal text-[7px] leading-relaxed text-muted-foreground">
          Deterministic finance tools remain available while AI is off. AI-generated analysis is separate from LiOS deterministic results.
        </p>
      </div>

      <p className="font-terminal text-[7px] text-muted-foreground">
        {providerReady
          ? `Selected: ${providerName ?? "Connected provider"} · ${modelId}`
          : modelBlocked
            ? "Master AI is blocked because complete provider discovery did not return the selected model."
            : "Select a provider and model, then explicitly verify chat above before enabling Master AI. Configuration and model discovery alone are not verification."}
        {onChangeProvider && (
          <button type="button" onClick={onChangeProvider} data-testid="master-ai-change-provider" className="ml-2 underline underline-offset-2 text-[hsl(38,95%,55%)] hover:text-[hsl(38,95%,70%)]">
            Change provider or model
          </button>
        )}
      </p>
      {modelBlocked && (
        <p className="font-terminal text-[7px] leading-relaxed text-amber-200" role="alert" data-testid="master-ai-model-blocked">
          Choose a model returned by the provider's complete discovery result, or disable the AI provider. LiOS attempts to turn Master AI OFF once for this blocked model; if saving fails, the previous setting remains and the error below must be resolved.
        </p>
      )}
      {stateQuery.isError && <p className="font-terminal text-[7px] text-rose-300" role="alert">Master AI state could not be loaded. It remains unavailable until the authenticated preference service responds.</p>}
      {saveMutation.isError && <p className="font-terminal text-[7px] text-rose-300" role="alert">Could not confirm your Master AI setting. LiOS is refreshing the current permission; review the state above and retry.</p>}
      {saveMutation.isPending && <p className="font-terminal text-[7px] text-muted-foreground" role="status">Saving your account-scoped preference…</p>}
    </section>
  );
}
