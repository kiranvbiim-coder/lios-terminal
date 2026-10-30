// P12 voice routes -- the missing HTTP surface over the already-frozen
// server/p12VoiceRuntime.ts contract. Converts whatever audio format the
// browser recorded (MediaRecorder typically produces audio/webm;codecs=opus
// in Chromium/Electron) into 16kHz mono WAV via ffmpeg before handing it to
// the registered transcription provider, since whisper.cpp's CLI expects
// WAV and does not decode webm/opus itself.
import crypto from "crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./exec/run-command";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "./auth";
import { createMemoryUpload } from "./uploadPolicy";
import { assertExecutionAllowed, respondReadOnly } from "./accessMode";
import {
  listSpeechOutputProviders,
  listTranscriptionProviders,
  synthesizeSpeechOutput,
  transcribeVoiceInput,
} from "./p12VoiceRuntime";
import {
  inspectVoiceRuntimePublicStatus,
  inspectVoiceRuntimeSetup,
  refreshVoiceProviders,
  resolveVoiceFfmpegPath,
} from "./voiceProviderSetup";
import {
  VOICE_FFMPEG_MAX_OUTPUT_CHARS,
  VOICE_FFMPEG_TIMEOUT_MS,
  VOICE_MAX_AUDIO_SECONDS,
  VOICE_MAX_WAV_BYTES,
  VoiceTooLongError,
  wavDurationSeconds,
} from "./voiceLimits";
import { speechOutputPreferenceSchema } from "@shared/multimodalContracts";

const VOICE_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;
const upload = createMemoryUpload(["webm", "wav", "wave", "ogg", "mp3", "mp4", "m4a", "caf", "aiff"], VOICE_UPLOAD_LIMIT_BYTES);

const DEFAULT_TRANSCRIPTION_PROVIDER_ID = "lios.voice.whisper-cpp";

// Converts arbitrary browser-recorded audio bytes into 16kHz mono WAV.
// Returns the original bytes unchanged if they already look like a WAV
// container (RIFF/WAVE header) -- avoids an unnecessary round trip through
// ffmpeg for the common case where a caller already sends WAV.
export async function convertToWav(bytes: Buffer, mimeType: string): Promise<{ wav: Buffer; durationMs: number | null }> {
  const looksLikeWav = bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
  if (looksLikeWav) {
    // Passthrough still obeys the same ceiling; an unparseable header is left to the provider as before.
    const seconds = wavDurationSeconds(bytes);
    if (seconds !== null && seconds > VOICE_MAX_AUDIO_SECONDS) throw new VoiceTooLongError();
    return { wav: bytes, durationMs: seconds === null ? null : Math.round(seconds * 1000) };
  }

  const ffmpeg = resolveVoiceFfmpegPath();
  if (!ffmpeg) {
    throw new Error(
      `Voice input was recorded as "${mimeType}", which requires ffmpeg to convert to WAV, and ffmpeg is not installed on this machine.`,
    );
  }
  const stamp = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  const inputPath = path.join(os.tmpdir(), `lios-voice-in-${stamp}`);
  const outputPath = path.join(os.tmpdir(), `lios-voice-out-${stamp}.wav`);
  try {
    fs.writeFileSync(inputPath, bytes, { mode: 0o600 });
    await runCommand({
      // -t bounds decoded output to one second past the ceiling so an over-length recording is detected, not fully decoded.
      argv: [ffmpeg, "-y", "-i", inputPath, "-t", String(VOICE_MAX_AUDIO_SECONDS + 1), "-ar", "16000", "-ac", "1", "-f", "wav", outputPath],
      timeoutMs: VOICE_FFMPEG_TIMEOUT_MS,
      maxOutputChars: VOICE_FFMPEG_MAX_OUTPUT_CHARS,
    });
    if (!fs.existsSync(outputPath)) throw new Error("ffmpeg returned without a converted audio file.");
    const size = fs.statSync(outputPath).size;
    if (size > VOICE_MAX_WAV_BYTES) throw new VoiceTooLongError();
    const wav = fs.readFileSync(outputPath);
    const seconds = wavDurationSeconds(wav);
    return { wav, durationMs: seconds === null ? null : Math.round(seconds * 1000) };
  } finally {
    fs.rmSync(inputPath, { force: true });
    fs.rmSync(outputPath, { force: true });
  }
}

