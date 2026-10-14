import { z } from "zod";
import {
  conversationAttachmentRefSchema,
  conversationRequestSchema,
  type ConversationAttachmentRef,
  type ConversationExecutionMode,
  type ConversationRequest,
} from "@shared/conversationRuntime";
import type { ProjectChatMessage } from "@shared/schemaProjects";

/**
 * SI-02 restart-resume: the bounded, validated request facts persisted WITH the initiating user chat message so the server
 * can rebuild the same current ConversationContextEnvelope after a restart.
 *
 * This is transcript provenance, not authority. It never contains grants, approvals, authorization, hashes, adapter or
 * checkpoint fields; the objective is the message content itself.
 */

export const AGENT_RESTART_METADATA_KEY = "agentRestart";
const MAX_RESTART_REQUEST_BYTES = 64 * 1024;

export const agentRestartRequestSchema = conversationRequestSchema
  .pick({ sourceScope: true, transmissionPolicy: true, context: true })
  .extend({ version: z.literal(1) })
  .strict();
export type AgentRestartRequest = z.infer<typeof agentRestartRequestSchema>;

/**
 * Metadata fragment for the initiating message of an agent run, or an empty fragment when the projection cannot be stored
 * within its bound (such a run is then simply not restart-resumable; it never silently loses context).
 */
export function agentRestartMetadata(initialRequest: ConversationRequest): { agentRestart: AgentRestartRequest } | Record<string, never> {
  const projection = agentRestartRequestSchema.parse({
    version: 1,
    sourceScope: initialRequest.sourceScope,
    transmissionPolicy: initialRequest.transmissionPolicy,
    ...(initialRequest.context ? { context: initialRequest.context } : {}),
  });
  return Buffer.byteLength(JSON.stringify(projection), "utf8") > MAX_RESTART_REQUEST_BYTES ? {} : { [AGENT_RESTART_METADATA_KEY]: projection };
}

export type AgentRestartSourceRefusal = "initiating_message_missing" | "initiating_message_ambiguous" | "restart_request_unavailable" | "not_ai_assisted";

export class AgentRestartSourceError extends Error {
  constructor(readonly code: AgentRestartSourceRefusal, message: string) {
    super(message);
    this.name = "AgentRestartSourceError";
  }
}

export interface AgentRestartSource {
  /** The exact initiating message row, bound into the encrypted checkpoint. */
  messageId: number;
  /** The exact initiating user message content: the objective. Never taken from the journal or a client. */
  objective: string;
  executionMode: ConversationExecutionMode;
  projection: AgentRestartRequest;
  /** Attachment descriptors as persisted with the message (no previews). */
  attachments: ConversationAttachmentRef[];
  /** Everything saved before the initiating message: the history and carried Working Context it started from. */
  priorHistory: ProjectChatMessage[];
}

/**
 * Locates the one initiating user message of `requestId` in an already owner-authorized chat transcript and validates its
 * persisted reconstruction facts. Absent, duplicated, non-user or unprojected matches are refused.
 */
export function resolveAgentRestartSource(
  messages: readonly ProjectChatMessage[],
  requestId: string,
  sourceMessageId: number,
): AgentRestartSource {
  if (!Number.isSafeInteger(sourceMessageId) || sourceMessageId <= 0) {
    throw new AgentRestartSourceError("initiating_message_missing", "The exact message that started this run was not bound to its checkpoint.");
  }
  const matches = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.id === sourceMessageId && message.metadata.runtimeRequestId === requestId && message.role === "user");
  if (matches.length === 0) throw new AgentRestartSourceError("initiating_message_missing", "The exact message that started this run was not found in its chat.");
  if (matches.length > 1) throw new AgentRestartSourceError("initiating_message_ambiguous", "The checkpoint message identity is ambiguous.");
  const { message, index } = matches[0]!;
  const projection = agentRestartRequestSchema.safeParse(message.metadata[AGENT_RESTART_METADATA_KEY]);
  if (!projection.success) {
    throw new AgentRestartSourceError("restart_request_unavailable", "This run did not persist the request facts needed to resume it.");
  }
  const mode = message.metadata.executionMode;
  if (mode !== "ai_assisted") throw new AgentRestartSourceError("not_ai_assisted", "Only AI-assisted agent runs can be resumed.");
  const rawAttachments = Array.isArray(message.metadata.attachments) ? message.metadata.attachments : [];
  const attachments = z.array(conversationAttachmentRefSchema).max(20).safeParse(rawAttachments);
  if (!attachments.success) {
    throw new AgentRestartSourceError("restart_request_unavailable", "This run's persisted attachment descriptors are invalid.");
  }
  return {
    messageId: message.id,
    objective: message.content,
    executionMode: mode,
    projection: projection.data,
    attachments: attachments.data,
    priorHistory: messages.slice(0, index),
  };
}
