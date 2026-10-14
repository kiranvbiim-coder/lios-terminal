import { z } from "zod";
import type { DevicePairingInvitation } from "./deviceNetwork";

const wssEndpointSchema = z.string().max(512);

export const deviceHomeRecordSchema = z.object({
  homeId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  urls: z.array(wssEndpointSchema).min(1).max(32),
  savedAt: z.string().datetime({ offset: true }),
}).strict();
export type DeviceHomeRecord = z.infer<typeof deviceHomeRecordSchema>;

export const deviceHomesStateSchema = z.object({
  version: z.literal(1),
  activeHomeId: z.string().uuid().nullable(),
  homes: z.array(deviceHomeRecordSchema).max(32),
}).strict();
export type DeviceHomesState = z.infer<typeof deviceHomesStateSchema>;

export const EMPTY_DEVICE_HOMES_STATE: DeviceHomesState = { version: 1, activeHomeId: null, homes: [] };
export const MAX_DEVICE_HOMES = 32;

export function deviceHomeTrustKey(homeId: string, fingerprint: string): string {
  return `${homeId}:${fingerprint}`;
}

export function recordFromPairingInvitation(invitation: DevicePairingInvitation, savedAt = new Date().toISOString()): DeviceHomeRecord {
  return deviceHomeRecordSchema.parse({
    homeId: invitation.homeId,
    name: invitation.name,
    fingerprint: invitation.fingerprint,
    urls: invitation.urls,
    savedAt,
  });
}

/**
 * Multiple Homes may be remembered on a device, but only one is active for Gateway connections at a time.
 * A changed certificate fingerprint for the same Home id replaces the prior record and requires re-pairing.
 */
export function upsertDeviceHome(state: DeviceHomesState, record: DeviceHomeRecord): DeviceHomesState {
  const parsed = deviceHomesStateSchema.parse(state);
  const nextRecord = deviceHomeRecordSchema.parse(record);
  const without = parsed.homes.filter((home) => home.homeId !== nextRecord.homeId);
  const homes = [nextRecord, ...without].slice(0, MAX_DEVICE_HOMES);
  const activeHomeId = parsed.activeHomeId === nextRecord.homeId || parsed.activeHomeId === null
    ? nextRecord.homeId
    : parsed.activeHomeId;
  return deviceHomesStateSchema.parse({ version: 1, activeHomeId, homes });
}

export function removeDeviceHome(state: DeviceHomesState, homeId: string): DeviceHomesState {
  const parsed = deviceHomesStateSchema.parse(state);
  const homes = parsed.homes.filter((home) => home.homeId !== homeId);
  const activeHomeId = parsed.activeHomeId === homeId ? (homes[0]?.homeId ?? null) : parsed.activeHomeId;
  return deviceHomesStateSchema.parse({ version: 1, activeHomeId, homes });
}

export function setActiveDeviceHome(state: DeviceHomesState, homeId: string): DeviceHomesState {
  const parsed = deviceHomesStateSchema.parse(state);
  if (!parsed.homes.some((home) => home.homeId === homeId)) {
    throw new Error("That Home is not saved on this device.");
  }
  return deviceHomesStateSchema.parse({ ...parsed, activeHomeId: homeId });
}

export function activeDeviceHome(state: DeviceHomesState): DeviceHomeRecord | null {
  const parsed = deviceHomesStateSchema.parse(state);
  if (!parsed.activeHomeId) return parsed.homes[0] ?? null;
  return parsed.homes.find((home) => home.homeId === parsed.activeHomeId) ?? null;
}
