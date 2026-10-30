import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VOICE_MAX_AUDIO_SECONDS, VOICE_MAX_WAV_BYTES, VoiceTooLongError, wavDurationSeconds } from "./voiceLimits";

/** PCM WAV header (mono, 8-bit) declaring `declared` data bytes; the caller appends the actual data. */
function header(byteRate: number, declared: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii"); h.writeUInt32LE((36 + declared) >>> 0, 4); h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii"); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(byteRate, 24); h.writeUInt32LE(byteRate, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34);
  h.write("data", 36, "ascii"); h.writeUInt32LE(declared >>> 0, 40);
  return h;
}
const clip = (seconds: number, byteRate = 8_000) => Buffer.concat([header(byteRate, seconds * byteRate), Buffer.alloc(seconds * byteRate)]);

test("WAV duration comes from the header, only present bytes count, and malformed input is refused", () => {
  assert.equal(wavDurationSeconds(clip(5)), 5);
  assert.equal(wavDurationSeconds(clip(1_300)), 1_300);
  assert.equal(wavDurationSeconds(Buffer.concat([header(16_000, 16_000 * 600), Buffer.alloc(4096)])), 4096 / 16_000, "an inflated declaration cannot claim audio that is not there");
  assert.equal(wavDurationSeconds(Buffer.concat([header(16_000, 0xffffffff), Buffer.alloc(16_000)])), 1, "a streamed 0xFFFFFFFF size is bounded by present bytes");
  assert.equal(wavDurationSeconds(Buffer.from("RIFF....WAVE")), null);
  assert.equal(wavDurationSeconds(Buffer.alloc(100)), null);
  const hostile = Buffer.alloc(300); hostile.write("RIFF", 0); hostile.write("WAVE", 8);
  for (let offset = 12; offset + 8 <= 300; offset += 8) { hostile.write("junk", offset); hostile.writeUInt32LE(0, offset + 4); }
  assert.equal(wavDurationSeconds(hostile), null, "chunk walking terminates without a data chunk");
});

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-voice-limits-"));
process.env.LIMURIA_DATA_DIR = dataDir;
const { convertToWav } = await import("./voiceRoutes");

test("an over-length WAV is refused before any provider work and a short one reports its duration", async () => {
  await assert.rejects(convertToWav(clip(VOICE_MAX_AUDIO_SECONDS + 100), "audio/wav"), VoiceTooLongError);
  assert.equal((await convertToWav(clip(5), "audio/wav")).durationMs, 5_000);
  assert.equal((await convertToWav(clip(VOICE_MAX_AUDIO_SECONDS), "audio/wav")).durationMs, VOICE_MAX_AUDIO_SECONDS * 1000, "the ceiling itself is allowed");
});

test("compressed audio is converted by a bounded managed ffmpeg and an oversized result is refused", { skip: process.platform === "win32" ? "POSIX shell fixture" : false }, async t => {
  const argLog = path.join(dataDir, "ffmpeg-args.txt");
  const mode = path.join(dataDir, "mode.txt");
  const script = path.join(dataDir, "fake-ffmpeg.sh");
  fs.writeFileSync(script, `#!/bin/sh
if [ "$1" = "-version" ]; then echo "ffmpeg version 0-test"; exit 0; fi
echo "$@" > "${argLog}"
for last; do :; done
if [ "$(cat "${mode}")" = "big" ]; then
  head -c ${VOICE_MAX_WAV_BYTES + 1} /dev/zero > "$last"
else
  cp "${path.join(dataDir, "short.wav")}" "$last"
fi
`, { mode: 0o700 });
  fs.writeFileSync(path.join(dataDir, "short.wav"), clip(2, 16_000));
  fs.writeFileSync(path.join(dataDir, "voice-runtime.json"), JSON.stringify({ ffmpeg: script }));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  fs.writeFileSync(mode, "big");
  await assert.rejects(convertToWav(Buffer.from("not-really-opus"), "audio/webm"), VoiceTooLongError);
  assert.match(fs.readFileSync(argLog, "utf8"), new RegExp(`-t ${VOICE_MAX_AUDIO_SECONDS + 1} `), "decoding is bounded one second past the ceiling");
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("lios-voice-") && name.includes(String(process.pid))), [], "temporary audio is removed after refusal");

  fs.writeFileSync(mode, "short");
  const converted = await convertToWav(Buffer.from("not-really-opus"), "audio/webm");
  assert.equal(converted.durationMs, 2_000);
});
