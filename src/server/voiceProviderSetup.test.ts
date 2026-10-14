import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { inspectVoiceRuntimeSetup } from "./voiceProviderSetup";

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
