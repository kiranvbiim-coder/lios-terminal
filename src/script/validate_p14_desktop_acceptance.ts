import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readQualificationWorkflow } from "./source_distribution";
import {
  P14_QUALIFICATION_TASKS,
  P14_RELEASE_EVIDENCE_CATEGORIES,
  P14_RELEASE_EVIDENCE_ENV,
  assertP14QualificationBoardComplete,
  buildP14QualificationBoard,
  p14ReleaseEvidenceSchema,
} from "../shared/p14ReleaseEvidence";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.resolve(root, file), "utf8");
const roadmap = read("../docs/LIOS_EXECUTION_ROADMAP.md");
const spec = read("../docs/technical/P14_DESKTOP_LAUNCH_QUALIFICATION.md");
const mac = readQualificationWorkflow(path.resolve(root, ".."), "production-release-readiness.yml");
const win = readQualificationWorkflow(path.resolve(root, ".."), "windows-release.yml");
const preview = readQualificationWorkflow(path.resolve(root, ".."), "desktop-website-release.yml");
const certification = readQualificationWorkflow(path.resolve(root, ".."), "p14-release-certification.yml");
const accessibility = read("script/validate_desktop_accessibility.ts");
const packageJson = JSON.parse(read("package.json")) as {
  version: string;
  build?: {
    electronFuses?: {
      runAsNode?: boolean;
      onlyLoadAppFromAsar?: boolean;
      enableEmbeddedAsarIntegrityValidation?: boolean;
    };
    extraResources?: string[];
  };
};
const desktopMain = read("main.cjs");
const pythonService = read("server/pythonService.ts");
const desktopPythonSidecar = read("desktopPythonSidecar.cjs");
const desktopSelfTest = read("desktopSelfTest.cjs");
const app = read("client/src/App.tsx");
const projectShell = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const connectionCenter = read("client/src/pages/DataConnectionCenter.tsx");
const connectionPresentation = read("client/src/lib/connectionCenterPresentation.ts");
const connectionPresentationTests = read("client/src/lib/connectionCenterPresentation.test.ts");
const firstUse = read("client/src/lib/firstUseJourney.ts");

for (let id = 1; id <= 12; id += 1) {
  const taskId = "LIOS-P14-" + String(id).padStart(2, "0");
  const rows = roadmap.split("\n").filter((line) => line.startsWith("| " + taskId + " |")).length;
  assert.equal(rows, 1, "Roadmap must contain exactly one canonical row for " + taskId + ".");
  assert.ok(spec.includes(taskId), "P14 specification is missing " + taskId + ".");
}

assert.match(mac, /codesign --verify/);
assert.match(mac, /xcrun stapler validate/);
assert.match(mac, /clean-install-macos/);
assert.match(mac, /--desktop-self-test/);
assert.match(win, /Get-AuthenticodeSignature/);
assert.match(win, /clean-install-windows/);
assert.match(win, /--desktop-self-test/);
assert.match(mac, /validate_p14_packaged_performance_probe\.cjs/);
assert.match(win, /validate_p14_packaged_performance_probe\.cjs/);
assert.match(mac, /macos-packaged-performance-probe\.json/);
assert.match(win, /windows-packaged-performance-probe\.json/);
assert.doesNotMatch(mac, /write_p14_evidence\.cjs performance/);
assert.doesNotMatch(win, /write_p14_evidence\.cjs performance/);

assert.match(preview, /LiOS Unsigned Preview Desktop Release/);
assert.match(preview, /desktop-preview-\*/);
assert.doesNotMatch(preview, /lios-v4clone|LiOS Clone/);
assert.match(preview, /UNSIGNED PREVIEW/);

