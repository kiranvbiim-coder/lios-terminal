import crypto from "node:crypto";
import type { WebSocket } from "ws";
import type { User } from "@shared/schema";
import type { z } from "zod";
import {
  GATEWAY_DEFAULT_POLICY,
  GATEWAY_EVENTS,
  GATEWAY_METHODS,
  GATEWAY_PROTOCOL_VERSION,
  GatewayFrameError,
  gatewayConnectParamsSchema,
  gatewayError,
  negotiateGatewayProtocol,
  parseGatewayFrame,
} from "@shared/gatewayProtocol";
import type {
  GatewayConnectParams,
  GatewayErrorShape,
  GatewayPairingPending,
  GatewayEventName,
  GatewayFrame,
  GatewayMethodName,
  GatewayScope,
} from "@shared/gatewayProtocol";

/**
 * Server half of the LiOS Gateway (GM-08a). Transport-agnostic: callers hand it an authenticated WebSocket plus the
 * identity the HTTP session produced at upgrade. It owns the connect handshake, per-connection scopes, request
 * dispatch with schema validation on both directions, the event sequence, tick heartbeat, and graceful shutdown.
 * Feature methods register through `register`; they receive the caller identity and never see raw frames.
 */

export interface GatewayIdentity {
  userId: number;
  email: string;
  role: User["role"];
  organizationId: number | null;
  /** Scopes the server derived from the signed-in account; a client can only narrow these. */
  grantedScopes: readonly GatewayScope[];
  /** Set when the connection authenticated as a paired device. */
  deviceId?: string;
}

/** What an authenticator decides about a device's `connect`. */
export type ConnectDecision =
  | { kind: "accept"; identity: GatewayIdentity }
  | { kind: "pending"; pending: GatewayPairingPending; resolution: Promise<"approved" | "denied" | "expired"> }
  | { kind: "reject"; error: GatewayErrorShape };

/** Authenticates connections that have no session cookie (paired devices). The hub supplies the challenge nonce. */
export interface GatewayAuthenticator {
  authenticate(input: { params: GatewayConnectParams; nonce: string; remoteAddress: string | undefined }): Promise<ConnectDecision>;
}

export interface GatewayConnection {
  readonly connId: string;
  readonly identity: GatewayIdentity;
  readonly scopes: readonly GatewayScope[];
  /** Per-feature state owned by the registering feature (for example quote subscriptions). */
  readonly state: Map<string, unknown>;
  emit<E extends GatewayEventName>(event: E, payload: z.input<(typeof GATEWAY_EVENTS)[E]>): void;
}

type MethodHandler<M extends GatewayMethodName> = (
  params: z.output<(typeof GATEWAY_METHODS)[M]["params"]>,
  connection: GatewayConnection,
) => Promise<z.input<(typeof GATEWAY_METHODS)[M]["result"]>> | z.input<(typeof GATEWAY_METHODS)[M]["result"]>;

/** Thrown by method handlers to return a structured protocol error instead of INTERNAL. */
export class GatewayMethodError extends Error {
  constructor(readonly shape: GatewayErrorShape) {
    super(shape.message);
    this.name = "GatewayMethodError";
  }
}

const SCOPE_RANK: Record<GatewayScope, number> = { read: 1, write: 2, admin: 3 };

function satisfies(scopes: readonly GatewayScope[], needed: GatewayScope): boolean {
  return scopes.some((scope) => SCOPE_RANK[scope] >= SCOPE_RANK[needed]);
}

export interface GatewayHubOptions {
  version: string;
  policy?: Partial<typeof GATEWAY_DEFAULT_POLICY>;
  now?: () => number;
  /**
   * Optional Home authority bridge. Production supplies the canonical
   * current account/device check; isolated transport fixtures may inject a
   * deterministic authority. A connect-time scope is never a durable grant.
   */
  authorizeRequest?: (connection: GatewayConnection, scope: GatewayScope) => Promise<void> | void;
}

class Connection implements GatewayConnection {
  readonly state = new Map<string, unknown>();
  scopes: readonly GatewayScope[] = [];
  ready = false;
  /** True while a device authenticator is deciding; further frames from that client are protocol violations. */
  authenticating = false;
  readonly nonce = crypto.randomBytes(24).toString("base64url");
  seq = 0;
  handshakeTimer: ReturnType<typeof setTimeout> | null = null;

  /** Set at attach for session connections, and after a successful device authentication otherwise. */
  identity!: GatewayIdentity;

