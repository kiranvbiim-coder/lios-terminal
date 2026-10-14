"use strict";

function rendererOrigin(port) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("Invalid desktop renderer port.");
  return `http://localhost:${port}`;
}

function isTrustedIpcSender(event, mainWindow, port) {
  if (!event || !mainWindow || mainWindow.isDestroyed?.()) return false;
  if (!event.sender || event.sender !== mainWindow.webContents) return false;

  const frame = event.senderFrame;
  if (frame && frame.top && frame.top !== frame) return false;

  const rawUrl = frame?.url || event.sender.getURL?.() || "";
  try {
    return new URL(rawUrl).origin === rendererOrigin(port);
  } catch {
    return false;
  }
}

function assertTrustedIpcSender(event, mainWindow, port) {
  if (!isTrustedIpcSender(event, mainWindow, port)) {
    throw new Error("Desktop IPC request rejected.");
  }
}

module.exports = { rendererOrigin, isTrustedIpcSender, assertTrustedIpcSender };
