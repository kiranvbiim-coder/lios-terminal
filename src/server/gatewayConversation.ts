import type { GatewayErrorCode } from "@shared/gatewayProtocol";
import { gatewayError } from "@shared/gatewayProtocol";
import { GatewayMethodError } from "./gatewayHub";
import type { GatewayConnection, GatewayHub } from "./gatewayHub";
import { cancelConversationRun } from "./conversationRunCancel";
import { conversationRuns } from "./conversationRunRegistry";
import type { ConversationRunRegistry } from "./conversationRunRegistry";
import { ConversationStartError, resumeInterruptedConversationRun, startProjectChatRun, startTemporaryRun } from "./conversationRunService";
import { getConversationExecutionJournal } from "./exec/execution-scope";
import type { ExecutionJournal, ExecutionJournalRecord } from "./exec/execution-journal";
import { ConversationGrantError } from "./conversationGrantStore";
import { proposeSandboxTerminalSession, reviewSandboxTerminalSession } from "./governedSandboxSession";
import { SandboxRuntimeConfigurationError } from "./exec/sandbox-runtime-profile";

/**
 * Conversation Runtime over the Gateway (GM-08b): start, subscribe/replay, cancel and list-active. Runs live in the
 * shared run registry, so a reloaded or reconnected UI re-attaches to the same run and the HTTP/SSE door sees the
 * same events. Observers are per-connection and are detached when the connection closes; the run itself continues.
 */

const OBSERVERS = "conversation.observers";

const STATUS_TO_CODE: Record<number, GatewayErrorCode> = {
  400: "INVALID_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "INVALID_REQUEST",
  413: "PAYLOAD_TOO_LARGE",
  428: "INVALID_REQUEST",
  429: "RATE_LIMITED",
  503: "UNAVAILABLE",
};

function observers(connection: GatewayConnection): Map<string, () => void> {
  let map = connection.state.get(OBSERVERS) as Map<string, () => void> | undefined;
  if (!map) {
    map = new Map();
    connection.state.set(OBSERVERS, map);
  }
  return map;
}

function conversationObserverKey(requestId: string): string {
  return `conversation:${requestId}`;
}

function executionObserverKey(
  sessionId: string,
  projectId: number | null,
  chatId: number | null,
): string {
  return `execution:${sessionId}:${projectId ?? "null"}:${chatId ?? "null"}`;
}

function observe(runs: ConversationRunRegistry, connection: GatewayConnection, requestId: string, afterSeq: number) {
  const map = observers(connection);
  const key = conversationObserverKey(requestId);
  map.get(key)?.();
  const subscription = runs.subscribe(requestId, connection.identity.userId, afterSeq, (entry) => {
    connection.emit("conversation.event", { requestId, runSeq: entry.seq, event: entry.event });
  });
  if (subscription) map.set(key, subscription.detach);
  return subscription;
}

function observeExecutionSession(
  runs: ConversationRunRegistry,
  connection: GatewayConnection,
  input: { sessionId: string; projectId: number | null; chatId: number | null; afterSeq: number },
) {
  const map = observers(connection);
  const key = executionObserverKey(input.sessionId, input.projectId, input.chatId);
  map.get(key)?.();
  const owner = {
    userId: connection.identity.userId,
    projectId: input.projectId,
    chatId: input.chatId,
  };
  const subscription = runs.subscribeScoped(
    input.sessionId,
    owner,
    input.afterSeq,
    (entry) => {
      connection.emit("execution.session.event", {
        sessionId: input.sessionId,
        projectId: input.projectId,
        chatId: input.chatId,
        runSeq: entry.seq,
        event: entry.event,
      });
    },
  );
  if (subscription) map.set(key, subscription.detach);
  return subscription;
}

