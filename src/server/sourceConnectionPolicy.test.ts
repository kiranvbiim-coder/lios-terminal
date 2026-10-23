import test from "node:test";
import assert from "node:assert/strict";
import { fetchWithEndpointPolicy, isDesktopMcpLoopbackEndpoint, normalizeSourceConfig, readBoundedText, sanitizeSourceConfig, validateMcpSourceEndpoint, validateSourceEndpoint } from "./sourceConnectionPolicy";

test("source endpoint policy accepts HTTPS endpoints and strips fragments", async () => {
  const publicResolver = async () => ["203.0.113.10"];
  const result = await validateSourceEndpoint("https://data.example.test/api#secret", false, publicResolver);
  assert.equal(result.valid, true);
  assert.equal(result.normalizedEndpoint, "https://data.example.test/api");
});

test("source endpoint policy rejects unsupported protocols and embedded credentials", async () => {
  assert.equal((await validateSourceEndpoint("ftp://data.example.test", false)).reason, "unsupported_protocol");
  assert.equal((await validateSourceEndpoint("https://user:pass@data.example.test", false)).reason, "embedded_credentials");
  assert.equal((await validateSourceEndpoint("not-a-url", false)).reason, "invalid_url");
});

test("remote HTTP endpoints are rejected even when local sources are allowed", async () => {
  const insecure = await validateSourceEndpoint("http://api.example.test/v1", true);
  assert.equal(insecure.valid, false);
  assert.equal(insecure.reason, "insecure_remote_endpoint");
});

test("source endpoint policy blocks private hosts for hosted mode but allows loopback HTTP locally", async () => {
  assert.equal((await validateSourceEndpoint("http://127.0.0.1:9000", false)).reason, "private_host_blocked");
  assert.equal((await validateSourceEndpoint("http://10.0.0.4", false)).reason, "private_host_blocked");
  assert.equal((await validateSourceEndpoint("https://[fd00::1]/v1", false)).reason, "private_host_blocked");
  assert.equal((await validateSourceEndpoint("http://localhost:9000", true)).valid, true);
  assert.equal((await validateSourceEndpoint("http://127.0.0.1:9000", true)).valid, true);
});

test("source endpoint policy blocks DNS names that resolve to a blocked address when local sources are not allowed", async () => {
  // rebindingResolver simulates DNS rebinding: an ordinary-looking public
  // hostname that resolves to a private/blocked address at request time,
  // which the string-only isLocalOrPrivateHost check above cannot catch.
  const rebindingResolver = async () => ["10.0.0.5"];
  const rebound = await validateSourceEndpoint("https://attacker.example.test", false, rebindingResolver);
  assert.equal(rebound.reason, "private_host_blocked");

  // An unresolvable hostname fails closed rather than passing through as
  // an unverified public destination.
  const unresolvable = async () => { throw new Error("ENOTFOUND"); };
  const notFound = await validateSourceEndpoint("https://nowhere.example.test", false, unresolvable);
  assert.equal(notFound.reason, "private_host_blocked");

  // A hostname that genuinely resolves only to public addresses is allowed.
  const publicResolver = async () => ["203.0.113.20"];
  const allowed = await validateSourceEndpoint("https://vendor.example.test", false, publicResolver);
  assert.equal(allowed.valid, true);
});



test("GM20 MCP permits explicit desktop loopback but never a hosted Home loopback", async () => {
  const publicResolver = async () => ["203.0.113.42"];
  const loopbacks = ["http://localhost:3010/mcp", "http://127.0.0.1:3010/mcp", "http://[::1]:3010/mcp"];
  for (const url of loopbacks) {
    assert.equal(isDesktopMcpLoopbackEndpoint(url, "desktop_local"), true);
    assert.equal(isDesktopMcpLoopbackEndpoint(url, "user_home_server"), false);
    const desktop = await validateMcpSourceEndpoint(url, "desktop_local", publicResolver);
    assert.equal(desktop.valid, true, url);
    assert.equal(desktop.normalizedEndpoint?.includes("localhost"), false, "localhost must not be resolved via DNS");
    const hosted = await validateMcpSourceEndpoint(url, "user_home_server", publicResolver);
    assert.equal(hosted.valid, false);
    assert.equal(hosted.reason, "private_host_blocked");
  }
});

