import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("D03 System Doctor searches actual authenticated registry reports with no repair side effects", () => {
  const component = readFileSync(new URL("../components/settings/SystemDoctorDesk.tsx", import.meta.url), "utf8");
  assert.match(component, /fetch\("\/api\/runtime\/foundation\/health"/);
  assert.match(component, /credentials: "same-origin", cache: "no-store"/);
  assert.match(component, /runtimeDoctorSnapshotSchema\.safeParse\(raw\)/);
  assert.match(component, /visibleRuntimeDoctorRecords\(summary\.records, search, attentionOnly\)/);
  assert.match(component, /shown\.slice\(0, 100\)/);
  assert.match(component, /Find a registered component/);
  assert.match(component, /className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border\/70 px-3/); // 44px inspect target.
  assert.match(component, /Needs attention only/);
  assert.match(component, /Search changes only this list, not actual health/);
  assert.match(component, /Native installation: <strong className="text-foreground">Not verified here/);
  assert.doesNotMatch(component, /repairRuntime|startProvider|installProvider|enableP9Workflow|openExternalUrl/);
});

test("D01 Briefing Studio has one existing P4 source/visual owner and no new store or generated claims", () => {
  const component = readFileSync(new URL("../components/terminal/ProjectBriefingStudio.tsx", import.meta.url), "utf8");
  assert.match(component, /buildProjectBriefingReport\(\{ projectId, title, introduction, sources: chosen, visuals: currentVisuals \}\)/);
  assert.match(component, /captureBriefingVisual\(detail, inspectedProject\)/);
  assert.match(component, /activeProjectRef\.current !== inspectedProject/);
  assert.match(component, /visualRequestRef\.current\?\.abort\(\)/);
  assert.match(component, /credentials: "same-origin", cache: "no-store", signal: controller\.signal/);
  assert.match(component, /await onSave\(chosen, title, introduction, currentVisuals\)/);
  assert.match(component, /No content has been copied without review/);
  assert.doesNotMatch(component, /new WebSocket|geolocate\(|fetch\("https?:|createImage\(|sendEmail\(/);
});
