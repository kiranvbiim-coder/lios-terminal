import { Bot } from "lucide-react";
import type { BoundedAgentComposerState } from "@/lib/useBoundedAgentComposer";

interface Props {
  agent: BoundedAgentComposerState;
  busy: boolean;
  onConfigureAI: () => void;
}

export default function BoundedAgentComposerControl({ agent, busy, onConfigureAI }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 font-ui text-xs">
      <button
        type="button"
        aria-label="Multi-step agent"
        aria-pressed={agent.enabled}
        aria-describedby="bounded-agent-guidance"
        data-testid="composer-agent-toggle"
        disabled={busy || !agent.supported}
        onClick={() => agent.setSelected(!agent.selected)}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 disabled:opacity-40 ${agent.enabled ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
      >
        <Bot className="h-3.5 w-3.5" /> Multi-step agent
      </button>
      <span id="bounded-agent-guidance" role="status" className="text-muted-foreground">{agent.guidance}</span>
      {agent.ready && agent.configuredProvider && agent.configuredModel && (
        <span data-provider-readiness="verified-config" className="text-xs text-muted-foreground">
          Configured: {agent.configuredProvider} / {agent.configuredModel}. Provider cost, quotas and data-transfer terms are not verified here.
        </span>
      )}
      {agent.supported && !agent.checking && !agent.ready && (
        <button type="button" onClick={onConfigureAI} data-testid="composer-agent-configure-ai" className="min-h-10 rounded px-2 text-amber-200 underline underline-offset-2 focus-visible:outline focus-visible:outline-2">
          Configure AI
        </button>
      )}
    </div>
  );
}
