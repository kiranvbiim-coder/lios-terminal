import crypto from "node:crypto";
import {
  DEVICE_PAIRING_TOKEN_TTL_MS,
  DEVICE_PROOF_MAX_SKEW_MS,
  DEVICE_SCOPES,
  buildDeviceProofPayload,
  deviceIdFromPublicKey,
  fromBase64Url,
  normalizeDeviceCapabilityAdvertisement,
} from "@shared/devicePairing";
import type { PendingPairing } from "@shared/devicePairing";
import { gatewayError } from "@shared/gatewayProtocol";
import type { ConnectDecision, GatewayAuthenticator } from "./gatewayHub";
import {
  findDeviceOwner,
  findPairedDevice,
  findPairedDeviceByPublicKey,
  insertPairedDevice,
  touchPairedDevice,
  updatePairedDeviceAdvertisement,
} from "./deviceStore";

/**
 * Pairing and device authentication (GM-09a).
 *
 * Pairing: an owner session creates a one-time token (kept only as a hash, expires in 5 minutes, single use). A new
 * device presents the token plus proof of possession of its key; that creates a *pending* request which only the
 * same owner can approve on the Home. Authentication: a known device signs the Home's per-connection nonce. Nothing
 * reusable is stored on either side. Pending state is in memory and lost on restart, which just means pairing again.
 */

const MAX_FAILURES_PER_WINDOW = 8;
const FAILURE_WINDOW_MS = 60_000;
const MAX_PENDING_PER_USER = 5;

interface TokenRecord {
  userId: number;
  organizationId: number | null;
  expiresAt: number;
}

interface PendingRecord extends PendingPairing {
  userId: number;
  organizationId: number | null;
  publicKey: string;
  capabilities: string[];
  commands: string[];
  settle: (outcome: "approved" | "denied" | "expired") => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PairingError extends Error {
  constructor(readonly code: "not_found" | "too_many", message: string) {
    super(message);
    this.name = "PairingError";
  }
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** DER prefix that wraps a raw 32-byte Ed25519 public key into SubjectPublicKeyInfo. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function verifyProof(publicKey: string, payload: string, signature: string): boolean {
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, fromBase64Url(publicKey)]), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(payload, "utf8"), key, fromBase64Url(signature));
  } catch {
    return false;
  }
}

