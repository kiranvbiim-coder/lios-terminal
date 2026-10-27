import type { IntelligenceCard } from "./waveDContracts";

/** A3 discovery preferences live exclusively in the authenticated Wave D owner record.
 * Following neither creates a watchlist holding nor schedules a monitor.
 * Muting only suppresses discovery; it never silences the canonical Action Inbox. */
export interface PulseSubjectPreferences {
  followed: string[];
  muted: string[];
}
export type PulseSubjectAction = "follow" | "mute" | "clear";
export const EMPTY_PULSE_SUBJECT_PREFERENCES: PulseSubjectPreferences = { followed: [], muted: [] };

const MAX_SUBJECTS = 60;
const MAX_KEY_LENGTH = 160;
const VALID_SUBJECT = /^[\p{L}\p{N}][\p{L}\p{N} ._:/-]*$/u;

/** Avoid silently collapsing or guessing aliases: exact canonical subject only. */
export function normalizePulseSubjectKey(key: unknown): string | null {
  if (typeof key !== "string") return null;
  const value = key.trim().normalize("NFC").toUpperCase();
  return value.length > 0 && value.length <= MAX_KEY_LENGTH && VALID_SUBJECT.test(value) ? value : null;
}

function normalizedKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 240)) {
    const key = normalizePulseSubjectKey(item);
    if (key) seen.add(key);
    if (seen.size >= MAX_SUBJECTS) break;
  }
  return [...seen];
}

export function normalizePulseSubjectPreferences(raw: unknown): PulseSubjectPreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { followed: [], muted: [] };
  const data = raw as Partial<PulseSubjectPreferences>;
  const muted = normalizedKeys(data.muted);
  const hidden = new Set(muted);
  const followed = normalizedKeys(data.followed).filter(key => !hidden.has(key));
  return { followed, muted };
}

export function updatePulseSubjectPreferences(
  current: PulseSubjectPreferences,
  rawKey: unknown,
  action: PulseSubjectAction,
): PulseSubjectPreferences {
  const key = normalizePulseSubjectKey(rawKey);
  if (!key) throw new Error("An explicit valid recorded subject is required.");
  const prefs = normalizePulseSubjectPreferences(current);
  const followed = prefs.followed.filter(item => item !== key);
  const muted = prefs.muted.filter(item => item !== key);
  if (action === "follow") {
    if (!prefs.followed.includes(key) && followed.length >= MAX_SUBJECTS) throw new Error("Followed subject limit reached.");
    followed.push(key);
  } else if (action === "mute") {
    if (!prefs.muted.includes(key) && muted.length >= MAX_SUBJECTS) throw new Error("Muted subject limit reached.");
    muted.push(key);
  } else if (action !== "clear") {
    throw new Error("Unsupported subject preference action.");
  }
  return { followed, muted };
}

export function effectivePulseFollowingSubjects(
  prefs: PulseSubjectPreferences,
  existingWatchlist: readonly string[],
): string[] {
  const normalized = normalizePulseSubjectPreferences(prefs);
  const muted = new Set(normalized.muted);
  return [...new Set([...existingWatchlist, ...normalized.followed]
    .map(normalizePulseSubjectKey).filter((key): key is string => !!key && !muted.has(key)))];
}

/** Muted keys cannot be restored with an arbitrary ?subjectKeys query param. */
export function suppressMutedPulseCards<T extends Pick<IntelligenceCard, "subjectKey" | "symbol">>(
  cards: readonly T[],
  prefs: PulseSubjectPreferences,
): T[] {
  const muted = new Set(normalizePulseSubjectPreferences(prefs).muted);
  return cards.filter(card => {
    const subject = normalizePulseSubjectKey(card.subjectKey ?? card.symbol);
    return !subject || !muted.has(subject);
  });
}
