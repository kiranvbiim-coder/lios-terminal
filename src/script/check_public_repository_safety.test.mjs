import assert from "node:assert/strict";
import test from "node:test";
import { unsafeTrackedPath, unsafeWorkflow } from "./check_public_repository_safety.mjs";

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