function toGatewayError(error: unknown): GatewayMethodError | unknown {
  if (error instanceof SandboxRuntimeConfigurationError) {
    return new GatewayMethodError(gatewayError("UNAVAILABLE", error.message, { retryable: true }));
  }
  if (error instanceof ConversationGrantError) {
    return new GatewayMethodError(gatewayError(STATUS_TO_CODE[error.status] ?? "INVALID_REQUEST", error.message));
  }
  if (!(error instanceof ConversationStartError)) return error;
  const code = STATUS_TO_CODE[error.status] ?? "INTERNAL";
  return new GatewayMethodError(gatewayError(code, error.message, {
    details: { ...error.body, status: error.status },
    ...(error.status === 503 ? { retryable: true } : {}),
  }));
}

export interface GatewayExecutionHistory {
  read: ExecutionJournal["read"];
  list: ExecutionJournal["list"];
}

export interface GatewayConversationDeps {
  startProject: typeof startProjectChatRun;
  startTemporary: typeof startTemporaryRun;
  resume: typeof resumeInterruptedConversationRun;
  cancel: typeof cancelConversationRun;
  runs: ConversationRunRegistry;
  journal: () => Promise<GatewayExecutionHistory>;
  proposeOperation?: typeof proposeSandboxTerminalSession;
  reviewOperation?: typeof reviewSandboxTerminalSession;
}

const DEFAULT_DEPS: GatewayConversationDeps = {
  startProject: startProjectChatRun,
  startTemporary: startTemporaryRun,
  resume: resumeInterruptedConversationRun,
  cancel: cancelConversationRun,
  runs: conversationRuns,
  journal: getConversationExecutionJournal,
};

function gatewayHistoryRecord(record: ExecutionJournalRecord) {
  return {
    sessionId: record.id,
    status: record.status,
    label: record.label,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    stdout: record.stdout,
    stderr: record.stderr,
    exitCode: record.exitCode,
    trust: record.trust,
  };
}

