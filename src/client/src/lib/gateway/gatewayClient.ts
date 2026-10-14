// Adapted from OpenClaw packages/gateway-client/src/protocol-client.ts (MIT, commit c074824a27c96d3983043f9eeb33823cd1772d8c), Copyright (c) 2026 OpenClaw Foundation.
import type { z } from "zod";
import {
  GATEWAY_EVENTS,
  GATEWAY_METHODS,
  GATEWAY_PROTOCOL_VERSION,
  gatewayHelloOkSchema,
  gatewayPairingPendingSchema,
  isTerminalGatewayError,
  parseGatewayFrame,
  type GatewayConnectParams,
  type GatewayErrorShape,
  type GatewayEventName,
  type GatewayHelloOk,
  type GatewayPairingPending,
  type GatewayMethodName,
  type GatewayScope,
} from "@shared/gatewayProtocol";
import { buildDeviceProofPayload, normalizeDeviceCapabilityAdvertisement } from "@shared/devicePairing";
import type { DeviceIdentity } from "./deviceIdentity";
import { EventListeners, ListenerSet } from "./eventListeners";
import {
  GatewayClosedError,
  GatewayNotReadyError,
  GatewayRequestError,
  GatewayResultError,
  GatewayTimeoutError,
} from "./gatewayErrors";
import { PendingRequests } from "./pendingRequests";
import { createReconnectBackoff, type ReconnectBackoff } from "./reconnectBackoff";
import { clampTimerMs } from "./timeouts";

export type GatewayState = "idle" | "connecting" | "ready" | "pairing" | "reconnecting" | "stopped" | "failed";

/** Minimal WebSocket surface the client needs; the DOM WebSocket and test fakes both satisfy it. */
export interface GatewaySocket {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
export type GatewaySocketConstructor = new (url: string) => GatewaySocket;

export interface GatewayReconnectOptions {
  initialMs?: number;
  maxMs?: number;
  multiplier?: number;
  jitter?: number;
}

export interface GatewayClientOptions {
  url: string;
  clientInfo: GatewayConnectParams["client"];
  WebSocketImpl?: GatewaySocketConstructor;
  scopes?: GatewayScope[];
  requestTimeoutMs?: number;
  reconnect?: GatewayReconnectOptions;
  now?: () => number;
  random?: () => number;
  /** Authenticate as a paired device (device endpoint): waits for connect.challenge and signs it. */
  device?: {
    identity: DeviceIdentity;
    pairing?: { token: string; deviceName: string };
    /** Descriptive surface only; declaration never grants invocation authority. */
    capabilities?: string[];
    commands?: string[];
  };
}

export interface GatewayRequestOptions {
  /** null disables the deadline; undefined uses the client default. */
  timeoutMs?: number | null;
  signal?: AbortSignal;
  /** Wait for the next ready instead of failing with GatewayNotReadyError. */
  queueUntilReady?: boolean;
}

export interface GatewayReadyInfo {
  /** True when the server bootId differs from the previous connection's (the Gateway restarted). */
  restarted: boolean;
  hello: GatewayHelloOk;
}
export type GatewayPairingOutcome = "approved" | "denied" | "expired";
export interface GatewayGapInfo { expected: number; received: number }
export interface GatewayProtocolIssue {
  kind: "invalid-frame" | "invalid-event" | "invalid-hello";
  message: string;
  detail?: unknown;
}

type EventPayloads = { [E in GatewayEventName]: z.output<(typeof GATEWAY_EVENTS)[E]> };
type MethodParams<M extends GatewayMethodName> = z.input<(typeof GATEWAY_METHODS)[M]["params"]>;
type MethodResult<M extends GatewayMethodName> = z.output<(typeof GATEWAY_METHODS)[M]["result"]>;

const HANDSHAKE_FALLBACK_MS = 15_000;
const WATCHDOG_TICKS = 2.5;
const CLOSE_NORMAL = 1000;
const CLOSE_POLICY = 4000;

interface QueuedRequest {
  run: () => void;
  fail: (error: unknown) => void;
}

function readEventData(data: unknown): string | null {
  return typeof data === "string" ? data : null;
}

export class GatewayClient {
  private readonly WebSocketImpl: GatewaySocketConstructor;
  private readonly requestTimeoutMs: number;
  private readonly now: () => number;
  private readonly backoff: ReconnectBackoff;
  private readonly pending = new PendingRequests();
  private readonly queue = new Set<QueuedRequest>();
  private readonly stateListeners = new ListenerSet<GatewayState>();
  private readonly readyListeners = new ListenerSet<GatewayReadyInfo>();
  private readonly gapListeners = new ListenerSet<GatewayGapInfo>();
  private readonly protocolErrorListeners = new ListenerSet<GatewayProtocolIssue>();
  private readonly pairingListeners = new ListenerSet<Omit<GatewayPairingPending, "type">>();
  private readonly pairingResolvedListeners = new ListenerSet<GatewayPairingOutcome>();
  private readonly eventListeners = new EventListeners<unknown>();

