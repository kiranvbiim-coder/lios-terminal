import { inspectCodingRuntimeCapabilities } from "../server/acp/runtime-capabilities";

// Read-only host inventory, not ACP workflow acceptance. No spawn, network, credentials or auto-resume.
const capabilities = await inspectCodingRuntimeCapabilities();
console.log(JSON.stringify(capabilities, null, 2));
if (process.argv.includes("--require-governed") && !capabilities.governedCodingAvailable) {
  process.exitCode = 3;
} else if (process.argv.includes("--require-installed") &&
           !capabilities.installations.some((entry) => entry.executableInstalled) &&
           !capabilities.acpxRuntimeModuleInstalled) {
  process.exitCode = 2;
}
