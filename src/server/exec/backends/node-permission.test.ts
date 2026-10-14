import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProcessSupervisor } from "../supervisor";
import {
  NODE_PERMISSION_EXECUTION_BACKEND_ID,
  nodePermissionExecutionBackend,
} from "./node-permission";
import { ExecutionBackendUnavailableError } from "./types";
import type { ExecutionBackendRequest } from "./types";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-node-permission-"));
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "inside.txt"), "inside");
  return { root, workspace };
}

function request(
  workspace: string,
  code: string,
  isolation: ExecutionBackendRequest["isolation"] = {
    filesystem: "none",
    network: "deny",
    processes: "deny-child-process",
  },
): ExecutionBackendRequest {
  return {
    argv: [process.execPath, "-e", code],
    cwd: workspace,
    isolation,
    resources: { maxWallTimeMs: 5_000, maxCapturedOutputChars: 32_768 },
  };
}

async function run(requestValue: ExecutionBackendRequest) {
  const plan = await nodePermissionExecutionBackend.prepare(requestValue);
  const supervisor = createProcessSupervisor();
  try {
    const managed = await supervisor.spawn(plan.spawn);
    const result = await managed.wait();
    await managed.waitForExtinction?.();
    return { plan, result };
  } finally {
    await supervisor.shutdown();
  }
}

test("node-permission backend advertises only isolation it can prove", () => {
  assert.equal(nodePermissionExecutionBackend.id, NODE_PERMISSION_EXECUTION_BACKEND_ID);
  assert.deepEqual(nodePermissionExecutionBackend.capabilities.filesystem, ["none"]);
  assert.deepEqual(nodePermissionExecutionBackend.capabilities.network, ["deny"]);
  assert.deepEqual(nodePermissionExecutionBackend.capabilities.processes, ["deny-child-process"]);
});

test("no-filesystem mode denies workspace reads", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const code = [
    'const fs = require("node:fs");',
    'try { fs.readFileSync("inside.txt", "utf8"); process.exit(41); } catch (error) { if (error?.code !== "ERR_ACCESS_DENIED") throw error; }',
    'process.stdout.write("no-fs");',
  ].join("\n");
  const { result } = await run(request(f.workspace, code));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "no-fs");
});

test("raw network is denied before any socket is opened", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const code = [
    'const net = require("node:net");',
    'try { net.connect({ host: "127.0.0.1", port: 9 }); process.exit(41); } catch (error) {',
    '  if (error?.code !== "ERR_ACCESS_DENIED") throw error;',
    '}',
    'process.stdout.write("network-denied");',
  ].join("\n");
  const { result } = await run(request(f.workspace, code));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "network-denied");
});

test("representative Node network surfaces and worker creation fail closed", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const code = [
    '(async () => {',
    '  const expectDenied = async (label, action) => {',
    '    try { await action(); throw new Error(`unexpected allow: ${label}`); }',
    '    catch (error) { if (error?.code !== "ERR_ACCESS_DENIED") throw error; }',
    '  };',
    '  await expectDenied("fetch", () => fetch("http://127.0.0.1:9"));',
    '  await expectDenied("http", () => require("node:http").get("http://127.0.0.1:9"));',
    '  await expectDenied("https", () => require("node:https").get("https://127.0.0.1:9"));',
    '  await expectDenied("http2", () => require("node:http2").connect("http://127.0.0.1:9"));',
    '  await expectDenied("tls", () => require("node:tls").connect({ host: "127.0.0.1", port: 9 }));',
    '  await expectDenied("udp", () => require("node:dgram").createSocket("udp4"));',
    '  await expectDenied("dns", () => new Promise((resolve, reject) => require("node:dns").lookup("localhost", (error) => error ? reject(error) : resolve(undefined))));',
    '  await expectDenied("worker", () => { const { Worker } = require("node:worker_threads"); return new Worker("0", { eval: true }); });',
    '  if (globalThis.WebSocket) await expectDenied("websocket", () => new WebSocket("ws://127.0.0.1:9"));',
    '  process.stdout.write("network-surfaces-denied");',
    '})().catch((error) => { console.error(error); process.exit(42); });',
  ].join("\n");
  const { result } = await run(request(f.workspace, code));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "network-surfaces-denied");
});

test("child process creation is denied by the Node permission model", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const code = [
    'const cp = require("node:child_process");',
    'try { cp.execFileSync(process.execPath, ["-e", "process.exit(0)"]); process.exit(41); } catch (error) {',
    '  if (error?.code !== "ERR_ACCESS_DENIED") throw error;',
    '}',
    'process.stdout.write("process-denied");',
  ].join("\n");
  const { result } = await run(request(f.workspace, code));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "process-denied");
});

test("backend refuses workspace filesystem modes, non-inline Node commands and weaker isolation", async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));

  for (const invalid of [
    request(f.workspace, "0", { filesystem: "host", network: "deny", processes: "deny-child-process" }),
    request(f.workspace, "0", { filesystem: "workspace-readonly", network: "deny", processes: "deny-child-process" }),
    request(f.workspace, "0", { filesystem: "workspace-readwrite", network: "deny", processes: "deny-child-process" }),
    request(f.workspace, "0", { filesystem: "none", network: "inherit", processes: "deny-child-process" }),
    request(f.workspace, "0", { filesystem: "none", network: "deny", processes: "host" }),
    { ...request(f.workspace, "0"), argv: [process.execPath, path.join(f.workspace, "script.js")] },
  ]) {
    await assert.rejects(
      () => nodePermissionExecutionBackend.prepare(invalid),
      ExecutionBackendUnavailableError,
    );
  }
});
