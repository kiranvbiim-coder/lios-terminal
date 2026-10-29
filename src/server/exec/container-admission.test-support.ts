import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Host operation identity needs a real regular executable file even when a test only prepares/refuses admission.
 * This placeholder is NEVER executed; it is not a Docker implementation or native-isolation proof.
 */
export function installContainerAdmissionIdentity(): () => void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-container-admission-"));
  const originalPath = process.env.PATH;
  const filename = path.join(root, process.platform === "win32" ? "docker.exe" : "docker");
  fs.writeFileSync(filename, "#!/bin/sh\nprintf 'admission-only identity must not execute\\n' >&2\nexit 97\n", { mode: 0o700 });
  process.env.PATH = root + path.delimiter + (originalPath ?? "");
  return () => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    fs.rmSync(root, { recursive: true, force: true });
  };
}
