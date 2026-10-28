import {
  decodeSupportingServiceFrame, SUPPORTING_SERVICE_MAX_FRAME_BYTES, SUPPORTING_SERVICE_PROTOCOL,
  supportingServiceBindingSchema,
  type SupportingServiceBinding, type SupportingServiceHomeFrame, type SupportingServiceWorkerFrame,
} from "@shared/supportingServiceContracts";
import { createBoundedLineFramer } from "./exec/bounded-line-framer";

export interface SupportingServiceTransportOptions {
  binding: SupportingServiceBinding;
  buildSha256: string;
  operations: readonly string[];
  /** Current Home-owned authority, not a worker assertion. Rechecked at each queued boundary. */
  assertCurrent(): void | Promise<void>;
  /** Await the actual pipe write callback; never treat enqueueing as delivery. */
  write(bytes: Buffer, signal: AbortSignal): Promise<void>;
  /** Owning supervisor must cancel and join native extinction/finalization here. */
  stop(): Promise<void>;
  /** Must honor signal and recheck canonical mutation/egress authority at actual dispatch. */
  onFrame(frame: SupportingServiceWorkerFrame, signal: AbortSignal): Promise<void>;
  maxFrameBytes?: number;
  maxQueuedBytes?: number;
  operationTimeoutMs?: number;
}

/**
 * Bounded transport over already-admitted process pipes. Does not launch a process, grant
 * privileges, expose a port, persist state or authorize a channel. The existing Home/GM/P13
 * owners still supply exact launch, current account authority and operation-specific admission.
 */
export class SupportingServiceTransport {
  private readonly binding: SupportingServiceBinding;
  private readonly framer: ReturnType<typeof createBoundedLineFramer>;
  private readonly abort = new AbortController();
  private readonly maxFrameBytes: number;
  private readonly maxQueuedBytes: number;
  private readonly timeoutMs: number;
  private readonly initialize: Extract<SupportingServiceHomeFrame, { kind: "initialize" }>;
  private state: "idle" | "starting" | "ready" | "closed" = "idle";
  private inbound = Promise.resolve();
  private outbound = Promise.resolve();
  private queuedInputBytes = 0;
  private queuedOutputBytes = 0;
  private lastSequence = -1;
  private stopping: Promise<void> | null = null;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readonly ready: Promise<void>;

