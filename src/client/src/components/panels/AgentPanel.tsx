import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Bot, Send, Trash2, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAudience } from "@/lib/audience";
import DataStatusBadge from "@/components/data/DataStatusBadge";
import type { DataStatus } from "@/lib/finance";
import type { ViewMode } from "@/lib/terminalTypes";
import type { ClientAiContext } from "@shared/clientAiContext";
import {
  buildAskLiosDelegation,
  classifyAskLiosIntent,
} from "@shared/askLiosRouter";

interface Props {
  magnetization?: number;
  orderIntensity?: number;
  onSymbol: (sym: string) => void;
  onNav?: (view: ViewMode) => void;
  context?: ClientAiContext;
  initialPrompt?: string;
}

interface AgentAction {
  label: string;
  view: ViewMode;
}

interface AgentMessage {
  id: number | string;
  role: string;
  content: string;
  status?: DataStatus;
  action?: AgentAction;
}

function MessageBubble({ msg, status, onAction }: { msg: AgentMessage; status?: DataStatus; onAction?: (action: AgentAction) => void }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div className={`max-w-[85%] ${isUser ? "order-2" : "order-1"}`}>
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-1">
            <Bot className="w-3 h-3 text-[hsl(38,95%,55%)]" />
            <span className="font-terminal text-[9px] text-[hsl(38,95%,55%)] tracking-widest">ASK LIOS</span>
          </div>
        )}
        <div className={`px-4 py-3 ${
          isUser
            ? "bg-[hsl(38,95%,50%)/15%] border border-[hsl(38,95%,50%)/30%] text-foreground"
            : "bg-[#0d0d0d] border border-border text-foreground"
        }`}>
          <div className="font-terminal text-xs leading-relaxed whitespace-pre-wrap break-words">
            {msg.content}
          </div>
          {status?.isFallback && <div className="mt-2"><DataStatusBadge status={status} compact /></div>}
          {!isUser && msg.action && onAction && (
            <button
              type="button"
              onClick={() => onAction(msg.action!)}
              className="mt-3 border border-amber-500/35 px-2.5 py-1.5 font-terminal text-[8px] tracking-widest text-amber-300 hover:bg-amber-500/[0.06] hover:text-amber-200"
              data-testid="ask-lios-engine-action"
            >
              {msg.action.label.toUpperCase()}
            </button>
          )}
        </div>
        {isUser && (
          <div className="flex justify-end mt-0.5">
            <span className="font-terminal text-[8px] text-muted-foreground">YOU</span>
          </div>
        )}
      </div>
    </div>
  );
}

const INTERNAL_PROMPTS = [
  "What's the macro outlook for Q2 2026?",
  "Analyze NVDA: bull vs bear case",
  "Explain yield curve inversion impact",
  "Compare FAANG valuations",
  "What does VIX > 25 signal?",
  "Top sectors to watch in rate-cut environment",
];

const CLIENT_PROMPTS = [
  "What's a reasonable way to think about diversification right now?",
  "Explain what a rate-cut cycle typically does to equity valuations.",
  "What should I be watching in this sector this quarter?",
  "Compare a couple of large-cap names on valuation.",
];

