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
import { speechOutputPreferenceSchema } from "@shared/multimodalContracts";

const VOICE_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;
const upload = createMemoryUpload(["webm", "wav", "wave", "ogg", "mp3", "mp4", "m4a", "caf", "aiff"], VOICE_UPLOAD_LIMIT_BYTES);

const DEFAULT_TRANSCRIPTION_PROVIDER_ID = "lios.voice.whisper-cpp";

// Converts arbitrary browser-recorded audio bytes into 16kHz mono WAV.
// Returns the original bytes unchanged if they already look like a WAV
// container (RIFF/WAVE header) -- avoids an unnecessary round trip through
// ffmpeg for the common case where a caller already sends WAV.
async function convertToWav(bytes: Buffer, mimeType: string): Promise<Buffer> {
  const looksLikeWav = bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
  if (looksLikeWav) return bytes;

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
      argv: [ffmpeg, "-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-f", "wav", outputPath],
      timeoutMs: 60_000,
      maxOutputChars: 64 * 1024,
    });
    if (!fs.existsSync(outputPath)) throw new Error("ffmpeg returned without a converted audio file.");
    return fs.readFileSync(outputPath);
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
      const wav = await convertToWav(req.file.buffer, req.file.mimetype || "application/octet-stream");
      const transcript = await transcribeVoiceInput(providerId, {
        bytes: new Uint8Array(wav),
        mimeType: "audio/wav",
        fileName: req.file.originalname,
        language,
        durationMs: null,
      });
      res.json({ transcript });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Voice transcription failed.";
      res.status(422).json({ error: message });
    }
  });

  app.post("/api/voice/speak", requireAuth, async (req: Request, res: Response) => {
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
    try {
      const result = await synthesizeSpeechOutput(body.text, {
        enabled: true,
        providerId: defaultProviderId,
        voiceId: body.preference?.voiceId ?? null,
        rate: body.preference?.rate ?? 1,
        localOnly: body.preference?.localOnly ?? false,
      });
      if (!result) {
        res.status(404).json({ error: "No speech output provider is registered." });
        return;
      }
      res.setHeader("Content-Type", result.mimeType);
      res.setHeader("Content-Length", String(result.byteLength));
      res.send(Buffer.from(result.audio));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Speech synthesis failed.";
      res.status(422).json({ error: message });
    }
  });
}
