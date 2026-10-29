// Client-side wiring for the P12 voice runtime (server/p12VoiceRuntime.ts +
// server/voiceRoutes.ts). Records a short clip with MediaRecorder, uploads
// it to /api/voice/transcribe, and returns the transcript text for the
// caller to place in the composer for review before sending -- this keeps
// every voice command going through the exact same send() path (and the
// same permission/approval gates) as a typed message.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { playReplySpeech, ReplySpeechError } from "./replySpeech";
import { voiceTranscriptSchema, type VoiceTranscript } from "@shared/multimodalContracts";
import { voiceFailureCopy } from "./composerAvailability";

export type VoiceTranscriptResult = VoiceTranscript;
const VOICE_PUBLIC_FAILURES = {
  invalid: voiceFailureCopy("invalid"),
  network: voiceFailureCopy("network"),
  denied: voiceFailureCopy(403),
  auth: voiceFailureCopy(401),
  tooLarge: voiceFailureCopy(413),
  limited: voiceFailureCopy(429),
  unknown: voiceFailureCopy(422),
} as const;

interface VoiceProvidersResponse {
  transcription: Array<{ id: string; label: string; local: boolean }>;
  speech: Array<{ id: string; label: string; local: boolean }>;
  runtime?: {
    packId: "lios.voice";
    managedPackRelativeRoot: string;
    whisperBinaryFound: boolean;
    modelFound: boolean;
    ffmpegFound: boolean;
    transcriptionReady: boolean;
    browserRecordingReady: boolean;
    sources: {
      whisper: string | null;
      model: string | null;
      ffmpeg: string | null;
    };
    installPolicy: "user_or_release_provisioned_no_silent_download";
    guidance: string;
  };
}

export function useVoiceProviders() {
  return useQuery<VoiceProvidersResponse>({
    queryKey: ["/api/voice/providers"],
    staleTime: 60_000,
  });
}

function pickRecorderMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(candidate)) return candidate;
  }
  return "";
}

export function useVoiceRecorder(onTranscript: (result: VoiceTranscriptResult) => void, ownerKey = "") {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const owner = useRef({ key: ownerKey, generation: 0 });
  if (owner.current.key !== ownerKey) owner.current = { key: ownerKey, generation: owner.current.generation + 1 };
  const pending = useRef(false);
  const transcription = useRef<AbortController | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    owner.current.generation += 1;
    transcription.current?.abort(); transcription.current = null;
    const recorder = recorderRef.current;
    if (recorder) { recorder.onstop = null; recorder.ondataavailable = null; if (recorder.state !== "inactive") recorder.stop(); }
    recorderRef.current = null; chunksRef.current = []; pending.current = false;
    stopStream(); setIsRecording(false); setIsTranscribing(false); setError(null);
  }, [stopStream]);
  useEffect(() => { cancel(); return cancel; }, [ownerKey, cancel]);

  const start = useCallback(async () => {
    if (pending.current) return;
    const generation = owner.current.generation;
    const current = () => owner.current.generation === generation;
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Microphone access is not available in this environment.");
      return;
    }
    pending.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!current()) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (current() && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        if (!current()) return;
        setIsRecording(false);
        stopStream();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size === 0) {
          setError("No audio was captured.");
          pending.current = false;
          return;
        }
        setIsTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "voice-input.webm");
          const controller = new AbortController();
          transcription.current = controller;
          const res = await fetch("/api/voice/transcribe", { method: "POST", body: form, signal: controller.signal });
          // The server can include provider diagnostics, system paths, or
          // credential-bearing details in error bodies. Never surface them.
          if (!res.ok) throw new Error(voiceFailureCopy(res.status));
          let payload: unknown;
          try { payload = await res.json(); }
          catch { throw new Error(voiceFailureCopy("invalid")); }
          const parsed = voiceTranscriptSchema.safeParse(
            payload && typeof payload === "object" && "transcript" in payload ? payload.transcript : null,
          );
          if (!parsed.success) throw new Error(voiceFailureCopy("invalid"));
          const transcript = parsed.data;
          if (current()) onTranscript(transcript);
        } catch (transcribeError) {
          if (!current()) return;
          setError(transcribeError instanceof Error
            && Object.values(VOICE_PUBLIC_FAILURES).includes(transcribeError.message)
            ? transcribeError.message : voiceFailureCopy("network"));
        } finally {
          if (current()) { pending.current = false; transcription.current = null; setIsTranscribing(false); }
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (permissionError) {
      if (!current()) return;
      pending.current = false;
      setError(voiceFailureCopy("microphone"));
      stopStream();
    }
  }, [onTranscript, stopStream]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const toggle = useCallback(() => {
    if (isRecording) stop();
    else void start();
  }, [isRecording, start, stop]);

  return { isRecording, isTranscribing, error, start, stop, toggle, cancel, isPending: () => pending.current };
}

/** One ephemeral playback owner per visible conversation; no audio or speech projection is persisted. */
export function useReplySpeech(enabled: boolean, ownerKey: string, onNotice: (message: string) => void) {
  const current = useRef({ enabled, ownerKey, onNotice });
  current.current = { enabled, ownerKey, onNotice };
  const active = useRef<AbortController | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const stop = useCallback(() => { active.current?.abort(); active.current = null; setIsSpeaking(false); }, []);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, [enabled, ownerKey]);
  useEffect(() => { setIsSpeaking(false); }, [enabled, ownerKey]);
  const speak = useCallback((text: string, expectedOwnerKey: string) => {
    if (!current.current.enabled || current.current.ownerKey !== expectedOwnerKey) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setIsSpeaking(true);
    void playReplySpeech(text, controller.signal).catch(error => {
      if (controller.signal.aborted || current.current.ownerKey !== expectedOwnerKey || !current.current.enabled) return;
      current.current.onNotice(error instanceof ReplySpeechError ? error.message : new ReplySpeechError("unavailable").message);
    }).finally(() => {
      if (active.current !== controller) return;
      active.current = null;
      setIsSpeaking(false);
    });
  }, []);
  return { speak, stop, isSpeaking };
}