assert.match(accessibility, /macOS VoiceOver/);
assert.match(accessibility, /Windows Narrator/);
assert.match(accessibility, /keyboard-only packaged app walkthrough/);
assert.match(spec, /Product Hardening Issue #1/);
assert.equal(packageJson.build?.electronFuses?.onlyLoadAppFromAsar, true, "P14 requires Electron to load the app only from app.asar.");
assert.equal(packageJson.build?.electronFuses?.enableEmbeddedAsarIntegrityValidation, true, "P14 requires embedded ASAR integrity validation.");
assert.equal(packageJson.build?.electronFuses?.runAsNode, true, "LiOS currently requires runAsNode for its supervised packaged local server.");
assert.match(desktopMain, /ELECTRON_RUN_AS_NODE/, "runAsNode must remain tied to the explicit packaged local-server architecture.");

// P14-01 regression: Python startup must never mutate the code-signed
// Contents/Resources tree after installation.
assert.match(desktopMain, /PYTHONDONTWRITEBYTECODE: "1"/,
  "Packaged Electron backend must force Python descendants to avoid bytecode writes.");
assert.match(pythonService, /env\.PYTHONDONTWRITEBYTECODE = "1"/,
  "Backend Python sidecar policy must be non-overridable.");
assert.match(desktopPythonSidecar, /env\.PYTHONDONTWRITEBYTECODE = "1"/,
  "Packaged Python probe policy must be non-overridable.");
assert.match(desktopPythonSidecar, /\/stats\/descriptive-diagnostics/,
  "Packaged Python qualification must execute a representative deterministic route.");
assert.match(desktopSelfTest, /assertPackagedPythonResourcesImmutable/,
  "Packaged self-test must reject runtime bytecode under signed source resources.");
assert.match(desktopSelfTest, /forbiddenPythonBytecodeAfter/,
  "Packaged self-test report must record the post-Python mutation result.");
for (const exclusion of [
  "!python-service/**/*.pyc",
  "!python-service/**/*.pyo",
  "!script/**/__pycache__/**",
  "!script/**/*.pyc",
  "!script/**/*.pyo",
]) {
  assert.ok(packageJson.build?.extraResources?.includes(exclusion),
    "Packager must exclude Python bytecode source artifacts: " + exclusion);
}
const macCleanInstall = mac.slice(mac.indexOf("clean-install-macos:"));
assert.ok((macCleanInstall.match(/codesign --verify --deep --strict/g) ?? []).length >= 2,
  "macOS clean-install gate must verify the installed app signature before and after Python execution.");
assert.match(macCleanInstall, /assert_python_resources_immutable/,
  "macOS clean-install gate must reject __pycache__\/pyc\/pyo mutations.");
assert.match(macCleanInstall, /representativeRoute\?\.verified!==true/,
  "macOS clean-install gate must require a real packaged Python calculation.");
assert.match(macCleanInstall, /forbiddenPythonBytecodeAfter!==0/,
  "macOS clean-install gate must require zero post-execution bytecode mutations.");

// P14-11 source-readiness contract: identity is the only entry gate.
// The packaged clean-profile walkthrough remains external release evidence.
assert.match(app, /useState\(false\).*environmentSetupOpen|environmentSetupOpen.*useState\(false\)/s,
  "Connection Center must not be an automatic startup gate.");
assert.match(app, /session \? \([\s\S]*?<AppRouter/,
  "Authenticated users must be able to enter the main LiOS shell without mandatory setup.");
assert.match(firstUse, /connectionsRequiredToEnter: false/,
  "First-use contract must keep connections optional.");
assert.match(firstUse, /primaryAction: "ask"/,
  "First-use contract must keep asking as the primary action.");
assert.match(projectShell, /data-first-use-entry="ask-first"/,
  "Conversation empty state must expose the ask-first entry contract.");
assert.match(projectShell, /data-first-use-connect="optional"/,
  "Conversation empty state must label Connections as optional.");
assert.match(projectShell, /onClick=\{onOpenEnvironment\}/,
  "Optional first-use Connections action must open the active Connection Center.");
assert.match(projectShell, /Your original request is preserved here so you return to the same task\./,
  "Missing-source recovery must preserve the original user task.");
assert.match(connectionPresentation, /canEnterTerminal: !LIOS_FIRST_USE_CONTRACT\.connectionsRequiredToEnter/,
  "Connection Center must derive entry permission from the non-blocking first-use contract.");
assert.match(connectionPresentationTests, /allows entering the terminal before any connection is saved/,
  "Zero-connection first-use behavior needs focused regression coverage.");
assert.match(connectionPresentationTests, /Continue to LiOS/,
  "Connection Center must present setup as a continuation, not a startup gate.");
assert.match(connectionCenter, /complete: true/,
  "Connection Center must retain an explicit save/continue path after optional setup.");
assert.match(connectionCenter, /data-first-use-connections="optional"/,
  "Active Connection Center must visibly identify first-use connection setup as optional.");
assert.match(connectionCenter, /Optional · start without setup/,
  "Zero-connection state must tell the user they can start without setup.");
assert.match(certification, /P14 Final Release Certification/);
assert.match(certification, /npm run acceptance:p14:release/);
assert.match(certification, /npm run acceptance:flagship:packaged/);
assert.match(certification, /LIOS_FLAGSHIP_RELEASE_REPORT: p14-evidence\/flagship-release-report\.json/);
assert.match(certification, /LIOS_P14_FLAGSHIP_EVIDENCE: p14-evidence\/p14-flagship-evidence\.json/);
assert.match(certification, /flagship-certification\.txt/);
assert.match(certification, /p14-macos-clean-install-evidence\.json/);
assert.match(certification, /p14-windows-clean-install-evidence\.json/);
assert.match(certification, /LIOS_P14_EVIDENCE_DIR: p14-evidence/);
assert.match(certification, /LIOS_P14_QUALIFICATION_BOARD: p14-evidence\/p14-qualification-board\.json/);
assert.match(certification, /Publish exact-release P14 qualification board/);
assert.match(certification, /refusing to overwrite certified evidence/);
assert.match(mac, /write_p14_evidence\.cjs security_privacy/);
assert.match(mac, /write_p14_evidence\.cjs release_rights/);

const mappedEvidenceCategories = P14_QUALIFICATION_TASKS.flatMap((task) => [...task.categories]);
assert.equal(P14_QUALIFICATION_TASKS.length, 12, "P14 must retain exactly 12 canonical launch-qualification tasks.");
assert.equal(mappedEvidenceCategories.length, P14_RELEASE_EVIDENCE_CATEGORIES.length,
  "Every P14 evidence category must map to exactly one canonical task.");
assert.deepEqual(new Set(mappedEvidenceCategories), new Set(P14_RELEASE_EVIDENCE_CATEGORIES),
  "P14 task/evidence mapping is incomplete or has unknown categories.");
assert.equal(new Set(mappedEvidenceCategories).size, mappedEvidenceCategories.length,
  "A P14 evidence category is mapped to multiple canonical tasks.");

const mode = process.argv.includes("--mode=release") ? "release" : "ci";
if (mode === "release") {
  const envEvidence: unknown[] = [];
  let expectedReleaseTag = process.env.RELEASE_TAG?.trim() || null;

  for (const [name, expectedCategory] of P14_RELEASE_EVIDENCE_ENV) {
    const value = process.env[name]?.trim();
    assert.ok(value, "Missing required P14 release evidence environment variable " + name + ".");
    const file = path.resolve(root, value!);
    assert.ok(fs.existsSync(file), name + " file does not exist: " + file);
    const parsed = p14ReleaseEvidenceSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    assert.equal(parsed.category, expectedCategory, name + " has the wrong evidence category.");
    assert.equal(parsed.packageVersion, packageJson.version, name + " packageVersion does not match package.json.");
    assert.equal(parsed.releaseTag.replace(/^v/, ""), packageJson.version, name + " releaseTag does not match package.json.");
    if (expectedReleaseTag === null) expectedReleaseTag = parsed.releaseTag;
    assert.equal(parsed.releaseTag, expectedReleaseTag, name + " belongs to a different release tag.");
    envEvidence.push(parsed);
  }

  assert.ok(expectedReleaseTag, "P14 release mode could not resolve the exact release tag.");

  const evidenceDir = process.env.LIOS_P14_EVIDENCE_DIR?.trim();
  let boardEvidence = envEvidence;
  if (evidenceDir) {
    const resolvedEvidenceDir = path.resolve(root, evidenceDir);
    assert.ok(fs.existsSync(resolvedEvidenceDir), "P14 evidence directory does not exist: " + resolvedEvidenceDir);
    const files = fs.readdirSync(resolvedEvidenceDir)
      .filter((name) => /^p14-.*-evidence\.json$/.test(name))
      .sort();
    assert.ok(files.length > 0, "P14 evidence directory contains no typed evidence files.");
    boardEvidence = files.map((name) => JSON.parse(fs.readFileSync(path.join(resolvedEvidenceDir, name), "utf8")));
  }

  const board = buildP14QualificationBoard({
    evidence: boardEvidence,
    expectedReleaseTag: expectedReleaseTag!,
    expectedPackageVersion: packageJson.version,
  });
  assertP14QualificationBoardComplete(board);

  const boardOutput = process.env.LIOS_P14_QUALIFICATION_BOARD?.trim();
  if (boardOutput) {
    const outputPath = path.resolve(root, boardOutput);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(board, null, 2) + "\n", "utf8");
  }

  console.log(JSON.stringify({
    phase: "P14 Final Desktop Launch Qualification",
    releaseTag: board.releaseTag,
    packageVersion: board.packageVersion,
    status: board.status,
    passedTasks: board.tasks.filter((task) => task.status === "passed").length,
    totalTasks: board.tasks.length,
    evidenceCategories: board.evidenceCategories.present.length,
    qualificationBoard: boardOutput || null,
  }, null, 2));
}

console.log("P14 desktop launch qualification " + mode + " contract: PASS");