function AgentShell({
  isLoading, isStreaming, messages, streaming, prompts, onSend, onClear, disableClear, contextLabel, inputPlaceholder, initialInput, onAction,
}: {
  isLoading: boolean;
  isStreaming: boolean;
  messages: AgentMessage[];
  streaming: string;
  prompts: string[];
  onSend: (msg: string) => void;
  onClear?: () => void;
  disableClear?: boolean;
  contextLabel?: string;
  inputPlaceholder?: string;
  initialInput?: string;
  onAction?: (action: AgentAction) => void;
}) {
  const isClient = useAudience() === "client";
  const [input, setInput] = useState(initialInput ?? "");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  useEffect(() => {
    if (!initialInput) return;
    setInput((current) => current.trim() ? current : initialInput);
  }, [initialInput]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    onSend(input);
    setInput("");
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-[hsl(38,95%,55%)]" />
          <span className="panel-label">{isClient ? "ASK LIOS" : "AI AGENT"}</span>
          {!isClient && <span className="font-terminal text-[8px] text-muted-foreground border border-border px-1.5 py-0.5">MODEL ROUTER</span>}
          {isClient && contextLabel && <span className="font-terminal text-[8px] text-muted-foreground border border-border px-1.5 py-0.5">{contextLabel}</span>}
        </div>
        {onClear && (
          <button
            onClick={onClear}
            disabled={disableClear}
            className="flex items-center gap-1.5 font-terminal text-[9px] text-muted-foreground hover:text-[hsl(0,80%,60%)] transition-colors disabled:opacity-30"
            data-testid="clear-chat"
          >
            <Trash2 className="w-3 h-3" /> CLEAR
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4">
        {isLoading ? (
          <div className="space-y-4">
            {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-16 bg-border" />)}
          </div>
        ) : messages.length === 0 && !streaming ? (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="flex flex-col items-center gap-3">
              <Bot className="w-12 h-12 text-[hsl(38,95%,50%)/30%]" />
              <div className="font-terminal text-sm text-muted-foreground text-center">
                {isClient ? "ASK LIOS" : "AUTONOMOUS FINANCIAL INTELLIGENCE"}
              </div>
              {!isClient && <div className="font-terminal text-[10px] text-muted-foreground/60 text-center max-w-sm">
                Ask about markets, analyze stocks, get macro insights, compare valuations, or discuss trading strategies.
              </div>}
            </div>

            <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
              {prompts.map((p, i) => (
                <button
                  key={i}
                  disabled={isStreaming}
                  onClick={() => onSend(p)}
                  className="text-left px-3 py-2 border border-border hover:border-[hsl(38,95%,50%)/50%] hover:bg-[hsl(38,95%,50%)/8%] font-terminal text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  data-testid={`prompt-${i}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) => <MessageBubble key={m.id} msg={m} status={m.status} onAction={onAction} />)}
            {streaming && (
              <div className="flex justify-start mb-4">
                <div className="max-w-[85%]">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Bot className="w-3 h-3 text-[hsl(38,95%,55%)]" />
                    <span className="font-terminal text-[9px] text-[hsl(38,95%,55%)] tracking-widest">ASK LIOS</span>
                    <span className="font-terminal text-[8px] text-muted-foreground animate-pulse">▌</span>
                  </div>
                  <div className="bg-[#0d0d0d] border border-border px-4 py-3">
                    <div className="font-terminal text-xs leading-relaxed whitespace-pre-wrap">{streaming}</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-border bg-[#070707] p-3">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <span className="font-terminal text-[10px] text-[hsl(38,95%,55%)] shrink-0">&gt;</span>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={inputPlaceholder ?? "ASK ABOUT MARKETS, STOCKS, MACRO..."}
            disabled={isStreaming}
            className="flex-1 bg-transparent font-terminal text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50"
            data-testid="agent-input"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="shrink-0 p-1.5 border border-border hover:border-[hsl(38,95%,50%)/50%] hover:text-[hsl(38,95%,55%)] text-muted-foreground disabled:opacity-30 transition-colors"
            data-testid="agent-send"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="font-terminal text-[8px] text-muted-foreground/60">SHIFT+ENTER NEW LINE · ENTER SEND</span>
        </div>
      </div>
    </div>
  );
}

// Internal build: unmetered, persisted per-user via /api/chat -- see
// server/routes.ts (behind requireInternal). Unchanged from before the
// audience split.
function InternalAgentPanel({ magnetization = 0.0, orderIntensity = 1.0, onSymbol, onNav }: Props) {
  const [streaming, setStreaming] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const qc = useQueryClient();
  const processedMessageIdsRef = useRef<Set<number>>(new Set());

  const { data: messages = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/chat"],
    queryFn: async () => {
      const res = await fetch("/api/chat");
      return res.json();
    },
  });

  const clearMut = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/chat");
    },
    onSuccess: () => {
      processedMessageIdsRef.current.clear();
      qc.invalidateQueries({ queryKey: ["/api/chat"] });
    },
  });

  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === "assistant" && lastMsg.id) {
      if (!processedMessageIdsRef.current.has(lastMsg.id)) {
        processedMessageIdsRef.current.add(lastMsg.id);

        const match = lastMsg.content.match(/<<NAVIGATE:\s*([^,>]+)(?:,\s*([^>]+))?>>/i);
        if (match) {
          const arg1 = match[1].trim();
          const arg2 = match[2]?.trim();
          if (arg2) {
            onSymbol(arg1);
            if (onNav) onNav(arg2.toLowerCase() as any);
          } else {
            const isView = [
              "market", "quote", "chart", "news", "agent", "screener", "watchlist",
              "alerts", "economics", "portfolio", "ising", "optimizer", "valuation",
              "fixedincome", "fractal", "risknetwork", "filingintel"
            ].includes(arg1.toLowerCase());
            if (isView) {
              if (onNav) onNav(arg1.toLowerCase() as any);
            } else {
              onSymbol(arg1);
            }
          }
        }
      }
    }
  }, [messages, onSymbol, onNav]);

  const sendMessage = async (msg: string) => {
    if (!msg.trim() || isStreaming) return;
    setIsStreaming(true);
    setStreaming("");

    qc.setQueryData(["/api/chat"], (old: any[] = []) => [
      ...old,
      { id: Date.now(), role: "user", content: msg, createdAt: new Date().toISOString() },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, magnetization, orderIntensity }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                fullText += data.text;
                setStreaming(fullText);
              }
              if (data.done) {
                setStreaming("");
                setIsStreaming(false);
                qc.invalidateQueries({ queryKey: ["/api/chat"] });
              }
            } catch {}
          }
        }
      }
    } catch {
      setStreaming("");
      setIsStreaming(false);
    }
  };

  return (
    <AgentShell
      isLoading={isLoading}
      isStreaming={isStreaming}
      messages={messages}
      streaming={streaming}
      prompts={INTERNAL_PROMPTS}
      onSend={sendMessage}
      onClear={() => clearMut.mutate()}
      disableClear={clearMut.isPending}
    />
  );
}

