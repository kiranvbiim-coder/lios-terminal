export const SI01_SANDBOX_IMAGE_CONTRACT = Object.freeze({
  schemaVersion: 1,
  nodeVersion: "22.12.0",
  doclingVersion: "2.129.0",
  xlsxVersion: "0.20.3",
  user: "10001:10001",
  browser: Object.freeze({
    playwrightVersion: "1.63.0",
    chromiumRevision: "1243",
    browserVersion: "153.0.8010.12",
    playwrightModule: "/opt/lios/node_modules/playwright-core",
    chromium: "/opt/lios/browser/chromium",
  } as const),
  tools: Object.freeze({
    shell: "/bin/sh",
    base64: "/usr/bin/base64",
    tar: "/bin/tar",
    python: "/usr/bin/python3",
    node: "/usr/bin/node",
    xlsxModule: "/opt/lios/node_modules/xlsx",
  } as const),
} as const);

const IMMUTABLE_NAMED_OCI = /^[a-z0-9][a-z0-9._/:+-]*@sha256:[a-f0-9]{64}$/i;
const LOCAL_IMAGE_ID = /^sha256:[a-f0-9]{64}$/i;

export class SandboxImageContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxImageContractError";
  }
}

export function assertImmutableBaseImage(value: string, label: string): string {
  const normalized = value.trim();
  if (!IMMUTABLE_NAMED_OCI.test(normalized)) {
    throw new SandboxImageContractError(
      `${label} must be a named OCI reference pinned with @sha256:<64 hex>; mutable tags are refused.`,
    );
  }
  return normalized;
}

export function assertLocalSandboxImageId(value: string): string {
  const normalized = value.trim();
  if (!LOCAL_IMAGE_ID.test(normalized)) {
    throw new SandboxImageContractError(
      "Built SI-01 sandbox image must resolve to a local sha256:<64 hex> image id.",
    );
  }
  return normalized;
}

export function assertLocalEngineTarget(value: string): string {
  const normalized = value.trim();
  let target: URL;
  try {
    target = new URL(normalized);
  } catch {
    throw new SandboxImageContractError("Sandbox image build requires an explicit local unix:// engine target.");
  }
  if (
    target.protocol !== "unix:" ||
    target.hostname ||
    target.username ||
    target.password ||
    target.port ||
    target.search ||
    target.hash ||
    !decodeURIComponent(target.pathname).startsWith("/")
  ) {
    throw new SandboxImageContractError("Sandbox image build requires an explicit local unix:// engine target.");
  }
  return target.href;
}

export interface SandboxImageBuildInputs {
  engine: "docker" | "podman";
  engineTarget: string;
  tag: string;
}

export function sandboxImageBuildInputs(
  env: NodeJS.ProcessEnv = process.env,
  tag = "lios-si01-sandbox:local",
): SandboxImageBuildInputs {
  const engine = env.LIOS_EXECUTION_SANDBOX_ENGINE?.trim().toLowerCase();
  if (engine !== "docker" && engine !== "podman") {
    throw new SandboxImageContractError(
      "LIOS_EXECUTION_SANDBOX_ENGINE must be docker or podman for the SI-01 image build.",
    );
  }
  const target = env.LIOS_EXECUTION_SANDBOX_TARGET?.trim();
  if (!target) {
    throw new SandboxImageContractError(
      "SI-01 image build requires LIOS_EXECUTION_SANDBOX_TARGET; base and runtime artifacts come only from sandbox-image/source-lock.json.",
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,127}:[a-z0-9][a-z0-9._-]{0,127}$/i.test(tag)) {
    throw new SandboxImageContractError("SI-01 sandbox build tag is invalid.");
  }
  return {
    engine,
    engineTarget: assertLocalEngineTarget(target),
    tag,
  };
}

export function engineTargetArgument(engine: "docker" | "podman", target: string): string {
  return engine === "docker" ? `--host=${target}` : `--url=${target}`;
}
