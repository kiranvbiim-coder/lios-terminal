import fs from "node:fs";
import { benchmarkWhisperCpp } from "../server/p12VoiceRuntime";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the P12 whisper.cpp benchmark.`);
  return value;
}

const executable = required("WHISPER_CPP_BIN");
const model = required("WHISPER_CPP_MODEL");
const audioFile = required("WHISPER_CPP_AUDIO");
const duration = Number(required("WHISPER_CPP_AUDIO_DURATION_MS"));
if (!Number.isFinite(duration) || duration <= 0) throw new Error("WHISPER_CPP_AUDIO_DURATION_MS must be a positive number.");
if (!fs.existsSync(executable)) throw new Error("WHISPER_CPP_BIN does not exist.");
if (!fs.existsSync(model)) throw new Error("WHISPER_CPP_MODEL does not exist.");
if (!fs.existsSync(audioFile)) throw new Error("WHISPER_CPP_AUDIO does not exist.");

const result = await benchmarkWhisperCpp({
  executable,
  model,
  audioFile,
  audioDurationMs: duration,
  language: process.env.WHISPER_CPP_LANGUAGE?.trim() || null,
  peakRssMb: process.env.WHISPER_CPP_PEAK_RSS_MB ? Number(process.env.WHISPER_CPP_PEAK_RSS_MB) : null,
});
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
