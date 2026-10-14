import type {
  ExecutionBackend,
  ExecutionBackendCapabilities,
  ExecutionIsolationRequirements,
} from "./backends/types";

export type Si01IsolationCoverageState =
  | "backend-ready"
  | "dependency-pending"
  | "integration-required"
  | "contract-gap";

export type Si01RiskExecutionClass =
  | "privileged-shell-command"
  | "inline-node-operation"
  | "managed-python-runtime-provisioning"
  | "p11-lep-python-sidecar"
  | "python-http-sidecar"
  | "p7-docling-document-parser"
  | "pdf-attachment-parser"
  | "spreadsheet-import-parser"
  | "playwright-browser-runtime";

export interface Si01IsolationCoverageEntry {
  id: Si01RiskExecutionClass;
  owner: string;
  sourcePaths: readonly string[];
  state: Si01IsolationCoverageState;
  /**
   * Backend IDs that can satisfy the claim once this class is routed through
   * the canonical ExecutionBackend seam. An empty list means no current
   * backend contract can truthfully express the required boundary.
   */
  backendIds: readonly string[];
  /**
   * A claim is permitted only when state=backend-ready. Other states must not
   * advertise an isolation posture until the runtime is actually wired.
   */
  claim?: Readonly<ExecutionIsolationRequirements>;
  requiredResourceControls: readonly ExecutionBackendCapabilities["resourceControls"][number][];
  limitation: string;
}

function freezeEntry(entry: Si01IsolationCoverageEntry): Si01IsolationCoverageEntry {
  return Object.freeze({
    ...entry,
    sourcePaths: Object.freeze([...entry.sourcePaths]),
    backendIds: Object.freeze([...entry.backendIds]),
    requiredResourceControls: Object.freeze([...entry.requiredResourceControls]),
    claim: entry.claim ? Object.freeze({ ...entry.claim }) : undefined,
  });
}

/**
 * SI-01/SP-01 risky execution inventory.
 *
 * This is deliberately a truth registry, not an enablement registry:
 * "backend-ready" means an existing canonical backend can prove the declared
 * boundary; it does not mean the product call site is already routed to it.
 * All host/in-process paths remain integration-required or contract-gap until
 * their own owner is migrated and validated.
 */
