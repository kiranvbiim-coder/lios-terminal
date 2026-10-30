import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";
import { getProcessSupervisor } from "./exec";
import { CommandExecutionError } from "./exec/run-command";
import type { ManagedRun, RunExit, SpawnInput, TerminationReason } from "./exec/types";
import { synthesizeSpeechOutput, unregisterSpeechOutputProvider } from "./p12VoiceRuntime";
import { inspectVoiceRuntimeSetup, refreshVoiceProviders } from "./voiceProviderSetup";

test("P12 voice runtime status is fail-closed and path-redacted", () => {
  const status = inspectVoiceRuntimeSetup();
  assert.equal(
    status.recordingReady,
    status.transcriptionProviderReady && status.ffmpeg.available,
    "microphone recording readiness must require transcription plus ffmpeg conversion",
  );
  assert.equal(
    status.transcriptionProviderReady,
    status.whisperExecutable.available && status.model.available,
    "transcription readiness must require both whisper executable and model",
  );
  for (const component of [status.whisperExecutable, status.model, status.ffmpeg]) {
    if (!component.name) continue;
    assert.equal(component.name, path.basename(component.name), "voice setup status must not expose an absolute local path");
    assert.equal(component.name.includes(path.sep), false, "voice setup status must expose only a file basename");
  }
});

function controlledSpeechRun() {
  const exit = Promise.withResolvers<RunExit>();
  const extinction = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<TerminationReason>();
  const activity = { resultSettled: false, lastOutputAtMs: Date.now() };
  const complete = (reason: TerminationReason = "exit") => {
    activity.resultSettled = true;
    exit.resolve({
      reason,
      exitCode: reason === "exit" ? 0 : null,
      exitSignal: reason === "exit" ? null : "SIGTERM",
      durationMs: 1,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: reason === "overall-timeout",
      noOutputTimedOut: false,
    });
  };
  const run: ManagedRun = {
    activity,
    runId: "test-speech-run",
    startedAtMs: Date.now(),
    wait: () => exit.promise,
    waitForExtinction: () => extinction.promise,
    cancel(reason = "manual-cancel") {
      cancelled.resolve(reason);
      complete(reason);
    },
  };
  return { run, complete, extinction, cancelled };
}

function macSpeechFixture(t: TestContext, runs: ManagedRun[]) {
  const commands: SpawnInput[] = [];
  const paths: string[] = [];
  const launched = runs.map(() => Promise.withResolvers<void>());
  t.mock.method(getProcessSupervisor(), "spawn", async (input: SpawnInput) => {
    const stage = commands.length;
    commands.push(input);
    assert.equal(input.argv[0], stage === 0 ? "/usr/bin/say" : "/usr/bin/afconvert");
    assert.equal(input.timeoutMs, 30_000, "native speech retains its existing per-stage deadline");
    assert.equal(input.maxCapturedOutputChars, 64 * 1024);
    const output = stage === 0 ? input.argv[input.argv.indexOf("-o") + 1] : input.argv.at(-1)!;
    paths.push(output);
    fs.writeFileSync(output, stage === 0 ? "AIFF" : "RIFF-test-WAVE");
    assert.ok(runs[stage], "cancelled speech must not launch another native stage");
    launched[stage].resolve();
    return runs[stage];
  });
  const exists = fs.existsSync;
  const existence = t.mock.method(fs, "existsSync", (file: fs.PathLike) =>
    file === "/usr/bin/say" || file === "/usr/bin/afconvert" || exists(file));
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
    refreshVoiceProviders();
  } finally {
    Object.defineProperty(process, "platform", platform);
    existence.mock.restore();
  }
  t.after(() => {
    unregisterSpeechOutputProvider("lios.voice.mac-say");
    for (const file of paths) fs.rmSync(file, { force: true });
  });
  return { commands, paths, launched };
}

