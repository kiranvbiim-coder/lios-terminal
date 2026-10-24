import { z } from "zod";
import { conversationRuntimeEventSchema } from "./conversationRuntime";
import { deviceProofSchema, pairingRequestSchema } from "./devicePairing";
import { deviceContinuityMethods } from "./deviceOutbox";
import { remoteNodeMethods } from "./remoteNode";

/**
 * LiOS Gateway protocol, version 1 (GM-08).
 *
 * A LiOS-owned typed WebSocket protocol between a LiOS Home (the Gateway) and its clients: the desktop shell, the
 * browser, and later paired devices, nodes and mobile apps. It is deliberately NOT wire-compatible with OpenClaw
 * (owner decision); the envelope design (request / response / event frames, a connect handshake that returns the
 * server's methods, events and limits, structured errors with retry hints, a heartbeat tick) is adapted from
 * OpenClaw `packages/gateway-protocol` (MIT, commit c074824a27c96d3983043f9eeb33823cd1772d8c), reimplemented with
 * zod instead of TypeBox. Device identity and pairing are additive and arrive with GM-09.
 *
 * Frames are single JSON text messages. Authentication is the existing LiOS session established at the WebSocket
 * upgrade; the connect frame only negotiates the protocol version and what the client asks to be allowed to do
 * (it can narrow, never widen, what the server derives from the signed-in account).
 */

export const GATEWAY_PROTOCOL_VERSION = 1 as const;
export const GATEWAY_PATH = "/gateway";
/** Endpoint for paired devices: no session cookie; the connect handshake authenticates by device key. */
export const GATEWAY_DEVICE_PATH = "/gateway/device";

const nonEmpty = z.string().min(1).max(256);

export const GATEWAY_ERROR_CODES = [
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "PROTOCOL_MISMATCH",
  "PAYLOAD_TOO_LARGE",
  "INTERNAL",
] as const;
export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number];

export const gatewayErrorShapeSchema = z.object({
  code: z.enum(GATEWAY_ERROR_CODES),
  message: z.string().min(1).max(2_000),
  details: z.unknown().optional(),
  retryable: z.boolean().optional(),
  retryAfterMs: z.number().int().min(0).optional(),
}).strict();
export type GatewayErrorShape = z.infer<typeof gatewayErrorShapeSchema>;

export const gatewayRequestFrameSchema = z.object({
  type: z.literal("req"),
  id: nonEmpty,
  method: nonEmpty,
  params: z.unknown().optional(),
}).strict();

export const gatewayResponseFrameSchema = z.object({
  type: z.literal("res"),
  id: nonEmpty,
  ok: z.boolean(),
  payload: z.unknown().optional(),
  error: gatewayErrorShapeSchema.optional(),
}).strict();

export const gatewayEventFrameSchema = z.object({
  type: z.literal("event"),
  event: nonEmpty,
  payload: z.unknown().optional(),
  /** Per-connection monotonically increasing sequence; a gap means the client missed events and should resync. */
  seq: z.number().int().min(0).optional(),
}).strict();

export const gatewayFrameSchema = z.discriminatedUnion("type", [
  gatewayRequestFrameSchema,
  gatewayResponseFrameSchema,
  gatewayEventFrameSchema,
]);

export type GatewayRequestFrame = z.infer<typeof gatewayRequestFrameSchema>;
export type GatewayResponseFrame = z.infer<typeof gatewayResponseFrameSchema>;
export type GatewayEventFrame = z.infer<typeof gatewayEventFrameSchema>;
export type GatewayFrame = z.infer<typeof gatewayFrameSchema>;

export const GATEWAY_ROLES = ["operator"] as const;
export const GATEWAY_SCOPES = ["read", "write", "admin"] as const;
export type GatewayScope = (typeof GATEWAY_SCOPES)[number];

