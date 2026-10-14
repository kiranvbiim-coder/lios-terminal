import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { runtimeComponentDescriptorSchema, type RuntimeAdapter } from "@shared/runtimeContracts";
import { redactSensitiveText } from "./error-format";

export interface CodingRuntimeInstallation {
  id: "acpx" | "codex" | "claude" | "cursor-agent";
  executableInstalled: boolean;
}

export interface CodingRuntimeCapabilities {
  installations: CodingRuntimeInstallation[];
  acpxRuntimeModuleInstalled: boolean;
  protocolVerified: false;
  governedCodingAvailable: false;
  controls: [];
  reason: "runtime_not_installed" | "governed_transport_unavailable";
}

/** Observe installation without loading third-party code, launching a process or contacting a vendor. */
export async function inspectCodingRuntimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  moduleResolver: (specifier: string) => string = createRequire(import.meta.url).resolve,
): Promise<CodingRuntimeCapabilities> {
  const directories = (env.PATH ?? "").split(platform === "win32" ? ";" : ":").filter((entry) => path.isAbsolute(entry));
  const suffixes = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const installations: CodingRuntimeInstallation[] = [];
  for (const id of ["acpx", "codex", "claude", "cursor-agent"] as const) {
    let executableInstalled = false;
    for (const directory of directories) {
      for (const suffix of suffixes) {
        try {
          const filename = path.join(directory, `${id}${suffix}`);
          if (!(await stat(filename)).isFile()) continue;
          await access(filename, platform === "win32" ? constants.F_OK : constants.X_OK);
          executableInstalled = true;
          break;
        } catch {
          // Missing/inaccessible entries are not available. Never retain path/OS diagnostic text.
        }
      }
      if (executableInstalled) break;
    }
    installations.push({ id, executableInstalled });
  }
  let acpxRuntimeModuleInstalled = false;
  try { moduleResolver("acpx/runtime"); acpxRuntimeModuleInstalled = true; } catch { /* not resolvable in LiOS */ }
  return {
    installations,
    acpxRuntimeModuleInstalled,
    // Executable presence is not an ACP handshake, authenticated session or GM-11 permission.
    protocolVerified: false,
    governedCodingAvailable: false,
    controls: [],
    reason: installations.some((entry) => entry.executableInstalled) || acpxRuntimeModuleInstalled
      ? "governed_transport_unavailable" : "runtime_not_installed",
  };
}

export const ACP_RUNTIME_DESCRIPTOR = runtimeComponentDescriptorSchema.parse({
  contractVersion: "1",
  id: "coding:acp-runtime",
  kind: "agent",
  name: "User-owned coding runtime inventory",
  version: "1",
  lifecycle: "optional",
  executionScopes: ["local_api"],
  capabilities: ["coding:runtime-inventory"],
  permissions: [],
  runtimePackId: null,
  replaceable: true,
  source: {
    origin: "oss",
    repository: "https://github.com/openclaw/openclaw",
    commitSha: "c074824a27c96d3983043f9eeb33823cd1772d8c",
    license: "MIT",
    importedPaths: ["packages/acp-core/src/runtime/types.ts", "packages/acp-core/src/error-format.ts", "packages/acp-core/src/structured-auth-redaction.ts"],
    modified: true,
  },
});

/** Read-only health consumer in the existing P13 registry. It offers no execution action. */
export function createCodingRuntimeAdapter(env: NodeJS.ProcessEnv = process.env): RuntimeAdapter {
  return {
    descriptor: ACP_RUNTIME_DESCRIPTOR,
    async health() {
      const capabilities = await inspectCodingRuntimeCapabilities(env);
      return {
        componentId: ACP_RUNTIME_DESCRIPTOR.id,
        state: capabilities.reason === "runtime_not_installed" ? "not_installed" : "disabled",
        detail: redactSensitiveText(capabilities.reason === "runtime_not_installed"
          ? "No coding runtime installation was found. Governed coding is unavailable."
          : "A coding runtime installation was found, but ACP protocol and governed sandbox transport are not qualified. Coding execution is disabled."),
        checkedAt: new Date().toISOString(),
      };
    },
  };
}