  constructor(private readonly options: SupportingServiceTransportOptions) {
    this.options = { ...options };
    this.binding = supportingServiceBindingSchema.parse(options.binding);
    this.maxFrameBytes = options.maxFrameBytes ?? SUPPORTING_SERVICE_MAX_FRAME_BYTES;
    this.maxQueuedBytes = options.maxQueuedBytes ?? 2 * this.maxFrameBytes;
    this.timeoutMs = options.operationTimeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.maxFrameBytes) || this.maxFrameBytes < 1 || this.maxFrameBytes > SUPPORTING_SERVICE_MAX_FRAME_BYTES ||
        !Number.isSafeInteger(this.maxQueuedBytes) || this.maxQueuedBytes < this.maxFrameBytes || this.maxQueuedBytes > 16 * SUPPORTING_SERVICE_MAX_FRAME_BYTES ||
        !Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 300_000) {
      throw new Error("Invalid supporting-service transport limits.");
    }
    this.initialize = { protocol: SUPPORTING_SERVICE_PROTOCOL, binding: this.binding, kind: "initialize", buildSha256: options.buildSha256, operations: [...options.operations] };
    decodeSupportingServiceFrame(Buffer.from(JSON.stringify(this.initialize)), "home", this.binding, this.maxFrameBytes);
    this.framer = createBoundedLineFramer(this.maxFrameBytes, "Supporting-service frame exceeds its byte limit.");
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    void this.ready.catch(() => undefined);
  }

  private requireLive(): void {
    if (this.state === "closed") throw new Error("Supporting-service transport is closed.");
  }

  private async bounded<T>(work: () => Promise<T>): Promise<T> {
    this.requireLive();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([Promise.resolve().then(work), new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("Supporting-service operation cancelled."));
        this.abort.signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => reject(new Error("Supporting-service operation timed out.")), this.timeoutMs);
      })]);
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) this.abort.signal.removeEventListener("abort", onAbort);
    }
  }

  private async current(): Promise<void> {
    this.requireLive();
    await this.bounded(async () => { await this.options.assertCurrent(); });
    this.requireLive();
  }

  private failure(): void {
    // Caller receives a redacted error; supervisor errors remain on the explicit close promise.
    void this.close().catch(() => undefined);
  }

  async open(): Promise<void> {
    if (this.state !== "idle") throw new Error("Supporting-service transport already opened or closed.");
    this.state = "starting";
    try {
      await this.enqueueWrite(this.initialize);
      await this.bounded(() => this.ready);
      await this.current();
    } catch {
      this.failure();
      throw new Error("Supporting-service startup failed.");
    }
  }

  send(frame: SupportingServiceHomeFrame): Promise<void> {
    if (this.state !== "ready" || frame.kind === "initialize") return Promise.reject(new Error("Supporting-service transport is not ready."));
    return this.enqueueWrite(frame);
  }

  private enqueueWrite(frame: SupportingServiceHomeFrame): Promise<void> {
    let body: Buffer;
    let admitted: SupportingServiceHomeFrame | SupportingServiceWorkerFrame;
    try {
      this.requireLive();
      body = Buffer.from(JSON.stringify(frame));
      admitted = decodeSupportingServiceFrame(body, "home", this.binding, this.maxFrameBytes);
      if (this.queuedOutputBytes + body.length + 1 > this.maxQueuedBytes) throw new Error("queue full");
    } catch {
      this.failure();
      return Promise.reject(new Error("Supporting-service outgoing frame refused."));
    }
    const wire = Buffer.concat([body, Buffer.from("\n")]);
    this.queuedOutputBytes += wire.length;
    const pending = this.outbound.then(async () => {
      await this.current();
      if (admitted.kind === "invoke" && admitted.deadlineAt <= Date.now()) throw new Error("Supporting-service invocation expired.");
      await this.bounded(() => this.options.write(wire, this.abort.signal));
      await this.current();
    }).finally(() => { this.queuedOutputBytes -= wire.length; });
    this.outbound = pending.catch(() => { this.failure(); });
    return pending.catch(() => { throw new Error("Supporting-service pipe write failed."); });
  }

  receive(chunk: Buffer): Promise<void> {
    if (this.state !== "starting" && this.state !== "ready") return Promise.reject(new Error("Supporting-service transport is not receiving."));
    if (chunk.length + this.queuedInputBytes > this.maxQueuedBytes) {
      this.failure();
      return Promise.reject(new Error("Supporting-service incoming queue exceeded its byte limit."));
    }
    const owned = Buffer.from(chunk);
    this.queuedInputBytes += owned.length;
    const pending = this.inbound.then(async () => {
      this.requireLive();
      for (const line of this.framer.push(owned)) {
        try {
          await this.current();
          const frame = decodeSupportingServiceFrame(line, "worker", this.binding, this.maxFrameBytes);
          if (frame.kind === "ready") {
            if (this.state !== "starting" || frame.buildSha256 !== this.initialize.buildSha256 ||
                frame.operations.length !== this.initialize.operations.length ||
                frame.operations.some(operation => !this.initialize.operations.includes(operation))) throw new Error("handshake mismatch");
            this.state = "ready";
            this.readyResolve();
            continue;
          }
          if (this.state !== "ready") throw new Error("frame before ready");
          if (frame.kind === "event") {
            if (frame.sequence <= this.lastSequence) throw new Error("old sequence");
            this.lastSequence = frame.sequence;
          }
          await this.bounded(() => this.options.onFrame(frame, this.abort.signal));
          await this.current();
        } finally {
          // Retain fragments and active frames until their consumer settles. Close retires all bytes.
          if (this.state !== "closed") this.queuedInputBytes -= line.length + 1;
        }
      }
    });
    this.inbound = pending.catch(() => { this.failure(); });
    return pending.catch(() => { throw new Error("Supporting-service incoming frame refused."); });
  }

  async end(): Promise<void> {
    await this.inbound;
    if (this.framer.pendingByteLength > 0) {
      this.failure();
      throw new Error("Supporting-service pipe ended mid-frame.");
    }
    await this.close();
  }

  close(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.state = "closed";
    // Publish before synchronous abort listeners can reenter close().
    this.stopping = Promise.resolve().then(() => this.options.stop());
    this.abort.abort();
    this.readyReject(new Error("Supporting-service transport closed before readiness."));
    this.framer.clear();
    this.queuedInputBytes = 0;
    return this.stopping;
  }
}
