import { runCommand } from "./exec/run-command";
import { createStrictProvisioningAuthority } from "./strictProvisioningAuthority";
import { managedRuntimeBasePython, managedRuntimeRoot, type StrictProvisioningAuthority, type StrictProvisioningRequest } from "./pythonRuntimeManager";

/**
 * Production composition of the closed strict provisioning capability.
 *
 * The authority — not the caller — derives every argv/cwd, restricts writes to one generated
 * `install-*` staging directory under the managed runtime root and installs only with
 * `--require-hashes` from release locks. The command runner is the same canonical
 * `runCommand` (python-runtime environment profile, bounded time/output) that the managed
 * runtime already uses. HTTP requests cannot supply or replace it. The root and interpreter are
 * resolved per call so a moved Home or reconfigured `PYTHON_EXECUTABLE` is honoured.
 */
export function createProductionProvisioningAuthority(): StrictProvisioningAuthority {
  return Object.freeze({
    provisionManagedRuntime: (request: StrictProvisioningRequest) => createStrictProvisioningAuthority({
      runtimeRoot: managedRuntimeRoot(),
      pythonExecutable: managedRuntimeBasePython(),
      run: (input) => runCommand(input),
    }).provisionManagedRuntime(request),
  });
}
