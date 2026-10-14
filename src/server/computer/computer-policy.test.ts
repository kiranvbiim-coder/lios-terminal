import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GovernedToolRegistry, GovernedToolDeniedError } from "../governedTools";
import { localExecutionBackend } from "../exec/backends/local";
import { classifyComputerAction, COMPUTER_ACTION_NAMES } from "./risk-policy";
import { registerComputerAssessment, type ComputerAssessmentResult } from "./governed-computer";
import { assertComputerCaptureScope, assertComputerExecutionAvailable, ComputerRuntimeUnavailableError } from "./native-boundary";
import { inspectCuaDriverArtifacts } from "./driver-artifact-verification";
import { adoptGeneration, issueFrame, issueWindowRef, issueObservation, resolveObservation, type CuaFrameState } from "./frame";
import { parseKeyChord, scalePoint } from "./actions";

const assessment = { action: "left_click", targetApp: "TextEdit", windowRef: "window", captureScope: "window" };

test("complete donor action vocabulary separates observations from consequential input", () => {
  assert.equal(COMPUTER_ACTION_NAMES.length, 40);
  for (const action of COMPUTER_ACTION_NAMES) {
    const risk = classifyComputerAction({ ...assessment, action,
      ...(action === "browser_dialog" ? { dialogAction: "inspect" } : {}),
      ...(["key", "hold_key"].includes(action) ? { keys: "cmd+a" } : {}),
    });
    if (risk.family === "observation") {
      assert.equal(risk.sideEffect, "none");
      assert.equal(risk.replaySafe, true);
    } else {
      assert.equal(risk.permissionClass, "user_confirm");
      assert.equal(risk.sideEffect, "external");
      assert.equal(risk.replaySafe, false);
    }
  }
  for (const [action, family] of [
    ["kill_app", "process_termination"], ["browser_navigate", "browser_navigation"],
    ["browser_download", "browser_download"], ["browser_set_input_files", "browser_file_input"],
    ["start_recording", "recording_start"], ["replay_trajectory", "recording_replay"],
    ["escalate_scope", "desktop_scope_escalation"],
  ]) {
    assert.equal(classifyComputerAction({ ...assessment, action }).family, family);
    assert.equal(classifyComputerAction({ ...assessment, action }).level, "high");
  }
  assert.equal(classifyComputerAction({ ...assessment, action: "browser_dialog", dialogAction: "accept" }).sideEffect, "external");
});

test("raw native controls, self approval and unknown actions do not enter the assessment seam", () => {
  for (const input of [
    { ...assessment, action: "__close_execution" },
    { ...assessment, binaryPath: "/tmp/cua" }, { ...assessment, socketPath: "/tmp/cua.sock" },
    { ...assessment, session: "native-session" }, { ...assessment, approval: true },
    { ...assessment, driverArgs: ["--dangerously-bypass-approvals"] },
    { ...assessment, dialogAction: "inspect" },
  ]) assert.throws(() => classifyComputerAction(input));
  assert.notEqual(classifyComputerAction(assessment).assessmentDigest,
    classifyComputerAction({ ...assessment, targetApp: "Safari" }).assessmentDigest);
});

test("assessment uses the supplied L1 registry; native actions remain absent and denied tools never invoke", async () => {
  const registry = new GovernedToolRegistry<"computer", ComputerAssessmentResult>();
  registerComputerAssessment(registry, "computer");
  const signal = new AbortController().signal;
  const result = await registry.invoke("computer.assess", assessment, signal, { source: "agent", role: "owner" });
  assert.equal(result.nativeAvailable, false);
  assert.equal(result.sideEffect, "external");
  assert.equal(registry.get("computer.act"), null);
  let invoked = false;
  registry.register({ ...registry.get("computer.assess")!, id: "computer.denied", permissionClass: "denied",
    invoke: async () => { invoked = true; return result; } });
  await assert.rejects(registry.invoke("computer.denied", assessment, signal, { role: "owner" }), GovernedToolDeniedError);
  assert.equal(invoked, false);
  await assert.rejects(registry.invoke("computer.assess", assessment, AbortSignal.abort(new Error("private reason")), { role: "owner" }));
});

test("canonical host backend cannot accidentally activate native execution", () => {
  for (const backend of [undefined, localExecutionBackend]) {
    assert.throws(() => assertComputerExecutionAvailable(backend), ComputerRuntimeUnavailableError);
  }
});

test("capture never widens an explicit window grant or reuses references across reconnect", () => {
  const state: CuaFrameState = { generation: "first" };
  const windowRef = issueWindowRef(state, { pid: 12, windowId: 34 });
  const args = { scope: "window" as const, authorizedScope: "window" as const,
    windowRef, authorizedWindowRef: windowRef, generation: "first", state };
  assert.doesNotThrow(() => assertComputerCaptureScope(args));
  assert.throws(() => assertComputerCaptureScope({ ...args, scope: "desktop" }), /CAPTURE_SCOPE_DENIED/);
  assert.throws(() => assertComputerCaptureScope({ ...args, authorizedWindowRef: "other" }), /CAPTURE_SCOPE_DENIED/);
  const old = issueObservation(state, windowRef);
  issueObservation(state, windowRef);
  assert.throws(() => resolveObservation(state, old.id, windowRef), /STALE_OBSERVATION/);
  adoptGeneration(state, "second");
  assert.throws(() => assertComputerCaptureScope({ ...args, generation: "second" }), /STALE_OBSERVATION/);
});

