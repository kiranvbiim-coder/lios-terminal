import assert from "node:assert/strict";
import test from "node:test";
import {
  assertIsolationV2Accepted,
  buildIsolationV2Evidence,
} from "./isolation-v2-evidence";

test("V2 evidence counts required and unavailable checks without hiding gaps", () => {
  const evidence = buildIsolationV2Evidence({
    engine: "docker",
    engineTarget: "unix:///var/run/docker.sock",
    image: "example@sha256:" + "a".repeat(64),
    platform: "darwin",
    arch: "arm64",
    node: "v22.16.0",
    now: "2026-10-04T00:00:00.000Z",
    checks: [
      { id: "network", required: true, status: "pass", detail: "denied" },
      { id: "extinction", required: true, status: "fail", detail: "orphan" },
      { id: "browser", required: false, status: "unavailable", detail: "broker missing" },
    ],
  });
  assert.equal(evidence.schemaVersion, "2");
  assert.equal(evidence.target.engineTarget, "unix:///var/run/docker.sock");
  assert.deepEqual(evidence.summary, {
    passed: 1,
    failed: 1,
    unavailable: 1,
    requiredPassed: 1,
    requiredFailed: 1,
  });
  assert.throws(() => assertIsolationV2Accepted(evidence), /extinction=fail/);
});

test("V2 acceptance refuses evidence without an explicit local engine socket", () => {
  const evidence = buildIsolationV2Evidence({
    engine: "docker",
    engineTarget: "tcp://127.0.0.1:2375",
    image: "example@sha256:" + "d".repeat(64),
    platform: "darwin",
    checks: [{ id: "network", required: true, status: "pass", detail: "denied" }],
  });
  assert.throws(() => assertIsolationV2Accepted(evidence), /explicit local unix:\/\/ engine target/);
});

test("V2 acceptance requires macOS even when sandbox checks pass elsewhere", () => {
  const evidence = buildIsolationV2Evidence({
    engine: "podman",
    engineTarget: "unix:///run/user/1000/podman/podman.sock",
    image: "example@sha256:" + "b".repeat(64),
    platform: "linux",
    checks: [{ id: "network", required: true, status: "pass", detail: "denied" }],
  });
  assert.throws(() => assertIsolationV2Accepted(evidence), /must run on the macOS target/);
});

test("optional unavailable capabilities do not invalidate the SP-01 sandbox proof", () => {
  const evidence = buildIsolationV2Evidence({
    engine: "docker",
    engineTarget: "unix:///var/run/docker.sock",
    image: "example@sha256:" + "c".repeat(64),
    platform: "darwin",
    checks: [
      { id: "network", required: true, status: "pass", detail: "denied" },
      { id: "extinction", required: true, status: "pass", detail: "absent" },
      { id: "browser", required: false, status: "unavailable", detail: "later SI phase" },
    ],
  });
  assert.doesNotThrow(() => assertIsolationV2Accepted(evidence));
});
