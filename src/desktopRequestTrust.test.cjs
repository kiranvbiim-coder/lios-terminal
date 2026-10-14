const assert = require("node:assert/strict");
const test = require("node:test");
const { mayAttachLocalToken } = require("./desktopRequestTrust.cjs");
const local = { webContentsId: 17, port: 5052 };
const details = (url, initiator = "http://localhost:5052") => ({ webContentsId: 17, url, initiator });

test("inject only into main window requests for its own loopback server", () => {
  assert.equal(mayAttachLocalToken(details("http://localhost:5052/api/auth/me"), local), true);
  assert.equal(mayAttachLocalToken(details("ws://localhost:5052/ws"), local), true);
  assert.equal(mayAttachLocalToken(details("http://127.0.0.1:5052/"), local), true);
  assert.equal(mayAttachLocalToken({ webContentsId: 17, url: "http://localhost:5052/" }, local), true, "top-level navigation is allowed");
});

test("never inject for a different window, a malicious initiator, or another port", () => {
  assert.equal(mayAttachLocalToken({ ...details("http://localhost:5052/api/auth/me"), webContentsId: 18 }, local), false);
  assert.equal(mayAttachLocalToken(details("http://localhost:5052/api/auth/me", "https://evil.example"), local), false);
  assert.equal(mayAttachLocalToken(details("http://localhost:5052/api/auth/me", "http://localhost:5052.evil.example"), local), false);
  assert.equal(mayAttachLocalToken(details("http://localhost:5053/api/auth/me"), local), false);
  assert.equal(mayAttachLocalToken(details("https://localhost:5052/api/auth/me"), local), false);
  assert.equal(mayAttachLocalToken(details("http://127.0.0.1:5052/api/auth/me", "http://127.0.0.1:5052"), local), false, "the renderer's canonical origin is localhost");
});

test("invalid URL or initiator is never trusted", () => {
  assert.equal(mayAttachLocalToken(details("not-a-url"), local), false);
  assert.equal(mayAttachLocalToken(details("http://localhost:5052/api", "null"), local), false);
  assert.equal(mayAttachLocalToken(details("http://localhost:5052/api", "data:text/html,hi"), local), false);
});
