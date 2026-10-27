import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const home = source("../components/terminal/ProjectHome.tsx");
const briefing = source("../components/terminal/ProjectBriefingStudio.tsx");
const builder = source("./phase4Briefing.ts");
const devices = source("../components/settings/DevicesSettings.tsx");
const doctor = source("../components/settings/SystemDoctorDesk.tsx");
const pkg = JSON.parse(source("../../../../package.json")) as {scripts: Record<string,string>};

test("Briefing Studio owns no new Artifact datastore and uses P4 only after review", () => {
  assert.match(home, /<ProjectBriefingStudio key=\{project\.id\} projectId=\{project\.id\} onOpenArtifact=\{onFocusArtifact\}/);
  assert.equal((home.match(/<ProjectBriefingStudio /g) ?? []).length, 1);
  assert.match(home, /setBriefingOpen\(false\)/);
  assert.match(briefing, /const result = await createArtifact\(expectedProject/);
  assert.match(briefing, /result\.artifact\.projectId !== expectedProject/);
  assert.match(briefing, /result\.version\.artifactId !== result\.artifact\.id/);
  assert.match(briefing, /onOpenArtifact\(saved\.id, saved\.title\)/);
  assert.match(builder, /reportArtifactContentSchema\.parse/);
  assert.doesNotMatch(builder, /fetch\(|createProjectChat|Math\.random|new Date\(\)/);
});

test("System Doctor reuses internal P0 diagnostic GET and is no repair executor", () => {
  assert.match(devices, /<SystemDoctorDesk \/>/);
  assert.match(devices, /aria-expanded=\{doctorOpen\}/);
  assert.match(doctor, /fetch\("\/api\/runtime\/foundation\/health"/);
  assert.match(doctor, /credentials: "same-origin"/);
  assert.match(doctor, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(doctor, /runtimeDoctorSnapshotSchema\.safeParse/);
  assert.doesNotMatch(doctor, /method: "POST"|apiRequest\("POST"|repairManagedRuntime\(|runP9WorkflowNow\(/);
});

test("offline zero-cost beta integrity tools are explicit and never production-signing claims", () => {
  assert.equal(pkg.scripts["beta:manifest:test"],"node --test betaReleaseManifest.test.cjs");
  assert.equal(pkg.scripts["beta:manifest"],"node script/beta_release_manifest.cjs");
  const manifest=source("../../../../betaReleaseManifest.cjs");
  const cli=source("../../../../script/beta_release_manifest.cjs");
  assert.match(manifest,/ed25519/);
  assert.match(manifest,/release_asset_integrity_only/);
  assert.match(manifest,/macNotarized: false/);
  assert.match(cli,/outside the public repository/);
  assert.doesNotMatch(cli,/quitAndInstall\(|autoDownload\s*=\s*true/);
});
