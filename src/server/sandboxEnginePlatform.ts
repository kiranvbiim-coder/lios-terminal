/**
 * Probe the OS of the explicitly configured local Docker/Podman engine.
 * Docker Info and Podman Info have different Go-template field layouts.
 *
 * This is passive inspection; it never selects an engine, grants execution,
 * imports images or accepts a release as qualified.
 */
export type LocalSandboxEngine = "docker" | "podman";

export function localSandboxEngineOsProbe(engine: LocalSandboxEngine): readonly string[] {
  return ["info", "--format", engine === "docker" ? "{{.OSType}}" : "{{.Host.OS}}"];
}

export function isLinuxSandboxEngineOs(observed: string): boolean {
  // Do not treat blank, unknown, Windows-container mode or untrusted
  // multi-line output as proof the OCI Linux sandbox can execute.
  return observed.trim() === "linux";
}