export class DevicePairingService implements GatewayAuthenticator {
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly pending = new Map<string, PendingRecord>();
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly options: { now?: () => number; onChange?: (userId: number) => void } = {}) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  createPairingToken(user: { id: number; organizationId: number | null }): { pairingToken: string; expiresAt: string } {
    this.sweep();
    const live = [...this.tokens.values()].filter((record) => record.userId === user.id).length;
    if (live >= MAX_PENDING_PER_USER) throw new PairingError("too_many", "Too many open pairing codes. Use or wait for one to expire.");
    const pairingToken = crypto.randomBytes(32).toString("base64url");
    const expiresAt = this.now() + DEVICE_PAIRING_TOKEN_TTL_MS;
    this.tokens.set(hashToken(pairingToken), { userId: user.id, organizationId: user.organizationId, expiresAt });
    return { pairingToken, expiresAt: new Date(expiresAt).toISOString() };
  }

  listPending(userId: number): PendingPairing[] {
    this.sweep();
    return [...this.pending.values()].filter((record) => record.userId === userId).map(({
      pairingId, deviceName, platform, deviceId, capabilities, commands, requestedAt, expiresAt,
    }) => ({ pairingId, deviceName, platform, deviceId, capabilities, commands, requestedAt, expiresAt }));
  }

  /** Approves a pending request. Only the user the pairing token was issued to can approve. */
  async approve(userId: number, pairingId: string): Promise<void> {
    this.sweep();
    const record = this.pending.get(pairingId);
    if (!record || record.userId !== userId) throw new PairingError("not_found", "That pairing request is no longer available.");
    this.pending.delete(pairingId);
    clearTimeout(record.timer);
    try {
      await insertPairedDevice({
        id: record.deviceId,
        ownerUserId: record.userId,
        organizationId: record.organizationId,
        name: record.deviceName,
        platform: record.platform,
        publicKey: record.publicKey,
        capabilities: record.capabilities,
        commands: record.commands,
        advertisedAt: new Date(record.requestedAt),
      });
      record.settle("approved");
    } catch (error) {
      // A failed persistence operation must not leave the waiting device or its socket alive indefinitely.
      record.settle("denied");
      throw error;
    } finally {
      this.options.onChange?.(userId);
    }
  }

  deny(userId: number, pairingId: string): void {
    this.sweep();
    const record = this.pending.get(pairingId);
    if (!record || record.userId !== userId) throw new PairingError("not_found", "That pairing request is no longer available.");
    this.pending.delete(pairingId);
    clearTimeout(record.timer);
    record.settle("denied");
    this.options.onChange?.(userId);
  }

  async authenticate(input: Parameters<GatewayAuthenticator["authenticate"]>[0]): Promise<ConnectDecision> {
    const { params, nonce, remoteAddress } = input;
    const reject = (code: "UNAUTHORIZED" | "FORBIDDEN" | "RATE_LIMITED" | "INVALID_REQUEST", message: string, countFailure = true): ConnectDecision => {
      if (countFailure) this.recordFailure(remoteAddress);
      return { kind: "reject", error: gatewayError(code, message, code === "RATE_LIMITED" ? { retryable: true, retryAfterMs: FAILURE_WINDOW_MS } : {}) };
    };
    if (this.isLimited(remoteAddress)) return reject("RATE_LIMITED", "Too many failed attempts. Wait a minute and try again.", false);

    const proof = params.device;
    if (!proof) return reject("UNAUTHORIZED", "A paired device must prove its key.");
    if (Math.abs(this.now() - proof.signedAt) > DEVICE_PROOF_MAX_SKEW_MS) return reject("UNAUTHORIZED", "The device clock is too far from the Home's clock.");
    if (proof.id !== await deviceIdFromPublicKey(proof.publicKey)) return reject("UNAUTHORIZED", "Device id does not match its key.");
    const surface = normalizeDeviceCapabilityAdvertisement({
      capabilities: proof.capabilities,
      commands: proof.commands,
    });
    const payload = buildDeviceProofPayload({
      deviceId: proof.id,
      clientId: params.client.id,
      clientMode: params.client.mode,
      scopes: params.scopes ?? [],
      signedAt: proof.signedAt,
      nonce,
      pairingToken: params.pairing?.token ?? "",
      ...surface,
    });
    if (!verifyProof(proof.publicKey, payload, proof.signature)) return reject("UNAUTHORIZED", "Device proof is invalid.");

    if (params.pairing) {
      return this.beginPairing(
        params.pairing.token,
        params.pairing.deviceName,
        params.client.platform,
        proof.id,
        proof.publicKey,
        surface.capabilities,
        surface.commands,
        reject,
      );
    }

    const device = await findPairedDevice(proof.id);
    if (!device || device.publicKey !== proof.publicKey) return reject("UNAUTHORIZED", "This device is not paired with this Home.");
    if (device.revokedAt) return reject("FORBIDDEN", "This device was removed from this Home.");
    const owner = await findDeviceOwner(device.ownerUserId);
    if (!owner) return reject("UNAUTHORIZED", "The account this device belongs to no longer exists.");
    if (!owner.active || owner.mustChangePassword) return reject("FORBIDDEN", "This account must sign in and resolve its account restrictions before using paired devices.");
    if (owner.lockedUntil && owner.lockedUntil.getTime() > this.now()) return reject("FORBIDDEN", "This account is locked.");
    const advertisementChanged = await updatePairedDeviceAdvertisement(device, {
      ...surface,
    }, new Date(this.now()));
    await touchPairedDevice(device);
    if (advertisementChanged) this.options.onChange?.(device.ownerUserId);
    const current = await findPairedDevice(proof.id);
    if (!current || current.revokedAt) return reject("FORBIDDEN", "This device was removed from this Home.");
    return {
      kind: "accept",
      identity: {
        userId: owner.id,
        email: owner.email,
        role: owner.role,
        organizationId: owner.organizationId ?? null,
        grantedScopes: device.scopes.filter((scope): scope is (typeof DEVICE_SCOPES)[number] => (DEVICE_SCOPES as readonly string[]).includes(scope)),
        deviceId: device.id,
      },
    };
  }

  private async beginPairing(
    token: string,
    deviceName: string,
    platform: string,
    deviceId: string,
    publicKey: string,
    capabilities: string[],
    commands: string[],
    reject: (code: "UNAUTHORIZED" | "FORBIDDEN" | "RATE_LIMITED" | "INVALID_REQUEST", message: string) => ConnectDecision,
  ): Promise<ConnectDecision> {
    this.sweep();
    const key = hashToken(token);
    const record = this.tokens.get(key);
    if (!record) return reject("UNAUTHORIZED", "This pairing code is invalid or has expired.");
    // Consume synchronously, before the first asynchronous lookup. Two requests may present the same code at once.
    this.tokens.delete(key);
    if (await findPairedDeviceByPublicKey(publicKey)) return reject("INVALID_REQUEST", "This device is already known to this Home.");
    this.sweep();
    if (record.expiresAt <= this.now()) return reject("UNAUTHORIZED", "This pairing code has expired.");
    if ([...this.pending.values()].some((entry) => entry.deviceId === deviceId)) return reject("INVALID_REQUEST", "This device already has a pairing request waiting for approval.");
    if ([...this.pending.values()].filter((entry) => entry.userId === record.userId).length >= MAX_PENDING_PER_USER) return reject("RATE_LIMITED", "Too many pairing requests are waiting for approval.");

    const pairingId = crypto.randomUUID();
    const requestedAt = this.now();
    const expiresAt = record.expiresAt;
    const { promise, resolve } = Promise.withResolvers<"approved" | "denied" | "expired">();
    const timer = setTimeout(() => {
      if (this.pending.delete(pairingId)) {
        resolve("expired");
        this.options.onChange?.(record.userId);
      }
    }, Math.max(0, expiresAt - this.now()));
    timer.unref?.();
    this.pending.set(pairingId, {
      pairingId,
      deviceName,
      platform,
      deviceId,
      publicKey,
      capabilities,
      commands,
      requestedAt: new Date(requestedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      userId: record.userId,
      organizationId: record.organizationId,
      settle: resolve,
      timer,
    });
    this.options.onChange?.(record.userId);
    return { kind: "pending", pending: { type: "pairing-pending", pairingId, expiresAt: new Date(expiresAt).toISOString() }, resolution: promise };
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, record] of this.tokens) if (record.expiresAt <= now) this.tokens.delete(key);
    for (const [id, record] of this.pending) {
      if (Date.parse(record.expiresAt) > now) continue;
      this.pending.delete(id);
      clearTimeout(record.timer);
      record.settle("expired");
      this.options.onChange?.(record.userId);
    }
    for (const [ip, entry] of this.failures) if (entry.resetAt <= now) this.failures.delete(ip);
  }

  private isLimited(remoteAddress: string | undefined): boolean {
    const now = this.now();
    // Remote peers must not grow the limiter indefinitely by cycling addresses.
    if (this.failures.size >= 1024) {
      for (const [ip, value] of this.failures) if (value.resetAt <= now) this.failures.delete(ip);
    }
    const entry = this.failures.get(remoteAddress ?? "unknown");
    return entry ? entry.resetAt > now && entry.count >= MAX_FAILURES_PER_WINDOW : this.failures.size >= 1024;
  }

  private recordFailure(remoteAddress: string | undefined): void {
    const key = remoteAddress ?? "unknown";
    const now = this.now();
    const entry = this.failures.get(key);
    if (!entry && this.failures.size >= 1024) return;
    if (!entry || entry.resetAt <= now) this.failures.set(key, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
    else entry.count += 1;
  }
}
