import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DataLineageReceipt } from "@shared/universalDataFabric";
import { dataRoot } from "./dataRoot";

const MAX_LOCAL_LINEAGE_BYTES = 5 * 1024 * 1024;

export interface P10OpenLineageEvent {
  eventType: "COMPLETE";
  eventTime: string;
  producer: string;
  schemaURL: string;
  run: {
    runId: string;
    facets: {
      lios: {
        schemaVersion: "1";
        requestIdPresent: boolean;
        projectScoped: boolean;
        pointInTimeMode: string;
      };
    };
  };
  job: {
    namespace: "lios";
    name: string;
    facets: {
      capability: { value: string };
      entityFingerprint: { value: string };
    };
  };
  inputs: Array<{ namespace: "lios-ref"; name: string; facets: Record<string, unknown> }>;
  outputs: Array<{ namespace: "lios-ref"; name: string; facets: Record<string, unknown> }>;
}

function fingerprint(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function dataset(ref: string, contentHash: string | null) {
  return {
    namespace: "lios-ref" as const,
    name: fingerprint(ref),
    facets: {
      liosReference: {
        fingerprint: fingerprint(ref),
        contentHash: contentHash ?? null,
      },
    },
  };
}

export function dataLineageReceiptToOpenLineage(receipt: DataLineageReceipt): P10OpenLineageEvent {
  const first = receipt.stages[0];
  const last = receipt.stages.at(-1)!;
  return {
    eventType: "COMPLETE",
    eventTime: receipt.createdAt,
    producer: "https://limuriaintelligence.com/lios",
    schemaURL: "https://openlineage.io/spec/2-0-2/OpenLineage.json",
    run: {
      runId: receipt.id,
      facets: {
        lios: {
          schemaVersion: "1",
          requestIdPresent: Boolean(receipt.requestId),
          projectScoped: receipt.projectId !== null,
          pointInTimeMode: receipt.pointInTime.mode,
        },
      },
    },
    job: {
      namespace: "lios",
      name: "data." + receipt.capability,
      facets: {
        capability: { value: receipt.capability },
        entityFingerprint: { value: fingerprint(receipt.entityRef) },
      },
    },
    inputs: first.inputRefs.map((ref) => dataset(ref, first.contentHash)),
    outputs: last.outputRefs.map((ref) => dataset(ref, last.contentHash)),
  };
}

export function p10OpenLineageConfig(env: NodeJS.ProcessEnv = process.env): {
  localEnabled: boolean;
  remoteEnabled: boolean;
  endpoint: string | null;
  reason: string;
} {
  const localEnabled = env.LIOS_OPENLINEAGE_LOCAL_ENABLED !== "false";
  if (env.LIOS_OPENLINEAGE_REMOTE_ENABLED !== "true") {
    return { localEnabled, remoteEnabled: false, endpoint: null, reason: "Remote OpenLineage export is disabled by default." };
  }
  if (env.LIOS_OPENLINEAGE_REMOTE_CONFIRMATION !== "fingerprinted-only") {
    return { localEnabled, remoteEnabled: false, endpoint: null, reason: "Remote OpenLineage export requires fingerprinted-only confirmation." };
  }
  const raw = env.OPENLINEAGE_URL?.trim();
  if (!raw) return { localEnabled, remoteEnabled: false, endpoint: null, reason: "OPENLINEAGE_URL is not configured." };
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const localhost = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (parsed.protocol !== "https:" && !(localhost && parsed.protocol === "http:")) {
      return { localEnabled, remoteEnabled: false, endpoint: null, reason: "OpenLineage endpoint must use HTTPS except localhost development." };
    }
    return { localEnabled, remoteEnabled: true, endpoint: parsed.toString().replace(/\/$/, ""), reason: "Explicit fingerprinted OpenLineage export enabled." };
  } catch {
    return { localEnabled, remoteEnabled: false, endpoint: null, reason: "OPENLINEAGE_URL is invalid." };
  }
}

function localPath(): string {
  return path.join(dataRoot(), "lineage", "openlineage-events.ndjson");
}

function writeLocal(event: P10OpenLineageEvent, env: NodeJS.ProcessEnv): void {
  const config = p10OpenLineageConfig(env);
  if (!config.localEnabled) return;
  try {
    const file = localPath();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (fs.existsSync(file) && fs.statSync(file).size >= MAX_LOCAL_LINEAGE_BYTES) {
      const rotated = file + ".1";
      fs.rmSync(rotated, { force: true });
      fs.renameSync(file, rotated);
    }
    fs.appendFileSync(file, JSON.stringify(event) + "\n", { encoding: "utf8", mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
  } catch {
    // Optional interoperability must never break canonical lineage persistence.
  }
}

export async function emitP10OpenLineageReceipt(
  receipt: DataLineageReceipt,
  fetchFn: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const event = dataLineageReceiptToOpenLineage(receipt);
  writeLocal(event, env);
  const config = p10OpenLineageConfig(env);
  if (!config.remoteEnabled || !config.endpoint) return false;
  try {
    const response = await fetchFn(config.endpoint + "/api/v1/lineage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const P10_OPENLINEAGE_CONTRACT = Object.freeze({
  canonicalSource: "LiOS P5 DataLineageReceipt",
  authoritative: false,
  localEnabledByDefault: true,
  remoteEnabledByDefault: false,
  remoteReferencesFingerprinted: true,
  boundedLocalFileBytes: MAX_LOCAL_LINEAGE_BYTES,
});