export function registerGatewayConversation(hub: GatewayHub, deps: GatewayConversationDeps = DEFAULT_DEPS): void {
  hub.register("conversation.start", async ({ chatId, body }, connection) => {
    const { userId, email, role, organizationId } = connection.identity;
    const user = { id: userId, email, role, organizationId };
    // Observe before the first event can be produced: the run starts executing as soon as it is registered.
    let started;
    try {
      started = chatId === null ? await deps.startTemporary(user, body) : await deps.startProject(user, chatId, body, {
        nodeFinanceGateway: { userId, request: (method, params) => hub.invokeForConnection(method, params, connection) },
      });
    } catch (error) {
      throw toGatewayError(error);
    }
    observe(deps.runs, connection, started.requestId, -1);
    return { requestId: started.requestId };
  });

  hub.register("conversation.subscribe", ({ requestId, afterSeq }, connection) => {
    const subscription = observe(deps.runs, connection, requestId, afterSeq);
    if (!subscription) throw new GatewayMethodError(gatewayError("NOT_FOUND", "That run is not available. It may have finished long ago or the Home restarted."));
    return { status: subscription.status, lastSeq: subscription.lastSeq };
  });

  hub.register("conversation.cancel", ({ requestId }, connection) => ({
    cancelled: deps.cancel(requestId, connection.identity.userId),
  }));

  hub.register("conversation.resume", async ({ requestId }, connection) => {
    const { userId, email, role, organizationId } = connection.identity;
    let resumed;
    try {
      resumed = await deps.resume({ id: userId, email, role, organizationId }, requestId);
    } catch (error) {
      throw toGatewayError(error);
    }
    // Same as start: observe before the first event of the re-registered run can be missed.
    observe(deps.runs, connection, resumed.requestId, -1);
    return { requestId: resumed.requestId };
  });

  hub.register("execution.session.attach", (params, connection) => {
    const subscription = observeExecutionSession(deps.runs, connection, params);
    if (!subscription) {
      throw new GatewayMethodError(gatewayError(
        "NOT_FOUND",
        "That execution session is not available in the requested Project/Chat scope.",
      ));
    }
    return {
      status: subscription.status,
      lastSeq: subscription.lastSeq,
      session: {
        sessionId: subscription.run.requestId,
        projectId: subscription.run.projectId,
        chatId: subscription.run.chatId,
        startedAt: subscription.run.startedAt,
      },
    };
  });

  hub.register("execution.session.detach", ({ sessionId, projectId, chatId }, connection) => {
    if (!deps.runs.getScoped(sessionId, {
      userId: connection.identity.userId,
      projectId,
      chatId,
    })) {
      return { detached: false };
    }
    const key = executionObserverKey(sessionId, projectId, chatId);
    const detach = observers(connection).get(key);
    if (!detach) return { detached: false };
    detach();
    observers(connection).delete(key);
    return { detached: true };
  });

  hub.register("execution.session.cancel", ({ sessionId, projectId, chatId }, connection) => {
    const owner = { userId: connection.identity.userId, projectId, chatId };
    if (!deps.runs.getScoped(sessionId, owner)) {
      throw new GatewayMethodError(gatewayError(
        "NOT_FOUND",
        "That execution session is not available in the requested Project/Chat scope.",
      ));
    }
    return { cancelled: deps.cancel(sessionId, connection.identity.userId) || deps.runs.cancelScoped(sessionId, owner) };
  });
  hub.register("execution.session.input", async ({ sessionId, projectId, chatId, input }, connection) => {
    const owner = { userId: connection.identity.userId, projectId, chatId };
    const run = deps.runs.getScoped(sessionId, owner);
    if (!run || run.finished) {
      throw new GatewayMethodError(gatewayError(
        "NOT_FOUND",
        "That active execution session is not available in the requested Project/Chat scope.",
      ));
    }
    try {
      await deps.runs.writeInputScoped(sessionId, owner, input);
      return { written: true };
    } catch {
      throw new GatewayMethodError(gatewayError(
        "INVALID_REQUEST",
        "That terminal input is not currently authorized for this execution session.",
      ));
    }
  });

  hub.register("execution.session.read", async ({ sessionId, projectId, chatId }, connection) => {
    const journal = await deps.journal();
    const record = await journal.read(sessionId, {
      userId: connection.identity.userId,
      projectId,
      chatId,
    });
    if (!record) {
      throw new GatewayMethodError(gatewayError(
        "NOT_FOUND",
        "That persisted execution session is not available in the requested Project/Chat scope.",
      ));
    }
    return gatewayHistoryRecord(record);
  });

  hub.register("execution.session.history", async ({ projectId, chatId }, connection) => {
    const journal = await deps.journal();
    const records = await journal.list({
      userId: connection.identity.userId,
      projectId,
      chatId,
    });
    return { sessions: records.slice(0, 256).map(gatewayHistoryRecord) };
  });

  hub.register("execution.operation.propose", async ({ projectId, chatId }, connection) => {
    const user = {
      id: connection.identity.userId,
      email: connection.identity.email,
      role: connection.identity.role,
      organizationId: connection.identity.organizationId,
    };
    try {
      const proposal = await (deps.proposeOperation ?? proposeSandboxTerminalSession)(user, projectId, chatId);
      return { ...proposal, argv: [...proposal.argv], allowedInteractiveInputs: [...proposal.allowedInteractiveInputs] };
    } catch (error) {
      throw toGatewayError(error);
    }
  });

  hub.register("execution.operation.review", async (input, connection) => {
    const user = {
      id: connection.identity.userId,
      email: connection.identity.email,
      role: connection.identity.role,
      organizationId: connection.identity.organizationId,
    };
    try {
      return await (deps.reviewOperation ?? reviewSandboxTerminalSession)({ user, ...input });
    } catch (error) {
      throw toGatewayError(error);
    }
  });

  hub.register("conversation.active", (_params, connection) => ({
    runs: deps.runs.active(connection.identity.userId).map(({ requestId, chatId, startedAt }) => ({ requestId, chatId, startedAt })),
  }));

  hub.onConnectionClosed((connection) => {
    const map = connection.state.get(OBSERVERS) as Map<string, () => void> | undefined;
    map?.forEach((detach) => detach());
    map?.clear();
  });
}
