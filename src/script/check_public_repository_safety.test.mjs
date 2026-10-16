import assert from "node:assert/strict";
import test from "node:test";
import { unsafeContent, unsafeTrackedPath, unsafeWorkflow } from "./check_public_repository_safety.mjs";

test("permits declared environment templates and ordinary source files", () => {
  for (const path of [".env.example", "src/.env.example", "src/.env.production.template",
    "src/server/sessionSecret.ts", "src/desktopSecretCustody.test.cjs",
    "src/vendor/xlsx-0.20.3.tgz"]) {
    assert.equal(unsafeTrackedPath(path), null, path);
  }
});

test("rejects credentials, private key material and runtime databases", () => {
  for (const path of ["src/.env", ".env.local", ".env.production",
    "src/.npmrc", "src/config/.aws/credentials", "src/id_ed25519",
    "keys/signing.p12", "customer.sqlite", "backup.dump", "service-account.json"]) {
    assert.ok(unsafeTrackedPath(path), path);
  }
});

test("detects high-confidence credential material inside ordinary text files", () => {
  const fixtures = [
    "-----BEGIN " + "PRIVATE KEY-----\n" + "QUJD".repeat(20) + "\n-----END PRIVATE KEY-----",
    "token=" + "sk-" + "proj-" + "AbCdEf0123456789AbCdEf0123456789",
    "token=" + "sk-" + "ant-api03-" + "AbCdEf0123456789AbCdEf0123456789",
    "token=" + "ghp_" + "AbCdEf0123456789AbCdEf0123456789AbCd",
    "token=" + "github_pat_" + "11AA22BB33CC44DD55EE66FF77GG88HH99II",
    "AWS_ACCESS_KEY_ID=" + "AKIA" + "ABCDEFGHIJKLMNOP",
    "slack=" + "xoxb-" + "123456789012-123456789012-AbCdEfGhIjKlMnOp",
    "google=" + "AIza" + "AbCdEfGhIjKlMnOpQrStUvWxYz012345678",
    "stripe=" + "sk_" + "live_" + "AbCdEf0123456789AbCdEf0123456789",
  ];
  for (const fixture of fixtures) assert.ok(unsafeContent(fixture), fixture.slice(0, 18));
});

test("does not flag documentation-style placeholders or harmless text", () => {
  for (const fixture of [
    "OPENAI_API_KEY=your-key-here",
    "GITHUB_TOKEN=<token>",
    "postgresql://user:password@localhost:5432/example",
    "-----BEGIN PUBLIC KEY-----",
    "sk-proj-example",
    "AKIAEXAMPLE",
  ]) assert.equal(unsafeContent(fixture), null, fixture);
});

test("accepts unprivileged hosted source workflows", () => {
  const yaml = ["on:", "  pull_request:", "permissions:", "  contents: read",
    "jobs:", "  source:", "    runs-on: ubuntu-24.04", "    steps:",
    "      - run: echo test"].join("\n");
  assert.equal(unsafeWorkflow(yaml), null);
});

test("rejects privileged triggers and runners", () => {
  for (const yaml of [
    "on:\n  pull_request_target:\n",
    "on:\n  workflow_run:\n",
    "jobs:\n  scan:\n    runs-on: self-hosted\n",
    "permissions: write-all\n",
    "permissions:\n  id-token: write\n",
    "secrets: inherit\n",
  ]) assert.ok(unsafeWorkflow(yaml), yaml);
});

test("ignores commented-out workflow examples", () => {
  assert.equal(unsafeWorkflow("# pull_request_target:\n# runs-on: self-hosted\npermissions:\n  contents: read\n"), null);
});
