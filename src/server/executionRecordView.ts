import type { ProjectChatMessage } from "@shared/schemaProjects";
import type { AgentCheckpointSnapshot } from "./agent-checkpoint";
import { nativeContinuationOf } from "./agentLoopCheckpoint";
import { resolveAgentRestartSource } from "./agentRestartRequest";
import { foldAgentToolDispatchState } from "./exec/agent-run-events";
import type { ExecutionJournalRecord } from "./exec/execution-journal";

/**
 * Owner-facing projection of a journal record for the execution history API.
 *
 * The native continuation holds the validated plan's raw tool inputs. It stays server-side: the wire shows the L6 binding
 * facts (so a Stop/restart fingerprint is observable) plus one derived boolean, never the continuation itself.
 */
export interface ExecutionRecordView extends Omit<ExecutionJournalRecord, "checkpoint"> {
  checkpoint?: Omit<AgentCheckpointSnapshot, "continuation">;
  /** True only for an interrupted native agent run an explicit, requestId-only resume could be attempted for. */
  resumable: boolean;
}

/**
 * The cheap, non-authoritative half of "can this resume": interrupted, native continuation present, no outcome-unknown
 * dispatch, and the initiating message plus its persisted request facts exist exactly once. The authoritative drift,
 * authorization and ledger checks happen at resume time and may still refuse.
 */
export function isRestartResumable(record: ExecutionJournalRecord, messages: readonly ProjectChatMessage[]): boolean {
  if (record.status !== "interrupted" || record.version !== 2 || !record.events) return false;
  if (!nativeContinuationOf(record.checkpoint)) return false;
  try {
    if (foldAgentToolDispatchState(record.events, record.id).some((dispatch) => dispatch.status === "outcome_unknown")) return false;
    const sourceMessageId = record.checkpoint?.sourceMessageId;
    if (!Number.isSafeInteger(sourceMessageId) || (sourceMessageId ?? 0) <= 0) return false;
    resolveAgentRestartSource(messages, record.id, sourceMessageId!);
    return true;
  } catch {
    return false;
  }
}

export function executionRecordView(record: ExecutionJournalRecord, resumable: boolean): ExecutionRecordView {
  const { checkpoint, ...rest } = record;
  if (!checkpoint) return { ...rest, resumable };
  const { continuation: _continuation, ...bindingFacts } = checkpoint;
  return { ...rest, checkpoint: bindingFacts, resumable };
}