const speakBodySchema = z.object({
  text: z.string().trim().min(1).max(4_000),
  preference: speechOutputPreferenceSchema.partial().optional(),
});

export function registerVoiceRoutes(app: Express): void {
  app.get("/api/voice/setup", requireAuth, (_req: Request, res: Response) => {
    res.json(inspectVoiceRuntimeSetup());
  });

  app.post("/api/voice/setup/refresh", requireAuth, (_req: Request, res: Response) => {
    res.json(refreshVoiceProviders());
  });

  app.get("/api/voice/providers", requireAuth, (_req: Request, res: Response) => {
    res.json({
      transcription: listTranscriptionProviders(),
      speech: listSpeechOutputProviders(),
      runtime: inspectVoiceRuntimePublicStatus(),
    });
  });

  app.post("/api/voice/transcribe", requireAuth, upload.single("audio"), async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No audio uploaded. Attach a recording under the 'audio' field." });
      return;
    }
    const providerId = typeof req.body?.providerId === "string" && req.body.providerId.trim()
      ? req.body.providerId.trim()
      : DEFAULT_TRANSCRIPTION_PROVIDER_ID;
    const language = typeof req.body?.language === "string" && req.body.language.trim() ? req.body.language.trim() : null;

    try {
      await assertExecutionAllowed("ai");
      const { wav, durationMs } = await convertToWav(req.file.buffer, req.file.mimetype || "application/octet-stream");
      const transcript = await transcribeVoiceInput(providerId, {
        bytes: new Uint8Array(wav),
        mimeType: "audio/wav",
        fileName: req.file.originalname,
        language,
        durationMs,
      });
      res.json({ transcript });
    } catch (error) {
      if (respondReadOnly(res, error)) return;
      if (error instanceof VoiceTooLongError) {
        res.status(413).json({ error: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : "Voice transcription failed.";
      res.status(422).json({ error: message });
    }
  });

  app.post("/api/voice/speak", requireAuth, async (req: Request, res: Response) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const onClose = () => {
      if (!res.writableEnded) abort();
    };
    const onTimeout = () => {
      abort();
      if (!res.destroyed && !res.writableEnded) res.destroy();
    };
    // IncomingMessage "close" also fires on normal request-body completion.
    // Only a request abort or a prematurely closed response revokes synthesis.
    req.once("aborted", abort);
    res.once("close", onClose);
    res.once("timeout", onTimeout);
    const canRespond = () => !controller.signal.aborted && !req.aborted
      && !res.destroyed && !res.writableEnded && !res.headersSent;
    try {
      if (!canRespond()) return;
      let body: z.infer<typeof speakBodySchema>;
      try {
        body = speakBodySchema.parse(req.body);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request." });
        return;
      }
      const defaultProviderId = body.preference?.providerId ?? listSpeechOutputProviders()[0]?.id ?? null;
      if (!defaultProviderId) {
        res.status(404).json({ error: "No speech output provider is registered." });
        return;
      }
      const result = await synthesizeSpeechOutput(body.text, {
        enabled: true,
        providerId: defaultProviderId,
        voiceId: body.preference?.voiceId ?? null,
        rate: body.preference?.rate ?? 1,
        localOnly: body.preference?.localOnly ?? false,
      }, controller.signal);
      if (!canRespond()) return;
      if (!result) {
        res.status(404).json({ error: "No speech output provider is registered." });
        return;
      }
      res.setHeader("Content-Type", result.mimeType);
      res.setHeader("Content-Length", String(result.byteLength));
      res.send(Buffer.from(result.audio));
    } catch {
      if (canRespond()) res.status(422).json({ error: "Speech synthesis failed." });
    } finally {
      req.removeListener("aborted", abort);
      res.removeListener("close", onClose);
      res.removeListener("timeout", onTimeout);
    }
  });
}
