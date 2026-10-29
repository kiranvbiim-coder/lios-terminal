import crypto from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";
import { liosPluginManifestV1Schema } from "@shared/pluginSdk";
import { SKILL_DOCUMENT_MAX_BYTES } from "@shared/p13ExtensionContracts";

// Adapted from approved OpenClaw markdown-core/frontmatter and skills/loading/frontmatter:
// normalize only parsing view, require a complete leading block, reject parser issues, retain body.
// Use the already installed pinned js-yaml parser, not the donor SDK/config/install authority.
const yaml = createRequire(path.resolve(process.cwd(), "package.json"))("js-yaml") as {
  FAILSAFE_SCHEMA: unknown;
  load(text: string, options: Record<string, unknown>): unknown;
};
const metadataSchema = z.object({
  name: z.string().trim().min(1).max(160).regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string().trim().min(1).max(2_000),
  "disable-model-invocation": z.enum(["true", "false"]).optional(),
  "user-invocable": z.enum(["true", "false"]).optional(),
}).passthrough();

export function parseSkillDocument(document: string) {
  if (Buffer.byteLength(document) > SKILL_DOCUMENT_MAX_BYTES || document.includes("\0")) throw new Error("Skill document exceeds its 24 KiB text limit or contains NUL.");
  const normalized = document.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const opening = /^---[^\S\n]*\n/.exec(normalized);
  if (!opening) throw new Error("SKILL.md requires leading name/description YAML frontmatter.");
  const tail = normalized.slice(opening[0].length);
  const closing = /(?:^|\n)---[^\S\n]*(?:\n|(?![\s\S]))/.exec(tail);
  if (!closing || Buffer.byteLength(tail.slice(0, closing.index)) > 4 * 1024) throw new Error("Skill frontmatter must close within 4 KiB.");
  let raw: unknown;
  try { raw = yaml.load(tail.slice(0, closing.index), { schema: yaml.FAILSAFE_SCHEMA, maxDepth: 12, maxTotalMergeKeys: 0 }); }
  catch { throw new Error("Skill frontmatter is invalid YAML; duplicate keys, unsafe tags and excessive nesting are refused."); }
  const parsed = metadataSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Skill frontmatter requires a lowercase-hyphen name, description and valid invocation flags.");
  const instructions = tail.slice(closing.index + closing[0].length).trim();
  if (!instructions || instructions.length > 16_000) throw new Error("Skill instructions require 1..16000 characters.");
  const ignored = Object.keys(parsed.data).filter(key => !["name", "description", "disable-model-invocation", "user-invocable"].includes(key));
  return {
    name: parsed.data.name, description: parsed.data.description, instructions,
    modelInvocable: parsed.data["disable-model-invocation"] !== "true",
    warnings: [
      "Original publisher identity is unverified. This is explicit Home-owner adoption for this session only.",
      "Only the reviewed Markdown procedure is imported. Referenced scripts, files, installers, credentials and metadata permissions are not installed or granted.",
      "Adoption is Home-wide. This procedure can be included in permitted agent/model planning; do not include secrets or content you cannot share with those providers.",
      ...(ignored.length ? ["Non-procedure frontmatter is retained only in the reviewed source document; it grants no capabilities or installation instructions."] : []),
      ...(parsed.data["user-invocable"] === "false" ? ["The document disables direct user invocation; this importer exposes no direct skill execution command."] : []),
    ],
  };
}

export function skillDocumentManifest(document: string, ownerUserId: number, toolIds: string[], reviewedAt: string) {
  const parsed = parseSkillDocument(document);
  const documentSha256 = crypto.createHash("sha256").update(document).digest("hex");
  const id = `lios.owner-skill.u${ownerUserId}.${documentSha256.slice(0, 24)}`;
  const manifest = liosPluginManifestV1Schema.parse({
    apiVersion: "1", id, name: parsed.name, version: "1.0.0",
    description: parsed.description, publisher: "Home owner · locally adopted; original publisher unverified",
    lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: null }, runtime: { kind: "declarative", entrypoint: null },
    dependencies: [], permissions: [], connectors: [], tools: [], artifacts: [], agents: [],
    skills: [{ id: id + ".procedure", componentId: id + ".procedure", name: parsed.name,
      description: parsed.description, instructions: parsed.instructions, modelInvocable: parsed.modelInvocable,
      updatedAt: reviewedAt, requiredInputs: [], supportedObjectKinds: [], capabilities: [], toolIds,
      ownerAdoption: { kind: "home_owner", ownerUserId, documentSha256, originalPublisherVerified: false } }],
    integrity: null, signer: null,
  });
  return { manifest, warnings: parsed.warnings };
}
