import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "http";
import { listenWithFallback } from "./listenConfig";

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function occupyRandomPort(): Promise<{ server: Server; port: number }> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
  return { server, port: address.port };
}

test("listenWithFallback fails on an occupied explicit port", async () => {
  const occupied = await occupyRandomPort();
  const target = createServer();
  try {
    await assert.rejects(
      listenWithFallback(target, occupied.port),
      (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE",
    );
  } finally {
    await closeServer(occupied.server);
  }
});

test("listenWithFallback selects a later development port when the preferred port is occupied", async () => {
  const occupied = await occupyRandomPort();
  const target = createServer();
  try {
    const selected = await listenWithFallback(target, occupied.port, { allowFallback: true, maxAdditionalPorts: 20 });
    assert.ok(selected > occupied.port);
  } finally {
    await closeServer(target);
    await closeServer(occupied.server);
  }
});
