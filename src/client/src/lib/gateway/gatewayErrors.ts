import type { GatewayErrorCode, GatewayErrorShape } from "@shared/gatewayProtocol";

/** The server answered a request with ok:false. Carries the structured error shape. */
export class GatewayRequestError extends Error {
  readonly code: GatewayErrorCode;
  readonly details?: unknown;
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;

  constructor(shape: GatewayErrorShape) {
    super(shape.message);
    this.name = "GatewayRequestError";
    this.code = shape.code;
    this.details = shape.details;
    this.retryable = shape.retryable;
    this.retryAfterMs = shape.retryAfterMs;
  }
}

/** The connection closed (or the client stopped) while the request was in flight or queued. Never replayed. */
export class GatewayClosedError extends Error {
  constructor(message = "Gateway connection closed") {
    super(message);
    this.name = "GatewayClosedError";
  }
}

/** A request was made while the client was not ready and did not opt into queueUntilReady. */
export class GatewayNotReadyError extends Error {
  constructor(message = "Gateway is not ready") {
    super(message);
    this.name = "GatewayNotReadyError";
  }
}

export class GatewayTimeoutError extends Error {
  constructor(readonly method: string, readonly timeoutMs: number) {
    super(`Gateway request ${method} timed out after ${timeoutMs}ms`);
    this.name = "GatewayTimeoutError";
  }
}

export class GatewayAbortError extends Error {
  constructor(readonly method: string) {
    super(`Gateway request ${method} was aborted`);
    this.name = "GatewayAbortError";
  }
}

/** The server answered with a payload that does not match the catalogue's result schema. */
export class GatewayResultError extends Error {
  constructor(readonly method: string, readonly issues: unknown) {
    super(`Gateway result for ${method} failed validation`);
    this.name = "GatewayResultError";
  }
}
