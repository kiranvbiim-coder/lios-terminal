import type { Express } from "express";
import { z } from "zod";
import { isHomeOwner, requireAuth, requireHomeOwner } from "./auth";
import { deviceNetwork, devicePairing } from "./deviceRuntime";
import { deviceNetworkSettingsSchema, encodeDevicePairingInvitation } from "@shared/deviceNetwork";
import { listActivePairedDevices, revokePairedDevice, toDeviceRecord } from "./deviceStore";
import { gatewayHub, notifyDataChanged } from "./gatewayRuntime";
import { PairingError } from "./devicePairingService";

/**
 * Device management for the signed-in user (GM-09a): list devices and pending pairing requests, create a one-time
 * pairing code, approve or deny a request, and remove a device. A device always belongs to the user who approved
 * it; no route here lets one user see or change another user's devices.
 */
export function registerDeviceRoutes(app: Express): void {
  app.get("/api/devices", requireAuth, async (req, res) => {
    const devices = await listActivePairedDevices(req.user!.id);
    const canPair = isHomeOwner(req.user);
    res.json({
      devices: devices.map(toDeviceRecord),
      pending: devicePairing.listPending(req.user!.id),
      canPair,
      ...(canPair ? { network: deviceNetwork.status() } : {}),
    });
  });

  app.put("/api/devices/network", requireHomeOwner, async (req, res) => {
    const parsed = deviceNetworkSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Provide a valid Home name and enabled setting." });
    try {
      const status = await deviceNetwork.update(parsed.data);
      notifyDataChanged("devices", { homeOwner: true });
      return res.json(status);
    } catch (error) {
      return res.status(503).json({ error: error instanceof Error ? error.message : "The device listener could not be changed." });
    }
  });

  app.post("/api/devices/pairing", requireHomeOwner, (req, res) => {
    try {
      const code = devicePairing.createPairingToken({ id: req.user!.id, organizationId: req.user!.organizationId ?? null });
      const network = deviceNetwork.status();
      const pairingUri = network.enabled && network.homeId && network.fingerprint
        ? encodeDevicePairingInvitation({
          version: 1, homeId: network.homeId, name: network.name, urls: network.urls,
          fingerprint: network.fingerprint, ...code,
        }) : undefined;
      res.status(201).json({ ...code, ...(pairingUri ? { pairingUri } : {}) });
    } catch (error) {
      if (error instanceof PairingError) return res.status(429).json({ error: error.message });
      throw error;
    }
  });

  const pairingId = z.string().uuid();

  app.post("/api/devices/pairing/:pairingId/approve", requireHomeOwner, async (req, res) => {
    const id = pairingId.safeParse(req.params.pairingId);
    if (!id.success) return res.status(400).json({ error: "Invalid pairing id." });
    try {
      await devicePairing.approve(req.user!.id, id.data);
      return res.json({ ok: true });
    } catch (error) {
      if (error instanceof PairingError) return res.status(404).json({ error: error.message });
      throw error;
    }
  });

  app.post("/api/devices/pairing/:pairingId/deny", requireHomeOwner, (req, res) => {
    const id = pairingId.safeParse(req.params.pairingId);
    if (!id.success) return res.status(400).json({ error: "Invalid pairing id." });
    try {
      devicePairing.deny(req.user!.id, id.data);
      return res.json({ ok: true });
    } catch (error) {
      if (error instanceof PairingError) return res.status(404).json({ error: error.message });
      throw error;
    }
  });

  app.delete("/api/devices/:deviceId", requireAuth, async (req, res) => {
    const id = z.string().length(32).regex(/^[0-9a-f]+$/).safeParse(req.params.deviceId);
    if (!id.success) return res.status(400).json({ error: "Invalid device id." });
    if (!await revokePairedDevice(req.user!.id, id.data)) return res.status(404).json({ error: "That device is not paired with your account." });
    gatewayHub.disconnectDevice(id.data);
    notifyDataChanged("devices", { userId: req.user!.id });
    return res.json({ ok: true });
  });
}
