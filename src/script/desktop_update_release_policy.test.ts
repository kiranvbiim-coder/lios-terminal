import assert from "node:assert/strict";
import test from "node:test";
import { collectPreflightChecks } from "./release_preflight";

const CURRENT_JOURNAL = JSON.stringify({
  entries: [{ idx: 41, tag: "0041_user_persona_preferences" }],
});

function updateFeedPasses(url: string): boolean {
  const results = collectPreflightChecks({
    mode: "desktop",
    env: {
      NODE_ENV: "production",
      CSC_LINK: "base64-certificate",
      CSC_KEY_PASSWORD: "certificate-password",
      LIOS_UPDATE_URL: url,
    },
    cwd: "/repo/src",
    platform: "win32",
    existsSync: () => true,
    readFileSync: () => CURRENT_JOURNAL,
    execFile: (file) => {
      if (file === "python3") return "Python 3.12.6";
      throw new Error(`unexpected executable ${file}`);
    },
  });
  const result = results.find((entry) => entry.id === "desktop_update_feed");
  assert.ok(result);
  assert.equal(result.required, true);
  return result.pass;
}

test("desktop release feed accepts a credential-free public HTTPS directory", () => {
  assert.equal(updateFeedPasses("https://updates.example.com/lios/"), true);
});

test("desktop release feed rejects credentials, query secrets, fragments, and private network hosts", () => {
  for (const url of [
    "https://release-user:release-password@updates.example.com/lios/",
    "https://updates.example.com/lios/?token=secret",
    "https://updates.example.com/lios/#private-fragment",
    "https://10.0.0.7/lios/",
    "https://127.0.0.1/lios/",
    "https://169.254.10.8/lios/",
    "https://172.16.1.7/lios/",
    "https://192.168.1.7/lios/",
    "https://updates.local/lios/",
  ]) {
    assert.equal(updateFeedPasses(url), false, `expected update feed to be rejected: ${url}`);
  }
});