export const SI01_ISOLATION_COVERAGE: readonly Si01IsolationCoverageEntry[] = Object.freeze([
  freezeEntry({
    id: "privileged-shell-command",
    owner: "GM-11c canonical ExecutionBackend",
    sourcePaths: [
      "server/exec/backends/container.ts",
      "server/exec/backends/container-lifecycle.ts",
      "server/exec/backends/workspace-transfer.ts",
    ],
    state: "backend-ready",
    backendIds: ["lios.execution.docker", "lios.execution.podman"],
    claim: {
      filesystem: "sandbox",
      network: "deny",
      processes: "sandbox",
    },
    requiredResourceControls: ["wall-time", "captured-output", "memory", "process-count"],
    limitation:
      "Backend exists, but chat/terminal execution must still route through GM-11 exact-operation/policy/receipt authority and pass real V2.",
  }),
  freezeEntry({
    id: "inline-node-operation",
    owner: "GM-11c Node Permission Model backend",
    sourcePaths: ["server/exec/backends/node-permission.ts"],
    state: "backend-ready",
    backendIds: ["lios.execution.node-permission"],
    claim: { filesystem: "none", network: "deny", processes: "deny-child-process" },
    requiredResourceControls: ["wall-time", "captured-output"],
    limitation:
      "Inline Node only; workspace grants and arbitrary shell execution remain unsupported. Permission/network/process denial requires target proof.",
  }),
  freezeEntry({
    id: "managed-python-runtime-provisioning",
    owner: "SI-01.16 provisioning / pythonRuntimeManager",
    sourcePaths: ["server/pythonRuntimeManager.ts"],
    state: "contract-gap",
    backendIds: [],
    requiredResourceControls: ["wall-time", "captured-output"],
    limitation:
      "Provisioning needs governed package-network access plus controlled writes to the managed runtime root; strict mode now refuses host pip/venv fallback until that authority exists.",
  }),
  freezeEntry({
    id: "p11-lep-python-sidecar",
    owner: "P11 engine fabric / LepSidecarSupervisor",
    sourcePaths: ["server/p11SidecarSupervisor.ts"],
    state: "integration-required",
    backendIds: [],
    requiredResourceControls: ["wall-time", "captured-output"],
    limitation:
      "Long-lived LEP sidecars require pipe-open/restart lifecycle isolation not owned by the one-shot backend; strict mode now refuses host-sidecar fallback.",
  }),
  freezeEntry({
    id: "python-http-sidecar",
    owner: "P11 deterministic Python service / pythonService",
    sourcePaths: ["server/pythonService.ts"],
    state: "integration-required",
    backendIds: [],
    requiredResourceControls: ["wall-time", "captured-output"],
    limitation:
      "The local HTTP sidecar still uses a host process plus loopback token; strict finance/Python calls now refuse host-sidecar fallback until a canonical isolated service lifecycle exists.",
  }),
  freezeEntry({
    id: "p7-docling-document-parser",
    owner: "P7 Docling isolated route / GM-11c one-shot backend runner",
    sourcePaths: [
      "server/p7DocumentIntelligence.ts",
      "server/exec/run-backend.ts",
    ],
    state: "backend-ready",
    backendIds: ["lios.execution.docker", "lios.execution.podman"],
    claim: {
      filesystem: "sandbox",
      network: "deny",
      processes: "sandbox",
    },
    requiredResourceControls: ["wall-time", "captured-output", "memory", "process-count"],
    limitation:
      "The strict runtime profile and live Project-PDF route select this isolated transport when configured; packaged macOS image/socket proof remains pending, and the legacy host Docling API stays explicitly non-isolated.",
  }),
  freezeEntry({
    id: "pdf-attachment-parser",
    owner: "P12 Project attachment content",
    sourcePaths: ["server/projectAttachmentContent.ts"],
    state: "backend-ready",
    backendIds: ["lios.execution.docker", "lios.execution.podman"],
    claim: {
      filesystem: "sandbox",
      network: "deny",
      processes: "sandbox",
    },
    requiredResourceControls: ["wall-time", "captured-output", "memory", "process-count"],
    limitation:
      "The live Project conversation attachment path selects isolated P7 Docling for PDFs under global strict mode; legacy pdf-parse remains compatibility-only and independently refuses strict-mode fallback.",
  }),
  freezeEntry({
    id: "spreadsheet-import-parser",
    owner: "P4 Spreadsheet Artifact import",
    sourcePaths: ["server/spreadsheetArtifactImport.ts"],
    state: "backend-ready",
    backendIds: ["lios.execution.docker", "lios.execution.podman"],
    claim: {
      filesystem: "sandbox",
      network: "deny",
      processes: "sandbox",
    },
    requiredResourceControls: ["wall-time", "captured-output", "memory", "process-count"],
    limitation:
      "The live spreadsheet-import route selects the isolated SheetJS worker under global strict mode; legacy in-process parsing remains compatibility-only and independently refuses strict-mode fallback.",
  }),
  freezeEntry({
    id: "playwright-browser-runtime",
    owner: "GM-14 browserConnectorRuntime / isolated Browser Runtime Pack",
    sourcePaths: [
      "server/browserConnectorRuntime.ts",
      "server/playwrightBrowserAdapter.ts",
      "server/browserRuntimePack.ts",
      "server/browser-runtime-pack/worker-source.ts",
    ],
    state: "integration-required",
    backendIds: ["lios.browser-brokered@lios.execution.docker", "lios.browser-brokered@lios.execution.podman"],
    requiredResourceControls: ["wall-time", "captured-output", "memory", "process-count"],
    limitation:
      "The backend-owned stdio transport, deny-network worker and P13 DNS-pinned host broker are implemented and fail closed. Production remains unavailable until an immutable Browser Runtime Pack image provisions the configured in-image Node, playwright-core and Chromium paths and target execution is qualified.",
  }),
]);

export function backendSupportsIsolationClaim(
  capabilities: ExecutionBackendCapabilities,
  claim: ExecutionIsolationRequirements,
  requiredResourceControls: readonly ExecutionBackendCapabilities["resourceControls"][number][] = [],
): boolean {
  return (
    capabilities.filesystem.includes(claim.filesystem) &&
    capabilities.network.includes(claim.network) &&
    capabilities.processes.includes(claim.processes) &&
    requiredResourceControls.every((control) => capabilities.resourceControls.includes(control))
  );
}

export function assertIsolationCoverageTruth(
  entries: readonly Si01IsolationCoverageEntry[],
  backends: readonly ExecutionBackend[],
): void {
  const seen = new Set<string>();
  const backendById = new Map(backends.map((backend) => [backend.id, backend]));

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new Error(`Duplicate SI-01 isolation coverage entry: ${entry.id}`);
    }
    seen.add(entry.id);

    if (entry.state !== "backend-ready") {
      if (entry.claim) {
        throw new Error(
          `SI-01 isolation class ${entry.id} is ${entry.state} and must not publish an active isolation claim.`,
        );
      }
      continue;
    }

    if (!entry.claim || entry.backendIds.length === 0) {
      throw new Error(
        `SI-01 isolation class ${entry.id} is backend-ready but does not name a claim and backend.`,
      );
    }

    const candidates = entry.backendIds
      .map((backendId) => backendById.get(backendId))
      .filter((backend): backend is ExecutionBackend => Boolean(backend));
    if (candidates.length === 0) {
      throw new Error(
        `SI-01 isolation class ${entry.id} claims backend-ready but none of its backends are registered for validation.`,
      );
    }

    const supported = candidates.some((backend) =>
      backendSupportsIsolationClaim(
        backend.capabilities,
        entry.claim!,
        entry.requiredResourceControls,
      ),
    );
    if (!supported) {
      throw new Error(
        `SI-01 isolation class ${entry.id} claims stronger isolation/resources than its registered backend advertises.`,
      );
    }
  }
}
