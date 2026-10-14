import { LIOS_PLUGIN_SDK_VERSION, type PluginSkillContribution } from "./pluginSdk";
import { FIRST_PARTY_SKILL_PACKS, type SkillManifest } from "./waveEContracts";

/**
 * SI-02.16: the Wave E skill catalogue is a view over the P13 plugin contract, not a second ecosystem.
 * A skill becomes a declarative P13 `skills` contribution; install, trust and approval are the P13 manager's.
 */
export class SkillBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillBridgeError";
  }
}

export const FIRST_PARTY_SKILL_PLUGIN_ID = "lios.first-party-skills";

export const FIRST_PARTY_SKILL_TOOL_IDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "first-party.india-bank": Object.freeze([
    "lios.instrument-master",
    "lios.market-data",
    "lios.company-intelligence",
    "lios.finance.technical",
    "lios.project.search",
    "agent.browser.navigate",
  ]),
  "first-party.saas-valuation": Object.freeze([
    "lios.instrument-master",
    "lios.market-data",
    "lios.company-intelligence",
    "lios.finance.technical",
    "lios.project.search",
    "agent.browser.navigate",
  ]),
  "first-party.reit": Object.freeze([
    "lios.instrument-master",
    "lios.market-data",
    "lios.company-intelligence",
    "lios.finance.technical",
    "lios.project.search",
    "agent.browser.navigate",
  ]),
});

/**
 * `toolIds` is the explicit governed-tool allow-list for the skill. Legacy capability labels (finance:read, ...) do
 * not name tools, so they are carried as capabilities only and never guessed into executable tool access.
 */
export function skillManifestToPluginSkill(skill: SkillManifest, toolIds: readonly string[] = []): PluginSkillContribution {
  if (!skill.firstParty || skill.approval !== "approved") {
    throw new SkillBridgeError(
      "Only approved first-party skills can be bridged; third-party skills are installed as signed P13 plugins.",
    );
  }
  return {
    id: skill.id,
    componentId: skill.id,
    name: skill.name,
    capabilities: [...skill.requiredCapabilities],
    description: skill.description,
    updatedAt: skill.updatedAt,
    requiredInputs: [...skill.requiredInputs],
    supportedObjectKinds: [...skill.supportedObjectKinds],
    toolIds: [...toolIds],
  };
}

export interface FirstPartySkillPluginOptions {
  version?: string;
  /** Skill id -> governed tool ids that skill may invoke. Absent means the skill can invoke nothing. */
  toolIdsBySkill?: Readonly<Record<string, readonly string[]>>;
  packs?: readonly SkillManifest[];
}

/** The unsigned declarative manifest for the first-party packs. Signing is the release packager's step. */
export function firstPartySkillPluginManifest(options: FirstPartySkillPluginOptions = {}): Record<string, unknown> {
  const packs = options.packs ?? FIRST_PARTY_SKILL_PACKS;
  return {
    apiVersion: LIOS_PLUGIN_SDK_VERSION,
    id: FIRST_PARTY_SKILL_PLUGIN_ID,
    name: "LiOS first-party skills",
    version: options.version ?? "1.0.0",
    description: "Curated first-party skill packs projected into the P13 plugin contract.",
    publisher: "LiOS",
    lios: { sdkVersion: LIOS_PLUGIN_SDK_VERSION, minVersion: "1.0.0", maxVersion: null },
    runtime: { kind: "declarative", entrypoint: null },
    dependencies: [],
    permissions: [],
    connectors: [],
    tools: [],
    artifacts: [],
    agents: [],
    skills: packs.map((skill) => skillManifestToPluginSkill(skill, options.toolIdsBySkill?.[skill.id] ?? [])),
    integrity: null,
    signer: null,
  };
}
