import { z } from "zod";

export const FLAGSHIP_RELEASE_PLATFORMS = ["macos", "windows"] as const;
export type FlagshipReleasePlatform = (typeof FLAGSHIP_RELEASE_PLATFORMS)[number];

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const commitSha = z.string().regex(/^[a-f0-9]{40}$/);

export const flagshipEvidenceRefSchema = z.object({
  label: z.string().trim().min(1).max(160),
  sha256,
}).strict();

export const flagshipPlatformRunSchema = z.object({
  platform: z.enum(FLAGSHIP_RELEASE_PLATFORMS),
  arch: z.string().trim().min(1).max(80),
  workflow: z.enum([
    "company-research",
    "valuation",
    "portfolio-risk",
    "personal-finance",
    "fixed-income",
    "macro",
  ]),
  cleanProfileLaunch: z.literal(true),
  signedPackageVerified: z.literal(true),
  notarizedPackageVerified: z.boolean(),
  installerVerified: z.literal(true),
  authenticated: z.literal(true),
  projectCreatedOrOpened: z.literal(true),
  realUserOwnedAiCredential: z.literal(true),
  nativeSecretCustody: z.literal("native_protected"),
  aiProvider: z.string().trim().min(1).max(120),
  aiModel: z.string().trim().min(1).max(200),
  providerVerificationPassed: z.literal(true),
  credentialPersistedAcrossRelaunch: z.literal(true),
  credentialMaterialLogged: z.literal(false),
  realUserControlledDataSource: z.literal(true),
  dataSourceAuthorized: z.literal(true),
  financeQuestionSubmitted: z.literal(true),
  deterministicExecutionObserved: z.literal(true),
  aiSynthesisObserved: z.literal(true),
  transmissionPolicyConfirmed: z.literal(true),
  executionReceiptInspected: z.literal(true),
  provenanceInspected: z.literal(true),
  artifactKept: z.literal(true),
  artifactRevisionApplied: z.literal(true),
  export: z.object({
    completed: z.literal(true),
    format: z.enum(["xlsx", "pdf", "pptx", "csv", "json"]),
    fileSha256: sha256,
    openedOutsideLios: z.literal(true),
  }).strict(),
  desktopQuitCompleted: z.literal(true),
  desktopRelaunchCompleted: z.literal(true),
  projectReopened: z.literal(true),
  chatReopened: z.literal(true),
  artifactReopened: z.literal(true),
  connectorOrProviderRevoked: z.literal(true),
  revokedAccessFailsClosed: z.literal(true),
  mockOrFixtureDataUsed: z.literal(false),
  serviceOnlyExecution: z.literal(false),
  developerInterventionRequired: z.literal(false),
  evidenceRefs: z.array(flagshipEvidenceRefSchema).min(3).max(30),
}).strict().superRefine((value, ctx) => {
  if (value.platform === "macos" && value.notarizedPackageVerified !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["notarizedPackageVerified"],
      message: "macOS flagship evidence must verify notarization.",
    });
  }
});

export const flagshipReleaseReportSchema = z.object({
  schemaVersion: z.literal("1"),
  status: z.literal("passed"),
  releaseTag: z.string().trim().min(1).max(200),
  packageVersion: z.string().trim().min(1).max(100),
  generatedAt: z.string().datetime({ offset: true }),
  build: z.object({
    commitSha,
    audience: z.literal("client"),
    packaged: z.literal(true),
    exactReleaseCandidate: z.literal(true),
  }).strict(),
  runs: z.array(flagshipPlatformRunSchema).length(2),
  notes: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]),
}).strict().superRefine((value, ctx) => {
  const platforms = value.runs.map((run) => run.platform);
  for (const required of FLAGSHIP_RELEASE_PLATFORMS) {
    if (!platforms.includes(required)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runs"],
        message: `Flagship release evidence is missing required platform: ${required}`,
      });
    }
  }
  if (new Set(platforms).size !== platforms.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["runs"],
      message: "Flagship release evidence contains duplicate platform runs.",
    });
  }
});

export type FlagshipReleaseReport = z.infer<typeof flagshipReleaseReportSchema>;
