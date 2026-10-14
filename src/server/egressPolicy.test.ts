import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { createGuardedFetch, createGuardedRequest, EgressBlockedError, evaluateEgress, parseEgressPolicy, type EgressPolicy } from "./egressPolicy";

const policy = (mode: string, allow = ""): EgressPolicy => parseEgressPolicy({ LIOS_EGRESS_MODE: mode, LIOS_EGRESS_ALLOW: allow });
const allowed = (p: EgressPolicy, url: string) => evaluateEgress(new URL(url), p).allowed;

test("policy parsing is strict so a typo cannot leave a Home open", () => {
  assert.equal(parseEgressPolicy({}).mode, "open");
  assert.throws(() => parseEgressPolicy({ LIOS_EGRESS_MODE: "allow-list" }), /must be open, allowlist or offline/);
  assert.throws(() => parseEgressPolicy({ LIOS_EGRESS_ALLOW: "https://api.example.com/v1" }), /not a hostname/);
  assert.throws(() => parseEgressPolicy({ LIOS_EGRESS_ALLOW: "exa mple.com" }), /not a hostname/);
  assert.deepEqual(parseEgressPolicy({ LIOS_EGRESS_ALLOW: "API.Example.com, *.data.example.com, 203.0.113.7, 10.0.0.0/8" }).rules.map((r) => r.kind), ["host", "suffix", "ip", "cidr"]);
});

test("open mode allows the internet and the LAN but never cloud metadata, whatever the spelling", () => {
  const open = policy("open");
  for (const url of ["https://api.openai.com/v1", "http://192.168.1.20:11434/api", "http://10.0.0.5/x"]) assert.equal(allowed(open, url), true, url);
  for (const url of [
    "http://169.254.169.254/latest/meta-data", "http://[::ffff:169.254.169.254]/", "http://[fd00:ec2::254]/",
    "http://metadata.google.internal/computeMetadata/v1", "http://100.100.100.200/", "http://0xa9fea9fe/",
  ]) assert.equal(allowed(open, url), false, url);
  assert.equal(allowed(policy("open", "169.254.169.254"), "http://169.254.169.254/"), true, "an explicit rule is the operator's decision");
});

test("allowlist mode permits only listed hosts, suffixes (not the bare domain), IPs and CIDRs, plus loopback", () => {
  const p = policy("allowlist", "api.openai.com, *.sec.gov, 203.0.113.7, 10.20.0.0/16");
  assert.equal(allowed(p, "https://api.openai.com/v1"), true);
  assert.equal(allowed(p, "https://www.sec.gov/x"), true);
  assert.equal(allowed(p, "https://sec.gov/x"), false);
  assert.equal(allowed(p, "https://evilsec.gov/x"), false);
  assert.equal(allowed(p, "https://api.openai.com.evil.test/"), false);
  assert.equal(allowed(p, "http://203.0.113.7:8080/"), true);
  assert.equal(allowed(p, "http://10.20.5.5/"), true);
  assert.equal(allowed(p, "http://10.21.5.5/"), false);
  assert.equal(allowed(p, "https://example.org/"), false);
  for (const url of ["http://127.0.0.1:5052/", "http://localhost:8000/", "http://[::1]:9/"]) assert.equal(allowed(p, url), true, url);
});

test("offline mode reaches only this machine and explicitly listed local services", () => {
  const p = policy("offline", "192.168.1.20");
  assert.equal(allowed(p, "http://127.0.0.1:8000/"), true);
  assert.equal(allowed(p, "http://192.168.1.20:11434/"), true);
  assert.equal(allowed(p, "https://api.openai.com/"), false);
  assert.equal(allowed(p, "http://192.168.1.21/"), false);
});

function fakeNative(routes: Record<string, { status: number; location?: string }>) {
  const calls: Array<{ url: string; method: string; headers: Headers; body: unknown; redirect: unknown }> = [];
  const native = (async (input: unknown, init?: RequestInit) => {
    const isRequest = typeof input === "object" && input !== null && "url" in (input as object);
    const url = isRequest ? (input as Request).url : String(input);
    calls.push({ url, method: String(init?.method ?? (isRequest ? (input as Request).method : "GET")), headers: new Headers(init?.headers ?? (isRequest ? (input as Request).headers : undefined)), body: init?.body ?? null, redirect: init?.redirect ?? (isRequest ? (input as Request).redirect : undefined) });
    const route = routes[url] ?? { status: 200 };
    return new Response("ok", { status: route.status, headers: route.location ? { location: route.location } : {} });
  }) as typeof fetch;
  return { native, calls };
}

