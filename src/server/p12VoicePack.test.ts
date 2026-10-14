import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { p12VoiceRuntimePublicStatus, resolveP12VoiceRuntime } from "./p12VoicePack";

test("P12 discovers a complete managed lios.voice pack without network or PATH assumptions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p12-voice-"));
  try {
    const pack = path.join(root, "runtime-packs", "lios.voice", "current");
    const bin = path.join(pack, "bin");
    const models = path.join(pack, "models");
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(models, { recursive: true });
    const suffix = process.platform === "win32" ? ".exe" : "";
    fs.writeFileSync(path.join(bin, "whisper-cli" + suffix), "fixture");
    fs.writeFileSync(path.join(bin, "ffmpeg" + suffix), "fixture");
    fs.writeFileSync(path.join(models, "ggml-tiny.en.bin"), "fixture");

    const resolved = resolveP12VoiceRuntime({
      dataDir: root,
      resourcesPath: null,
      env: {},
      platform: process.platform,
      systemLookup: () => null,
    });

    assert.equal(resolved.transcriptionReady, true);
    assert.equal(resolved.browserRecordingReady, true);
    assert.equal(resolved.sources.whisper, "managed_pack");
    assert.equal(resolved.sources.model, "managed_pack");
    assert.equal(resolved.sources.ffmpeg, "managed_pack");
    assert.equal(resolved.installPolicy, "user_or_release_provisioned_no_silent_download");

    const publicStatus = p12VoiceRuntimePublicStatus(resolved);
    assert.equal(publicStatus.whisperBinaryFound, true);
    assert.equal(publicStatus.modelFound, true);
    assert.equal(publicStatus.ffmpegFound, true);
    assert.equal(JSON.stringify(publicStatus).includes(root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("P12 reports missing optional assets honestly and never implies a silent download", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p12-voice-empty-"));
  try {
    const resolved = resolveP12VoiceRuntime({
      dataDir: root,
      resourcesPath: null,
      env: {},
      platform: process.platform,
      systemLookup: () => null,
    });
    const status = p12VoiceRuntimePublicStatus(resolved);
    assert.equal(status.transcriptionReady, false);
    assert.equal(status.browserRecordingReady, false);
    assert.match(status.guidance, /whisper\.cpp binary/);
    assert.match(status.guidance, /Whisper model/);
    assert.match(status.guidance, /ffmpeg/);
    assert.equal(status.installPolicy, "user_or_release_provisioned_no_silent_download");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("P12 explicit user-selected runtime paths take precedence over managed-pack discovery", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p12-voice-explicit-"));
  try {
    const selected = path.join(root, "selected");
    const managed = path.join(root, "runtime-packs", "lios.voice", "current");
    fs.mkdirSync(selected, { recursive: true });
    fs.mkdirSync(path.join(managed, "bin"), { recursive: true });
    fs.mkdirSync(path.join(managed, "models"), { recursive: true });
    const suffix = process.platform === "win32" ? ".exe" : "";
    const selectedWhisper = path.join(selected, "whisper-cli" + suffix);
    const selectedFfmpeg = path.join(selected, "ffmpeg" + suffix);
    const selectedModel = path.join(selected, "ggml-base.en.bin");
    for (const file of [selectedWhisper, selectedFfmpeg, selectedModel]) fs.writeFileSync(file, "fixture");
    fs.writeFileSync(path.join(managed, "bin", "whisper-cli" + suffix), "managed");
    fs.writeFileSync(path.join(managed, "bin", "ffmpeg" + suffix), "managed");
    fs.writeFileSync(path.join(managed, "models", "ggml-tiny.en.bin"), "managed");

    const resolved = resolveP12VoiceRuntime({
      dataDir: root,
      resourcesPath: null,
      env: {},
      platform: process.platform,
      explicitPaths: { whisperExecutable: selectedWhisper, model: selectedModel, ffmpeg: selectedFfmpeg },
      systemLookup: () => null,
    });
    assert.equal(resolved.whisperExecutable, path.resolve(selectedWhisper));
    assert.equal(resolved.modelPath, path.resolve(selectedModel));
    assert.equal(resolved.ffmpegPath, path.resolve(selectedFfmpeg));
    assert.deepEqual(resolved.sources, { whisper: "user_config", model: "user_config", ffmpeg: "user_config" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
