"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { isTrustedIpcSender, assertTrustedIpcSender } = require("./desktopIpcSecurity.cjs");

function fixture(url = "http://localhost:5052/") {
  const webContents = { getURL: () => url };
  const mainWindow = { webContents, isDestroyed: () => false };
  const top = {};
  const event = { sender: webContents, senderFrame: { url, top: null } };
  event.senderFrame.top = event.senderFrame;
  return { event, mainWindow };
}

test("desktop IPC accepts only the active LiOS top-level renderer origin", () => {
  const trusted = fixture();
  assert.equal(isTrustedIpcSender(trusted.event, trusted.mainWindow, 5052), true);

  const foreign = fixture("https://evil.example/");
  assert.equal(isTrustedIpcSender(foreign.event, foreign.mainWindow, 5052), false);

  const wrongPort = fixture("http://localhost:5999/");
  assert.equal(isTrustedIpcSender(wrongPort.event, wrongPort.mainWindow, 5052), false);

  const trustedAgain = fixture();
  trustedAgain.event.sender = { getURL: () => "http://localhost:5052/" };
  assert.equal(isTrustedIpcSender(trustedAgain.event, trustedAgain.mainWindow, 5052), false);
});

test("desktop IPC rejects subframes and malformed senders", () => {
  const child = fixture();
  child.event.senderFrame.top = {};
  assert.equal(isTrustedIpcSender(child.event, child.mainWindow, 5052), false);
  assert.throws(() => assertTrustedIpcSender(child.event, child.mainWindow, 5052), /rejected/i);
  assert.equal(isTrustedIpcSender(null, child.mainWindow, 5052), false);
});