// Client build: BYOAI via /api/client/trial/chat (see trialAccess.ts).
// The route is available to executable client/trial organizations and does
// not consume LiOS credits; the customer-selected AI provider owns inference.
// Deliberately stateless across reloads (no persisted history endpoint on
// this route), matching the trial funnel's TrialAgentPanel this replaces.
function ClientAgentPanel({ onSymbol, onNav, context, initialPrompt }: Props) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const nextId = useRef(1);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;
    setIsStreaming(true);
    setStreaming("");
    setMessages((prev) => [...prev, { id: nextId.current++, role: "user", content: text }]);

    const intent = classifyAskLiosIntent(text);
    if (intent.kind === "compute") {
      const delegation = buildAskLiosDelegation(intent);
      setMessages((prev) => [...prev, {
        id: nextId.current++,
        role: "assistant",
        content: delegation.message,
        action: onNav ? {
          label: `Open ${delegation.engineLabel}`,
          view: delegation.view as ViewMode,
        } : undefined,
      }]);
      setStreaming("");
      setIsStreaming(false);
      return;
    }

    let fullText = "";
    let finalStatus: DataStatus | undefined;
    try {
      const res = await fetch("/api/client/trial/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, context }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.text) {
              fullText += event.text;
              setStreaming(fullText);
            } else if (event.done) {
              finalStatus = event.status;
            } else if (event.error) {
              fullText = event.error;
            }
          } catch {
            // Malformed/partial SSE line -- skip rather than crash the stream.
          }
        }
      }
    } catch (err) {
      fullText = err instanceof Error ? err.message : "Something went wrong. Please try again.";
    }

    setStreaming("");
    setIsStreaming(false);
    if (fullText) {
      setMessages((prev) => [...prev, { id: nextId.current++, role: "assistant", content: fullText, status: finalStatus }]);
    }
  };

  return (
    <AgentShell
      isLoading={false}
      isStreaming={isStreaming}
      messages={messages}
      streaming={streaming}
      prompts={context ? ["Explain this analysis.", "What changed?", "Challenge the assumptions.", "Compare with peers."] : CLIENT_PROMPTS}
      onSend={sendMessage}
      contextLabel={[context?.symbol?.toUpperCase(), context?.view?.toUpperCase()].filter(Boolean).join(" · ") || undefined}
      inputPlaceholder={context ? "ASK ABOUT THIS ANALYSIS..." : "ASK LIOS..."}
      initialInput={initialPrompt}
      onAction={(action) => onNav?.(action.view)}
    />
  );
}

export default function AgentPanel(props: Props) {
  const isClient = useAudience() === "client";
  return isClient ? <ClientAgentPanel {...props} /> : <InternalAgentPanel {...props} />;
}
