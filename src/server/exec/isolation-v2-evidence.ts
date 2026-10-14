export type IsolationV2Status = "pass" | "fail" | "unavailable";

export interface IsolationV2Check {
  id: string;
  required: boolean;
  status: IsolationV2Status;
  detail: string;
  evidence?: Record<string, unknown>;
}

export interface IsolationV2Evidence {
  schemaVersion: "2";
  generatedAt: string;
  target: {
    platform: NodeJS.Platform;
    arch: string;
    node: string;
    engine: "docker" | "podman";
    engineTarget: string;
    image: string;
  };
  checks: readonly Readonly<IsolationV2Check>[];
  summary: {
    passed: number;
    failed: number;
    unavailable: number;
    requiredPassed: number;
    requiredFailed: number;
  };
}

export function buildIsolationV2Evidence(input: {
  engine: "docker" | "podman";
  engineTarget: string;
  image: string;
  checks: IsolationV2Check[];
  now?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  node?: string;
}): IsolationV2Evidence {
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
    schemaVersion: "2",
    generatedAt: input.now ?? new Date().toISOString(),
    target: Object.freeze({
      platform: input.platform ?? process.platform,
      arch: input.arch ?? process.arch,
      node: input.node ?? process.version,
      engine: input.engine,
      engineTarget: input.engineTarget,
      image: input.image,
    }),
    checks: Object.freeze(checks),
    summary: Object.freeze(summary),
  });
}

export function assertIsolationV2Accepted(evidence: IsolationV2Evidence): void {
  if (!evidence.target.engineTarget.startsWith("unix:///")) {
    throw new Error("SI-01.12 V2 acceptance requires an explicit local unix:// engine target.");
  }
  if (evidence.target.platform !== "darwin") {
    throw new Error(
      `SI-01.12 V2 acceptance must run on the macOS target; observed ${evidence.target.platform}-${evidence.target.arch}.`,
    );
  }
  if (evidence.summary.requiredFailed > 0) {
    const failed = evidence.checks
      .filter((check) => check.required && check.status !== "pass")
      .map((check) => `${check.id}=${check.status}`)
      .join(", ");
    throw new Error(`SI-01.12 V2 required checks did not pass: ${failed}.`);
  }
}
