import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { conversationRuns } from "./conversationRunRegistry";
import {
  ConversationExecutionTranscript,
  ConversationJournalError,
  getConversationExecutionJournal,
  withConversationExecutionScope,
} from "./exec/execution-scope";

export interface SpineRunOwner {
  userId: number;
  projectId: number | null;
  chatId: number | null;
}

export interface SpineRunContext {
  /** Registry-owned cancellation: the same signal Stop, the Gateway and the terminal pane abort. */
  signal: AbortSignal;
  /** Journals the event, then publishes it to the run registry. */
  emit: (event: ConversationRuntimeEvent) => Promise<void>;
}

/**
 * Runs a conversation-shaped job (a P9 automation rerun) on the same spine as a chat turn (SI-02.07): one active-run
 * registry entry, one encrypted journal record that recovery marks `interrupted`, and one execution scope so
 * cancelling the run reaches every supervised descendant. The caller still owns Working Context and ledger writes;
 * this only supplies run identity, cancellation and the journal.
 */
export async function runOnConversationSpine<T extends { text: string; cancelled: boolean }>(input: {
  requestId: string;
  owner: SpineRunOwner;
  label: string;
  run: (context: SpineRunContext) => Promise<T>;
}): Promise<T> {
  const journal = await getConversationExecutionJournal();
  const transcript = new ConversationExecutionTranscript(journal, input.requestId);
  const completion = Promise.withResolvers<T>();
  // The caller observes the failure through `completion`; the registry's own error event is for live listeners.
  completion.promise.catch(() => undefined);

  conversationRuns.start({ requestId: input.requestId, ...input.owner }, async (publish, signal) => {
    let begun = false;
    let terminal: "completed" | "cancelled" | "failed" | null = null;
    let needsApproval = false;
    try {
      try {
        await journal.begin({ id: input.requestId, owner: input.owner, label: input.label });
        begun = true;
      } catch (error) {
        throw new ConversationJournalError(error);
      }
      const result = await withConversationExecutionScope(input.requestId, () => input.run({
        signal,
        emit: async (event) => {
          await transcript.recordEvent(event);
          if (event.type === "done") {
            // A background rerun has no approver and no resume path: it never executed the gated step, so it is not a success.
            if (event.status === "waiting_approval") needsApproval = true;
            else terminal = event.status;
          }
          publish(event);
        },
      }));
      await transcript.recordText(result.text);
      if (needsApproval) {
        await transcript.recordFailure(new Error("This run needed an approval that a background run cannot receive; the gated step was not executed."));
        await transcript.finish("failed");
        completion.resolve(result);
        return;
      }
      await transcript.finish(terminal ?? (result.cancelled ? "cancelled" : "completed"));
      completion.resolve(result);
    } catch (error) {
      let failure: unknown = error;
      if (begun) {
        try {
          await transcript.recordFailure(error);
          await transcript.finish("failed");
        } catch (journalError) {
          failure = journalError;
        }
      }
      completion.reject(failure);
      throw failure;
    }
  });
  return completion.promise;
}
