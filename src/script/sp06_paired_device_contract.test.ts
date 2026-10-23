import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertSp06HomeIdentity, parseSp06Target } from "./sp06_paired_device_contract";

test("SP-06 target intake refuses non-disposable Home, wrong target and unexpected remote endpoints", t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lios-sp06-contract-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const binary = path.join(tmp, "app");
  fs.writeFileSync(binary, "executable-fixture");
  const env = {
    LIOS_SP06_DISPOSABLE_HOME: "1",
    LIOS_SP06_HOME_ORIGIN: "http://127.0.0.1:4321",
    LIOS_SP06_DEVICE_WSS_URL: "wss://127.0.0.1:8822/gateway/device",
    LIOS_SP06_TLS_FINGERPRINT: "a".repeat(64),
    LIOS_SP06_PROJECT_ID: "41",
    LIOS_SP06_APP_BINARY: binary,
    LIOS_SP06_TARGET_COMMIT: "b".repeat(40),
    LIOS_SP06_OWNER_COOKIE: "lios.sid=synthetic-not-real",
  };
  const target = parseSp06Target(env);
  assert.equal(target.projectId, 41);
  assert.equal(target.cookie, env.LIOS_SP06_OWNER_COOKIE);
  assert.equal(assertSp06HomeIdentity(target, { enabled: true, fingerprint: "a".repeat(64),
    homeId: "e7787faf-d78c-438a-9e83-0f6c31e3a991", port: 8822 }), "e7787faf-d78c-438a-9e83-0f6c31e3a991");
  for (const bad of [
    { LIOS_SP06_DISPOSABLE_HOME: "" },
    { LIOS_SP06_HOME_ORIGIN: "https://example.com" },
    { LIOS_SP06_HOME_ORIGIN: "http://evil:pass@localhost:4321/" },
    { LIOS_SP06_DEVICE_WSS_URL: "ws://127.0.0.1:8822/gateway/device" },
    { LIOS_SP06_DEVICE_WSS_URL: "wss://remote.example.com/gateway/device" },
    { LIOS_SP06_TLS_FINGERPRINT: "wrong" },
    { LIOS_SP06_PROJECT_ID: "-1" },
    { LIOS_SP06_APP_BINARY: path.join(tmp, "missing") },
    { LIOS_SP06_TARGET_COMMIT: "latest" },
    { LIOS_SP06_OWNER_COOKIE: "cookie\r\ninjected" },
  ]) assert.throws(() => parseSp06Target({ ...env, ...bad }));
  assert.throws(() => assertSp06HomeIdentity(target, { enabled: true, fingerprint: "c".repeat(64),
    homeId: "e7787faf-d78c-438a-9e83-0f6c31e3a991", port: 8822 }), /does not match/);
  assert.throws(() => assertSp06HomeIdentity(target, { enabled: true, fingerprint: "a".repeat(64),
    homeId: "e7787faf-d78c-438a-9e83-0f6c31e3a991", port: 12 }), /port/);
});
