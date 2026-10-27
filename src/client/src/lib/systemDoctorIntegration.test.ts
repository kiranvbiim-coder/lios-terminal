import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("System Doctor mounts only on demand in existing Device Settings", () => {
  const settings = read("../components/settings/DevicesSettings.tsx");
  const doctor = read("../components/settings/SystemDoctorDesk.tsx");
  assert.match(settings, /aria-expanded=\{doctorOpen\}/);
  assert.match(settings, /aria-controls="lios-system-doctor-panel"/);
  assert.match(settings, /\{doctorOpen && <div id="lios-system-doctor-panel"><SystemDoctorDesk \/><\/div>\}/);
  assert.equal((settings.match(/<SystemDoctorDesk \/>/g) ?? []).length, 1);
  assert.match(doctor, /fetch\("\/api\/runtime\/foundation\/health"/);
  assert.match(doctor, /credentials: "same-origin"/);
  assert.match(doctor, /runtimeDoctorSnapshotSchema\.safeParse/);
  assert.doesNotMatch(doctor, /method: "POST"|repairManagedRuntime\(|runP9WorkflowNow\(/);
});