  private socket: GatewaySocket | null = null;
  private currentState: GatewayState = "idle";
  private currentHello: GatewayHelloOk | null = null;
  private lastBootId: string | null = null;
  private lastSeq: number | null = null;
  private lastFrameAt = 0;
  private everAttempted = false;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: GatewayClientOptions) {
    const impl = options.WebSocketImpl ?? (globalThis.WebSocket as unknown as GatewaySocketConstructor | undefined);
    if (!impl) throw new Error("GatewayClient requires a WebSocket implementation");
    this.WebSocketImpl = impl;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.backoff = createReconnectBackoff({
      initialMs: options.reconnect?.initialMs ?? 1000,
      maxMs: options.reconnect?.maxMs ?? 30_000,
      multiplier: options.reconnect?.multiplier ?? 2,
      jitter: options.reconnect?.jitter ?? 0.2,
      random: options.random,
    });
  }

  get state(): GatewayState {
    return this.currentState;
  }

  /** The hello-ok of the current connection; null unless ready. */
  get hello(): GatewayHelloOk | null {
    return this.currentState === "ready" ? this.currentHello : null;
  }

  start(): void {
    if (this.currentState !== "idle" && this.currentState !== "stopped" && this.currentState !== "failed") return;
    this.everAttempted = false;
    this.backoff.reset();
    this.connect();
  }

  stop(): void {
    if (this.currentState === "stopped") return;
    this.setState("stopped");
    this.dropSocket(false);
  }

  onState(listener: (state: GatewayState) => void): () => void {
    return this.stateListeners.add(listener);
  }

  /** Fires after every successful (re)connect so subscribers can resubscribe or resync. */
  onReady(listener: (info: GatewayReadyInfo) => void): () => void {
    return this.readyListeners.add(listener);
  }

  /** Fires when a first-time device's pairing request awaits owner approval on the Home. */
  onPairing(listener: (pairing: { pairingId: string; expiresAt: string }) => void): () => void {
    return this.pairingListeners.add(listener);
  }

  /** Fires with the owner's decision; the client then stops (start a new client without `pairing` to connect as the paired device). */
  onPairingResolved(listener: (outcome: GatewayPairingOutcome) => void): () => void {
    return this.pairingResolvedListeners.add(listener);
  }

  onGap(listener: (gap: GatewayGapInfo) => void): () => void {
    return this.gapListeners.add(listener);
  }

  onProtocolError(listener: (issue: GatewayProtocolIssue) => void): () => void {
    return this.protocolErrorListeners.add(listener);
  }

  onEvent<E extends GatewayEventName>(event: E, listener: (payload: EventPayloads[E]) => void): () => void;
  onEvent(event: string, listener: (payload: unknown) => void): () => void;
  onEvent(event: string, listener: (payload: never) => void): () => void {
    return this.eventListeners.add(event, listener as (payload: unknown) => void);
  }

