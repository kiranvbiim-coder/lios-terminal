import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import type { GatewayClient } from "./gatewayClient";
import { GatewayRequestError } from "./gatewayErrors";

/** What the shell needs after a run: the same shape the old SSE reader returned, plus the start status. */
export interface GatewayRunResult {
  /** HTTP-style status of the start (428 = spoken transcript must be reviewed first); 200 once started. */
  status: number;
  ok: boolean;
  text: string;
  error: string | null;
  errorCode?: string;
  events: ConversationRuntimeEvent[];
}

interface StartFailure {
  status?: number;
  error?: string;
  code?: string;
}

function failure(status: number, error: string, errorCode?: string): GatewayRunResult {
  return { status, ok: false, text: "", error, ...(errorCode ? { errorCode } : {}), events: [] };
}

/**
 * Follows a run through its terminal event. Agent approval pauses retain this observer for the same run id; legacy
 * non-agent approvals finish this attempt so their explicit continuation can be submitted. Events deduplicate by the
 * run sequence and reconnect subscribes from the last seen sequence without starting another run.
 */
export async function followConversationRun(
  client: GatewayClient,
  requestId: string,
  onEvent: (event: ConversationRuntimeEvent) => void,
  startRun: () => Promise<void>,
  keepApprovalObserver = false,
): Promise<GatewayRunResult> {
  const events: ConversationRuntimeEvent[] = [];
  let lastSeq = -1;
  let text = "";
  let error: string | null = null;
  let agentPause = keepApprovalObserver;

  return new Promise<GatewayRunResult>((resolve) => {
    let settled = false;
    // Set once the Home confirmed the run exists; before that a reconnect must not try to re-attach.
    let started = false;
    const disposers: Array<() => void> = [];
    const finish = (result: GatewayRunResult) => {
      if (settled) return;
      settled = true;
      disposers.forEach((dispose) => dispose());
      resolve(result);
    };
    // Only the Home's confirmed terminal completion (or explicit legacy approval pause)
    // may produce ok:true. Disconnect, cancellation and failure are not success receipts.
    const complete = (terminalStatus: string) => {
      const ok = (terminalStatus === "completed" || terminalStatus === "waiting_approval") && !error;
      finish({ status: ok ? 200 : 503, ok, text, error: ok ? null : (error ?? `Home reported ${terminalStatus}; completion was not confirmed.`), events });
    };
    const interrupted = (message: string) => {
      error ??= message;
      finish(failure(503, `${error} The outcome was not confirmed; check the original run before resending.`, "run_status_unconfirmed"));
    };

    disposers.push(client.onEvent("conversation.event", (payload) => {
      if (payload.requestId !== requestId || payload.runSeq <= lastSeq) return;
      lastSeq = payload.runSeq;
      const event = payload.event;
      events.push(event);
      try {
        onEvent(event);
      } catch (consumerError) {
        // Consumer failures must not be swallowed as transport problems.
        finish({ status: 500, ok: false, text, error: consumerError instanceof Error ? consumerError.message : "Event handler failed.", events });
        return;
      }
      if (event.type === "text") text = event.text;
      if (event.type === "error") error = event.message;
      if (event.type === "plan" && event.plan.steps.some((step) => step.kind === "agent")) agentPause = true;
      if (event.type === "governed_tool_approval_required") agentPause = true;
      if (event.type === "done" && (event.status !== "waiting_approval" || !agentPause)) complete(event.status);
    }));

    disposers.push(client.onReady(({ restarted }) => {
      if (settled || !started) return;
      if (restarted) {
        interrupted("The Home restarted before this run finished. Please retry.");
        return;
      }
      client.request("conversation.subscribe", { requestId, afterSeq: lastSeq }, { timeoutMs: 15_000 }).catch((subscribeError: unknown) => {
        interrupted(subscribeError instanceof GatewayRequestError && subscribeError.code === "NOT_FOUND"
          ? "This run is no longer available. Please retry."
          : "The connection was interrupted before this run finished. Please retry.");
      });
    }));

    startRun().then(() => { started = true; }).catch(async (startError: unknown) => {
      if (startError instanceof GatewayRequestError) {
        const details = (startError.details ?? {}) as StartFailure;
        finish(failure(details.status ?? (startError.code === "NOT_FOUND" ? 404 : 500), details.error ?? startError.message, details.code));
        return;
      }
      // The connection dropped (or timed out) while starting: the run may or may not exist on the Home. Ask, so a
      // retry never duplicates a run that did start and a run that did not start is reported as failed.
      try {
        await client.request("conversation.subscribe", { requestId, afterSeq: lastSeq }, { queueUntilReady: true, timeoutMs: 15_000 });
        started = true;
      } catch {
        finish(failure(0, "LiOS could not confirm whether Home received this request. Inspect the original run before resending; it was not retried automatically.", "run_status_unconfirmed"));
      }
    });
  });
}

export interface RunConversationInput {
  /** Project chat id, or null for a temporary chat. */
  chatId: number | null;
  /** The wire request; `requestId` must be set (the run is addressed by it). */
  body: { requestId: string } & Record<string, unknown>;
  onEvent: (event: ConversationRuntimeEvent) => void;
}

export function runConversation(client: GatewayClient, input: RunConversationInput): Promise<GatewayRunResult> {
  return followConversationRun(client, input.body.requestId, input.onEvent, async () => {
    await client.request("conversation.start", { chatId: input.chatId, body: input.body }, { queueUntilReady: true, timeoutMs: 60_000 });
  }, input.body.agent === true);
}

/** Re-attaches to a run that is already executing (for example after a reload). */
export function attachConversationRun(
  client: GatewayClient,
  requestId: string,
  onEvent: (event: ConversationRuntimeEvent) => void,
): Promise<GatewayRunResult> {
  return followConversationRun(client, requestId, onEvent, async () => {
    await client.request("conversation.subscribe", { requestId, afterSeq: -1 }, { queueUntilReady: true, timeoutMs: 15_000 });
  });
}

/**
 * Explicit owner resume of an interrupted agent run. The wire carries ONLY the requestId: the Home derives the owner,
 * objective, plan and authorization itself and continues the SAME run id, so this follows that run exactly like a start.
 */
export function resumeConversationRun(
  client: GatewayClient,
  requestId: string,
  onEvent: (event: ConversationRuntimeEvent) => void,
): Promise<GatewayRunResult> {
  return followConversationRun(client, requestId, onEvent, async () => {
    await client.request("conversation.resume", { requestId }, { queueUntilReady: true, timeoutMs: 60_000 });
  }, true);
}

export async function cancelConversationRun(client: GatewayClient, requestId: string): Promise<boolean> {
  const { cancelled } = await client.request("conversation.cancel", { requestId }, { timeoutMs: 15_000 });
  return cancelled;
}
