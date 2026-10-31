import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readQualificationWorkflow } from "./source_distribution";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.resolve(root, file), "utf8");
const exists = (file: string) => fs.existsSync(path.resolve(root, file));

const roadmap = read("../docs/LIOS_EXECUTION_ROADMAP.md");
const architecture = read("../docs/LIOS_ARCHITECTURE.md");
const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
const quality = readQualificationWorkflow(path.resolve(root, ".."), "lios-hardening.yml");

const phaseMarkers: Array<[string, RegExp]> = [
  ["P1", /P1 completion status — COMPLETE/],
  ["P2", /P2 completion status — COMPLETE/],
  ["P3", /P3 completion status — COMPLETE/],
  ["P4", /P4 completion status — COMPLETE/],
  ["P5", /P5 completion status — COMPLETE/],
  ["P6", /Active P6 status: COMPLETE/],
  ["P7", /P7 engineering completion status — COMPLETE/],
];
for (const [phase, marker] of phaseMarkers) {
  assert.match(roadmap, marker, phase + " active completion marker is missing.");
}

const requiredFiles: Record<string, string[]> = {
  P1: [
    "shared/identityContracts.ts",
    "client/src/lib/p1Shell.ts",
    "script/validate_p1c_shell_acceptance.ts",
  ],
  P2: [
    "shared/conversationRuntime.ts",
    "server/conversationCapabilityResolver.ts",
    "script/validate_p2_active_orchestration_acceptance.ts",
  ],
  P3: [
    "shared/trustContracts.ts",
    "server/universalDataResolver.ts",
    "script/validate_p3_active_trust_acceptance.ts",
  ],
  P4: [
    "shared/artifactContracts.ts",
    "server/artifactStore.ts",
    "script/validate_p4_active_artifact_workspace_acceptance.ts",
  ],
  P5: [
    "server/p5ProfessionalWorkflow.ts",
    "server/p5ProfessionalExecution.ts",
    "script/validate_p5_active_professional_acceptance.ts",
  ],
  P6: [
    "shared/p6ContinuityContracts.ts",
    "server/p6ProjectContinuity.ts",
    "script/validate_p6_active_continuity_acceptance.ts",
  ],
  P7: [
    "shared/p7ReleaseContracts.ts",
    "server/p7ReleaseReadiness.ts",
    "client/src/components/panels/P7ReleaseReadinessPanel.tsx",
    "script/validate_p7_active_release_acceptance.ts",
  ],
};

for (const [phase, files] of Object.entries(requiredFiles)) {
  for (const file of files) assert.equal(exists(file), true, phase + " required active file is missing: " + file);
}

for (let phase = 1; phase <= 7; phase += 1) {
  assert.ok(packageJson.scripts["test:p" + phase], "test:p" + phase + " is missing.");
  assert.ok(packageJson.scripts["acceptance:p" + phase], "acceptance:p" + phase + " is missing.");
  assert.match(quality, new RegExp("npm run acceptance:p" + phase + "\\b"), "Quality Gate does not run acceptance:p" + phase + ".");
}

assert.match(packageJson.scripts["acceptance:p1"], /validate_p1c_shell_acceptance/);
assert.match(packageJson.scripts["acceptance:p2"], /validate_p2_active_orchestration_acceptance/);
assert.match(packageJson.scripts["acceptance:p3"], /validate_p3_active_trust_acceptance/);
assert.match(packageJson.scripts["acceptance:p4"], /validate_p4_active_artifact_workspace_acceptance/);
assert.match(packageJson.scripts["acceptance:p5"], /validate_p5_active_professional_acceptance/);
assert.match(packageJson.scripts["acceptance:p6"], /validate_p6_active_continuity_acceptance/);
assert.match(packageJson.scripts["acceptance:p7"], /validate_p7_active_release_acceptance/);
assert.match(packageJson.scripts["acceptance:p7"], /validate_active_seven_phase_closure/);
assert.match(packageJson.scripts["acceptance:p7:release"], /--mode=release/);

assert.match(architecture, /Active P7 World-Class Desktop Hardening & Enterprise Release/);
assert.match(roadmap, /engineering complete.*release certified/is);
assert.match(roadmap, /real signed-package and typed external evidence exists/i);

console.log(JSON.stringify({
  activeProgramEngineeringComplete: true,
  phases: ["P1", "P2", "P3", "P4", "P5", "P6", "P7"],
  qualityGateCoversAllActivePhases: true,
  externalReleaseEvidenceStillRequired: true,
  releaseCertificationCommand: "npm run acceptance:p7:release",
}, null, 2));
