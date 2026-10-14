import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { dataRoot } from "./dataRoot";

export type P10ObservabilitySignal = "trace" | "metric" | "log";
export type P10LogLevel = "debug" | "info" | "warn" | "error";

export interface P10ObservabilityRecord {
  schemaVersion: "1";
  signal: P10ObservabilitySignal;
  service: "lios-terminal";
  name: string;
  at: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string | null;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  status?: "ok" | "error";
  value?: number;
  level?: P10LogLevel;
  attributes: Record<string, string | number | boolean | null>;
}

const MAX_LOCAL_BYTES = 5 * 1024 * 1024;
const MAX_ATTRIBUTE_KEYS = 64;
const MAX_ATTRIBUTE_TEXT = 500;
const SECRET_KEY = /(authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential|private[_-]?key|prompt|message|content|body|payload|query)/i;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+\/-]{8,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*\S{6,})/i;

export function p10ObservabilityPath(): string {
  return path.join(dataRoot(), "observability", "otel-events.ndjson");
}

function sanitizeText(value: string): string {
  const trimmed = value.trim().slice(0, MAX_ATTRIBUTE_TEXT);
  if (!trimmed) return "";
  if (SECRET_VALUE.test(trimmed)) return "[REDACTED]";
  return trimmed;
}

export function sanitizeP10ObservabilityAttributes(input: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, rawValue] of Object.entries(input).slice(0, MAX_ATTRIBUTE_KEYS)) {
    const key = rawKey.trim().slice(0, 100);
    if (!key || SECRET_KEY.test(key)) continue;
    if (rawValue === null) output[key] = null;
    else if (typeof rawValue === "string") output[key] = sanitizeText(rawValue);
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) output[key] = rawValue;
    else if (typeof rawValue === "boolean") output[key] = rawValue;
    else if (rawValue instanceof Date) output[key] = rawValue.toISOString();
    // Deliberately reject arrays/objects. Nested structures can hide sensitive
    // keys below an otherwise harmless top-level attribute name.
    else if (rawValue !== undefined) continue;
  }
  return output;
}

function localEnabled(): boolean {
  return process.env.LIOS_OBSERVABILITY_LOCAL_ENABLED !== "false";
}

export function p10RemoteObservabilityConfig(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; endpoint: string | null; reason: string } {
  if (env.LIOS_OBSERVABILITY_REMOTE_ENABLED !== "true") {
    return { enabled: false, endpoint: null, reason: "Remote observability is disabled by default." };
  }
  if (env.LIOS_OBSERVABILITY_REMOTE_CONFIRMATION !== "redacted-only") {
    return { enabled: false, endpoint: null, reason: "Remote observability requires LIOS_OBSERVABILITY_REMOTE_CONFIRMATION=redacted-only." };
  }
  const raw = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!raw) return { enabled: false, endpoint: null, reason: "OTEL_EXPORTER_OTLP_ENDPOINT is not configured." };
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const localhost = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (parsed.protocol !== "https:" && !(localhost && parsed.protocol === "http:")) {
      return { enabled: false, endpoint: null, reason: "OTLP endpoint must use HTTPS, except explicit localhost development." };
    }
    return { enabled: true, endpoint: parsed.toString().replace(/\/$/, ""), reason: "Explicit redacted-only OTLP export is enabled." };
  } catch {
    return { enabled: false, endpoint: null, reason: "OTLP endpoint is invalid." };
  }
}

function rotateIfNeeded(file: string): void {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < MAX_LOCAL_BYTES) return;
    const rotated = file + ".1";
    fs.rmSync(rotated, { force: true });
    fs.renameSync(file, rotated);
  } catch {
    // Observability must never take down the application.
  }
}

export function writeP10ObservabilityRecord(record: P10ObservabilityRecord): void {
  if (!localEnabled()) return;
  try {
    const file = p10ObservabilityPath();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    rotateIfNeeded(file);
    fs.appendFileSync(file, JSON.stringify(record) + "\n", { encoding: "utf8", mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
  } catch {
    // Local diagnostics are non-critical.
  }
}

function nanos(iso: string): string {
  return String(BigInt(new Date(iso).getTime()) * 1_000_000n);
}

function otlpBytesFromHex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) return value;
  return Buffer.from(value, "hex").toString("base64");
}

