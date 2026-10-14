import { z } from "zod";

export const P14_RELEASE_EVIDENCE_CATEGORIES = [
  "mac_clean_install",
  "windows_clean_install",
  "update_rollback",
  "pack_lifecycle",
  "workspace_restore",
  "recovery",
  "security_privacy",
  "release_rights",
  "performance",
  "voiceover",
  "narrator",
  "keyboard",
  "first_use",
  "flagship",
] as const;

export type P14ReleaseEvidenceCategory = (typeof P14_RELEASE_EVIDENCE_CATEGORIES)[number];

export const p14ReleaseEvidenceSchema = z.object({
  schemaVersion: z.literal("1"),
  category: z.enum(P14_RELEASE_EVIDENCE_CATEGORIES),
  status: z.literal("passed"),
  releaseTag: z.string().trim().min(1).max(200),
  packageVersion: z.string().trim().min(1).max(100),
  generatedAt: z.string().datetime({ offset: true }),
  evidenceKind: z.enum(["automated", "human_assisted"]),
  platform: z.string().trim().min(1).max(120),
  sourceArtifacts: z.array(z.object({
    name: z.string().trim().min(1).max(500),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  }).strict()).min(1).max(50),
  notes: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]),
}).strict().superRefine((value, ctx) => {
  if (value.evidenceKind === "automated" && value.sourceArtifacts.some((artifact) => artifact.sha256 === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceArtifacts"],
      message: "Automated P14 evidence must hash every source artifact.",
    });
  }
});

export type P14ReleaseEvidence = z.infer<typeof p14ReleaseEvidenceSchema>;

export const P14_RELEASE_EVIDENCE_ENV = [
  ["LIOS_P14_MAC_CLEAN_INSTALL_EVIDENCE", "mac_clean_install"],
  ["LIOS_P14_WINDOWS_CLEAN_INSTALL_EVIDENCE", "windows_clean_install"],
  ["LIOS_P14_UPDATE_ROLLBACK_EVIDENCE", "update_rollback"],
  ["LIOS_P14_PACK_LIFECYCLE_EVIDENCE", "pack_lifecycle"],
  ["LIOS_P14_WORKSPACE_RESTORE_EVIDENCE", "workspace_restore"],
  ["LIOS_P14_RECOVERY_EVIDENCE", "recovery"],
  ["LIOS_P14_SECURITY_PRIVACY_EVIDENCE", "security_privacy"],
  ["LIOS_P14_RELEASE_RIGHTS_EVIDENCE", "release_rights"],
  ["LIOS_P14_PERFORMANCE_EVIDENCE", "performance"],
  ["LIOS_P14_VOICEOVER_EVIDENCE", "voiceover"],
  ["LIOS_P14_NARRATOR_EVIDENCE", "narrator"],
  ["LIOS_P14_KEYBOARD_EVIDENCE", "keyboard"],
  ["LIOS_P14_FIRST_USE_EVIDENCE", "first_use"],
  ["LIOS_P14_FLAGSHIP_EVIDENCE", "flagship"],
] as const satisfies ReadonlyArray<readonly [string, P14ReleaseEvidenceCategory]>;


export const P14_QUALIFICATION_TASKS = [
  { id: "LIOS-P14-01", title: "macOS signing, notarization and clean install", categories: ["mac_clean_install"] },
  { id: "LIOS-P14-02", title: "Windows signing, installer and clean install", categories: ["windows_clean_install"] },
  { id: "LIOS-P14-03", title: "Update, migration, rollback and recovery", categories: ["update_rollback"] },
  { id: "LIOS-P14-04", title: "Runtime Pack lifecycle", categories: ["pack_lifecycle"] },
  { id: "LIOS-P14-05", title: "Portable workspace backup and restore", categories: ["workspace_restore"] },
  { id: "LIOS-P14-06", title: "Crash, resource and long-job recovery", categories: ["recovery"] },
  { id: "LIOS-P14-07", title: "Packaged security, privacy and secret custody", categories: ["security_privacy"] },
  { id: "LIOS-P14-08", title: "Release rights and dependency audit", categories: ["release_rights"] },
  { id: "LIOS-P14-09", title: "Packaged performance budgets", categories: ["performance"] },
  { id: "LIOS-P14-10", title: "Accessibility, keyboard and visual qualification", categories: ["voiceover", "narrator", "keyboard"] },
  { id: "LIOS-P14-11", title: "First-use and Experience Center", categories: ["first_use"] },
  { id: "LIOS-P14-12", title: "Flagship end-to-end journey", categories: ["flagship"] },
] as const satisfies ReadonlyArray<{
  id: `LIOS-P14-${string}`;
  title: string;
  categories: readonly P14ReleaseEvidenceCategory[];
}>;

export type P14QualificationTaskId = (typeof P14_QUALIFICATION_TASKS)[number]["id"];

