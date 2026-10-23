import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
import type { ConversationExecutionMode } from "@shared/conversationRuntime";

interface AgentAISetup {
  setup: { aiProviderId: string | null; aiModelId: string | null } | null;
  aiProviders: Array<{ id: string; available: boolean }>;
}

export interface BoundedAgentComposerState {
  selected: boolean;
  setSelected: (selected: boolean) => void;
  supported: boolean;
  enabled: boolean;
  checking: boolean;
  ready: boolean;
  guidance: string;
  configuredProvider: string | null;
  configuredModel: string | null;
}

/** Reads the same owner-scoped preferences as Connection Center; only the Home authorizes an actual run. */
export function useBoundedAgentComposer(chatMode: string, executionMode: ConversationExecutionMode): BoundedAgentComposerState {
  const [selected, setSelected] = useState(false);
  const state = useQuery<{ state: "on" | "off" }>({
    queryKey: ["/api/wave-c/ai/state"],
    queryFn: async () => (await apiRequest("GET", "/api/wave-c/ai/state")).json(),
    staleTime: 5_000,
  });
  const setup = useQuery<AgentAISetup>({
    queryKey: ["/api/setup/status"],
    queryFn: async () => (await apiRequest("GET", "/api/setup/status")).json(),
    staleTime: 15_000,
  });
  const supported = chatMode !== "temporary" && executionMode === "ai_assisted";
  const enabled = supported && selected;
  const checking = state.isPending || setup.isPending;
  const provider = setup.data?.aiProviders.find((candidate) => candidate.id === setup.data?.setup?.aiProviderId);
  const ready = !state.isError && !setup.isError && state.data?.state === "on"
    && provider?.available === true && Boolean(setup.data?.setup?.aiModelId?.trim());
  const guidance = chatMode === "temporary" ? "Multi-step agents require a saved Project or Quick chat."
    : executionMode !== "ai_assisted" ? "Choose AUTO · AI ASSISTED to use a multi-step agent."
    : checking ? "Checking AI setup…"
    : state.isError || setup.isError ? "AI setup is unavailable. Open Connection Center to check your provider."
    : state.data?.state !== "on" ? "Turn on Master AI in Connection Center to use a multi-step agent."
    : !ready ? "Configure a connected AI provider and model in Connection Center."
    : "Plans and executes bounded steps. Consequential tools still require your review.";
  return { selected, setSelected, supported, enabled, checking, ready, guidance,
    configuredProvider: ready ? provider?.id ?? null : null,
    configuredModel: ready ? setup.data?.setup?.aiModelId ?? null : null,
  };
}
