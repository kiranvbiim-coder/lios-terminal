import { normalizePulseSubjectKey } from "./pulseSubjectPreferences";

/** The existing Wave D user preference document owns these named discovery
 * selections. Saved views are filters, never copies of source content, URLs,
 * private articles, credentials, unapproved monitoring rules or search indexes.
 */
export type PulseViewChannel = "for_you" | "following" | "markets" | "research";
export interface PulseSavedView {
  id: string;
  name: string;
  channel: PulseViewChannel;
  subjectKey: string | null;
  createdAt: string;
}
export const MAX_PULSE_SAVED_VIEWS = 12;
const CHANNELS: readonly PulseViewChannel[] = ["for_you", "following", "markets", "research"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function recognizedChannel(value: unknown): value is PulseViewChannel {
  return typeof value === "string" && CHANNELS.includes(value as PulseViewChannel);
}
export function normalizePulseSavedViews(input: unknown): PulseSavedView[] {
  if (!Array.isArray(input)) return [];
  const rows: PulseSavedView[] = [];
  const ids = new Set<string>();
  for (const raw of input.slice(0, 48)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.id !== "string" || !UUID.test(entry.id) || ids.has(entry.id) ||
      typeof entry.name !== "string" || entry.name.trim().length < 1 ||
      entry.name.trim().length > 60 || !recognizedChannel(entry.channel) ||
      typeof entry.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(entry.createdAt) ||
      !Number.isFinite(Date.parse(entry.createdAt))) continue;
    const subject = entry.subjectKey === null ? null : normalizePulseSubjectKey(entry.subjectKey);
    if (entry.subjectKey !== null && !subject) continue;
    ids.add(entry.id);
    rows.push({ id: entry.id, name: entry.name.trim(), channel: entry.channel,
      subjectKey: subject, createdAt: new Date(entry.createdAt).toISOString() });
    if (rows.length >= MAX_PULSE_SAVED_VIEWS) break;
  }
  return rows;
}
export function savePulseDiscoveryView(
  existing: readonly PulseSavedView[],
  proposed: { name: string; channel: PulseViewChannel; subjectKey: string | null },
  followed: readonly string[],
  id: string,
  at: Date = new Date(),
): PulseSavedView[] {
  const current = normalizePulseSavedViews(existing);
  if (current.length >= MAX_PULSE_SAVED_VIEWS) throw new Error("Saved view limit reached.");
  if (!UUID.test(id) || !Number.isFinite(at.getTime()) ||
    proposed.name.trim().length < 1 || proposed.name.trim().length > 60 ||
    !recognizedChannel(proposed.channel)) throw new Error("Invalid saved view selection.");
  const subject = proposed.subjectKey === null ? null : normalizePulseSubjectKey(proposed.subjectKey);
  if (proposed.subjectKey !== null && (!subject ||
    !followed.map(normalizePulseSubjectKey).includes(subject))) {
    throw new Error("The selected subject is not followed in this account.");
  }
  return [...current, { id, name: proposed.name.trim(), channel: proposed.channel,
    subjectKey: subject, createdAt: at.toISOString() }];
}
export function removePulseDiscoveryView(existing: readonly PulseSavedView[], id: string): PulseSavedView[] {
  if (!UUID.test(id)) throw new Error("Invalid saved view ID.");
  const items = normalizePulseSavedViews(existing);
  if (!items.some(item => item.id === id)) throw new Error("Saved view not found.");
  return items.filter(item => item.id !== id);
}