export const p14QualificationTaskResultSchema = z.object({
  id: z.enum(P14_QUALIFICATION_TASKS.map((task) => task.id) as [
    P14QualificationTaskId,
    ...P14QualificationTaskId[],
  ]),
  title: z.string().trim().min(1).max(300),
  status: z.enum(["passed", "missing"]),
  requiredCategories: z.array(z.enum(P14_RELEASE_EVIDENCE_CATEGORIES)).min(1).max(14),
  presentCategories: z.array(z.enum(P14_RELEASE_EVIDENCE_CATEGORIES)).max(14),
  missingCategories: z.array(z.enum(P14_RELEASE_EVIDENCE_CATEGORIES)).max(14),
}).strict();

export const p14QualificationBoardSchema = z.object({
  schemaVersion: z.literal("1"),
  releaseTag: z.string().trim().min(1).max(200),
  packageVersion: z.string().trim().min(1).max(100),
  generatedAt: z.string().datetime({ offset: true }),
  status: z.enum(["passed", "incomplete"]),
  evidenceCategories: z.object({
    required: z.array(z.enum(P14_RELEASE_EVIDENCE_CATEGORIES)).length(P14_RELEASE_EVIDENCE_CATEGORIES.length),
    present: z.array(z.enum(P14_RELEASE_EVIDENCE_CATEGORIES)).max(P14_RELEASE_EVIDENCE_CATEGORIES.length),
    missing: z.array(z.enum(P14_RELEASE_EVIDENCE_CATEGORIES)).max(P14_RELEASE_EVIDENCE_CATEGORIES.length),
  }).strict(),
  tasks: z.array(p14QualificationTaskResultSchema).length(P14_QUALIFICATION_TASKS.length),
}).strict();

export type P14QualificationBoard = z.infer<typeof p14QualificationBoardSchema>;

export function buildP14QualificationBoard(input: {
  evidence: readonly unknown[];
  expectedReleaseTag: string;
  expectedPackageVersion: string;
  generatedAt?: string;
}): P14QualificationBoard {
  const expectedReleaseTag = input.expectedReleaseTag.trim();
  const expectedPackageVersion = input.expectedPackageVersion.trim();
  if (!expectedReleaseTag) throw new Error("P14 qualification requires an exact release tag.");
  if (!expectedPackageVersion) throw new Error("P14 qualification requires an exact package version.");
  if (expectedReleaseTag.replace(/^v/, "") !== expectedPackageVersion) {
    throw new Error("P14 qualification release tag does not match the package version.");
  }

  const byCategory = new Map<P14ReleaseEvidenceCategory, P14ReleaseEvidence>();
  for (const value of input.evidence) {
    const parsed = p14ReleaseEvidenceSchema.parse(value);
    if (parsed.releaseTag !== expectedReleaseTag) {
      throw new Error(`P14 evidence ${parsed.category} belongs to release ${parsed.releaseTag}, expected ${expectedReleaseTag}.`);
    }
    if (parsed.packageVersion !== expectedPackageVersion) {
      throw new Error(`P14 evidence ${parsed.category} belongs to package ${parsed.packageVersion}, expected ${expectedPackageVersion}.`);
    }
    if (byCategory.has(parsed.category)) {
      throw new Error(`Duplicate P14 evidence category: ${parsed.category}`);
    }
    byCategory.set(parsed.category, parsed);
  }

  const present = P14_RELEASE_EVIDENCE_CATEGORIES.filter((category) => byCategory.has(category));
  const missing = P14_RELEASE_EVIDENCE_CATEGORIES.filter((category) => !byCategory.has(category));
  const tasks = P14_QUALIFICATION_TASKS.map((task) => {
    const presentCategories = task.categories.filter((category) => byCategory.has(category));
    const missingCategories = task.categories.filter((category) => !byCategory.has(category));
    return {
      id: task.id,
      title: task.title,
      status: missingCategories.length === 0 ? "passed" as const : "missing" as const,
      requiredCategories: [...task.categories],
      presentCategories,
      missingCategories,
    };
  });

  return p14QualificationBoardSchema.parse({
    schemaVersion: "1",
    releaseTag: expectedReleaseTag,
    packageVersion: expectedPackageVersion,
    generatedAt: input.generatedAt
      ?? [...byCategory.values()].map((item) => item.generatedAt).sort().at(-1)
      ?? "1970-01-01T00:00:00.000Z",
    status: missing.length === 0 ? "passed" : "incomplete",
    evidenceCategories: {
      required: [...P14_RELEASE_EVIDENCE_CATEGORIES],
      present,
      missing,
    },
    tasks,
  });
}

export function assertP14QualificationBoardComplete(boardInput: P14QualificationBoard): void {
  const board = p14QualificationBoardSchema.parse(boardInput);
  if (board.status !== "passed" || board.evidenceCategories.missing.length > 0) {
    throw new Error(
      "P14 qualification evidence is incomplete: "
      + (board.evidenceCategories.missing.join(", ") || "one or more task gates are missing"),
    );
  }
  const incompleteTasks = board.tasks.filter((task) => task.status !== "passed");
  if (incompleteTasks.length) {
    throw new Error("P14 qualification tasks are incomplete: " + incompleteTasks.map((task) => task.id).join(", "));
  }
}
