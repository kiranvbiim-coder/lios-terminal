import type { ExtensionCatalog } from "@shared/p13ExtensionContracts";

export type ExtensionAvailability = "registered_session" | "blocked" | "stored_inactive" | "unsupported";

export interface ExtensionCapabilityRow {
  key: string;
  id: string;
  name: string;
  provider: string;
  kind: "skill" | "artifact" | "connector" | "tool" | "agent" | "pack";
  availability: ExtensionAvailability;
  availabilityLabel: string;
  health: string;
  permissions: string[];
  reason: string;
}

export interface ExtensionCapabilitySummary {
  entries: ExtensionCapabilityRow[];
  registered: number;
  blocked: number;
  inactive: number;
  unsupported: number;
  importPosture: string;
}

/** A view of the one canonical, authenticated P13/P11 catalog. Registered is
 * never equivalent to independently healthy, licensed or approved to act. */
export function summarizeExtensionCapabilities(catalog: ExtensionCatalog): ExtensionCapabilitySummary {
  const entries: ExtensionCapabilityRow[] = [];
  for (const plugin of catalog.plugins) {
    const trusted = plugin.trust.state === "trusted" && !!plugin.trust.packageDigest;
    const base = {
      provider: plugin.manifest.name,
      permissions: plugin.manifest.permissions,
      health: "Runtime health and execution rights not independently verified",
    };
    for (const kind of ["skills", "artifacts", "connectors", "tools", "agents"] as const) {
      for (const contribution of plugin.manifest[kind]) {
        const supported = kind === "skills" || kind === "artifacts";
        const registered = supported && plugin.componentIds.includes(contribution.componentId);
        const availability: ExtensionAvailability = !supported ? "unsupported" : !trusted || !registered ? "blocked" : "registered_session";
        const reason = !supported
          ? "Executable tools, agents and connector adapters cannot be activated by this declarative installer."
          : !trusted
            ? "The current catalog has not established a trusted, digested package."
            : !registered
              ? "This contribution is listed in the manifest but absent from the registered component IDs."
              : "Registered in the current Home process only; execution still needs live policy, input, source and rights checks.";
        entries.push({
          ...base,
          key: plugin.id + ":" + contribution.componentId,
          id: contribution.componentId,
          name: contribution.name,
          kind: kind === "skills" ? "skill" : kind === "artifacts" ? "artifact" : kind === "connectors" ? "connector" : kind === "tools" ? "tool" : "agent",
          availability,
          availabilityLabel: availability === "registered_session" ? "Registered this session" : availability === "blocked" ? "Not registered or untrusted" : "Unavailable in this installer",
          reason,
        });
      }
    }
  }
  for (const pack of catalog.packs) {
    for (const version of pack.versions) {
      entries.push({
        key: "p11:" + pack.packId + "@" + version.version,
        id: pack.packId + "@" + version.version,
        name: pack.packId,
        provider: "P11 local archive",
        kind: "pack",
        availability: "stored_inactive",
        availabilityLabel: "Stored locally · execution not enabled here",
        health: "Recorded package health: " + (version.lastHealth || "not reported"),
        permissions: [],
        reason: "The Home Extensions screen provides signed archive custody, not a supervised executable activation grant. Reported pack state: " + version.state + ".",
      });
    }
  }
  return {
    entries,
    registered: entries.filter(row => row.availability === "registered_session").length,
    blocked: entries.filter(row => row.availability === "blocked").length,
    inactive: entries.filter(row => row.availability === "stored_inactive").length,
    unsupported: entries.filter(row => row.availability === "unsupported").length,
    importPosture: catalog.managementAllowed
      ? catalog.packImportAvailable
        ? "Owner-supplied local P13 packages and P11 archives may be submitted for signed review; none is pre-approved or discovered from a public marketplace."
        : "Owner-supplied P13 packages may be submitted for review; P11 import is unavailable on this target."
      : "Extension management is not permitted for the current authenticated owner.",
  };
}
