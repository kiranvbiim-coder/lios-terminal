import type { SourceRegistryItem } from "@shared/sourceRegistry";

export type SourceAvailability = "operational" | "configured_unverified" | "needs_attention" | "catalog_only";

/**
 * The registry reports observed/configured health; a connection alone does
 * not prove that a user can retrieve data, use AI, or export licensed content.
 */
export function sourceAvailability(item: Pick<SourceRegistryItem, "connected" | "operational" | "lastCheckedAt">): SourceAvailability {
  if (!item.connected) return "catalog_only";
  if (item.operational && item.lastCheckedAt) return "operational";
  if (item.operational || !item.lastCheckedAt) return "configured_unverified";
  return "needs_attention";
}

export const SOURCE_AVAILABILITY_COPY: Record<SourceAvailability, string> = {
  operational: "Operational at last check; access and source licences still apply",
  configured_unverified: "Configured; current retrieval has not been verified",
  needs_attention: "Connected but not operational; check this source",
  catalog_only: "Not connected",
};

export type VoiceAvailability = {
  transcriptionReady: boolean;
  speechReady: boolean;
  transcriptionIsLocal: boolean;
  speechIsLocal: boolean;
  label: string;
};

export function voiceAvailability(input: {
  loading: boolean;
  error: boolean;
  transcription: ReadonlyArray<{ id: string; local: boolean }> | undefined;
  speech: ReadonlyArray<{ id: string; local: boolean }> | undefined;
  browserRecordingReady: boolean | undefined;
}): VoiceAvailability {
  const unknown = { transcriptionReady: false, speechReady: false, transcriptionIsLocal: false, speechIsLocal: false };
  if (input.loading) return { ...unknown, label: "Checking voice providers; availability not verified" };
  if (input.error || !input.transcription || !input.speech)
    return { ...unknown, label: "Could not verify voice providers. Retry or open Connection Center." };
  const voiceIn = input.transcription.some(provider =>
    provider.id !== "lios.voice.whisper-cpp" || input.browserRecordingReady === true);
  const voiceOut = input.speech.length > 0;
  return {
    transcriptionReady: voiceIn,
    speechReady: voiceOut,
    transcriptionIsLocal: voiceIn && input.transcription.filter(provider => provider.id !== "lios.voice.whisper-cpp" || input.browserRecordingReady === true).every(provider => provider.local),
    speechIsLocal: voiceOut && input.speech.every(provider => provider.local),
    label: voiceIn ? "Transcription provider registered; browser microphone permission still required"
      : "Voice input unavailable. Configure a compatible transcription runtime.",
  };
}

/** Never pass back arbitrary raw server, browser or provider error text to the UI. */
export function voiceFailureCopy(status: number | "network" | "microphone" | "invalid"): string {
  if (status === "microphone") return "Microphone access was denied or unavailable. Check browser and operating-system permissions.";
  if (status === "invalid") return "Transcription returned an invalid response. The audio was not submitted as a Chat message.";
  if (status === "network" || (typeof status === "number" && status >= 500)) return "Voice service unavailable. Check the Connection Center and retry recording.";
  if (status === 401) return "Your session may have expired. Sign in again before using voice.";
  if (status === 403) return "Voice transcription is not permitted for this account.";
  if (status === 413) return "The recording is too large. Try a shorter clip.";
  if (status === 429) return "Voice transcription is rate-limited. Try again later.";
  return "Voice transcription was not completed. Check the configured provider and retry.";
}
