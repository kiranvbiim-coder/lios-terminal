import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readQualificationWorkflow } from "./source_distribution";
import { P14_RELEASE_EVIDENCE_ENV, p14ReleaseEvidenceSchema } from "../shared/p14ReleaseEvidence";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.resolve(root, file), "utf8");
const exists = (file: string) => fs.existsSync(path.resolve(root, file));

const roadmap = read("../docs/LIOS_EXECUTION_ROADMAP.md");
const architecture = read("../docs/LIOS_ARCHITECTURE.md");
const service = read("server/p7ReleaseReadiness.ts");
const route = read("server/operationalReadinessRoutes.ts");
const panel = read("client/src/components/panels/P7ReleaseReadinessPanel.tsx");
const operationalPanel = read("client/src/components/panels/OperationalReadinessPanel.tsx");
const enterprise = read("shared/enterpriseContracts.ts");
const enterpriseSso = read("server/enterpriseSso.ts");
const sessionRestoration = read("server/sessionRestoration.ts");
const offlineLease = read("server/offlineLeaseCache.ts");
const hardening = read("server/desktopHardening.ts");
const desktopAcceptance = read("server/desktopAcceptance.ts");
const securityAcceptance = read("server/securityAcceptance.ts");
const accessibility = read("script/validate_desktop_accessibility.ts");
const p14 = read("script/validate_p14_desktop_acceptance.ts");
const p14Certification = readQualificationWorkflow(path.resolve(root, ".."), "p14-release-certification.yml");
const macRelease = readQualificationWorkflow(path.resolve(root, ".."), "production-release-readiness.yml");
const windowsRelease = readQualificationWorkflow(path.resolve(root, ".."), "windows-release.yml");
const updater = read("desktopUpdater.cjs");
const mainProcess = read("main.cjs");
const packageJson = JSON.parse(read("package.json")) as { version: string; scripts: Record<string, string> };

assert.match(roadmap, /P7 — World-Class Desktop Hardening & Enterprise Release/);
assert.match(roadmap, /Active P7 delivery slices/);
assert.match(architecture, /Active P7 World-Class Desktop Hardening & Enterprise Release/);

assert.match(service, /buildSecurityAcceptanceSnapshot/);
assert.match(service, /buildDesktopAcceptanceSnapshot/);
assert.match(service, /P14_RELEASE_EVIDENCE_ENV/);
assert.match(service, /p7:final-release-certification/);
assert.doesNotMatch(service, /pgTable\(/, "Active P7 must not create a parallel persistence authority.");
assert.doesNotMatch(service, /setInterval\(/, "Active P7 must not create a parallel scheduler or release daemon.");
assert.match(service, /Engineering completion and release certification are deliberately separate/);
assert.match(route, /\/api\/operations\/p7-release-readiness/);
assert.match(panel, /data-p7-release-readiness/);
assert.match(operationalPanel, /P7ReleaseReadinessPanel/);

assert.match(enterprise, /z\.enum\(\["disabled", "oidc", "saml"\]\)/);
assert.match(enterprise, /requireAuthorization/);
assert.match(enterpriseSso, /\/api\/client\/auth\/sso\/device\/start/);
assert.match(enterpriseSso, /oidc_signature_invalid/);
assert.match(enterpriseSso, /saml_assertion_invalid/);
assert.match(sessionRestoration, /authenticated_offline/);
assert.match(offlineLease, /offline/i);

assert.match(hardening, /DESKTOP_PERFORMANCE_BUDGETS/);
assert.match(accessibility, /focusIndicators:\s*true/);
assert.match(accessibility, /reducedMotion:\s*true/);
assert.match(accessibility, /macOS VoiceOver/);
assert.match(accessibility, /Windows Narrator/);
assert.match(desktopAcceptance, /desktop:workspace-recovery-contract/);
assert.match(desktopAcceptance, /desktop:signed-release-workflows/);
assert.match(securityAcceptance, /security:dependency-ci/);
assert.match(securityAcceptance, /security:independent-review/);
assert.match(updater, /allowDowngrade\s*=\s*false/);
assert.match(mainProcess, /limuria:move-data-folder/);
assert.doesNotMatch(mainProcess, /workspace-backup|workspace-restore/);

assert.match(macRelease, /codesign --verify/);
assert.match(macRelease, /xcrun stapler validate/);
assert.match(macRelease, /clean-install-macos/);
assert.match(windowsRelease, /Get-AuthenticodeSignature/);
assert.match(windowsRelease, /clean-install-windows/);
assert.match(p14, /P14_RELEASE_EVIDENCE_ENV/);
assert.match(p14Certification, /npm run acceptance:p7:release/);

assert.ok(exists("server/p7ReleaseReadiness.test.ts"));
assert.match(packageJson.scripts["test:p7"] ?? "", /p7ReleaseReadiness\.test\.ts/);
assert.match(packageJson.scripts["acceptance:p7"] ?? "", /validate_p7_active_release_acceptance\.ts/);
assert.match(packageJson.scripts["acceptance:p7:release"] ?? "", /validate_p7_active_release_acceptance\.ts --mode=release/);

const releaseMode = process.argv.includes("--mode=release");
if (releaseMode) {
  const seen = new Set<string>();
  let releaseTag: string | null = null;
  for (const [envName, category] of P14_RELEASE_EVIDENCE_ENV) {
    const value = process.env[envName]?.trim();
    assert.ok(value, "Active P7 release certification requires " + envName + ".");
    const evidencePath = path.resolve(root, value!);
    assert.ok(fs.existsSync(evidencePath), envName + " evidence file does not exist.");
    const evidence = p14ReleaseEvidenceSchema.parse(JSON.parse(fs.readFileSync(evidencePath, "utf8")));
    assert.equal(evidence.category, category);
    assert.equal(evidence.packageVersion, packageJson.version);
    assert.equal(evidence.releaseTag.replace(/^v/, ""), packageJson.version);
    if (releaseTag === null) releaseTag = evidence.releaseTag;
    assert.equal(evidence.releaseTag, releaseTag, "All P7 release evidence must belong to one release tag.");
    assert.equal(seen.has(evidence.category), false, "Duplicate P7 release evidence category " + evidence.category + ".");
    seen.add(evidence.category);
  }
  assert.equal(seen.size, P14_RELEASE_EVIDENCE_ENV.length);
}

console.log("Active P7 desktop/enterprise release " + (releaseMode ? "release" : "engineering") + " acceptance: PASS");
