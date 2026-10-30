/**
 * Bounds for voice-input conversion. Constants adapted from OpenClaw src/media/ffmpeg-limits.ts
 * (c074824a27c96d3983043f9eeb33823cd1772d8c, MIT, Copyright (c) 2026 OpenClaw Foundation): a 20 minute audio ceiling,
 * a 45 second conversion deadline and bounded captured output. LiOS keeps its own managed ffmpeg resolution and route.
 */
export const VOICE_MAX_AUDIO_SECONDS = 1_200;
export const VOICE_FFMPEG_TIMEOUT_MS = 45_000;
export const VOICE_FFMPEG_MAX_OUTPUT_CHARS = 64 * 1024;
/** 16 kHz mono 16-bit PCM. */
export const VOICE_WAV_BYTES_PER_SECOND = 32_000;
/** Largest WAV (header + data) a 20 minute recording can be after conversion. */
export const VOICE_MAX_WAV_BYTES = 44 + VOICE_WAV_BYTES_PER_SECOND * VOICE_MAX_AUDIO_SECONDS;

export class VoiceTooLongError extends Error {
  constructor() {
    super(`Recording is longer than ${VOICE_MAX_AUDIO_SECONDS / 60} minutes. Record a shorter clip.`);
    this.name = "VoiceTooLongError";
  }
}

/**
 * Duration in seconds from a canonical RIFF/WAVE header (byteRate and the data chunk size), or null when the header is
 * not a parseable PCM WAV. Chunk walking is bounded so a crafted file cannot spin the parser.
 */
export function wavDurationSeconds(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 44 || view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) return null;
  let byteRate = 0;
  let offset = 12;
  for (let chunks = 0; chunks < 64 && offset + 8 <= bytes.length; chunks++) {
    const id = view.getUint32(offset, false);
    const size = view.getUint32(offset + 4, true);
    if (id === 0x666d7420 /* "fmt " */) {
      if (offset + 8 + 16 > bytes.length) return null;
      byteRate = view.getUint32(offset + 16, true);
    } else if (id === 0x64617461 /* "data" */) {
      if (!byteRate) return null;
      // A streamed WAV may declare 0xFFFFFFFF; the bytes actually present bound the data.
      const present = Math.min(size, bytes.length - (offset + 8));
      return present / byteRate;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}