/** The first frame a client must send: method "connect". */
export const gatewayConnectParamsSchema = z.object({
  minProtocol: z.number().int().min(1),
  maxProtocol: z.number().int().min(1),
  client: z.object({
    id: nonEmpty,
    version: nonEmpty,
    platform: nonEmpty,
    mode: z.enum(["ui", "cli", "service", "test"]),
    displayName: nonEmpty.optional(),
    instanceId: nonEmpty.optional(),
  }).strict(),
  /** Optional narrowing of the scopes the server would otherwise grant. */
  scopes: z.array(z.enum(GATEWAY_SCOPES)).max(GATEWAY_SCOPES.length).optional(),
  /**
   * Paired-device authentication (device endpoint only): proof of possession of the device key over the nonce the
   * server sent in `connect.challenge`. Session-cookie connections do not send it.
   */
  device: deviceProofSchema.optional(),
  /** Present on a first-time device: the one-time pairing token created from an owner session. */
  pairing: pairingRequestSchema.optional(),
}).strict();
export type GatewayConnectParams = z.infer<typeof gatewayConnectParamsSchema>;

export const gatewayHelloOkSchema = z.object({
  type: z.literal("hello-ok"),
  protocol: z.number().int().min(1),
  server: z.object({
    version: nonEmpty,
    connId: nonEmpty,
    /** Changes every server start; a different value on reconnect means the Gateway restarted. */
    bootId: nonEmpty,
  }).strict(),
  features: z.object({
    methods: z.array(nonEmpty),
    events: z.array(nonEmpty),
  }).strict(),
  auth: z.object({
    role: z.enum(GATEWAY_ROLES),
    scopes: z.array(z.enum(GATEWAY_SCOPES)),
    /** Set when the connection authenticated as a paired device. */
    deviceId: z.string().optional(),
  }).strict(),
  policy: z.object({
    maxPayload: z.number().int().min(1),
    maxBufferedBytes: z.number().int().min(1),
    tickIntervalMs: z.number().int().min(1),
    handshakeTimeoutMs: z.number().int().min(1),
  }).strict(),
}).strict();
export type GatewayHelloOk = z.infer<typeof gatewayHelloOkSchema>;

