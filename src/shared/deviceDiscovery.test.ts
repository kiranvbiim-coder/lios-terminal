import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  buildDeviceDiscoveryTxt,
  DEVICE_DISCOVERY_TXT_MAX_BYTES,
  DEVICE_DISCOVERY_TXT_STRING_MAX_BYTES,
  discoveredHomeFromAdvertisement,
  parseDeviceDiscoveryTxt,
  sanitizeMdnsServiceName,
} from "./deviceDiscovery";
import { GATEWAY_EVENTS, GATEWAY_METHODS } from "./gatewayProtocol";

// Exercise the installed Bonjour wire codecs, not an imitation of their length-byte behavior.
const require = createRequire(import.meta.url);
const dnsPacket = require("dns-packet") as {
  txt: { encode: (data: Buffer[]) => Buffer; decode: (data: Buffer) => Buffer[] };
};
const { DnsTxt } = require("bonjour-service/dist/lib/dns-txt") as {
  DnsTxt: new () => { encode: (data: Record<string, string>) => Buffer[]; decodeAll: (data: Buffer[]) => Record<string, string> };
};
const identity = { homeId: "d14d7195-2bac-4005-9c30-8350365c52c9", fingerprint: "a".repeat(64) };

test("discovery TXT advertises Home identity and Gateway capabilities without secrets", () => {
  const txt = buildDeviceDiscoveryTxt({
    ...identity,
    methods: ["gateway.ping", "conversation.start"],
    events: ["tick", "data.invalidate"],
  });
  assert.equal(txt.v, "2");
  assert.equal(txt.methods, "2");
  assert.equal(txt.m0, "gateway.ping,conversation.start");
  assert.deepEqual(Object.keys(txt).sort(), ["e0", "events", "fp", "homeId", "m0", "methods", "v"]);
  const parsed = parseDeviceDiscoveryTxt(txt);
  assert.equal(parsed.fp, identity.fingerprint);
});

test("all canonical Gateway capabilities survive the actual Bonjour DNS TXT encode/decode", () => {
  const methods = Object.keys(GATEWAY_METHODS);
  const events = Object.keys(GATEWAY_EVENTS);
  assert.ok(Buffer.byteLength(`methods=${methods.join(",")}`) > 255, "regression fixture must exercise the original overflow");
  const txt = buildDeviceDiscoveryTxt({ ...identity, methods, events });
  assert.ok(txt.m1, "full method list must span multiple character-strings");
  const codec = new DnsTxt();
  const strings = codec.encode(txt);
  assert.ok(strings.every((entry) => entry.length <= DEVICE_DISCOVERY_TXT_STRING_MAX_BYTES));
  assert.ok(strings.reduce((total, entry) => total + entry.length + 1, 0) <= DEVICE_DISCOVERY_TXT_MAX_BYTES);
  const decoded = codec.decodeAll(dnsPacket.txt.decode(dnsPacket.txt.encode(strings)));
  const home = discoveredHomeFromAdvertisement({ name: "Kitchen LiOS", host: "192.168.1.20", port: 8443, txt: decoded });
  assert.equal(home.homeId, identity.homeId);
  assert.equal(home.fingerprint, identity.fingerprint);
  assert.deepEqual(home.methods, methods);
  assert.deepEqual(home.events, events);
});

test("discovered Home records normalise Bonjour byte TXT and host metadata", () => {
  const txt = buildDeviceDiscoveryTxt({ ...identity, methods: [" gateway.ping ", "gateway.ping"], events: ["tick"] });
  const home = discoveredHomeFromAdvertisement({
    name: "Kitchen LiOS",
    host: "192.168.1.20",
    port: 8443,
    txt: Object.fromEntries(Object.entries(txt).map(([key, value]) => [key, Buffer.from(value)])),
  });
  assert.equal(home.name, "Kitchen LiOS");
  assert.equal(home.port, 8443);
  assert.deepEqual(home.methods, ["gateway.ping"]);
});

test("empty capability lists round trip without ambiguous empty Bonjour TXT values", () => {
  const txt = buildDeviceDiscoveryTxt({ ...identity, methods: [], events: [] });
  const codec = new DnsTxt();
  const decoded = codec.decodeAll(dnsPacket.txt.decode(dnsPacket.txt.encode(codec.encode(txt))));
  const home = discoveredHomeFromAdvertisement({ name: "Home", host: "192.168.1.20", port: 8443, txt: decoded });
  assert.deepEqual(home.methods, []);
  assert.deepEqual(home.events, []);
});

test("discovery rejects missing, reordered, duplicate, mismatched and oversized capability chunks", () => {
  const txt = buildDeviceDiscoveryTxt({ ...identity, methods: ["gateway.ping"], events: ["tick"] });
  const { m0: _method, ...missing } = txt;
  for (const malformed of [
    missing,
    { ...missing, m1: "gateway.ping" },
    { ...txt, methods: "2", m1: "gateway.ping" },
    { ...txt, methods: "0" },
    { ...txt, methods: "01" },
    { ...txt, e2: "other.event" },
    { ...txt, m0: "gateway.ping," },
    { ...txt, m0: "x".repeat(253) },
  ]) {
    assert.throws(() => parseDeviceDiscoveryTxt(malformed));
  }
  assert.throws(() => buildDeviceDiscoveryTxt({ ...identity, methods: ["x".repeat(65)], events: [] }));
  assert.throws(() => buildDeviceDiscoveryTxt({ ...identity, methods: Array.from({ length: 65 }, (_, i) => `method.${i}`), events: [] }));
  assert.throws(() => buildDeviceDiscoveryTxt({
    ...identity, methods: Array.from({ length: 64 }, (_, i) => `m${i.toString().padStart(2, "0")}.${"x".repeat(60)}`), events: [],
  }), /1300 bytes/);
});

test("discovery rejects invalid identities, unknown secret fields, malformed bytes and the obsolete wire version", () => {
  const txt = buildDeviceDiscoveryTxt({ ...identity, methods: ["gateway.ping"], events: [] });
  for (const malformed of [
    { ...txt, fp: "b".repeat(63) },
    { ...txt, homeId: "not-a-home-uuid" },
    { ...txt, token: "pairing-secret" },
    { ...txt, token: true },
    { ...txt, v: "1" },
    { ...txt, m0: new Uint8Array([0xff]) },
    { ...txt, m0: [999] },
    { ...txt, m0: null },
  ]) {
    assert.throws(() => parseDeviceDiscoveryTxt(malformed));
  }
});

test("mDNS service names are sanitized, fit one DNS label and never empty", () => {
  assert.equal(sanitizeMdnsServiceName("  My Home 🏠  "), "My Home");
  assert.equal(sanitizeMdnsServiceName("%%%"), "LiOS Home");
  assert.equal(sanitizeMdnsServiceName("Home.office"), "Home-office");
  assert.ok(Buffer.byteLength(sanitizeMdnsServiceName("x".repeat(100))) <= 63);
});
