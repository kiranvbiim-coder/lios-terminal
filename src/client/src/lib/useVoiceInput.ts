// Client-side wiring for the P12 voice runtime (server/p12VoiceRuntime.ts +
// server/voiceRoutes.ts). Records a short clip with MediaRecorder, uploads
// it to /api/voice/transcribe, and returns the transcript text for the
// caller to place in the composer for review before sending -- this keeps
// every voice command going through the exact same send() path (and the
// same permission/approval gates) as a typed message.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
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

export function useVoiceRecorder(onTranscript: (result: VoiceTranscriptResult) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Microphone access is not available in this environment.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stopStream();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size === 0) {
          setError("No audio was captured.");
          return;
        }
        setIsTranscribing(true);
        try {
          const form = new FormData();
          form.append("audio", blob, "voice-input.webm");
          const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
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
          onTranscript(transcript);
        } catch (transcribeError) {
          setError(transcribeError instanceof Error
            && Object.values(VOICE_PUBLIC_FAILURES).includes(transcribeError.message)
            ? transcribeError.message : voiceFailureCopy("network"));
        } finally {
          setIsTranscribing(false);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch (permissionError) {
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

  return { isRecording, isTranscribing, error, start, stop, toggle };
}

export async function speakText(text: string, preference?: { providerId?: string | null; voiceId?: string | null; rate?: number }): Promise<void> {
  const res = await apiRequest("POST", "/api/voice/speak", { text, preference });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  audio.onerror = () => URL.revokeObjectURL(url);
  await audio.play();
}