test("allowlist redirects are followed hop by hop and a forbidden hop is never requested", async () => {
  const { native, calls } = fakeNative({
    "https://api.allowed.test/a": { status: 302, location: "https://cdn.allowed.test/b" },
    "https://cdn.allowed.test/b": { status: 302, location: "http://169.254.169.254/latest/meta-data" },
    "https://api.allowed.test/ok": { status: 301, location: "https://cdn.allowed.test/final" },
  });
  const guarded = createGuardedFetch(native, policy("allowlist", "api.allowed.test, cdn.allowed.test"));
  await assert.rejects(guarded("https://api.allowed.test/a"), (error) => error instanceof EgressBlockedError && error.reason === "metadata_blocked");
  assert.deepEqual(calls.map((c) => c.url), ["https://api.allowed.test/a", "https://cdn.allowed.test/b"]);
  assert.ok(calls.every((c) => c.redirect === "manual"), "the guard owns redirect handling");
  const response = await guarded("https://api.allowed.test/ok");
  assert.equal(response.status, 200);
  await assert.rejects(guarded("https://not-listed.test/"), EgressBlockedError);
});

test("redirect semantics follow fetch: 303 becomes GET, 307 keeps the body, credentials do not cross origins", async () => {
  const { native, calls } = fakeNative({
    "https://a.allowed.test/post": { status: 303, location: "https://b.allowed.test/result" },
    "https://a.allowed.test/keep": { status: 307, location: "https://a.allowed.test/kept" },
    "https://a.allowed.test/loop": { status: 302, location: "https://a.allowed.test/loop" },
  });
  const guarded = createGuardedFetch(native, policy("allowlist", "*.allowed.test"));
  await guarded("https://a.allowed.test/post", { method: "POST", body: "payload", headers: { authorization: "Bearer secret", "content-type": "text/plain", "x-keep": "1" } });
  const second = calls[1]!;
  assert.equal(second.method, "GET");
  assert.equal(second.body, null);
  assert.equal(second.headers.get("authorization"), null, "no bearer token to a different origin");
  assert.equal(second.headers.get("content-type"), null);
  assert.equal(second.headers.get("x-keep"), "1");

  calls.length = 0;
  await guarded("https://a.allowed.test/keep", { method: "POST", body: "payload", headers: { authorization: "Bearer secret" } });
  assert.equal(calls[1]!.method, "POST");
  assert.equal(calls[1]!.body, "payload");
  assert.equal(calls[1]!.headers.get("authorization"), "Bearer secret", "same origin keeps credentials");

  await assert.rejects(guarded("https://a.allowed.test/loop"), /too many redirects/);
});

test("a Request input keeps its method and body on the first hop; open mode and non-follow redirects pass straight through", async () => {
  const { native, calls } = fakeNative({});
  const guarded = createGuardedFetch(native, policy("allowlist", "api.allowed.test"));
  await guarded(new Request("https://api.allowed.test/x", { method: "POST", body: "hello", headers: { "content-type": "text/plain" } }));
  assert.equal(calls[0]!.method, "POST");
  const open = createGuardedFetch(native, policy("open"));
  calls.length = 0;
  await open("https://anywhere.test/y", { redirect: "follow" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.redirect, "follow", "open mode does not alter redirect behaviour");
  await assert.rejects(open("http://169.254.169.254/"), EgressBlockedError);
  calls.length = 0;
  await guarded("https://api.allowed.test/z", { redirect: "manual" });
  assert.equal(calls.length, 1);
});

test("node:http requests are held to the same policy in every call shape, and loopback still works", async (t) => {
  const server = http.createServer((_req, res) => res.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = (server.address() as { port: number }).port;
  const guarded = createGuardedRequest(http.request, policy("allowlist", "api.allowed.test"), "http:");

  const body = await new Promise<string>((resolve, reject) => {
    const req = guarded({ hostname: "127.0.0.1", port, path: "/" }, (res) => { let data = ""; res.on("data", (c) => { data += c; }); res.on("end", () => resolve(data)); });
    req.on("error", reject);
    req.end();
  });
  assert.equal(body, "ok");
  assert.throws(() => guarded("http://169.254.169.254/latest/meta-data"), EgressBlockedError);
  assert.throws(() => guarded(new URL("http://not-listed.test/")), EgressBlockedError);
  assert.throws(() => guarded({ host: "not-listed.test", path: "/" }), EgressBlockedError);
  assert.throws(() => guarded({ hostname: "169.254.169.254" }, () => undefined), EgressBlockedError);
  const tls = createGuardedRequest(http.request, policy("offline"), "http:");
  assert.throws(() => tls({ protocol: "https:", hostname: "api.example.com" }), EgressBlockedError);
});
