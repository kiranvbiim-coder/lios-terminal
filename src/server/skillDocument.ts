import crypto from "node:crypto";
import * as yaml from "js-yaml";
import { z } from "zod";
import { liosPluginManifestV1Schema } from "@shared/pluginSdk";
import { SKILL_DOCUMENT_MAX_BYTES } from "@shared/p13ExtensionContracts";

// Adapted from approved OpenClaw markdown-core/frontmatter and skills/loading/frontmatter:
// normalize only parsing view, require a complete leading block, reject parser issues, retain body.
// Use the already installed pinned js-yaml parser, not the donor SDK/config/install authority.
const metadataSchema = z.object({
  name: z.string().trim().min(1).max(160).regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string().trim().min(1).max(2_000),
  "disable-model-invocation": z.enum(["true", "false"]).optional(),
  "user-invocable": z.enum(["true", "false"]).optional(),
}).passthrough();
export type SkillFindingSeverity = "critical" | "warn";
export interface SkillDocumentFinding { ruleId: string; severity: SkillFindingSeverity; line: number }

// Rules adapted from OpenClaw src/skills/security/scanner.ts SKILL_CONTENT_RULES and scan-evidence.ts
// (c074824a27c96d3983043f9eeb33823cd1772d8c, MIT): markdown-only content rules, not its executable-file scanners.
const LITERAL_SECRET = /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16})\b/;
const PEM_PRIVATE_KEY = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/;
const PLACEHOLDER = /(?:x{6,}|\.{3}|<[^>]+>|your[-_]?|example|placeholder|dummy|changeme)/i;
const SKILL_CONTENT_RULES: Array<{ ruleId: string; severity: SkillFindingSeverity; test: (line: string) => boolean }> = [
  { ruleId: "literal-secret", severity: "critical", test: line => PEM_PRIVATE_KEY.test(line) || (() => { const m = LITERAL_SECRET.exec(line); return Boolean(m) && !PLACEHOLDER.test(m![0]); })() },
  { ruleId: "shell-pipe-to-shell", severity: "critical", test: line => /\b(?:curl|wget)\b[^|\n]{0,120}\|\s*(?:sh|bash|zsh)\b/i.test(line) },
  { ruleId: "secret-exfiltration", severity: "critical", test: line => /(?:process\.env\b|\$\{?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\}?)[\s\S]{0,80}(?:\bcurl\b|\bwget\b|\bfetch\s*\(|https?:\/\/)/i.test(line) || /(?:\bcurl\b|\bwget\b|\bfetch\s*\()[\s\S]{0,80}(?:process\.env\b|\$\{?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\}?)/i.test(line) },
  { ruleId: "destructive-delete", severity: "warn", test: line => /\brm\s+-[a-z]*r[a-z]*\s+(?:\/|~|\$HOME|\.)(?:\s|$|\/\*)/i.test(line) || /\brm\s+-[a-z]*f[a-z]*r[a-z]*\s+(?:\/|~|\$HOME|\.)(?:\s|$|\/\*)/i.test(line) },
  { ruleId: "unsafe-permissions", severity: "warn", test: line => /\bchmod\s+(?:-R\s+)?0?777\b/.test(line) },
];
const MAX_FINDINGS_PER_RULE = 8;

/** Pure, bounded scan of the full normalized document (frontmatter included). Findings never carry the matched text. */
export function scanSkillDocumentContent(normalized: string): SkillDocumentFinding[] {
  const findings: SkillDocumentFinding[] = [];
  const counts = new Map<string, number>();
  normalized.split("\n").forEach((line, index) => {
    for (const rule of SKILL_CONTENT_RULES) {
      if ((counts.get(rule.ruleId) ?? 0) >= MAX_FINDINGS_PER_RULE || !rule.test(line)) continue;
      counts.set(rule.ruleId, (counts.get(rule.ruleId) ?? 0) + 1);
      findings.push({ ruleId: rule.ruleId, severity: rule.severity, line: index + 1 });
    }
  });
  return findings;
}

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
  const findings = scanSkillDocumentContent(normalized);
  return {
    findings,
    name: parsed.data.name, description: parsed.data.description, instructions,
    modelInvocable: parsed.data["disable-model-invocation"] !== "true",
    warnings: [
      ...findings.filter(finding => finding.severity === "warn").map(finding => `Warning ${finding.ruleId} at line ${finding.line}: review this instruction before adopting it.`),
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
  return { manifest, warnings: parsed.warnings, findings: parsed.findings };
}