  async request<M extends GatewayMethodName>(
    method: M,
    params: MethodParams<M>,
    options?: GatewayRequestOptions,
  ): Promise<MethodResult<M>> {
    const spec = GATEWAY_METHODS[method];
    const parsedParams = spec.params.safeParse(params);
    if (!parsedParams.success) {
      throw new GatewayRequestError({ code: "INVALID_REQUEST", message: `Invalid params for ${method}`, details: parsedParams.error.issues });
    }
    const raw = await this.requestRaw(method, parsedParams.data, options);
    const parsedResult = spec.result.safeParse(raw);
    if (!parsedResult.success) throw new GatewayResultError(method, parsedResult.error.issues);
    return parsedResult.data as MethodResult<M>;
  }

  /** Untyped request for methods that are not in the catalogue yet. The result is not validated. */
  requestRaw(method: string, params?: unknown, options: GatewayRequestOptions = {}): Promise<unknown> {
    if (this.currentState === "ready") return this.dispatch(method, params, options);
    if (!options.queueUntilReady) return Promise.reject(new GatewayNotReadyError());
    if (this.currentState === "stopped" || this.currentState === "failed") return Promise.reject(new GatewayNotReadyError());
    return new Promise<unknown>((resolve, reject) => {
      const timeoutMs = options.timeoutMs === undefined ? this.requestTimeoutMs : options.timeoutMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const leave = () => {
        this.queue.delete(item);
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };
      const item: QueuedRequest = {
        run: () => {
          leave();
          this.dispatch(method, params, options).then(resolve, reject);
        },
        fail: (error) => {
          leave();
          reject(error);
        },
      };
      const onAbort = () => item.fail(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
      this.queue.add(item);
      if (options.signal?.aborted) return onAbort();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (timeoutMs !== null) {
        const ms = clampTimerMs(timeoutMs, this.requestTimeoutMs);
        timer = setTimeout(() => item.fail(new GatewayTimeoutError(method, ms)), ms);
      }
    });
  }

  private dispatch(method: string, params: unknown, options: GatewayRequestOptions): Promise<unknown> {
    const timeoutMs = options.timeoutMs === undefined ? this.requestTimeoutMs : options.timeoutMs;
    const { id, promise } = this.pending.create({ method, timeoutMs, signal: options.signal });
    try {
      if (!this.socket) throw new GatewayClosedError();
      this.socket.send(JSON.stringify({ type: "req", id, method, ...(params === undefined ? {} : { params }) }));
    } catch (error) {
      this.pending.reject(id, error);
    }
    return promise;
  }

  private setState(state: GatewayState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.stateListeners.emit(state);
  }

  private reportIssue(kind: GatewayProtocolIssue["kind"], message: string, detail?: unknown): void {
    this.protocolErrorListeners.emit({ kind, message, detail });
  }

  private connect(): void {
    this.setState(this.everAttempted ? "reconnecting" : "connecting");
    this.everAttempted = true;
    this.lastSeq = null;
    let socket: GatewaySocket;
    try {
      socket = new this.WebSocketImpl(this.options.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.handshakeTimer = setTimeout(() => this.failConnection(socket, CLOSE_POLICY, "handshake timeout"), HANDSHAKE_FALLBACK_MS);
    socket.onopen = () => {
      if (this.socket === socket && !this.options.device) void this.sendConnect(socket, null);
    };
    socket.onmessage = (event) => {
      if (this.socket === socket) this.handleMessage(event.data);
    };
    socket.onerror = () => {};
    socket.onclose = () => {
      if (this.socket === socket) this.dropSocket(true);
    };
  }

  private async sendConnect(socket: GatewaySocket, nonce: string | null): Promise<void> {
    const params: GatewayConnectParams = {
      minProtocol: 1,
      maxProtocol: GATEWAY_PROTOCOL_VERSION,
      client: this.options.clientInfo,
      ...(this.options.scopes ? { scopes: this.options.scopes } : {}),
    };
    const device = this.options.device;
    if (device && nonce !== null) {
      const signedAt = this.now();
      const pairing = device.pairing;
      let signature: string;
      let surface;
      try {
        surface = normalizeDeviceCapabilityAdvertisement({
          capabilities: device.capabilities,
          commands: device.commands,
        });
        signature = await device.identity.sign(buildDeviceProofPayload({
          deviceId: device.identity.id,
          clientId: this.options.clientInfo.id,
          clientMode: this.options.clientInfo.mode,
          scopes: this.options.scopes ?? [],
          signedAt,
          nonce,
          pairingToken: pairing?.token ?? "",
          ...surface,
        }));
      } catch {
        this.failConnection(socket, CLOSE_POLICY, "device signing failed");
        return;
      }
      if (this.socket !== socket) return;
      params.device = {
        id: device.identity.id,
        publicKey: device.identity.publicKey,
        signature,
        signedAt,
        ...surface,
      };
      if (pairing) params.pairing = { token: pairing.token, deviceName: pairing.deviceName };
    }
    this.dispatch("connect", params, { timeoutMs: null }).then(
      (payload) => {
        if (this.socket !== socket) return;
        const pairingPending = gatewayPairingPendingSchema.safeParse(payload);
        if (pairingPending.success) this.handlePairingPending(pairingPending.data);
        else this.handleHello(socket, payload);
      },
      (error) => {
        if (this.socket !== socket) return;
        if (error instanceof GatewayRequestError && isTerminalGatewayError(error)) {
          this.setState("failed");
          this.dropSocket(false, CLOSE_NORMAL, "terminal connect failure");
        } else if (error instanceof GatewayRequestError) {
          this.failConnection(socket, CLOSE_NORMAL, "connect rejected");
        }
      },
    );
  }

  private handlePairingPending(pending: GatewayPairingPending): void {
    if (this.handshakeTimer !== undefined) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = undefined;
    this.setState("pairing");
    this.pairingListeners.emit({ pairingId: pending.pairingId, expiresAt: pending.expiresAt });
  }

  private handleHello(socket: GatewaySocket, payload: unknown): void {
    const parsed = gatewayHelloOkSchema.safeParse(payload);
    if (!parsed.success) {
      this.reportIssue("invalid-hello", "Gateway sent an invalid hello-ok", parsed.error.issues);
      this.failConnection(socket, CLOSE_POLICY, "invalid hello");
      return;
    }
    const hello = parsed.data;
    if (hello.protocol !== GATEWAY_PROTOCOL_VERSION) {
      this.setState("failed");
      this.dropSocket(false, CLOSE_POLICY, "protocol mismatch");
      return;
    }
    if (this.handshakeTimer !== undefined) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = undefined;
    const restarted = this.lastBootId !== null && this.lastBootId !== hello.server.bootId;
    this.lastBootId = hello.server.bootId;
    this.currentHello = hello;
    this.backoff.reset();
    this.lastFrameAt = this.now();
    this.armWatchdog(socket, hello.policy.tickIntervalMs);
    this.setState("ready");
    for (const item of [...this.queue]) item.run();
    this.readyListeners.emit({ restarted, hello });
  }

  private armWatchdog(socket: GatewaySocket, tickIntervalMs: number): void {
    const limit = tickIntervalMs * WATCHDOG_TICKS;
    const check = () => {
      if (this.socket !== socket) return;
      const remaining = limit - (this.now() - this.lastFrameAt);
      if (remaining > 0) {
        this.watchdogTimer = setTimeout(check, clampTimerMs(remaining, limit));
        return;
      }
      this.failConnection(socket, CLOSE_POLICY, "tick timeout");
    };
    this.watchdogTimer = setTimeout(check, clampTimerMs(limit, limit));
  }

  private handleMessage(data: unknown): void {
    const text = readEventData(data);
    if (text === null) return this.reportIssue("invalid-frame", "Gateway sent a non-text frame");
    this.lastFrameAt = this.now();
    let frame: ReturnType<typeof parseGatewayFrame>;
    try {
      frame = parseGatewayFrame(text, this.currentHello?.policy.maxPayload);
    } catch (error) {
      return this.reportIssue("invalid-frame", error instanceof Error ? error.message : "invalid frame");
    }
    if (frame.type === "res") {
      if (frame.ok) this.pending.resolve(frame.id, frame.payload);
      else this.pending.reject(frame.id, new GatewayRequestError(frame.error ?? ({ code: "INTERNAL", message: "Request failed" } satisfies GatewayErrorShape)));
      return;
    }
    if (frame.type !== "event") return;
    if (frame.seq === undefined && this.options.device && this.currentState !== "ready") {
      if (frame.event === "connect.challenge") {
        const challenge = GATEWAY_EVENTS["connect.challenge"].safeParse(frame.payload);
        if (!challenge.success) return this.reportIssue("invalid-event", "Invalid connect.challenge payload", challenge.error.issues);
        if (this.socket) void this.sendConnect(this.socket, challenge.data.nonce);
        return;
      }
      if (frame.event === "pairing.resolved" && this.currentState === "pairing") {
        const resolved = GATEWAY_EVENTS["pairing.resolved"].safeParse(frame.payload);
        if (!resolved.success) return this.reportIssue("invalid-event", "Invalid pairing.resolved payload", resolved.error.issues);
        this.setState("stopped");
        this.dropSocket(false);
        this.pairingResolvedListeners.emit(resolved.data.outcome);
        return;
      }
    }
    if (frame.seq !== undefined) {
      if (this.lastSeq !== null && frame.seq !== this.lastSeq + 1) this.gapListeners.emit({ expected: this.lastSeq + 1, received: frame.seq });
      this.lastSeq = frame.seq;
    }
    const schema = (GATEWAY_EVENTS as Record<string, z.ZodType | undefined>)[frame.event];
    if (!schema) return this.eventListeners.emit(frame.event, frame.payload);
    const parsed = schema.safeParse(frame.payload);
    if (!parsed.success) return this.reportIssue("invalid-event", `Invalid payload for event ${frame.event}`, parsed.error.issues);
    this.eventListeners.emit(frame.event, parsed.data);
  }

  /** Closes a misbehaving connection and goes through the normal reconnect path. */
  private failConnection(socket: GatewaySocket, code: number, reason: string): void {
    if (this.socket !== socket) return;
    this.dropSocket(true, code, reason);
  }

  /**
   * Detaches and closes the current socket, rejects everything in flight (never replayed) and,
   * unless the client stopped or failed, schedules a reconnect.
   */
  private dropSocket(reconnect: boolean, code = CLOSE_NORMAL, reason = "client closing"): void {
    const socket = this.socket;
    this.socket = null;
    this.currentHello = null;
    for (const timer of [this.handshakeTimer, this.watchdogTimer, this.reconnectTimer]) if (timer !== undefined) clearTimeout(timer);
    this.handshakeTimer = this.watchdogTimer = this.reconnectTimer = undefined;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = null;
      socket.onerror = () => {};
      try {
        socket.close(code, reason);
      } catch {
        // already closed
      }
    }
    if (this.currentState === "pairing" && reconnect) this.setState("stopped");
    const stopped = this.currentState === "stopped" || this.currentState === "failed";
    this.pending.rejectAll(() => new GatewayClosedError());
    if (stopped) for (const item of [...this.queue]) item.fail(new GatewayClosedError());
    if (reconnect && !stopped) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.setState("reconnecting");
    const delay = this.backoff.next();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.currentState === "reconnecting") this.connect();
    }, clampTimerMs(delay, 1000));
  }
}
