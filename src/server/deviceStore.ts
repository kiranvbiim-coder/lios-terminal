import { and, desc, eq, isNull } from "drizzle-orm";
import { pairedDevices, users } from "@shared/schema";
import type { PairedDeviceRow } from "@shared/schema";
import { DEVICE_SCOPES, normalizeDeviceCapabilityAdvertisement } from "@shared/devicePairing";
import type { DeviceRecord, DeviceScope } from "@shared/devicePairing";
import { getDb } from "./db";

/** Persistence for paired devices (GM-09a). The Home stores public keys only. */

const LAST_SEEN_RESOLUTION_MS = 60_000;

export function toDeviceRecord(row: PairedDeviceRow): DeviceRecord {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    scopes: row.scopes.filter((scope): scope is DeviceScope => (DEVICE_SCOPES as readonly string[]).includes(scope)),
    capabilities: row.capabilities ?? [],
    commands: row.commands ?? [],
    advertisedAt: row.advertisedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export async function insertPairedDevice(input: {
  id: string;
  ownerUserId: number;
  organizationId: number | null;
  name: string;
  platform: string;
  publicKey: string;
  capabilities?: readonly string[];
  commands?: readonly string[];
  advertisedAt?: Date | null;
}): Promise<PairedDeviceRow> {
  const surface = normalizeDeviceCapabilityAdvertisement({
    capabilities: input.capabilities,
    commands: input.commands,
  });
  const [row] = await getDb().insert(pairedDevices).values({
    id: input.id,
    ownerUserId: input.ownerUserId,
    organizationId: input.organizationId,
    name: input.name,
    platform: input.platform,
    publicKey: input.publicKey,
    scopes: [...DEVICE_SCOPES],
    ...surface,
    advertisedAt: input.advertisedAt ?? null,
  }).returning();
  return row!;
}

export async function findPairedDevice(id: string): Promise<PairedDeviceRow | null> {
  const [row] = await getDb().select().from(pairedDevices).where(eq(pairedDevices.id, id)).limit(1);
  return row ?? null;
}

export async function findPairedDeviceByPublicKey(publicKey: string): Promise<PairedDeviceRow | null> {
  const [row] = await getDb().select().from(pairedDevices).where(eq(pairedDevices.publicKey, publicKey)).limit(1);
  return row ?? null;
}

export async function listActivePairedDevices(ownerUserId: number): Promise<PairedDeviceRow[]> {
  return getDb().select().from(pairedDevices)
    .where(and(eq(pairedDevices.ownerUserId, ownerUserId), isNull(pairedDevices.revokedAt)))
    .orderBy(desc(pairedDevices.createdAt));
}

/** Marks the device revoked. Returns false when it does not exist, is not the caller's, or was already revoked. */
export async function revokePairedDevice(ownerUserId: number, id: string): Promise<boolean> {
  const revoked = await getDb().update(pairedDevices).set({ revokedAt: new Date() })
    .where(and(eq(pairedDevices.id, id), eq(pairedDevices.ownerUserId, ownerUserId), isNull(pairedDevices.revokedAt)))
    .returning();
  return revoked.length > 0;
}

export async function touchPairedDevice(device: PairedDeviceRow): Promise<void> {
  if (device.lastSeenAt && Date.now() - device.lastSeenAt.getTime() < LAST_SEEN_RESOLUTION_MS) return;
  await getDb().update(pairedDevices).set({ lastSeenAt: new Date() }).where(eq(pairedDevices.id, device.id));
}

export async function updatePairedDeviceAdvertisement(
  device: PairedDeviceRow,
  input: { capabilities?: readonly string[]; commands?: readonly string[] },
  now = new Date(),
): Promise<boolean> {
  const surface = normalizeDeviceCapabilityAdvertisement(input);
  const previous = normalizeDeviceCapabilityAdvertisement({
    capabilities: device.capabilities ?? [],
    commands: device.commands ?? [],
  });
  if (
    previous.capabilities.length === surface.capabilities.length &&
    previous.commands.length === surface.commands.length &&
    previous.capabilities.every((value, index) => value === surface.capabilities[index]) &&
    previous.commands.every((value, index) => value === surface.commands[index])
  ) return false;
  await getDb().update(pairedDevices).set({
    ...surface,
    advertisedAt: now,
  }).where(eq(pairedDevices.id, device.id));
  return true;
}

export async function findDeviceOwner(userId: number) {
  const [user] = await getDb().select({
    id: users.id,
    email: users.email,
    role: users.role,
    organizationId: users.organizationId,
    lockedUntil: users.lockedUntil,
    active: users.active,
    mustChangePassword: users.mustChangePassword,
  }).from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}