for (const stage of ["say", "afconvert"] as const) {
  test(`macOS speech cancellation during ${stage} joins native extinction before deleting owned files`, async (t) => {
    const controller = new AbortController();
    const say = controlledSpeechRun();
    const conversion = controlledSpeechRun();
    if (stage === "afconvert") {
      say.complete();
      say.extinction.resolve();
    }
    t.after(() => {
      controller.abort();
      say.complete("manual-cancel");
      conversion.complete("manual-cancel");
      say.extinction.resolve();
      conversion.extinction.resolve();
    });
    const fixture = macSpeechFixture(t, stage === "say" ? [say.run] : [say.run, conversion.run]);
    let settled = false;
    const pending = synthesizeSpeechOutput("Read a local reply", {
      enabled: true,
      providerId: "lios.voice.mac-say",
      localOnly: true,
    }, controller.signal);
    const rejected = assert.rejects(pending, { name: "AbortError", message: "Speech synthesis was cancelled." });
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await fixture.launched[stage === "say" ? 0 : 1].promise;
    controller.abort(new Error("private-stop-reason"));
    const active = stage === "say" ? say : conversion;
    assert.equal(await active.cancelled.promise, "manual-cancel");
    assert.equal(settled, false);
    for (const file of fixture.paths) assert.equal(fs.existsSync(file), true, "files remain owned until native extinction");
    active.extinction.resolve();
    await rejected;
    assert.equal(fixture.commands.length, stage === "say" ? 1 : 2);
    for (const file of fixture.paths) assert.equal(fs.existsSync(file), false);
    // The WAV path is owned even when cancellation prevents afconvert from starting.
    assert.equal(fs.existsSync(fixture.paths[0].replace(/\\.aiff$/, ".wav")), false);
  });
}

test("macOS speech timeout rejects partial audio and joins extinction before file cleanup", async (t) => {
  const say = controlledSpeechRun();
  const conversion = controlledSpeechRun();
  say.complete();
  say.extinction.resolve();
  conversion.complete("overall-timeout");
  t.after(() => { conversion.extinction.resolve(); });
  const fixture = macSpeechFixture(t, [say.run, conversion.run]);
  const pending = synthesizeSpeechOutput("Read a local reply", {
    enabled: true,
    providerId: "lios.voice.mac-say",
    localOnly: true,
  });
  const rejected = assert.rejects(pending, (error: unknown) =>
    error instanceof CommandExecutionError && error.result.timedOut);
  await fixture.launched[1].promise;
  for (const file of fixture.paths) assert.equal(fs.existsSync(file), true);
  conversion.extinction.resolve();
  await rejected;
  for (const file of fixture.paths) assert.equal(fs.existsSync(file), false);
});

test("macOS speech cancels between native stages without launching conversion", async (t) => {
  const controller = new AbortController();
  const say = controlledSpeechRun();
  say.complete();
  say.run.waitForExtinction = async () => { controller.abort(new Error("private-stop-reason")); };
  const fixture = macSpeechFixture(t, [say.run]);
  await assert.rejects(synthesizeSpeechOutput("Read a local reply", {
    enabled: true,
    providerId: "lios.voice.mac-say",
    localOnly: true,
  }, controller.signal), { name: "AbortError", message: "Speech synthesis was cancelled." });
  assert.equal(fixture.commands.length, 1);
  for (const file of fixture.paths) assert.equal(fs.existsSync(file), false);
});

test("macOS speech without a signal returns audio only after both managed stages and removes both files", async (t) => {
  const say = controlledSpeechRun();
  const conversion = controlledSpeechRun();
  for (const native of [say, conversion]) { native.complete(); native.extinction.resolve(); }
  const fixture = macSpeechFixture(t, [say.run, conversion.run]);
  const result = await synthesizeSpeechOutput("Read a local reply", {
    enabled: true,
    providerId: "lios.voice.mac-say",
    voiceId: "test-voice",
    rate: 1.5,
    localOnly: true,
  });
  assert.equal(result?.mimeType, "audio/wav");
  assert.deepEqual(result?.audio, Buffer.from("RIFF-test-WAVE"));
  assert.equal(result?.voiceId, "test-voice");
  assert.deepEqual(fixture.commands[0].argv.slice(3), ["-r", "263", "-v", "test-voice", "Read a local reply"]);
  assert.equal(fixture.commands.length, 2);
  for (const file of fixture.paths) assert.equal(fs.existsSync(file), false);
});
