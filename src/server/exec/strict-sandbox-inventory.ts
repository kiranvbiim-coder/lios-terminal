/**
 * Passive fingerprint for the exact strict sandbox settings used by Python inventory.
 *
 * This is NOT permission to execute or evidence a healthy runtime. The Python Doctor
 * caches only a result already obtained from the canonical isolated backend and
 * must invalidate it whenever any backend/image/tool/resource setting changes.
 * Keep this list in sync with resolveSandboxRuntimeProfile().
 */
const STRICT_SANDBOX_INPUTS = [
  "LIOS_EXECUTION_ISOLATION",
  "LIOS_EXECUTION_SANDBOX_ENGINE",
  "LIOS_EXECUTION_SANDBOX_TARGET",
  "LIOS_EXECUTION_SANDBOX_IMAGE",
  "LIOS_EXECUTION_SANDBOX_USER",
  "LIOS_EXECUTION_SANDBOX_SHELL",
  "LIOS_EXECUTION_SANDBOX_BASE64",
  "LIOS_EXECUTION_SANDBOX_TAR",
  "LIOS_EXECUTION_SANDBOX_PYTHON",
  "LIOS_EXECUTION_SANDBOX_NODE",
  "LIOS_EXECUTION_SANDBOX_XLSX",
  "LIOS_EXECUTION_SANDBOX_MAX_MEMORY_BYTES",
  "LIOS_EXECUTION_SANDBOX_MAX_PROCESSES",
  "LIOS_EXECUTION_SANDBOX_WORKSPACE_BYTES",
] as const;

export function strictSandboxInventoryFingerprint(env: NodeJS.ProcessEnv = process.env): string {
  // Never persist or print this value: paths/engine endpoints may be sensitive.
  return JSON.stringify(STRICT_SANDBOX_INPUTS.map((name) => env[name] ?? null));
}
