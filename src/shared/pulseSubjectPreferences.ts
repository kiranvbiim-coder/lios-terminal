import type { IntelligenceCard } from "./waveDContracts";
import { filterPulseCards, type PulseFilter } from "./waveDAdvancedContracts";

/** User-owned discovery preferences in the existing Wave D persona state.
 * Follow/Mute NEVER authorizes access, enables a monitor, or changes the Action Inbox.
 */
export interface PulseSubjectPreferences {
  followed: string[];
  muted: string[];
}

export type PulseSubjectChoice = "follow" | "mute" | "clear";
export const MAX_PULSE_SUBJECT_PREFERENCES = 100;

export function normalizePulseSubject(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().normalize("NFC").toUpperCase();
  if (!cleaned || cleaned.length > 240 || /[\u0000-\u001f\u007f]/.test(cleaned)) return null;
  return cleaned;
}

function canonicalList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.slice(0, 500)) {
    const subject = normalizePulseSubject(raw);
    if (!subject || seen.has(subject)) continue;
    seen.add(subject);
    if (result.length === MAX_PULSE_SUBJECT_PREFERENCES) break;
    result.push(subject);
  }
  return result;
}

/** Mute wins when stale legacy state contains conflicting values. */
export function normalizePulseSubjectPreferences(value: unknown): PulseSubjectPreferences {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const muted = canonicalList(input.muted);
  const deny = new Set(muted);
  return {
    followed: canonicalList(input.followed).filter(subject => !deny.has(subject)),
    muted,
  };
}

export function setPulseSubjectChoice(
  current: PulseSubjectPreferences,
  rawSubject: string,
  choice: PulseSubjectChoice,
): PulseSubjectPreferences {
  const subject = normalizePulseSubject(rawSubject);
  if (!subject) throw new Error("A nonempty recorded subject is required.");
  const old = normalizePulseSubjectPreferences(current);
  const followed = old.followed.filter(item => item !== subject);
  const muted = old.muted.filter(item => item !== subject);
  if (choice === "follow") {
    if (followed.length >= MAX_PULSE_SUBJECT_PREFERENCES) throw new Error("Maximum followed subjects reached.");
    followed.push(subject);
  } else if (choice === "mute") {
    if (muted.length >= MAX_PULSE_SUBJECT_PREFERENCES) throw new Error("Maximum muted subjects reached.");
    muted.push(subject);
  } else if (choice !== "clear") throw new Error("Invalid discovery preference choice.");
  return { followed, muted };
}

export function pulseSubjectChoice(
  preferences: PulseSubjectPreferences, rawSubject: string | undefined,
): PulseSubjectChoice | null {
  const subject = normalizePulseSubject(rawSubject);
  if (!subject) return null;
  if (preferences.muted.includes(subject)) return "mute";
  if (preferences.followed.includes(subject)) return "follow";
  return "clear";
}

/** Server applies privacy/tenant scoping before this pure display projection. */
export function filterPreferredPulseCards(
  cards: readonly IntelligenceCard[],
  filter: PulseFilter,
  preferences: PulseSubjectPreferences,
  watchlistSubjects: readonly string[] = [],
): IntelligenceCard[] {
  const prefs = normalizePulseSubjectPreferences(preferences);
  const muted = new Set(prefs.muted);
  const following = new Set([...prefs.followed, ...watchlistSubjects.map(normalizePulseSubject).filter((x): x is string => x !== null)]);
  for (const denied of muted) following.delete(denied);

  const kept = cards.filter(card => {
    const subject = normalizePulseSubject(card.subjectKey ?? card.symbol);
    return !subject || !muted.has(subject);
  });

  if (filter.channel !== "following") return filterPulseCards(kept, filter);
  // Ignore arbitrary client-submitted following subjectKeys: only persisted,
  // user-owned follows and the existing user's watchlist define this channel.
  if (!following.size) return [];
  const trustedFollowFilter: PulseFilter = {
    ...filter, channel: "following", subjectKeys: [...following],
  };
  return filterPulseCards(kept, trustedFollowFilter);
}
