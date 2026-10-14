import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import type { GatewayClient } from "./gateway/gatewayClient";
import { resumeConversationRun, type GatewayRunResult } from "./gateway/conversationRun";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The newest interrupted run of an owner-scoped execution history that the Home itself flagged `resumable`. Cancelled,
 * completed, failed, denied and checkpoint-less records, and an interrupted run with an outcome-unknown dispatch, are never
 * flagged by the server, so none of them can be offered. The list is newest first.
 */
export function newestResumableRunId(history: unknown): string | null {
  if (!Array.isArray(history)) return null;
  for (const record of history) {
    if (typeof record !== "object" || record === null || !("id" in record) || !("status" in record) || !("resumable" in record)) continue;
    const { id, status, resumable } = record;
    if (typeof id === "string" && UUID.test(id) && status === "interrupted" && resumable === true) return id;
  }
  return null;
}

/** The shell state a followed run drives. The same transitions a started run performs, owned here instead of in the shell. */
export interface InterruptedRunShellState {
  busyRef: MutableRefObject<boolean>;
  traceOwnerChatRef: MutableRefObject<number | null>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setStreaming: Dispatch<SetStateAction<string>>;
  setRuntimeEvents: Dispatch<SetStateAction<ConversationRuntimeEvent[]>>;
  setRuntimeRequestId: Dispatch<SetStateAction<string | null>>;
  setLifecycleNotice: Dispatch<SetStateAction<string | null>>;
  /** Refreshes the Project's saved chat data once the run ends. */
  onSettled: () => void;
}

export interface InterruptedAgentRunOptions {
  gateway: GatewayClient | null;
  /** The open saved chat, or null (Temporary chats keep no execution history). */
  chatId: number | null;
  busy: boolean;
  onEvent: (event: ConversationRuntimeEvent) => void;
  shell: InterruptedRunShellState;
}

/**
 * Discovers an interrupted, resumable agent run of the open saved chat and exposes ONE explicit resume action. Discovery
 * only reads the owner-scoped history; nothing resumes until the person clicks. The resume sends the requestId and nothing
 * else, then follows that same requestId.
 */
export function useInterruptedAgentRun(options: InterruptedAgentRunOptions): {
  requestId: string | null;
  resume: () => void;
  /** Spread onto the runtime trace: the request-bound resume control. */
  traceProps: { resumableRequestId: string | null; onResume: () => void };
} {
  const { gateway, chatId, busy, onEvent, shell } = options;
  const history = useQuery<unknown>({
    queryKey: ["/api/project-chats", chatId, "executions"],
    queryFn: async () => {
      const response = await fetch(`/api/project-chats/${chatId}/executions`);
      if (!response.ok) throw new Error("Failed to load execution history.");
      return response.json();
    },
    enabled: Boolean(chatId),
  });
  const requestId = newestResumableRunId(history.data);
  const refetch = history.refetch;
  const resuming = useRef(false);

  // Re-read after every run ends (a Stop is how a run becomes resumable) and when the chat opens.
  useEffect(() => {
    if (chatId && !busy) void refetch();
  }, [chatId, busy, refetch]);

  const resume = useCallback(() => {
    if (!gateway || !requestId || busy || resuming.current) return;
    resuming.current = true;
    shell.busyRef.current = true;
    shell.traceOwnerChatRef.current = chatId;
    shell.setBusy(true);
    shell.setStreaming("");
    shell.setRuntimeEvents([]);
    shell.setRuntimeRequestId(requestId);
    void resumeConversationRun(gateway, requestId, onEvent)
      .then((result) => {
        shell.busyRef.current = false;
        shell.setStreaming("");
        shell.setBusy(false);
        shell.onSettled();
        if (!result.ok && result.error) shell.setLifecycleNotice(result.error);
      })
      .finally(() => {
        resuming.current = false;
        void refetch();
      });
  }, [gateway, requestId, busy, chatId, shell, onEvent, refetch]);

  const offered = busy ? null : requestId;
  return { requestId: offered, resume, traceProps: { resumableRequestId: offered, onResume: resume } };
}
