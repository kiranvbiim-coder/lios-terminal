import crypto from "node:crypto";
import {
  canonicalPluginPayload,
  liosPluginManifestV1Schema,
} from "@shared/pluginSdk";
import type { SkillAdapter } from "@shared/runtimeContracts";
import {
  FIRST_PARTY_SKILL_PLUGIN_ID,
  FIRST_PARTY_SKILL_TOOL_IDS,
  firstPartySkillPluginManifest,
} from "@shared/skillPluginBridge";
import { skillManifestSchema, type SkillManifest } from "@shared/waveEContracts";
import { getP13PluginRuntimeHost } from "./p13PluginRuntime";
import {
  computePluginPackageDigest,
  signPluginManifest,
} from "./p13PluginTrust";

const BUILTIN_SKILL_KEY_ID = "lios.runtime.builtin-skills";

function isSkillAdapter(value: unknown): value is SkillAdapter {
  return Boolean(
    value
      && typeof value === "object"
      && "descriptor" in value
      && (value as SkillAdapter).descriptor.kind === "skill"
      && "definition" in value,
  );
}

export function ensureFirstPartySkillsInstalled(): void {
  const host = getP13PluginRuntimeHost();
  if (host.plugins.get(FIRST_PARTY_SKILL_PLUGIN_ID)) return;

  const manifest = liosPluginManifestV1Schema.parse(firstPartySkillPluginManifest({
    toolIdsBySkill: FIRST_PARTY_SKILL_TOOL_IDS,
  }));
  const observedPackageDigest = computePluginPackageDigest(
    Buffer.from(canonicalPluginPayload(manifest), "utf8"),
  );
  const pair = crypto.generateKeyPairSync("ed25519");
  host.trustStore.trustKey(BUILTIN_SKILL_KEY_ID, pair.publicKey);
  const signed = signPluginManifest(
    manifest,
    BUILTIN_SKILL_KEY_ID,
    pair.privateKey,
    observedPackageDigest,
  );
  host.installDeclarativePlugin({ manifest: signed, observedPackageDigest });
}

export function listInstalledSkillAdapters(): SkillAdapter[] {
  ensureFirstPartySkillsInstalled();
  const host = getP13PluginRuntimeHost();
  const registry = host.registry;
  const trustedComponents = new Set(host.plugins.list().filter(plugin =>
    host.trustStore.verify(plugin.manifest, plugin.trust.packageDigest).state === "trusted",
  ).flatMap(plugin => plugin.manifest.skills.map(skill => skill.componentId)));
  return registry.list("skill").filter(descriptor => trustedComponents.has(descriptor.id)).flatMap((descriptor) => {
    const adapter = registry.get(descriptor.id);
    return isSkillAdapter(adapter) ? [adapter] : [];
  });
}

export function listInstalledSkillCatalog(): SkillManifest[] {
  ensureFirstPartySkillsInstalled();
  const host = getP13PluginRuntimeHost();
  const output: SkillManifest[] = [];
  for (const plugin of host.plugins.list()) {
    for (const skill of plugin.manifest.skills) {
      const projected = skillManifestSchema.safeParse({
        id: skill.id,
        name: skill.name,
        version: plugin.version,
        description: skill.description,
        requiredInputs: [...skill.requiredInputs],
        requiredCapabilities: [...skill.capabilities],
        supportedObjectKinds: [...skill.supportedObjectKinds],
        firstParty: plugin.id === FIRST_PARTY_SKILL_PLUGIN_ID,
        approval: plugin.trust.state === "trusted" ? "approved" : "pending",
        publisher: plugin.manifest.publisher,
        updatedAt: skill.updatedAt,
      });
      if (projected.success) output.push(projected.data);
    }
  }
  return output.sort((a, b) => a.id.localeCompare(b.id));
}
