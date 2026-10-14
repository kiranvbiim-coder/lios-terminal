export type OfflineV2Status = "pass" | "fail" | "unavailable";

export interface OfflineV2Check {
  id: string;
  required: boolean;
  status: OfflineV2Status;
  detail: string;
  evidence?: Record<string, unknown>;
}

export interface OfflineV2Evidence {
  schemaVersion: "1";
  generatedAt: string;
  target: {
    baseUrl: string;
    hostname: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  checks: readonly Readonly<OfflineV2Check>[];
  summary: {
    passed: number;
    failed: number;
    unavailable: number;
    requiredPassed: number;
    requiredFailed: number;
  };
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function buildOfflineV2Evidence(input: {
  baseUrl: string;
  checks: OfflineV2Check[];
  now?: string;
  platform?: NodeJS.Platform;
  arch?: string;
}): OfflineV2Evidence {
  const target = new URL(input.baseUrl);
  const checks = input.checks.map((check) => Object.freeze({
    ...check,
    evidence: check.evidence ? Object.freeze({ ...check.evidence }) : undefined,
  }));
  const summary = {
    passed: checks.filter((check) => check.status === "pass").length,
    failed: checks.filter((check) => check.status === "fail").length,
    unavailable: checks.filter((check) => check.status === "unavailable").length,
    requiredPassed: checks.filter((check) => check.required && check.status === "pass").length,
    requiredFailed: checks.filter((check) => check.required && check.status !== "pass").length,
  };
  return Object.freeze({
    schemaVersion: "1",
    generatedAt: input.now ?? new Date().toISOString(),
    target: Object.freeze({
      baseUrl: input.baseUrl.replace(/\/$/, ""),
      hostname: target.hostname,
      platform: input.platform ?? process.platform,
      arch: input.arch ?? process.arch,
    }),
    checks: Object.freeze(checks),
    summary: Object.freeze(summary),
  });
}

export function assertOfflineV2Accepted(evidence: OfflineV2Evidence): void {
  if (!LOOPBACK.has(evidence.target.hostname)) {
    throw new Error(
      `SI-01.15 offline V2 must target Desktop Local loopback, got ${evidence.target.hostname}.`,
    );
  }
  if (evidence.summary.requiredFailed > 0) {
    const failed = evidence.checks
      .filter((check) => check.required && check.status !== "pass")
      .map((check) => `${check.id}=${check.status}`)
      .join(", ");
    throw new Error(`SI-01.15 offline V2 required checks did not pass: ${failed}.`);
  }
}