  constructor(
    readonly connId: string,
    identity: GatewayIdentity | null,
    readonly socket: WebSocket,
    private readonly maxBufferedBytes: number,
    readonly authenticator: GatewayAuthenticator | null,
    readonly remoteAddress: string | undefined,
  ) {
    if (identity) this.identity = identity;
  }

  send(frame: GatewayFrame): void {
    if (this.socket.readyState !== this.socket.OPEN) return;
    if (this.socket.bufferedAmount > this.maxBufferedBytes) {
      // A client that cannot keep up must reconnect and resync rather than buffer unboundedly in the Home.
      this.socket.close(1013, "Backpressure limit exceeded");
      return;
    }
    this.socket.send(JSON.stringify(frame));
  }

  emit<E extends GatewayEventName>(event: E, payload: z.input<(typeof GATEWAY_EVENTS)[E]>): void {
    if (!this.ready) return;
    this.send({ type: "event", event, payload, seq: this.seq++ });
  }
}

export class GatewayHub {
  readonly bootId = crypto.randomUUID();
  readonly policy: typeof GATEWAY_DEFAULT_POLICY;
  private readonly connections = new Set<Connection>();
  private readonly handlers = new Map<string, { scope: GatewayScope; run: (params: unknown, connection: GatewayConnection) => Promise<unknown> | unknown; params: z.ZodType; result: z.ZodType }>();
  private readonly closeListeners: Array<(connection: GatewayConnection) => void> = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: GatewayHubOptions) {
    this.policy = { ...GATEWAY_DEFAULT_POLICY, ...options.policy };
    this.now = options.now ?? Date.now;
    this.register("gateway.ping", () => ({ now: this.now(), bootId: this.bootId }));
  }

  get size(): number {
    return this.connections.size;
  }

  /** Snapshot of the canonical live connections; feature discovery does not create another device registry. */
  readyConnections(): readonly GatewayConnection[] {
    return [...this.connections].filter((connection) => connection.ready && connection.socket.readyState === connection.socket.OPEN);
  }

  isReadyConnection(connection: GatewayConnection): boolean {
    const candidate = connection as Connection;
    return this.connections.has(candidate) && candidate.ready && candidate.socket.readyState === candidate.socket.OPEN;
  }

  /** Current Home/device grant, checked before and after method execution. */
  private async assertCurrentRequestAuthority(connection: GatewayConnection, scope: GatewayScope): Promise<void> {
    if (!this.isReadyConnection(connection)) {
      throw new GatewayMethodError(gatewayError("UNAVAILABLE", "The exact authenticated Gateway connection is no longer live."));
    }
    try {
      await this.options.authorizeRequest?.(connection, scope);
    } catch {
      // Do not disclose provider, DB, device identity or policy detail over
      // the Gateway merely because a current-authority lookup failed.
      throw new GatewayMethodError(gatewayError("FORBIDDEN", "Current device authorization is unavailable or revoked."));
    }
    if (!this.isReadyConnection(connection)) {
      throw new GatewayMethodError(gatewayError("UNAVAILABLE", "The authenticated Gateway connection disconnected during authorization."));
    }
  }

  /** Server-owned composition: the same current-authority checks as wire RPC. */
  async invokeForConnection(method: string, rawParams: unknown, connection: GatewayConnection): Promise<unknown> {
    if (!this.isReadyConnection(connection)) throw new GatewayMethodError(gatewayError("UNAVAILABLE", "The exact authenticated Gateway connection is no longer live."));
    const handler = this.handlers.get(method);
    if (!handler) throw new GatewayMethodError(gatewayError("NOT_FOUND", "The requested Gateway method is not registered."));
    if (!satisfies(connection.scopes, handler.scope)) throw new GatewayMethodError(gatewayError("FORBIDDEN", "This connection lacks the method's required scope."));
    const params = handler.params.safeParse(rawParams);
    if (!params.success) throw new GatewayMethodError(gatewayError("INVALID_REQUEST", "Parameters do not match the method schema."));
    await this.assertCurrentRequestAuthority(connection, handler.scope);
    const result = handler.result.parse(await handler.run(params.data, connection));
    await this.assertCurrentRequestAuthority(connection, handler.scope);
    return result;
  }

  register<M extends GatewayMethodName>(method: M, handler: MethodHandler<M>): void {
    if (this.handlers.has(method)) throw new Error(`Gateway method ${method} is already registered.`);
    const definition = GATEWAY_METHODS[method];
    this.handlers.set(method, {
      scope: definition.scope,
      params: definition.params,
      result: definition.result,
      run: handler as (params: unknown, connection: GatewayConnection) => Promise<unknown> | unknown,
    });
  }

  onConnectionClosed(listener: (connection: GatewayConnection) => void): void {
    this.closeListeners.push(listener);
  }

  /** Delivers an event to every ready connection for which `select` returns a payload. */
  publish<E extends GatewayEventName>(event: E, select: (connection: GatewayConnection) => z.input<(typeof GATEWAY_EVENTS)[E]> | null): void {
    for (const connection of this.connections) {
      if (!connection.ready) continue;
      const payload = select(connection);
      if (payload !== null) connection.emit(event, payload);
    }
  }

  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      this.publish("tick", () => ({ ts: this.now() }));
    }, this.policy.tickIntervalMs);
    this.tickTimer.unref?.();
  }

  /** Announces the shutdown, then closes every connection. Safe to call twice. */
  async shutdown(reason: string, restartExpectedMs?: number): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    const payload = restartExpectedMs === undefined ? { reason } : { reason, restartExpectedMs };
    this.publish("shutdown", () => payload);
    for (const connection of [...this.connections]) connection.socket.close(1001, "Gateway shutting down");
  }

  /** Attaches a socket whose identity was already established (the HTTP session at upgrade). */
  attach(socket: WebSocket, identity: GatewayIdentity): void {
    this.attachConnection(new Connection(crypto.randomUUID(), identity, socket, this.policy.maxBufferedBytes, null, undefined));
  }

  /** Attaches a socket with no identity yet: sends a challenge and lets `authenticator` decide on `connect`. */
  attachUnauthenticated(socket: WebSocket, authenticator: GatewayAuthenticator, remoteAddress: string | undefined): void {
    const connection = new Connection(crypto.randomUUID(), null, socket, this.policy.maxBufferedBytes, authenticator, remoteAddress);
    this.attachConnection(connection);
    connection.send({ type: "event", event: "connect.challenge", payload: { nonce: connection.nonce } });
  }

  /** Closes every ready connection of a paired device (revocation). */
  disconnectDevice(deviceId: string): void {
    for (const connection of [...this.connections]) {
      if (connection.ready && connection.identity.deviceId === deviceId) connection.socket.close(4001, "Device revoked");
    }
  }

  private attachConnection(connection: Connection): void {
    const socket = connection.socket;
    this.connections.add(connection);
    connection.handshakeTimer = setTimeout(() => {
      socket.close(4000, "Handshake timeout");
    }, this.policy.handshakeTimeoutMs);
    connection.handshakeTimer.unref?.();

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        socket.close(1003, "Binary frames are not supported");
        return;
      }
      void this.handleMessage(connection, data.toString("utf8"));
    });
    const dispose = () => {
      if (connection.handshakeTimer) clearTimeout(connection.handshakeTimer);
      if (!this.connections.delete(connection)) return;
      for (const listener of this.closeListeners) listener(connection);
    };
    socket.on("close", dispose);
    socket.on("error", dispose);
  }

  private reply(connection: Connection, id: string, outcome: { payload: unknown } | { error: GatewayErrorShape }): void {
    connection.send("error" in outcome
      ? { type: "res", id, ok: false, error: outcome.error }
      : { type: "res", id, ok: true, payload: outcome.payload });
  }

  private async handleMessage(connection: Connection, raw: string): Promise<void> {
    let frame: GatewayFrame;
    try {
      frame = parseGatewayFrame(raw, this.policy.maxPayload);
    } catch (error) {
      const shape = error instanceof GatewayFrameError ? gatewayError(error.code, error.message) : gatewayError("INVALID_REQUEST", "Invalid frame.");
      connection.send({ type: "res", id: "invalid", ok: false, error: shape });
      connection.socket.close(1008, shape.code);
      return;
    }
    if (frame.type !== "req") {
      connection.socket.close(1008, "Clients send request frames only");
      return;
    }
    if (!connection.ready) {
      await this.handleConnect(connection, frame.id, frame.method, frame.params);
      return;
    }
    if (frame.method === "connect") {
      this.reply(connection, frame.id, { error: gatewayError("INVALID_REQUEST", "Already connected.") });
      return;
    }
    const handler = this.handlers.get(frame.method);
    if (!handler) {
      this.reply(connection, frame.id, { error: gatewayError("NOT_FOUND", `Unknown method ${frame.method}.`) });
      return;
    }
    if (!satisfies(connection.scopes, handler.scope)) {
      this.reply(connection, frame.id, { error: gatewayError("FORBIDDEN", `Method ${frame.method} requires the ${handler.scope} scope.`) });
      return;
    }
    const params = handler.params.safeParse(frame.params);
    if (!params.success) {
      this.reply(connection, frame.id, { error: gatewayError("INVALID_REQUEST", "Parameters do not match the method schema.", { details: params.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }) });
      return;
    }
    try {
      await this.assertCurrentRequestAuthority(connection, handler.scope);
      const result = handler.result.parse(await handler.run(params.data, connection));
      // Revocation/role change during an asynchronous read cannot release
      // that result to an already-connected device. This is a *response*
      // boundary, not evidence that earlier external effects were undone.
      await this.assertCurrentRequestAuthority(connection, handler.scope);
      this.reply(connection, frame.id, { payload: result });
    } catch (error) {
      if (error instanceof GatewayMethodError) {
        this.reply(connection, frame.id, { error: error.shape });
        return;
      }
      console.error(`Gateway method ${frame.method} failed:`, error);
      this.reply(connection, frame.id, { error: gatewayError("INTERNAL", "The request failed.") });
    }
  }

  private async handleConnect(connection: Connection, id: string, method: string, rawParams: unknown): Promise<void> {
    const fail = (error: GatewayErrorShape) => {
      this.reply(connection, id, { error });
      connection.socket.close(1008, error.code);
    };
    if (connection.authenticating) {
      connection.socket.close(1008, "Connect is already in progress");
      return;
    }
    if (method !== "connect") return fail(gatewayError("INVALID_REQUEST", "The first request must be connect."));
    const parsed = gatewayConnectParamsSchema.safeParse(rawParams);
    if (!parsed.success) return fail(gatewayError("INVALID_REQUEST", "Invalid connect parameters."));
    const protocol = negotiateGatewayProtocol(parsed.data);
    if (protocol === null) {
      return fail(gatewayError("PROTOCOL_MISMATCH", `This Home speaks Gateway protocol ${GATEWAY_PROTOCOL_VERSION}.`, { details: { supported: [GATEWAY_PROTOCOL_VERSION] } }));
    }

    if (connection.authenticator) {
      connection.authenticating = true;
      let decision: ConnectDecision;
      try {
        decision = await connection.authenticator.authenticate({ params: parsed.data, nonce: connection.nonce, remoteAddress: connection.remoteAddress });
      } catch (error) {
        console.error("Gateway device authentication failed:", error);
        return fail(gatewayError("INTERNAL", "Device authentication failed."));
      }
      if (decision.kind === "reject") return fail(decision.error);
      if (decision.kind === "pending") {
        // Approval can take minutes; the pairing request carries its own expiry, so the handshake deadline ends here.
        if (connection.handshakeTimer) clearTimeout(connection.handshakeTimer);
        connection.handshakeTimer = null;
        this.reply(connection, id, { payload: decision.pending });
        void decision.resolution.then((outcome) => {
          connection.send({ type: "event", event: "pairing.resolved", payload: { outcome } });
          connection.socket.close(1000, "Pairing resolved");
        });
        return;
      }
      connection.identity = decision.identity;
    }

    const requested = parsed.data.scopes;
    const scopes = requested ? connection.identity.grantedScopes.filter((scope) => requested.includes(scope)) : connection.identity.grantedScopes;
    if (requested && requested.some((scope) => !connection.identity.grantedScopes.includes(scope))) {
      return fail(gatewayError("FORBIDDEN", "Requested scopes exceed what this account is allowed."));
    }
    connection.scopes = scopes;
    connection.ready = true;
    if (connection.handshakeTimer) clearTimeout(connection.handshakeTimer);
    connection.handshakeTimer = null;
    const available = [...this.handlers.entries()].filter(([, handler]) => satisfies(scopes, handler.scope)).map(([name]) => name);
    this.reply(connection, id, {
      payload: {
        type: "hello-ok",
        protocol,
        server: { version: this.options.version, connId: connection.connId, bootId: this.bootId },
        features: { methods: available, events: Object.keys(GATEWAY_EVENTS) },
        auth: { role: "operator", scopes, ...(connection.identity.deviceId ? { deviceId: connection.identity.deviceId } : {}) },
        policy: this.policy,
      },
    });
  }
}
