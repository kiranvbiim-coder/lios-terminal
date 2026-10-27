/**
 * Display-only interpretation of Connection Center's canonical voice setup
 * read. Never infer runtime availability from cached data following a failed
 * refresh, a missing response or a successful file-picker alone.
 */
export function checkedVoiceSetup<T>(
  data: T | undefined,
  isError: boolean,
): T | undefined {
  return isError ? undefined : data;
}

export type VoiceSetupStatus = "CHECKING" | "UNAVAILABLE" | "READY" | "NEEDS FFMPEG" | "OPTIONAL SETUP";

export function voiceSetupStatus(input: {
  loading: boolean;
  failed: boolean;
  recordingReady?: boolean;
  transcriptionProviderReady?: boolean;
  hasData: boolean;
}): VoiceSetupStatus {
  if (input.loading) return "CHECKING";
  if (input.failed || !input.hasData) return "UNAVAILABLE";
  if (input.recordingReady) return "READY";
  if (input.transcriptionProviderReady) return "NEEDS FFMPEG";
  return "OPTIONAL SETUP";
}

export function voiceReadVerified(result: { isError: boolean; data?: unknown }): boolean {
  return !result.isError && result.data !== null && result.data !== undefined;
}
