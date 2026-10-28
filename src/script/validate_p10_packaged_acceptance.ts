import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readQualificationWorkflow } from "./source_distribution";

type Mode = "ci" | "release";

function mode(): Mode {
  return process.argv.includes("--mode=release") ? "release" : "ci";
}

function read(relative: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");
}

function requireText(source: string, pattern: RegExp, message: string): void {
  if (!pattern.test(source)) throw new Error(message);
}

function requirePath(file: string, message: string): string {
  const resolved = path.resolve(file);
  if (!file || !fs.existsSync(resolved)) throw new Error(message + " Missing: " + resolved);
  return resolved;
}

function requireFile(file: string, message: string): string {
  const resolved = requirePath(file, message);
  if (!fs.statSync(resolved).isFile()) throw new Error(message + " Expected a file: " + resolved);
  return resolved;
}

function visualManifest(file: string, expectedCount: number): void {
  const resolved = requireFile(file, "P10 visual evidence manifest is required.");
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as { cases?: unknown[] };
  if (!Array.isArray(parsed.cases) || parsed.cases.length !== expectedCount) {
    throw new Error(`Visual evidence ${resolved} expected ${expectedCount} cases.`);
  }
  const root = path.dirname(resolved);
  const pngCount = fs.readdirSync(root).filter((name) => name.endsWith(".png")).length;
  if (pngCount < expectedCount) throw new Error(`Visual evidence ${root} has only ${pngCount} PNGs; expected at least ${expectedCount}.`);
}

export function validateP10VisualEvidence(uxManifest: string, analyticalManifest: string): void {
  visualManifest(uxManifest, 15);
  visualManifest(analyticalManifest, 12);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {

const currentMode = mode();
const experience = read("client/src/pages/ExperienceCenter.tsx");
const accessibility = read("script/validate_desktop_accessibility.ts");
const artifactPerformance = read("server/artifactPerformance.test.ts");
const calculationPerformance = read("client/src/lib/calculationPerformance.test.ts");
const visualWorkflow = readQualificationWorkflow(path.resolve(process.cwd(), ".."), "ux-visual-smoke.yml");
const releaseWorkflow = readQualificationWorkflow(path.resolve(process.cwd(), ".."), "production-release-readiness.yml");
const runtimePacks = read("server/p10RuntimePacks.ts");
const observability = read("server/p10Observability.ts");

requireText(experience, /data-experience-demo="read-only"/, "P10 Experience Center guided demo is missing.");
requireText(experience, /No login · no API key · no live data/, "Experience Center must explicitly disclose its static/no-live-data boundary.");
requireText(experience, /Connect your data[\s\S]+Ask in Project context[\s\S]+Inspect evidence and models[\s\S]+Save the workflow/, "Experience Center must cover the real four-step LiOS loop.");

requireText(accessibility, /focusIndicators:\s*true/, "Desktop accessibility acceptance must preserve focus indicators.");
requireText(accessibility, /reducedMotion:\s*true/, "Desktop accessibility acceptance must preserve reduced motion.");
requireText(accessibility, /macOS VoiceOver/, "Packaged accessibility acceptance must retain VoiceOver evidence requirement.");
requireText(accessibility, /Windows Narrator/, "Packaged accessibility acceptance must retain Narrator evidence requirement.");
requireText(accessibility, /keyboard-only packaged app walkthrough/, "Packaged accessibility acceptance must retain keyboard-only evidence requirement.");

requireText(artifactPerformance, /10k-cell spreadsheet diff\/apply/, "P10 performance gate must retain 10k-cell Artifact performance coverage.");
requireText(artifactPerformance, /elapsed < 10_000/, "P10 Artifact performance budget is missing.");
requireText(calculationPerformance, /analyzeCalculationPerformance/, "P10 calculation performance analyzer coverage is missing.");

requireText(visualWorkflow, /ux_png_count[\s\S]+-eq 15/, "P10 UX visual-smoke evidence count must remain 15.");
requireText(visualWorkflow, /analytical_png_count[\s\S]+-eq 12/, "P10 analytical visual-smoke evidence count must remain 12.");
requireText(releaseWorkflow, /Package signed and notarized macOS customer distribution/, "P10 signed release package step is missing.");
requireText(releaseWorkflow, /Verify macOS signature, Gatekeeper, and notarization/, "P10 signature/Gatekeeper/notarization verification is missing.");
requireText(releaseWorkflow, /Clean-machine macOS install acceptance/, "P10 clean-install recovery qualification is missing.");
requireText(releaseWorkflow, /Record release checksums[\s\S]+shasum -a 256/, "P10 release checksum evidence is missing.");
requireText(releaseWorkflow, /Clean-machine macOS install acceptance[\s\S]+Verify checksum, Gatekeeper and clean install self-test/, "P10 clean-install checksum\/recovery qualification is missing.");
requireText(runtimePacks, /P10_RUNTIME_PACK_IDS\s*=\s*\["core", "research", "quant", "modeling", "data-lab", "local-ai"\]\s*as const/, "P10 six-pack runtime contract is missing.");
requireText(observability, /localOnlyByDefault:\s*true/, "P10 observability must remain local-first.");

if (currentMode === "release") {
  const appPath = requirePath(process.env.LIOS_P10_PACKAGED_APP || "", "Signed packaged app evidence is required.");
  if (!fs.statSync(appPath).isDirectory()) throw new Error("LIOS_P10_PACKAGED_APP must point to the packaged .app directory.");
  const selfTestPath = requireFile(process.env.LIOS_DESKTOP_SELF_TEST_REPORT || "", "Packaged desktop self-test evidence is required.");
  const selfTest = JSON.parse(fs.readFileSync(selfTestPath, "utf8")) as { status?: string; nativeSecretCustody?: { mode?: string } };
  if (selfTest.status !== "verified" || selfTest.nativeSecretCustody?.mode !== "native_protected") {
    throw new Error("Packaged desktop self-test did not verify native secret custody.");
  }
  validateP10VisualEvidence(process.env.LIOS_P10_VISUAL_UX_MANIFEST || "", process.env.LIOS_P10_VISUAL_ANALYTICAL_MANIFEST || "");
  const checksums = requireFile(process.env.LIOS_P10_RELEASE_CHECKSUMS || "", "Release checksum evidence is required.");
  const checksumText = fs.readFileSync(checksums, "utf8");
  if (!/[a-f0-9]{64}\s+.+\.(?:dmg|zip)/i.test(checksumText)) throw new Error("Release checksums do not contain signed desktop artifacts.");
  if (!/\.app$/i.test(appPath)) throw new Error("LIOS_P10_PACKAGED_APP must point to the packaged .app bundle.");
}

console.log(JSON.stringify({
  contractVersion: "1.0.0",
  mode: currentMode,
  experienceCenterGuidedDemo: true,
  performanceBudgets: true,
  accessibilitySourceContract: true,
  visualSmokeContract: { uxCases: 15, analyticalCases: 12 },
  signedReleaseQualification: true,
  releaseEvidenceRequired: currentMode === "release",
}, null, 2));
}