test("frame integrity bounds coordinates and rejects stale geometry and reference width", () => {
  const state: CuaFrameState = { generation: "one" };
  const geometry = { platform: "darwin", display: "primary", screenWidth: 100, screenHeight: 80,
    scaleFactor: 2, screenshotWidth: 200, screenshotHeight: 160 };
  issueFrame(state, geometry, { width: 100, height: 80, referenceWidth: 100 });
  const frame = state.lastFrame!;
  assert.deepEqual(scalePoint(frame, 50, 40, "click"), { x: 100, y: 80 });
  for (const x of [-1, NaN, Infinity, 100]) assert.throws(() => scalePoint(frame, x, 0, "click"));
  assert.deepEqual(parseKeyChord("command+a", "darwin"), { key: "a", modifiers: ["cmd"] });
  assert.throws(() => parseKeyChord("cmd+!", "darwin"), /UNSUPPORTED_KEY/);
  const windowRef = issueWindowRef(state, { pid: 12, windowId: 34 });
  const scope = { scope: "window" as const, authorizedScope: "window" as const, state,
    windowRef, authorizedWindowRef: windowRef, generation: "one",
    frame: { id: frame.id, geometry: { width: 100, height: 80, scaleFactor: 2 }, referenceWidth: 100 } };
  assert.doesNotThrow(() => assertComputerCaptureScope(scope));
  assert.throws(() => assertComputerCaptureScope({ ...scope,
    frame: { ...scope.frame, referenceWidth: 99 } }), /STALE_FRAME/);
  issueFrame(state, geometry, { width: 100, height: 80, referenceWidth: 100 });
  assert.throws(() => assertComputerCaptureScope({ ...scope,
    frame: { ...scope.frame, geometry: { width: 101, height: 80, scaleFactor: 2 } } }), /STALE_FRAME/);
});

test("native package integrity checks version, digest, missing file, symlink and macOS non-applicability", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-cua-integrity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const platform = path.join(root, "platform");
  fs.mkdirSync(platform);
  const sdk = path.join(root, "sdk.json");
  const platformJson = path.join(platform, "package.json");
  const native = path.join(platform, "libcua_driver_sdk.so");
  fs.writeFileSync(sdk, JSON.stringify({ name: "@trycua/cua-driver", version: "0.28.2" }));
  fs.writeFileSync(platformJson, JSON.stringify({ name: "@trycua/cua-driver-linux-x64-gnu", version: "0.28.2" }));
  fs.writeFileSync(native, "integrity test bytes, not a native driver");
  const digest = createHash("sha256").update(fs.readFileSync(native)).digest("hex");
  const options = { platform: "linux" as const, arch: "x64", linuxLibc: "gnu" as const,
    pluginManifest: { dependencies: { "@trycua/cua-driver": "0.28.2" },
      cuaDriverArtifacts: { "linux-x64-gnu": { files: { "libcua_driver_sdk.so": digest } } } },
    resolvePackageJson: (name: string) => name === "@trycua/cua-driver" ? sdk : platformJson };
  assert.equal(inspectCuaDriverArtifacts(options).ok, true);
  assert.equal(inspectCuaDriverArtifacts({ ...options, platform: "darwin" }).ok, false);
  fs.writeFileSync(native, "altered");
  assert.equal(inspectCuaDriverArtifacts(options).ok, false);
  fs.unlinkSync(native);
  assert.equal(inspectCuaDriverArtifacts(options).ok, false);
  fs.symlinkSync(sdk, native);
  assert.equal(inspectCuaDriverArtifacts(options).ok, false);
  fs.writeFileSync(platformJson, JSON.stringify({ name: "@trycua/cua-driver-linux-x64-gnu", version: "0.27.0" }));
  assert.equal(inspectCuaDriverArtifacts(options).ok, false);
});

test("CUA donor geometry guard refuses malformed frames before computing native pixel coordinates", () => {
  const state: CuaFrameState = { generation: "trusted" };
  issueFrame(state, {
    platform: "darwin", display: "primary", screenWidth: 100, screenHeight: 80,
    scaleFactor: 2, screenshotWidth: 200, screenshotHeight: 160,
  }, { width: 100, height: 80, referenceWidth: 100 });
  const frame=state.lastFrame!;
  assert.deepEqual(scalePoint(frame,99,79,"click"),{x:198,y:158});
  for (const dimension of ["referenceWidth","deliveredWidth","deliveredHeight","nativeWidth","nativeHeight"] as const) {
    for (const value of [0,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER]) {
      assert.throws(()=>scalePoint({...frame,[dimension]:value},1,1,"click"),/INVALID_REQUEST/);
    }
  }
  for (const badGeometry of [
    {...frame.geometry,scaleFactor:NaN},
    {...frame.geometry,scaleFactor:0},
    {...frame.geometry,width:0},
    {...frame.geometry,height:Infinity},
  ]) {
    assert.throws(()=>scalePoint({...frame,geometry:badGeometry},1,1,"click"),/INVALID_REQUEST/);
  }
  assert.throws(()=>scalePoint(frame,Infinity,1,"click"),/INVALID_REQUEST/);
  assert.throws(()=>scalePoint(frame,100,1,"click"),/outside/);
});