/** Answer to a first-time device's connect: the owner must approve on the Home; the socket then reports `pairing.resolved`. */
export const gatewayPairingPendingSchema = z.object({
  type: z.literal("pairing-pending"),
  pairingId: z.string().uuid(),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();
export type GatewayPairingPending = z.infer<typeof gatewayPairingPendingSchema>;

export const GATEWAY_DEFAULT_POLICY = {
  maxPayload: 1_048_576,
  maxBufferedBytes: 4_194_304,
  tickIntervalMs: 15_000,
  handshakeTimeoutMs: 15_000,
} as const;

/** Methods every Gateway offers. Feature methods are added by the owning feature (see GATEWAY_METHODS). */
const executionSessionOwnerSchema = z.object({
  projectId: z.number().int().positive().nullable(),
  chatId: z.number().int().positive().nullable(),
}).strict();

const executionSessionScopeSchema = executionSessionOwnerSchema.extend({
  sessionId: z.string().uuid(),
}).strict();

const executionTrustFactsSchema = z.object({
  version: z.literal(1),
  requestId: z.string().uuid(),
  operationDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  approvalDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  permissionClass: z.enum(["user_confirm", "admin_confirm"]),
  policyRevision: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(["approved", "denied"]),
  denialReason: z.enum([
    "user-denied", "policy-denied", "stale-policy", "expired",
    "cancelled-before-launch", "unsupported", "approval-mismatch",
  ]).nullable(),
  backendId: z.string().max(200).nullable(),
  deviceId: z.string().max(200).nullable(),
  backendGenerationId: z.string().max(200).nullable(),
  runtimeReceiptId: z.string().uuid().nullable(),
  interactiveInputDigests: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(256).optional(),
}).strict();

const executionSessionHistoryRecordSchema = z.object({
  sessionId: z.string().uuid(),
  status: z.enum(["running", "waiting_approval", "completed", "cancelled", "failed", "interrupted", "denied"]),
  label: z.string().max(256),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).nullable(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().safe().nullable(),
  trust: executionTrustFactsSchema.nullable(),
}).strict();

export const GATEWAY_METHODS = {
  ...deviceContinuityMethods,
  ...remoteNodeMethods,
  "gateway.ping": {
    scope: "read",
    params: z.object({}).strict().optional(),
    result: z.object({ now: z.number().int().min(0), bootId: nonEmpty }).strict(),
  },
  "quotes.subscribe": {
    scope: "read",
    params: z.object({ symbols: z.array(z.string().trim().min(1).max(24)).min(1).max(200) }).strict(),
    result: z.object({ subscribed: z.array(z.string()), total: z.number().int().min(0) }).strict(),
  },
  "quotes.unsubscribe": {
    scope: "read",
    params: z.object({ symbols: z.array(z.string().trim().min(1).max(24)).min(1).max(200) }).strict(),
    result: z.object({ total: z.number().int().min(0) }).strict(),
  },
  /**
   * Starts a Conversation Runtime run. `chatId: null` is a temporary chat. `body` is the same wire request the HTTP
   * respond endpoints take and is validated by the server (it owns the schema); the run id is `body.requestId`.
   */
  "conversation.start": {
    scope: "write",
    params: z.object({ chatId: z.number().int().positive().nullable(), body: z.unknown() }).strict(),
    result: z.object({ requestId: z.string().uuid() }).strict(),
  },
  /** Attaches to a run (including one started before a reload) and replays buffered events after `afterSeq`. */
  "conversation.subscribe": {
    scope: "read",
    params: z.object({ requestId: z.string().uuid(), afterSeq: z.number().int().min(-1).default(-1) }).strict(),
    result: z.object({ status: z.enum(["running", "finished"]), lastSeq: z.number().int().min(-1) }).strict(),
  },
  "conversation.cancel": {
    scope: "write",
    params: z.object({ requestId: z.string().uuid() }).strict(),
    result: z.object({ cancelled: z.boolean() }).strict(),
  },
  /**
   * Explicit owner resume of an interrupted agent run (Stop or Home restart). `requestId` is the ONLY input: the server
   * derives the owner Project/Chat, objective, plan, tool/policy facts and authorization itself, rejects drift, and
   * continues the SAME run id. A confirm-class step pauses for a fresh approval instead of self-authorizing.
   */
  "conversation.resume": {
    scope: "write",
    params: z.object({ requestId: z.string().uuid() }).strict(),
    result: z.object({ requestId: z.string().uuid() }).strict(),
  },
  /**
   * Terminal/secondary-surface attach to the same canonical Conversation Runtime
   * execution session. Project/chat scope is mandatory to prevent same-user
   * cross-workspace attachment.
   */
  "execution.session.attach": {
    scope: "read",
    params: executionSessionScopeSchema.extend({
      afterSeq: z.number().int().min(-1).default(-1),
    }).strict(),
    result: z.object({
      status: z.enum(["running", "finished"]),
      lastSeq: z.number().int().min(-1),
      session: z.object({
        sessionId: z.string().uuid(),
        projectId: z.number().int().positive().nullable(),
        chatId: z.number().int().positive().nullable(),
        startedAt: z.string().datetime({ offset: true }),
      }).strict(),
    }).strict(),
  },
  "execution.session.detach": {
    scope: "read",
    params: executionSessionScopeSchema,
    result: z.object({ detached: z.boolean() }).strict(),
  },
  "execution.session.cancel": {
    scope: "write",
    params: executionSessionScopeSchema,
    result: z.object({ cancelled: z.boolean() }).strict(),
  },
  "execution.session.input": {
    scope: "write",
    params: executionSessionScopeSchema.extend({
      input: z.enum(["help", "pwd", "id -u", "ls /tmp", "exit"]),
    }).strict(),
    result: z.object({ written: z.literal(true) }).strict(),
  },
  /**
   * Durable encrypted transcript/history for the exact owner scope. This is
   * read-only recovery state; it never re-admits or resumes execution.
   */
  "execution.session.read": {
    scope: "read",
    params: executionSessionScopeSchema,
    result: executionSessionHistoryRecordSchema,
  },
  "execution.session.history": {
    scope: "read",
    params: executionSessionOwnerSchema,
    result: z.object({
      sessions: z.array(executionSessionHistoryRecordSchema).max(256),
    }).strict(),
  },
  /** Closed server-owned sandbox intent; the browser does not supply argv or policy. */
  "execution.operation.propose": {
    scope: "write",
    params: z.object({
      projectId: z.number().int().positive(),
      chatId: z.number().int().positive(),
    }).strict(),
    result: z.object({
      requestId: z.string().uuid(),
      label: z.string(),
      argv: z.array(z.string()),
      cwd: z.string(),
      backendId: z.string(),
      operationDigest: z.string().regex(/^[a-f0-9]{64}$/),
      approvalDigest: z.string().regex(/^[a-f0-9]{64}$/),
      policyRevision: z.string().regex(/^[a-f0-9]{64}$/),
      permissionClass: z.enum(["user_confirm", "admin_confirm"]),
      expiresAtMs: z.number().int().safe(),
      isolation: z.object({
        filesystem: z.string(), network: z.string(), processes: z.string(),
      }).strict(),
      resources: z.object({
        maxWallTimeMs: z.number().int(),
        maxCapturedOutputChars: z.number().int(),
        maxCpuTimeMs: z.number().int().optional(),
        maxMemoryBytes: z.number().int().optional(),
        maxStorageBytes: z.number().int().optional(),
        maxProcesses: z.number().int().optional(),
      }).strict(),
      placement: z.object({
        requestId: z.string().uuid(),
        owner: z.object({
          userId: z.number().int().positive(),
          projectId: z.number().int().positive().nullable(),
          chatId: z.number().int().positive().nullable(),
        }).strict(),
        nodeId: z.string().min(1).max(200),
        kind: z.enum(["host", "node-permission", "container"]),
        backendId: z.enum(["lios.execution.local", "lios.execution.node-permission", "lios.execution.docker", "lios.execution.podman"]),
        generation: z.string().min(1).max(200),
        endpoint: z.string().regex(/^unix:\/\/\/[^?\s#\0]+$/).nullable(),
        policyRevision: z.string().regex(/^[a-f0-9]{64}$/),
        trustPosture: z.enum(["host-access", "restricted-node", "isolated-container"]),
        dataLocality: z.enum(["runtime-only", "workspace-copy"]),
        secretLocality: z.enum(["none", "runtime-only"]),
      }).strict().optional(),
      interactiveInputPolicy: z.enum(["sandbox-readonly-console"]).nullable(),
      allowedInteractiveInputs: z.array(z.enum(["help", "pwd", "id -u", "ls /tmp", "exit"])).max(5),
    }).strict().superRefine((value, ctx) => {
      const placement = value.placement;
      if (!placement) return;
      const expectedKind = placement.backendId === "lios.execution.local" ? "host"
        : placement.backendId === "lios.execution.node-permission" ? "node-permission" : "container";
      const expectedTrust = expectedKind === "host" ? "host-access"
        : expectedKind === "node-permission" ? "restricted-node" : "isolated-container";
      if (placement.requestId !== value.requestId || placement.backendId !== value.backendId
        || placement.policyRevision !== value.policyRevision || placement.kind !== expectedKind
        || placement.trustPosture !== expectedTrust
        || (expectedKind === "container" ? placement.endpoint === null : placement.endpoint !== null)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["placement"], message: "Placement facts must match the reviewed operation." });
      }
    }),
  },
  /** Approval is a separate human decision against the exact server-issued pair of digests. */
  "execution.operation.review": {
    scope: "write",
    params: z.object({
      projectId: z.number().int().positive(),
      chatId: z.number().int().positive(),
      requestId: z.string().uuid(),
      operationDigest: z.string().regex(/^[a-f0-9]{64}$/),
      approvalDigest: z.string().regex(/^[a-f0-9]{64}$/),
      allow: z.boolean(),
    }).strict(),
    result: z.object({ sessionId: z.string().uuid(), status: z.enum(["denied", "started"]) }).strict(),
  },
  /** The caller's runs that are still executing, so a reloaded UI can re-attach. */
  "conversation.active": {
    scope: "read",
    params: z.object({}).strict().optional(),
    result: z.object({
      runs: z.array(z.object({
        requestId: z.string().uuid(),
        chatId: z.number().int().positive().nullable(),
        startedAt: z.string().datetime({ offset: true }),
      }).strict()).max(100),
    }).strict(),
  },
} as const satisfies Record<string, { scope: GatewayScope; params: z.ZodType; result: z.ZodType }>;
export type GatewayMethodName = keyof typeof GATEWAY_METHODS;

/** What changed on the Home. A client refetches the queries it holds for these topics instead of polling. */
export const GATEWAY_INVALIDATION_TOPICS = ["alerts", "backup", "license", "quantlab", "devices", "notifications"] as const;
export type GatewayInvalidationTopic = (typeof GATEWAY_INVALIDATION_TOPICS)[number];

export const GATEWAY_EVENTS = {
  tick: z.object({ ts: z.number().int().min(0) }).strict(),
  /** Sent first on a device connection; the device signs this nonce in its `connect`. */
  "connect.challenge": z.object({ nonce: z.string().min(16).max(128) }).strict(),
  "pairing.resolved": z.object({ outcome: z.enum(["approved", "denied", "expired"]) }).strict(),
  shutdown: z.object({ reason: nonEmpty, restartExpectedMs: z.number().int().min(0).optional() }).strict(),
  "quotes.update": z.object({ quotes: z.array(z.object({ symbol: z.string() }).passthrough()).max(500) }).strict(),
  "data.invalidate": z.object({ topics: z.array(z.enum(GATEWAY_INVALIDATION_TOPICS)).min(1).max(GATEWAY_INVALIDATION_TOPICS.length) }).strict(),
  /** One Conversation Runtime event of a run; `runSeq` is the run's own sequence and is what `afterSeq` refers to. */
  "conversation.event": z.object({
    requestId: z.string().uuid(),
    runSeq: z.number().int().min(0),
    event: conversationRuntimeEventSchema,
  }).strict(),
  /** Same run/event stream, addressed as an execution session for Terminal and future control surfaces. */
  "execution.session.event": z.object({
    sessionId: z.string().uuid(),
    projectId: z.number().int().positive().nullable(),
    chatId: z.number().int().positive().nullable(),
    runSeq: z.number().int().min(0),
    event: conversationRuntimeEventSchema,
  }).strict(),
} as const satisfies Record<string, z.ZodType>;
export type GatewayEventName = keyof typeof GATEWAY_EVENTS;

export class GatewayFrameError extends Error {
  constructor(readonly code: GatewayErrorCode, message: string) {
    super(message);
    this.name = "GatewayFrameError";
  }
}

/** Parses one inbound text message into a frame, enforcing the size limit before JSON parsing. */
export function parseGatewayFrame(raw: string, maxBytes: number = GATEWAY_DEFAULT_POLICY.maxPayload): GatewayFrame {
  if (typeof raw !== "string") throw new GatewayFrameError("INVALID_REQUEST", "Gateway frames are text.");
  if (new TextEncoder().encode(raw).length > maxBytes) throw new GatewayFrameError("PAYLOAD_TOO_LARGE", "Frame exceeds the maximum payload.");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new GatewayFrameError("INVALID_REQUEST", "Frame is not valid JSON.");
  }
  const parsed = gatewayFrameSchema.safeParse(json);
  if (!parsed.success) throw new GatewayFrameError("INVALID_REQUEST", "Frame does not match the Gateway protocol.");
  return parsed.data;
}

export function gatewayError(code: GatewayErrorCode, message: string, extra: Partial<Omit<GatewayErrorShape, "code" | "message">> = {}): GatewayErrorShape {
  return { code, message, ...extra };
}

/** Whether a connect failure is final (a retry cannot succeed) so a client should stop reconnecting. */
export function isTerminalGatewayError(error: Pick<GatewayErrorShape, "code"> | null | undefined): boolean {
  return error?.code === "UNAUTHORIZED" || error?.code === "FORBIDDEN" || error?.code === "PROTOCOL_MISMATCH";
}

/** Picks the protocol version both sides support, or null. */
export function negotiateGatewayProtocol(params: Pick<GatewayConnectParams, "minProtocol" | "maxProtocol">): number | null {
  return params.minProtocol <= GATEWAY_PROTOCOL_VERSION && params.maxProtocol >= GATEWAY_PROTOCOL_VERSION ? GATEWAY_PROTOCOL_VERSION : null;
}