test("GM20 desktop MCP rejects private LAN, alternate loopback and DNS-to-private hosts", async () => {
  const privateResolver = async () => ["10.0.0.4"];
  const aliases = [
    "http://127.0.0.2:5000/mcp",
    "http://10.0.0.4:5000/mcp",
    "https://192.168.1.2/mcp",
    "https://mcp-private.example.test/mcp",
  ];
  for (const endpoint of aliases) {
    const result = await validateMcpSourceEndpoint(endpoint, "desktop_local", privateResolver);
    assert.equal(result.valid, false, endpoint);
  }
  assert.equal((await validateMcpSourceEndpoint(
    "https://203.0.113.2/mcp", "desktop_local", privateResolver,
  )).valid, true, "public HTTPS MCP remains permitted under existing source policy");
  assert.equal((await validateMcpSourceEndpoint(
    "http://203.0.113.2/mcp", "desktop_local", privateResolver,
  )).valid, false, "remote HTTP never inherits local exceptions");
});

test("GM20 MCP normalization is independent of database configuration and uses canonical runtime mode", async () => {
  const previousHost = process.env.HOST;
  const previousDatabase = process.env.DATABASE_URL;
  try {
    delete process.env.HOST;
    process.env.DATABASE_URL = "postgres://local-owner-db";
    const result = await normalizeSourceConfig("mcp", {
      endpoint: "http://localhost:3010/mcp",
      label: "User-owned local MCP",
    });
    assert.equal(result.endpoint, "http://127.0.0.1:3010/mcp");
    process.env.HOST = "0.0.0.0";
    const rejected = await validateMcpSourceEndpoint("http://localhost:3010/mcp");
    assert.equal(rejected.valid, false, "exposed Home cannot contact its own loopback through MCP");
  } finally {
    if (previousHost === undefined) delete process.env.HOST;
    else process.env.HOST = previousHost;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
  }
});

test("source config sanitization removes secret-shaped fields", () => {
  const sanitized = sanitizeSourceConfig({
    endpoint: "https://example.test",
    apiKey: "secret",
    password: "secret",
    authorization: "Bearer secret",
    database: "lios",
  });
  assert.deepEqual(sanitized, { endpoint: "https://example.test", database: "lios" });
});

test("source config normalization preserves safe metadata and normalizes endpoint", async () => {
  const normalized = await normalizeSourceConfig("private_api", { endpoint: "https://example.test/api#fragment", label: "ERP" });
  assert.equal(normalized.sourceType, "private_api");
  assert.equal(normalized.endpoint, "https://example.test/api");
  assert.equal(normalized.label, "ERP");
});

test("endpoint redirect policy refuses to forward sensitive headers across origins", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, {
    status: 302,
    headers: { location: "https://other.example.test/next" },
  })) as typeof fetch;
  try {
    await assert.rejects(
      () => fetchWithEndpointPolicy("https://source.example.test/start", {
        headers: { Authorization: "Bearer secret" },
      }, true),
      /credentials across origins/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GM20 endpoint-pinned source requests never follow redirects even within the same origin", async () => {
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Response(null, {
      status: 307,
      headers: { location: "/different-path" },
    });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => fetchWithEndpointPolicy("https://8.8.8.8/mcp", {
        method: "POST",
        headers: { Authorization: "Bearer test-only-secret" },
        body: JSON.stringify({ action: "read" }),
      }, false, 0),
      /redirect safety limit/i,
    );
    assert.deepEqual(seen, ["https://8.8.8.8/mcp"],
      "exact-endpoint MCP mode cannot transmit credentials or request body to redirect target");
    await assert.rejects(() => fetchWithEndpointPolicy("https://8.8.8.8/mcp", {}, false, 6),
      /Invalid source redirect limit/i);
    assert.equal(seen.length, 1, "invalid redirect policy fails before any network request");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bounded response reader aborts while streaming once the byte limit is exceeded", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("12345"));
      controller.enqueue(encoder.encode("67890"));
      controller.close();
    },
  });
  await assert.rejects(
    () => readBoundedText(new Response(body), 8),
    /safety limit/i,
  );
});
