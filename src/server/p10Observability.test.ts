import assert from "node:assert/strict";
import test from "node:test";
import {
  P10_OBSERVABILITY_PRIVACY_CONTRACT,
  p10RecordToOtlp,
  p10RemoteObservabilityConfig,
  p10SafeHttpRoute,
  sanitizeP10ObservabilityAttributes,
} from "./p10Observability";

test("P10 observability strips credential and content-shaped fields", () => {
  const safe = sanitizeP10ObservabilityAttributes({
    httpMethod: "GET",
    latencyMs: 123,
    apiKey: "secret",
    authorization: "Bearer abcdefghijklmnop",
    prompt: "private prompt",
    provider: "lse",
    detail: "api_key=supersecret",
  });
  assert.equal(safe.httpMethod, "GET");
  assert.equal(safe.latencyMs, 123);
  assert.equal(safe.provider, "lse");
  assert.equal("apiKey" in safe, false);
  assert.equal("authorization" in safe, false);
  assert.equal("prompt" in safe, false);
  assert.equal(safe.detail, "[REDACTED]");
});

test("P10 observability drops nested objects even under a safe attribute name", () => {
  const safe = sanitizeP10ObservabilityAttributes({
    operation: "refresh",
    metadata: { cookie: "session=private", prompt: "client question", safe: true },
    tags: ["public", "private"],
  });
  assert.deepEqual(safe, { operation: "refresh" });
});

test("P10 remote observability is off by default and requires explicit redacted-only confirmation", () => {
  assert.equal(p10RemoteObservabilityConfig({}).enabled, false);
  assert.equal(p10RemoteObservabilityConfig({
    LIOS_OBSERVABILITY_REMOTE_ENABLED: "true",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.com",
  }).enabled, false);
  assert.equal(p10RemoteObservabilityConfig({
    LIOS_OBSERVABILITY_REMOTE_ENABLED: "true",
    LIOS_OBSERVABILITY_REMOTE_CONFIRMATION: "redacted-only",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.example.com",
  }).enabled, false);
  assert.equal(p10RemoteObservabilityConfig({
    LIOS_OBSERVABILITY_REMOTE_ENABLED: "true",
    LIOS_OBSERVABILITY_REMOTE_CONFIRMATION: "redacted-only",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.com",
  }).enabled, true);
});

test("P10 records translate into OTLP JSON trace/metric/log envelopes", () => {
  const base = {
    schemaVersion: "1" as const,
    service: "lios-terminal" as const,
    name: "unit.test",
    at: "2026-09-23T00:00:00.000Z",
    attributes: { operation: "test" },
  };
  const trace = p10RecordToOtlp({
    ...base,
    signal: "trace",
    traceId: "1".repeat(32),
    spanId: "2".repeat(16),
    startedAt: "2026-09-23T00:00:00.000Z",
    endedAt: "2026-09-23T00:00:00.050Z",
    durationMs: 50,
    status: "ok",
  });
  const metric = p10RecordToOtlp({ ...base, signal: "metric", value: 1 });
  const log = p10RecordToOtlp({ ...base, signal: "log", level: "info" });
  assert.equal(trace.path, "/v1/traces");
  assert.equal(metric.path, "/v1/metrics");
  assert.equal(log.path, "/v1/logs");
  assert.match(JSON.stringify(trace.body), /lios\.privacy\.mode/);
});

test("P10 privacy contract remains local/redacted by default", () => {
  assert.equal(P10_OBSERVABILITY_PRIVACY_CONTRACT.localOnlyByDefault, true);
  assert.equal(P10_OBSERVABILITY_PRIVACY_CONTRACT.storesRawPromptContent, false);
  assert.equal(P10_OBSERVABILITY_PRIVACY_CONTRACT.storesRequestBodies, false);
  assert.equal(P10_OBSERVABILITY_PRIVACY_CONTRACT.storesCredentials, false);
});


test("P10 encodes OTLP trace identifiers as JSON byte fields", () => {
  const traceId = "00112233445566778899aabbccddeeff";
  const spanId = "0011223344556677";
  const payload = p10RecordToOtlp({
    schemaVersion: "1",
    signal: "trace",
    service: "lios-terminal",
    name: "runtime.test",
    at: "2026-09-23T00:00:01.000Z",
    traceId,
    spanId,
    parentSpanId: null,
    startedAt: "2026-09-23T00:00:00.000Z",
    endedAt: "2026-09-23T00:00:01.000Z",
    status: "ok",
    attributes: {},
  });
  const span = ((payload.body as any).resourceSpans[0].scopeSpans[0].spans[0]);
  assert.equal(span.traceId, Buffer.from(traceId, "hex").toString("base64"));
  assert.equal(span.spanId, Buffer.from(spanId, "hex").toString("base64"));
});


test("P10 HTTP observability prefers route templates and redacts dynamic fallback identifiers", () => {
  assert.equal(
    p10SafeHttpRoute({
      raw: "/api/projects/42/automation/workflows/550e8400-e29b-41d4-a716-446655440000?token=secret",
      routePath: "/api/projects/:projectId/automation/workflows/:workflowId",
    }),
    "/api/projects/:projectId/automation/workflows/:workflowId",
  );
  assert.equal(
    p10SafeHttpRoute({
      raw: "/api/projects/42/automation/workflows/550e8400-e29b-41d4-a716-446655440000?token=secret",
    }),
    "/api/projects/:id/automation/workflows/:uuid",
  );
});
