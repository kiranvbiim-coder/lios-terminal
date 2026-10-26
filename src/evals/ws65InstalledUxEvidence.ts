/**
 * WS-65: packaged macOS/Windows seven-scenario UX qualification.
 * This is an evidence contract, not an automation that runs screen readers
 * or an alternative release authority. The original P14 board remains final.
 */
import { z } from "zod";
import { WS64_SCENARIOS } from "./ws64ScenarioMatrix";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const commitSha = z.string().regex(/^[0-9a-f]{40}$/);
const evidenceFilename = z.string().min(1).max(180).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
  .refine((value) => value !== "." && value !== ".." && !value.startsWith("."), "Evidence must be a safe basename.");

export const WS65_PLATFORMS = ["macos", "windows"] as const;
const scenarioIds = WS64_SCENARIOS.map(({ id }) => id) as [
  (typeof WS64_SCENARIOS)[number]["id"], ...(typeof WS64_SCENARIOS)[number]["id"][],
];

export const ws65SourceArtifactSchema = z.object({
  id: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  name: evidenceFilename,
  sha256,
  kind: z.enum(["installer_log", "screen_recording", "screenreader_trace", "performance_trace", "run_receipt", "artifact_export", "source_provenance", "privacy_recovery"]),
}).strict();

export const ws65GateProofSchema = z.object({
  gateId: z.string().trim().min(1).max(120),
  evidenceIds: z.array(z.string().min(1).max(100)).min(1).max(12),
}).strict();

export const ws65ScenarioRunSchema = z.object({
  id: z.enum(scenarioIds),
  status: z.literal("passed"),
  executedInInstalledClient: z.literal(true),
  simulatedOrFixtureData: z.literal(false),
  developerIntervention: z.literal(false),
  gateProofs: z.array(ws65GateProofSchema).min(3).max(15),
}).strict().superRefine((run, ctx) => {
  const expected = WS64_SCENARIOS.find((item) => item.id === run.id);
  if (!expected) return;
  const actual = run.gateProofs.map((gate) => gate.gateId);
  if (new Set(actual).size !== actual.length || new Set(actual).size !== expected.requiredManual.length
    || expected.requiredManual.some((id) => !actual.includes(id))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gateProofs"],
      message: `${run.id} must prove every expected installed manual gate exactly once.` });
  }
});

export const ws65PlatformRunSchema = z.object({
  platform: z.enum(WS65_PLATFORMS),
  arch: z.enum(["arm64", "x64"]),
  osVersion: z.string().trim().min(3).max(120),
  deviceProfile: z.string().trim().min(3).max(160),
  installerName: evidenceFilename,
  installerSha256: sha256,
  installedAppName: evidenceFilename,
  installedAppSha256: sha256,
  signedPackageVerified: z.literal(true),
  macNotarizationVerified: z.boolean(),
  cleanInstallCompleted: z.literal(true),
  firstUseCompleted: z.literal(true),
  keyboardOnlyCompleted: z.literal(true),
  assistiveTechnology: z.enum(["voiceover", "narrator"]),
  screenreaderWalkthroughCompleted: z.literal(true),
  reducedMotionVerified: z.literal(true),
  zoom200PercentVerified: z.literal(true),
  testedViewportWidths: z.array(z.number().int().min(300).max(4000)).min(4).max(30),
  unreconciledCriticalDefects: z.literal(0),
  evidence: z.array(ws65SourceArtifactSchema).min(5).max(80),
  scenarioRuns: z.array(ws65ScenarioRunSchema).length(WS64_SCENARIOS.length),
}).strict().superRefine((run, ctx) => {
  if (run.platform === "macos" && (run.arch !== "arm64"
    || run.assistiveTechnology !== "voiceover" || !run.macNotarizationVerified)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["platform"],
      message: "macOS qualification requires arm64, verified notarization and VoiceOver." });
  }
  if (run.platform === "windows" && (run.arch !== "x64" || run.assistiveTechnology !== "narrator")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["platform"],
      message: "Windows qualification requires x64 and Narrator." });
  }
  for (const width of [320, 390, 768, 1440]) {
    if (!run.testedViewportWidths.includes(width)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["testedViewportWidths"], message: `Missing viewport ${width}px.` });
    }
  }
  const ids = run.scenarioRuns.map(({ id }) => id);
  if (new Set(ids).size !== WS64_SCENARIOS.length
    || WS64_SCENARIOS.some((item) => !ids.includes(item.id))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scenarioRuns"], message: "All seven distinct WS-64 scenarios must be run on this installed platform." });
  }
  const evidenceIds = new Set<string>();
  const evidenceNames = new Set<string>();
  for (const artifact of run.evidence) {
    if (evidenceIds.has(artifact.id) || evidenceNames.has(artifact.name)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence"], message: "Evidence IDs and filenames must be unique within platform." });
    }
    evidenceIds.add(artifact.id);
    evidenceNames.add(artifact.name);
  }
  for (const kind of ["installer_log", "screen_recording", "screenreader_trace", "performance_trace", "source_provenance", "privacy_recovery"]) {
    if (!run.evidence.some((item) => item.kind === kind)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence"], message: `Missing real ${kind} artifact.` });
    }
  }
  for (const scenario of run.scenarioRuns) {
    for (const gate of scenario.gateProofs) for (const ref of gate.evidenceIds) {
      if (!evidenceIds.has(ref)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scenarioRuns"], message: `${scenario.id}/${gate.gateId}: evidence ${ref} does not exist.` });
      }
    }
  }
});

export const ws65InstalledUxReleaseReportSchema = z.object({
  schemaVersion: z.literal("1"),
  status: z.literal("passed"),
  releaseTag: z.string().trim().min(1).max(200),
  packageVersion: z.string().trim().min(1).max(100),
  generatedAt: z.string().datetime({ offset: true }),
  build: z.object({
    commitSha,
    packaged: z.literal(true),
    audience: z.literal("client"),
    exactSignedReleaseCandidate: z.literal(true),
  }).strict(),
  releaseOwner: z.object({
    reviewer: z.string().trim().min(3).max(150),
    signedOffAt: z.string().datetime({ offset: true }),
    signoffEvidenceSha256: sha256,
  }).strict(),
  runs: z.array(ws65PlatformRunSchema).length(WS65_PLATFORMS.length),
}).strict().superRefine((report, ctx) => {
  if (report.releaseTag.replace(/^v/, "") !== report.packageVersion) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["releaseTag"], message: "Release tag and package version must match." });
  }
  if (new Set(report.runs.map((run) => run.platform)).size !== WS65_PLATFORMS.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["runs"], message: "Require one macOS and one Windows installed run." });
  }
});

export type WS65InstalledUxReleaseReport = z.infer<typeof ws65InstalledUxReleaseReportSchema>;