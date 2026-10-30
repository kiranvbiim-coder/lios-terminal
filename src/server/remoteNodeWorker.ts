import os from "node:os";
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { REMOTE_DIAGNOSIS_CAPABILITY, REMOTE_FINANCE_CAPABILITY, remoteOperationBindingSchema, remoteDiagnosisReportSchema, remoteNodeMethods, type RemoteOperationOutcome, type RemoteFinanceSource } from "@shared/remoteNode";
import { GatewayClient } from "../client/src/lib/gateway/gatewayClient";
import type { DeviceIdentity } from "../client/src/lib/gateway/deviceIdentity";
import { createPinnedDeviceSocket } from "./pinnedDeviceSocket";
import { executeNodeLocalFinanceSnapshot, loadNodeLocalFinanceSource, type NodeLocalFinanceConfiguration } from "./remoteNodeFinance";

/** Adapted fixed-home-volume statfs mechanism: OpenClaw c074824a src/node-host/host-stats.ts and src/infra/disk-space.ts (MIT). */
function readHomeVolumeCapacity() {
  try {
    const stats = fs.statfsSync(os.homedir(), { bigint: true });
    if (stats.bsize <= 0n || stats.blocks < 0n || stats.bavail < 0n) return null;
    const total = stats.bsize * stats.blocks;
    const available = stats.bsize * stats.bavail;
    if (available > total || total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return { scope: "node-home-volume" as const, totalBytes: Number(total), availableBytes: Number(available) };
  } catch { return null; }
}

/** Closed OS/volume-metadata executor. No file contents/listing, caller paths,
 * environment disclosure, network providers, child processes, inference or GPU claims. */
export function readNodeRuntimeDiagnosis() {
  return remoteDiagnosisReportSchema.parse({
    platform: os.platform(), architecture: os.arch(), nodeVersion: process.version,
    logicalCpuCount: os.cpus().length, totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(),
    diskHomeVolume: readHomeVolumeCapacity(),
    observedAt: new Date().toISOString(), execution: "synchronous-node-os-volume-read-no-subprocess",
  });
}

/** One signed/pinned connection generation; loss stops the worker. Restart is
 * explicit and never replays a lost operation/result on a new generation. */
export function startRemoteNodeWorker(options: {
  url: string;
  fingerprint: string;
  identity: DeviceIdentity;
  signal?: AbortSignal;
  finance?: NodeLocalFinanceConfiguration;
}) {
  const client = new GatewayClient({
    url: options.url, WebSocketImpl: createPinnedDeviceSocket(options.fingerprint), scopes: ["read"],
    clientInfo: { id: "lios-closed-read-node-worker", version: "2", platform: process.platform, mode: "service" },
    device: { identity: options.identity, capabilities: options.finance ? [REMOTE_DIAGNOSIS_CAPABILITY, REMOTE_FINANCE_CAPABILITY] : [REMOTE_DIAGNOSIS_CAPABILITY], commands: options.finance ? [REMOTE_DIAGNOSIS_CAPABILITY, REMOTE_FINANCE_CAPABILITY] : [REMOTE_DIAGNOSIS_CAPABILITY] },
  });
  const controller = new AbortController();
  const stop = () => { controller.abort(); client.stop(); };
  let started = false;
  let settled = false;
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const done = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
  const finish = (error?: unknown) => {
    if (settled) return;
    settled = true;
    stop();
    options.signal?.removeEventListener("abort", abort);
    if (error) reject(error); else resolve();
  };
  const abort = () => finish();
  client.onState((state) => {
    if (state === "reconnecting" || state === "failed") finish(new Error("Paired node connection lost; no replay or Home fallback occurred."));
  });
  client.onReady(() => {
    if (started) { finish(new Error("A node worker cannot migrate an operation to a new connection generation.")); return; }
    started = true;
    void (async () => {
      while (!controller.signal.aborted) {
        let financeSources: RemoteFinanceSource[] = [];
        if (options.finance) {
          try { financeSources = [(await loadNodeLocalFinanceSource(options.finance)).source]; }
          catch { /* A missing/changed/unapproved source is not offered for admission. */ }
        }
        const response = remoteNodeMethods["node.operation.poll"].result.parse(await client.requestRaw("node.operation.poll", { capability: REMOTE_DIAGNOSIS_CAPABILITY, financeSources }, { timeoutMs: 5000 }));
        if (controller.signal.aborted) return;
        if (response.generationId !== client.hello?.server.connId) throw new Error("Node poll generation does not match the pinned connection.");
        if (response.operation) {
          const binding = remoteOperationBindingSchema.parse(response.operation);
          if (binding.deviceId !== options.identity.id || binding.generationId !== response.generationId || Date.now() >= Date.parse(binding.expiresAt)) throw new Error("Node operation target or deadline is invalid.");
          let report: RemoteOperationOutcome["report"] = null;
          let failure: "source-unavailable" | undefined;
          if (binding.capability === REMOTE_FINANCE_CAPABILITY) {
            try {
              if (!options.finance || options.finance.sourceId !== binding.source.sourceId) throw new Error("The requested source is not configured on this node.");
              report = await executeNodeLocalFinanceSnapshot(options.finance, binding.source);
            } catch { failure = "source-unavailable"; }
          } else { report = readNodeRuntimeDiagnosis(); }
          // No child process exists. A failed RPC never proves remote execution
          // or extinction, and results are never replayed after connection loss.
          if (controller.signal.aborted || Date.now() >= Date.parse(binding.expiresAt)) throw new Error("Node operation result missed its connection or deadline.");
          remoteNodeMethods["node.operation.result"].result.parse(await client.requestRaw("node.operation.result", { binding, report, ...(failure ? { failure } : {}) }, { timeoutMs: 5000 }));
        }
        await sleep(250, undefined, { signal: controller.signal });
      }
    })().catch((error) => { if (!controller.signal.aborted) finish(error); });
  });
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) finish(); else client.start();
  return { done, stop: abort };
}