function otelAttributes(attributes: P10ObservabilityRecord["attributes"]) {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value:
      typeof value === "number" ? { doubleValue: value } :
      typeof value === "boolean" ? { boolValue: value } :
      value === null ? { stringValue: "null" } :
      { stringValue: String(value) },
  }));
}

export function p10RecordToOtlp(record: P10ObservabilityRecord): { path: string; body: Record<string, unknown> } {
  const resource = {
    attributes: [
      { key: "service.name", value: { stringValue: "lios-terminal" } },
      { key: "service.namespace", value: { stringValue: "limuria" } },
      { key: "telemetry.sdk.language", value: { stringValue: "nodejs" } },
      { key: "lios.privacy.mode", value: { stringValue: "redacted" } },
    ],
  };
  if (record.signal === "trace") {
    return {
      path: "/v1/traces",
      body: {
        resourceSpans: [{
          resource,
          scopeSpans: [{
            scope: { name: "lios.p10" },
            spans: [{
              traceId: otlpBytesFromHex(record.traceId),
              spanId: otlpBytesFromHex(record.spanId),
              ...(record.parentSpanId ? { parentSpanId: otlpBytesFromHex(record.parentSpanId) } : {}),
              name: record.name,
              kind: 1,
              startTimeUnixNano: nanos(record.startedAt ?? record.at),
              endTimeUnixNano: nanos(record.endedAt ?? record.at),
              attributes: otelAttributes(record.attributes),
              status: { code: record.status === "error" ? 2 : 1 },
            }],
          }],
        }],
      },
    };
  }
  if (record.signal === "metric") {
    return {
      path: "/v1/metrics",
      body: {
        resourceMetrics: [{
          resource,
          scopeMetrics: [{
            scope: { name: "lios.p10" },
            metrics: [{
              name: record.name,
              gauge: {
                dataPoints: [{
                  asDouble: record.value ?? 0,
                  timeUnixNano: nanos(record.at),
                  attributes: otelAttributes(record.attributes),
                }],
              },
            }],
          }],
        }],
      },
    };
  }
  return {
    path: "/v1/logs",
    body: {
      resourceLogs: [{
        resource,
        scopeLogs: [{
          scope: { name: "lios.p10" },
          logRecords: [{
            timeUnixNano: nanos(record.at),
            severityText: (record.level ?? "info").toUpperCase(),
            body: { stringValue: record.name },
            attributes: otelAttributes(record.attributes),
          }],
        }],
      }],
    },
  };
}

