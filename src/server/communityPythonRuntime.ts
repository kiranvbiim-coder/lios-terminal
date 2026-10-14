import fs from "node:fs";
import path from "node:path";
import { readManagedRuntimeState, type ManagedRuntimeState } from "./pythonRuntimeManager";
import { isRetailSoftwareProfile } from "./retailSoftwareProfile";

export const COMMUNITY_PYTHON_PACK_ID = "community-yahoo" as const;

export type CommunityPythonAuthority = "managed_runtime" | "configured_dev" | "ambient_dev";

export interface CommunityPythonResolution {
  executable: string;
  authority: CommunityPythonAuthority;
  packId: typeof COMMUNITY_PYTHON_PACK_ID;
}

export class CommunityPythonRuntimeUnavailableError extends Error {
  readonly code = "community_python_runtime_unavailable" as const;
  readonly packId = COMMUNITY_PYTHON_PACK_ID;

  constructor(message = "Community Yahoo requires the selected community-yahoo managed runtime pack in the packaged desktop app.") {
    super(message);
    this.name = "CommunityPythonRuntimeUnavailableError";
  }
}

interface ResolveCommunityPythonOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  existsSync?: (candidate: string) => boolean;
  state?: ManagedRuntimeState | null;
}

function runtimePythonPath(state: ManagedRuntimeState, platform: NodeJS.Platform): string {
  return platform === "win32"
    ? path.join(state.runtimePath, "Scripts", "python.exe")
    : path.join(state.runtimePath, "bin", "python3");
}

function packagedRetailRuntime(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.ELECTRON_RESOURCES_PATH?.trim()) && isRetailSoftwareProfile(env);
}

export function resolveCommunityPythonExecutable(
  options: ResolveCommunityPythonOptions = {},
): CommunityPythonResolution {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const existsSync = options.existsSync ?? fs.existsSync;
  const state = options.state === undefined ? readManagedRuntimeState() : options.state;

  if (state?.selectedPackIds.includes(COMMUNITY_PYTHON_PACK_ID)) {
    const candidate = runtimePythonPath(state, platform);
    if (existsSync(candidate)) {
      return {
        executable: candidate,
        authority: "managed_runtime",
        packId: COMMUNITY_PYTHON_PACK_ID,
      };
    }
    if (packagedRetailRuntime(env)) {
      throw new CommunityPythonRuntimeUnavailableError(
        "The community-yahoo pack is selected but its managed Python runtime is unavailable. Repair or reinstall the selected Runtime Pack before using Yahoo community helpers.",
      );
    }
  }

  if (packagedRetailRuntime(env)) {
    throw new CommunityPythonRuntimeUnavailableError(
      "Yahoo community helpers are unavailable until the consent-gated community-yahoo Runtime Pack is installed and selected.",
    );
  }

  const configured = env.PYTHON_EXECUTABLE?.trim();
  if (configured) {
    return {
      executable: configured,
      authority: "configured_dev",
      packId: COMMUNITY_PYTHON_PACK_ID,
    };
  }

  const candidates = platform === "darwin"
    ? [
        "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3",
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
      ]
    : [];
  const discovered = candidates.find((candidate) => existsSync(candidate));
  return {
    executable: discovered ?? (platform === "win32" ? "python" : "python3"),
    authority: "ambient_dev",
    packId: COMMUNITY_PYTHON_PACK_ID,
  };
}

export function communityPythonRuntimeStatus(
  options: ResolveCommunityPythonOptions = {},
): { available: boolean; authority: CommunityPythonAuthority | "unavailable"; executable: string | null; detail: string } {
  try {
    const resolved = resolveCommunityPythonExecutable(options);
    return {
      available: true,
      authority: resolved.authority,
      executable: resolved.executable,
      detail: resolved.authority === "managed_runtime"
        ? "Community Yahoo is routed through the selected managed runtime."
        : "Community Yahoo is using a development/hosted Python fallback.",
    };
  } catch (error) {
    if (error instanceof CommunityPythonRuntimeUnavailableError) {
      return { available: false, authority: "unavailable", executable: null, detail: error.message };
    }
    throw error;
  }
}
