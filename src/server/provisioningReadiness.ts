import { MANAGED_RUNTIME_MANIFEST, type ManagedRuntimeManifest } from "./runtimeManifest";
import type { ManagedRuntimeState } from "./pythonRuntimeManager";

export type ManagedRuntimeReadinessState =
  | "ready"
  | "missing"
  | "corrupt"
  | "incompatible"
  | "unverified"
  | "integrity_failed"
  | "unsupported";

export type ManagedRuntimeRepairAction = "none" | "install" | "repair";

export interface ManagedRuntimeReadiness {
  state: ManagedRuntimeReadinessState;
  ready: boolean;
  repairAction: ManagedRuntimeRepairAction;
  requiredPackIds: readonly string[];
  missingPackIds: readonly string[];
  reasons: readonly string[];
}

export interface ManagedRuntimeReadinessInput {
  state: ManagedRuntimeState | null;
  pythonAvailable: boolean;
  platformKey?: string;
  requiredPackIds?: readonly string[];
  manifest?: ManagedRuntimeManifest;
}

function normalizedPackIds(packIds: readonly string[]): string[] {
  return [...new Set(packIds)].sort();
}

function result(
  state: ManagedRuntimeReadinessState,
  repairAction: ManagedRuntimeRepairAction,
  requiredPackIds: readonly string[],
  missingPackIds: readonly string[],
  reasons: readonly string[],
): ManagedRuntimeReadiness {
  return Object.freeze({
    state,
    ready: state === "ready",
    repairAction,
    requiredPackIds: Object.freeze([...requiredPackIds]),
    missingPackIds: Object.freeze([...missingPackIds]),
    reasons: Object.freeze([...reasons]),
  });
}

/**
 * SI-01.16 readiness classification for the existing managed Python runtime.
 *
 * This is deliberately a pure view over the canonical runtime manifest/state.
 * It does not install, download, activate, repair or register anything. Callers
 * decide whether a capability requires particular packs and may then invoke the
 * existing pythonRuntimeManager install/rollback authority.
 */
export function evaluateManagedRuntimeReadiness(
  input: ManagedRuntimeReadinessInput,
): ManagedRuntimeReadiness {
  const manifest = input.manifest ?? MANAGED_RUNTIME_MANIFEST;
  const platformKey = input.platformKey ?? `${process.platform}-${process.arch}`;
  const requiredPackIds = normalizedPackIds(input.requiredPackIds ?? ["core"]);
  const knownPackIds = new Set(manifest.packs.map((pack) => pack.id));

  const unknownRequired = requiredPackIds.filter((packId) => !knownPackIds.has(packId));
  if (unknownRequired.length > 0) {
    return result(
      "incompatible",
      "repair",
      requiredPackIds,
      unknownRequired,
      ["Required runtime pack is not present in the signed manifest."],
    );
  }

  if (!manifest.supportedPlatforms.includes(platformKey)) {
    return result(
      "unsupported",
      "none",
      requiredPackIds,
      requiredPackIds,
      ["Current platform is not supported by the managed runtime manifest."],
    );
  }

  const runtimeState = input.state;
  if (!runtimeState) {
    return result(
      "missing",
      "install",
      requiredPackIds,
      requiredPackIds,
      ["Managed runtime is not installed."],
    );
  }

  if (runtimeState.manifestVersion !== manifest.manifestVersion) {
    return result(
      "incompatible",
      "repair",
      requiredPackIds,
      [],
      ["Installed runtime manifest version does not match the current manifest."],
    );
  }

  const installedPacks = new Set(runtimeState.selectedPackIds);
  const missingPackIds = requiredPackIds.filter((packId) => !installedPacks.has(packId));
  if (missingPackIds.length > 0) {
    return result(
      "missing",
      "install",
      requiredPackIds,
      missingPackIds,
      ["One or more capability-required runtime packs are not installed."],
    );
  }

  if (!input.pythonAvailable) {
    return result(
      "corrupt",
      "repair",
      requiredPackIds,
      [],
      ["Managed runtime state exists but its Python executable is unavailable."],
    );
  }

  if (runtimeState.verificationWarnings.length > 0) {
    return result(
      "integrity_failed",
      "repair",
      requiredPackIds,
      [],
      ["Installed runtime failed the manifest allow-list verification."],
    );
  }

  if (!runtimeState.hashVerified) {
    return result(
      "unverified",
      "repair",
      requiredPackIds,
      [],
      ["Installed runtime was not verified against release-artifact package hashes."],
    );
  }

  return result("ready", "none", requiredPackIds, [], []);
}