export async function exportP10ObservabilityRecord(
  record: P10ObservabilityRecord,
  fetchFn: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const config = p10RemoteObservabilityConfig(env);
  if (!config.enabled || !config.endpoint) return false;
  const payload = p10RecordToOtlp(record);
  try {
    const response = await fetchFn(config.endpoint + payload.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload.body),
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function emit(record: P10ObservabilityRecord): void {
  writeP10ObservabilityRecord(record);
  if (p10RemoteObservabilityConfig().enabled) {
    void exportP10ObservabilityRecord(record).catch(() => false);
  }
}

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export interface P10Span {
  traceId: string;
  spanId: string;
  end(status?: "ok" | "error", attributes?: Record<string, unknown>): void;
  error(error: unknown, attributes?: Record<string, unknown>): void;
}

export function startP10Span(name: string, attributes: Record<string, unknown> = {}, parent?: { traceId: string; spanId: string } | null): P10Span {
  const startedAt = new Date().toISOString();
  const traceId = parent?.traceId ?? randomHex(16);
  const spanId = randomHex(8);
  let closed = false;
  const close = (status: "ok" | "error", extra: Record<string, unknown>) => {
    if (closed) return;
    closed = true;
    const endedAt = new Date().toISOString();
    const merged = sanitizeP10ObservabilityAttributes({ ...attributes, ...extra });
    emit({
      schemaVersion: "1",
      signal: "trace",
      service: "lios-terminal",
      name: sanitizeText(name).slice(0, 150) || "unnamed",
      at: endedAt,
      traceId,
      spanId,
      parentSpanId: parent?.spanId ?? null,
      startedAt,
      endedAt,
      durationMs: Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime()),
      status,
      attributes: merged,
    });
  };
  return {
    traceId,
    spanId,
    end: (status = "ok", extra = {}) => close(status, extra),
    error: (error, extra = {}) => {
      const value = error instanceof Error ? `${error.name}|${error.message}` : String(error);
      close("error", {
        ...extra,
        errorFingerprint: crypto.createHash("sha256").update(value).digest("hex").slice(0, 24),
        errorType: error instanceof Error ? error.name : typeof error,
      });
    },
  };
}

export async function withP10Span<T>(
  name: string,
  attributes: Record<string, unknown>,
  callback: (span: P10Span) => Promise<T>,
): Promise<T> {
  const span = startP10Span(name, attributes);
  try {
    const result = await callback(span);
    span.end("ok");
    return result;
  } catch (error) {
    span.error(error);
    throw error;
  }
}

export function recordP10Metric(name: string, value: number, attributes: Record<string, unknown> = {}): void {
  if (!Number.isFinite(value)) return;
  emit({
    schemaVersion: "1",
    signal: "metric",
    service: "lios-terminal",
    name: sanitizeText(name).slice(0, 150) || "unnamed",
    at: new Date().toISOString(),
    value,
    attributes: sanitizeP10ObservabilityAttributes(attributes),
  });
}

export function recordP10Log(level: P10LogLevel, name: string, attributes: Record<string, unknown> = {}): void {
  emit({
    schemaVersion: "1",
    signal: "log",
    service: "lios-terminal",
    name: sanitizeText(name).slice(0, 150) || "unnamed",
    at: new Date().toISOString(),
    level,
    attributes: sanitizeP10ObservabilityAttributes(attributes),
  });
}

export function normalizeP10RequestPath(raw: string): string {
  const pathOnly = String(raw || "/").split("?")[0];
  return pathOnly.split("/").map((segment) => {
    if (!segment) return segment;
    if (/^\d+$/.test(segment)) return ":id";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) return ":uuid";
    if (/^[A-Za-z0-9_-]{24,}$/.test(segment)) return ":token";
    return segment.slice(0, 80);
  }).join("/").slice(0, 200) || "/";
}

export function p10SafeHttpRoute(input: { raw: string; routePath?: unknown; baseUrl?: string }): string {
  if (typeof input.routePath === "string" && input.routePath.trim()) {
    return normalizeP10RequestPath((input.baseUrl || "") + input.routePath);
  }
  return normalizeP10RequestPath(input.raw);
}

export function p10ObservabilityMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/health" || req.path === "/api/health") {
    next();
    return;
  }
  const span = startP10Span("http.request", { httpMethod: req.method });
  res.once("finish", () => {
    const status = res.statusCode >= 500 ? "error" : "ok";
    const routePath = (req as Request & { route?: { path?: unknown } }).route?.path;
    const httpRoute = p10SafeHttpRoute({
      raw: req.originalUrl || req.path || "/",
      routePath,
      baseUrl: req.baseUrl,
    });
    span.end(status, { httpStatusCode: res.statusCode, httpRoute });
    recordP10Metric("http.server.request", 1, {
      httpMethod: req.method,
      httpStatusCode: res.statusCode,
      httpRoute,
    });
  });
  next();
}

export const P10_OBSERVABILITY_PRIVACY_CONTRACT = Object.freeze({
  localOnlyByDefault: true,
  remoteRequiresExplicitEnable: true,
  remoteRequiresRedactedOnlyConfirmation: true,
  storesRawPromptContent: false,
  storesRequestBodies: false,
  storesCredentials: false,
  boundedLocalFileBytes: MAX_LOCAL_BYTES,
  openTelemetryCompatibleOtlpJson: true,
});
