import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProcessSupervisor } from "../supervisor";
import { nodePermissionExecutionBackend } from "./node-permission";
import type { ExecutionBackendRequest } from "./types";

function request(cwd: string, code: string): ExecutionBackendRequest {
  return {
    argv: [process.execPath, "-e", code],
    cwd,
    isolation: {
      filesystem: "none",
      network: "deny",
      processes: "deny-child-process",
    },
    resources: { maxWallTimeMs: 5_000, maxCapturedOutputChars: 16_384 },
  };
}

async function run(cwd: string, code: string) {
  const plan = await nodePermissionExecutionBackend.prepare(request(cwd, code));
  const supervisor = createProcessSupervisor();
  try {
    const managed = await supervisor.spawn(plan.spawn);
    const result = await managed.wait();
    await managed.waitForExtinction?.();
    return result;
  } finally {
    await supervisor.shutdown();
  }
}

test("network deny blocks net._createServerHandle before a TCP listener can be created", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-node-net-internals-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const code = [
    'const net = require("node:net");',
    'try {',
    '  const handle = net._createServerHandle("127.0.0.1", 0, 4, -1, 0);',
    '  handle?.close?.();',
    '  process.exit(41);',
    '} catch (error) {',
    '  if (error?.code !== "ERR_ACCESS_DENIED") throw error;',
    '}',
    'process.stdout.write("tcp-internal-denied");',
  ].join("\n");

  const result = await run(cwd, code);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "tcp-internal-denied");
});

test("network deny blocks dgram._createSocketHandle before a UDP socket can be bound", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-node-net-internals-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const code = [
    'const dgram = require("node:dgram");',
    'try {',
    '  const handle = dgram._createSocketHandle("127.0.0.1", 0, "udp4", -1, 0);',
    '  handle?.close?.();',
    '  process.exit(41);',
    '} catch (error) {',
    '  if (error?.code !== "ERR_ACCESS_DENIED") throw error;',
    '}',
    'process.stdout.write("udp-internal-denied");',
  ].join("\n");

  const result = await run(cwd, code);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "udp-internal-denied");
});
