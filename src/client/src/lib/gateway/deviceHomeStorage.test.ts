import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeDevicePairingInvitation } from "@shared/deviceNetwork";
import {
  chooseActiveDeviceHome,
  forgetDeviceHome,
  readDeviceHomesState,
  rememberPairingInvitationUri,
} from "./deviceHomeStorage";

const storage = new Map<string, string>();

test("device Home storage remembers invitations and switches active Homes", () => {
  const invitation = {
    version: 1 as const,
    homeId: "d14d7195-2bac-4005-9c30-8350365c52c9",
    name: "Office",
    urls: ["wss://192.168.1.10:8443/gateway/device"],
    fingerprint: "e".repeat(64),
    pairingToken: "x".repeat(43),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const uri = encodeDevicePairingInvitation(invitation);
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  try {
    rememberPairingInvitationUri(uri);
    const remembered = readDeviceHomesState();
    assert.equal(remembered.homes.length, 1);
    const second = rememberPairingInvitationUri(encodeDevicePairingInvitation({
      ...invitation,
      homeId: "11111111-1111-4111-8111-111111111111",
      name: "Lab",
    }));
    chooseActiveDeviceHome("11111111-1111-4111-8111-111111111111");
    assert.equal(readDeviceHomesState().activeHomeId, "11111111-1111-4111-8111-111111111111");
    forgetDeviceHome("11111111-1111-4111-8111-111111111111");
    assert.equal(readDeviceHomesState().homes.length, 1);
    assert.equal(second.homes.length, 2);
  } finally {
    storage.clear();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
  }
});

test("pasted invitations that are expired or malformed are refused, and the pairing token is never persisted", () => {
  const base = {
    version: 1 as const,
    homeId: "d14d7195-2bac-4005-9c30-8350365c52c9",
    name: "Office",
    urls: ["wss://192.168.1.10:8443/gateway/device"],
    fingerprint: "e".repeat(64),
    pairingToken: "secret-pairing-token-".padEnd(43, "x"),
  };
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  try {
    assert.throws(() => rememberPairingInvitationUri(encodeDevicePairingInvitation({ ...base, expiresAt: new Date(Date.now() - 1_000).toISOString() })), /expired/i);
    assert.throws(() => rememberPairingInvitationUri("not-an-invitation"), /Invalid LiOS pairing invitation/);
    assert.equal(storage.size, 0, "a refused invitation must not write anything");
    rememberPairingInvitationUri(`  ${encodeDevicePairingInvitation({ ...base, expiresAt: new Date(Date.now() + 60_000).toISOString() })}\n`);
    const persisted = [...storage.values()].join("");
    assert.ok(persisted.includes(base.homeId));
    assert.ok(!persisted.includes("secret-pairing-token-"), "the one-time pairing token must not be stored");
  } finally {
    storage.clear();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
  }
});
