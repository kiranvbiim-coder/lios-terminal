import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedWebSocketOrigin } from "./webSocketOrigin";

const req = (headers: Record<string, string>, encrypted = false) => ({ headers, socket: { encrypted } }) as never;

test("the packaged desktop (production, plain loopback HTTP) may open its own WebSocket", () => {
  const savedEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal(isAllowedWebSocketOrigin(req({ origin: "http://localhost:5052", host: "localhost:5052" })), true);
  } finally { if (savedEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedEnv; }
});

test("a page on another site or port is rejected", () => {
  assert.equal(isAllowedWebSocketOrigin(req({ origin: "http://evil.example", host: "localhost:5052" })), false);
  assert.equal(isAllowedWebSocketOrigin(req({ origin: "http://localhost:9999", host: "localhost:5052" })), false);
  assert.equal(isAllowedWebSocketOrigin(req({ origin: "not a url", host: "localhost:5052" })), false);
});

test("the scheme must match what the browser used: TLS socket or trusted proxy header", () => {
  assert.equal(isAllowedWebSocketOrigin(req({ origin: "https://lios.example", host: "lios.example" }, true)), true);
  assert.equal(isAllowedWebSocketOrigin(req({ origin: "https://lios.example", host: "lios.example" }, false)), false, "https page over a plain socket is a mismatch");
  assert.equal(isAllowedWebSocketOrigin(req({ origin: "https://lios.example", host: "lios.example", "x-forwarded-proto": "https" })), true);
  assert.equal(isAllowedWebSocketOrigin(req({ origin: "http://lios.example", host: "lios.example" }, true)), false);
});

test("a handshake with no Origin (not a browser) is left to session authentication", () => {
  assert.equal(isAllowedWebSocketOrigin(req({ host: "localhost:5052" })), true);
});
