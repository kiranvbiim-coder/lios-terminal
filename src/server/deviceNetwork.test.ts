import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once, EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { get } from "node:https";
import { connect, createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import Bonjour from "bonjour-service";
import { discoveredHomeFromAdvertisement } from "@shared/deviceDiscovery";
import type { DiscoveredLiosHome } from "@shared/deviceDiscovery";
import { GATEWAY_EVENTS, GATEWAY_METHODS } from "@shared/gatewayProtocol";
import { WebSocket, WebSocketServer } from "ws";
import { DeviceNetwork } from "./deviceNetwork";
import type { DeviceNetworkOptions } from "./deviceNetwork";
import { GatewayHub } from "./gatewayHub";
import type { GatewayAuthenticator } from "./gatewayHub";
import { createPinnedDeviceSocket } from "./pinnedDeviceSocket";
import { DeviceMdnsAdvertiser } from "./deviceMdnsAdvertiser";
import type { BonjourFactory } from "./deviceMdnsAdvertiser";

async function fixture(t: TestContext, options: Partial<DeviceNetworkOptions> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "lios-device-network-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hub = options.hub ?? new GatewayHub({ version: "network-test", policy: { handshakeTimeoutMs: 5_000 } });
  const authenticator: GatewayAuthenticator = options.authenticator ?? { authenticate: async () => ({ kind: "reject", error: { code: "UNAUTHORIZED", message: "Not paired" } }) };
  const configuration: DeviceNetworkOptions = {
    hub, authenticator, settingsFile: path.join(root, "network.json"), identityDirectory: path.join(root, "tls"), host: "127.0.0.1", addresses: () => ["127.0.0.1"], ...options,
  };
  const network = new DeviceNetwork(configuration);
  t.after(() => network.stop());
  return { root, network, hub, configuration };
}

async function httpStatus(url: string): Promise<number> {
  const result = Promise.withResolvers<number>();
  const request = get(url, { rejectUnauthorized: false, agent: false }, (response) => {
    response.resume();
    response.on("end", () => result.resolve(response.statusCode!));
  });
  request.on("error", result.reject);
  return result.promise;
}

test("network defaults off and never creates TLS keys or a listener until the owner opts in", async (t) => {
  const { root, network } = await fixture(t);
  assert.equal(network.readSettings().enabled, false);
  assert.ok(network.readSettings().name.length > 0 && network.readSettings().name.length <= 80);
  await network.start();
  assert.deepEqual(network.status(), {
    enabled: false, discoverable: false, discovering: false, name: network.readSettings().name, port: null, urls: [], fingerprint: null, homeId: null, error: null,
  });
  assert.equal(existsSync(path.join(root, "tls")), false);
  await network.update({ enabled: false, name: "Private Home" });
  assert.equal(existsSync(path.join(root, "tls")), false);
  assert.deepEqual(network.readSettings(), { enabled: false, discoverable: false, name: "Private Home" });
});

test("enable binds real TLS; restart preserves identity and all ordinary HTTP routes remain 404", { timeout: 10_000 }, async (t) => {
  const { network, configuration } = await fixture(t);
  const enabled = await network.update({ enabled: true, name: "My Home" });
  assert.equal(enabled.enabled, true);
  assert.ok(enabled.port && enabled.port > 0);
  assert.match(enabled.fingerprint!, /^[a-f0-9]{64}$/);
  assert.equal(enabled.urls[0], `wss://127.0.0.1:${enabled.port}/gateway/device`);
  for (const route of ["/", "/api/auth/me", "/gateway/device"]) {
    assert.equal(await httpStatus(`https://127.0.0.1:${enabled.port}${route}`), 404);
  }
  const Socket = createPinnedDeviceSocket(enabled.fingerprint!);
  const socket = new Socket(enabled.urls[0]!);
  const challenge = Promise.withResolvers<{ type: string; event: string; payload: { nonce: string } }>();
  socket.onmessage = ({ data }) => challenge.resolve(JSON.parse(String(data)));
  const frame = await challenge.promise;
  assert.equal(frame.type, "event");
  assert.equal(frame.event, "connect.challenge");
  assert.ok(frame.payload.nonce.length >= 16);
  await network.stop();
  assert.equal(network.status().enabled, false);
  assert.equal(network.readSettings().enabled, true, "temporary stop does not rewrite owner intent");
  const restarted = new DeviceNetwork(configuration);
  t.after(() => restarted.stop());
  await restarted.start();
  const status = restarted.status();
  assert.equal(status.enabled, true);
  assert.equal(status.name, "My Home");
  assert.equal(status.fingerprint, enabled.fingerprint);
  assert.equal(status.homeId, enabled.homeId);
});

test("only the exact device upgrade path is accepted, without queries or suffixes", { timeout: 10_000 }, async (t) => {
  const { network } = await fixture(t);
  const status = await network.update({ enabled: true, name: "Home" });
  for (const route of ["/gateway", "/", "/api/auth/me", "/gateway/device?token=secret", "/gateway/device/", "/gateway/%64evice"]) {
    const statusCode = await new Promise<number>((resolve, reject) => {
      const request = get({ hostname: "127.0.0.1", port: status.port, path: route, rejectUnauthorized: false }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.on("error", reject);
    });
    assert.equal(statusCode, 404, route);
  }
});

test("stop closes its connected/preauth/hanging TLS sockets and port, but leaves local UI sockets alone", { timeout: 10_000 }, async (t) => {
  const { network, hub } = await fixture(t);
  const localHttp = createHttpServer();
  const localSockets = new WebSocketServer({ server: localHttp });
  localSockets.on("connection", (socket) => hub.attach(socket, { userId: 1, email: "local@example.test", role: "client_user", organizationId: null, grantedScopes: ["read", "write"] }));
  const listening = Promise.withResolvers<void>();
  localHttp.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  const localAddress = localHttp.address();
  assert.ok(localAddress && typeof localAddress !== "string");
  t.after(async () => {
    for (const socket of localSockets.clients) socket.terminate();
    const closed = Promise.withResolvers<void>();
    localHttp.close(() => closed.resolve());
    await closed.promise;
    localSockets.close();
  });
  const local = new WebSocket(`ws://127.0.0.1:${localAddress.port}/gateway`);
  local.on("error", () => undefined);
  t.after(() => local.terminate());
  await once(local, "open");
  const status = await network.update({ enabled: true, name: "Home" });
  const device = new WebSocket(status.urls[0]!, { rejectUnauthorized: false });
  const deviceClosed = Promise.withResolvers<void>();
  device.on("close", () => deviceClosed.resolve());
  device.on("error", () => undefined);
  await once(device, "open");
  const stalledTls = connect({ host: "127.0.0.1", port: status.port! });
  stalledTls.on("error", () => undefined);
  const stalledClosed = Promise.withResolvers<void>();
  stalledTls.on("close", () => stalledClosed.resolve());
  await once(stalledTls, "connect");
  await network.stop();
  await Promise.all([deviceClosed.promise, stalledClosed.promise]);
  assert.equal(device.readyState, WebSocket.CLOSED);
  assert.equal(local.readyState, WebSocket.OPEN);
  assert.equal(network.status().port, null);
  const probe = connect({ host: "127.0.0.1", port: status.port! });
  const refused = Promise.withResolvers<Error>();
  probe.on("error", refused.resolve);
  assert.match((await refused.promise).message, /ECONNREFUSED/);
  probe.destroy();
});

test("failed bind preserves disabled settings and name; status reports the error until a successful retry", { timeout: 10_000 }, async (t) => {
  const occupied = createTcpServer();
  const listening = Promise.withResolvers<void>();
  occupied.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  t.after(() => { occupied.close(); });
  const address = occupied.address();
  assert.ok(address && typeof address !== "string");
  const { root, network } = await fixture(t, { port: address.port });
  await network.update({ enabled: false, name: "Original" });
  const original = await readFile(path.join(root, "network.json"), "utf8");
  await assert.rejects(network.update({ enabled: true, name: "Changed" }), /EADDRINUSE/);
  assert.equal(await readFile(path.join(root, "network.json"), "utf8"), original);
  assert.equal(network.readSettings().enabled, false);
  assert.equal(network.status().enabled, false);
  assert.equal(network.status().name, "Original");
  assert.match(network.status().error!, /EADDRINUSE/);
  await network.stop();
  assert.match(network.status().error!, /EADDRINUSE/);
  const closed = Promise.withResolvers<void>();
  occupied.close(() => closed.resolve());
  await closed.promise;
  const retried = await network.update({ enabled: true, name: "Changed" });
  assert.equal(retried.enabled, true);
  assert.equal(retried.port, address.port);
  assert.equal(retried.error, null);
});

test("persisted opt-in start errors leave networking closed without changing saved settings", { timeout: 10_000 }, async (t) => {
  const { network, configuration } = await fixture(t);
  await network.update({ enabled: true, name: "Stable" });
  await network.stop();
  await writeFile(path.join(configuration.identityDirectory!, "identity.json"), "malformed", { mode: 0o600 });
  await assert.rejects(network.start(), /Invalid existing device TLS identity/);
  assert.deepEqual(network.readSettings(), { enabled: true, discoverable: false, name: "Stable" });
  assert.equal(network.status().enabled, false);
  assert.match(network.status().error!, /Invalid existing device TLS identity/);
});

test("start/update/stop transactions are serialized and URL discovery is deduplicated and capped", { timeout: 10_000 }, async (t) => {
  const { network } = await fixture(t, { addresses: () => ["not an address", "0.0.0.0", "127.0.0.1", "127.0.0.1", ...Array.from({ length: 40 }, (_, index) => `192.0.2.${index + 1}`)] });
  const first = network.update({ enabled: true, name: "First" });
  const second = network.update({ enabled: false, name: "Second" });
  const third = network.update({ enabled: true, name: "Third" });
  const stop = network.stop();
  const start = network.start();
  const [one, two, three] = await Promise.all([first, second, third, stop, start]);
  assert.equal(one.name, "First");
  assert.equal(two.enabled, false);
  assert.equal(two.name, "Second");
  assert.equal(three.name, "Third");
  assert.equal(network.status().name, "Third");
  assert.equal(network.status().enabled, true);
  assert.equal(network.status().urls.length, 32);
  assert.equal(new Set(network.status().urls).size, 32);
});

test("the listener caps all incoming sockets at 64 and shutdown closes incomplete TLS handshakes", { timeout: 10_000 }, async (t) => {
  const { network } = await fixture(t);
  const status = await network.update({ enabled: true, name: "Bounded Home" });
  const sockets = Array.from({ length: 64 }, () => connect({ host: "127.0.0.1", port: status.port! }));
  for (const socket of sockets) {
    socket.on("error", () => undefined);
    t.after(() => socket.destroy());
  }
  await Promise.all(sockets.map((socket) => once(socket, "connect")));
  const extra = connect({ host: "127.0.0.1", port: status.port! });
  extra.on("error", () => undefined);
  const rejected = Promise.withResolvers<void>();
  extra.on("close", () => rejected.resolve());
  await rejected.promise;
  assert.ok(sockets.every((socket) => !socket.destroyed));
  const closed = sockets.map((socket) => once(socket, "close"));
  await network.stop();
  await Promise.all(closed);
  assert.ok(sockets.every((socket) => socket.destroyed));
});

/** A controlled multicast transport: the real publication state machine runs, but no UDP packet leaves the host. */
function controlledBonjour(options: { autoUp?: boolean } = {}) {
  const published: Array<{ name: string; port: number; txt: Record<string, unknown> }> = [];
  const services: Array<EventEmitter & { published: boolean; activated: boolean; destroyed: boolean }> = [];
  const transports: Array<EventEmitter & { respond: (packet: unknown, callback: (error?: Error) => void) => void }> = [];
  let destroyed = 0;
  const factory: BonjourFactory = () => {
    const mdns = Object.assign(new EventEmitter(), {
      respond: (_packet: unknown, callback: (error?: Error) => void) => callback(),
    });
    transports.push(mdns);
    const fake = {
      server: { mdns },
      publish(config: { name: string; port: number; txt: Record<string, unknown> }) {
        published.push(config);
        const service = Object.assign(new EventEmitter(), { published: false, activated: false, destroyed: false });
        services.push(service);
        if (options.autoUp !== false) queueMicrotask(() => up(service));
        return service;
      },
      unpublishAll: (callback: (error?: Error) => void) => callback(),
      destroy: (callback: () => void) => { destroyed += 1; callback(); },
    };
    return fake as unknown as Bonjour;
  };
  const up = (service: (typeof services)[number]) => {
    service.published = true;
    service.activated = true;
    service.emit("up");
  };
  return { factory, published, services, transports, up, destroyedCount: () => destroyed };
}

test("discoverable opt-in toggles mDNS publisher state with device networking", { timeout: 10_000 }, async (t) => {
  const wire = controlledBonjour();
  const { network } = await fixture(t, { createBonjour: wire.factory });
  const enabled = await network.update({ enabled: true, discoverable: true, name: "Discoverable Home" });
  assert.equal(enabled.discovering, true);
  assert.equal(enabled.discoverable, true);
  assert.equal(wire.published.length, 1);
  assert.equal(wire.published[0]!.port, enabled.port);
  await network.update({ enabled: true, discoverable: false, name: "Discoverable Home" });
  assert.equal(network.status().discovering, false);
  assert.equal(wire.destroyedCount(), 1, "opting out tears the transport down");
  await network.update({ enabled: true, discoverable: true, name: "Discoverable Home" });
  assert.equal(network.status().discovering, true);
  await network.stop();
  assert.equal(network.status().discovering, false);
  assert.equal(wire.destroyedCount(), 2);
});

test("a multicast send failure is reported and never leaves a publication marked live", { timeout: 10_000 }, async (t) => {
  const wire = controlledBonjour({ autoUp: false });
  const advertiser = new DeviceMdnsAdvertiser(wire.factory);
  t.after(() => advertiser.stop());
  const advertisement = {
    name: "Unreachable Home", homeId: randomUUID(), fingerprint: "d".repeat(64), port: 5052,
    methods: Object.keys(GATEWAY_METHODS), events: Object.keys(GATEWAY_EVENTS),
  };
  const publishing = advertiser.sync(advertisement);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const failure = Object.assign(new Error("send EHOSTUNREACH 224.0.0.251:5353"), { code: "EHOSTUNREACH" });
  publishing.catch(() => undefined);
  wire.transports[0]!.emit("error", failure);
  await assert.rejects(publishing, /LiOS LAN discovery failed: send EHOSTUNREACH/);
  assert.equal(advertiser.isPublishing(), false);
  assert.match(advertiser.error() ?? "", /UDP 5353/);
  assert.equal(wire.destroyedCount(), 1);
});

test("mDNS publication state waits for probing and capability changes with unchanged counts republish", { timeout: 10_000 }, async (t) => {
  const wire = controlledBonjour({ autoUp: false });
  const advertiser = new DeviceMdnsAdvertiser(wire.factory);
  t.after(() => advertiser.stop());
  const advertisement = {
    name: "Signature Home", homeId: randomUUID(), fingerprint: "c".repeat(64), port: 5052,
    methods: Object.keys(GATEWAY_METHODS), events: Object.keys(GATEWAY_EVENTS),
  };
  const changedMethods = [...advertisement.methods.slice(0, -1), "wire.updated"];
  assert.equal(changedMethods.length, advertisement.methods.length, "the capability count is unchanged");
  const publishing = advertiser.sync(advertisement);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(advertiser.isPublishing(), false, "an allocated/pending service is not a live advertisement");
  wire.up(wire.services[0]!);
  await publishing;
  assert.equal(advertiser.isPublishing(), true);
  await advertiser.sync(advertisement);
  assert.equal(wire.published.length, 1, "an unchanged live advertisement is not republished");
  const republishing = advertiser.sync({ ...advertisement, methods: changedMethods });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(advertiser.isPublishing(), false, "the replacement is pending until it is announced");
  wire.up(wire.services[1]!);
  await republishing;
  assert.equal(wire.published.length, 2);
  assert.notDeepEqual(wire.published[1]!.txt, wire.published[0]!.txt);
  assert.equal(advertiser.isPublishing(), true);
  await advertiser.stop();
  assert.equal(advertiser.isPublishing(), false);
});

test("discoverable opt-in publishes LiOS Home mDNS on the LAN", {
  timeout: 20_000,
  skip: process.env.GITHUB_ACTIONS === "true",
}, async (t) => {
  const { network } = await fixture(t, { host: "0.0.0.0" });
  const { network: otherNetwork } = await fixture(t, { host: "0.0.0.0" });
  const identity = await network.update({ enabled: true, discoverable: false, name: "Discoverable Home" });
  const otherIdentity = await otherNetwork.update({ enabled: true, discoverable: false, name: "Discoverable Home" });
  assert.equal(identity.discovering, false);
  assert.equal(otherIdentity.discovering, false);
  const mdns = new Bonjour();
  const seen = Promise.withResolvers<DiscoveredLiosHome>();
  const otherSeen = Promise.withResolvers<DiscoveredLiosHome>();
  const removed = Promise.withResolvers<void>();
  const otherRemoved = Promise.withResolvers<void>();
  const browser = mdns.find({ type: "lios-home" }, (service) => {
    if (!service.txt || service.port === undefined) return;
    try {
      const home = discoveredHomeFromAdvertisement({
        name: service.name,
        host: service.referer?.address ?? service.host,
        port: service.port,
        txt: service.txt as Record<string, unknown>,
      });
      if (home.homeId === identity.homeId) seen.resolve(home);
      if (home.homeId === otherIdentity.homeId) otherSeen.resolve(home);
    } catch (error) {
      // Malformed advertisements for our exact instances are failures, not an opaque discovery timeout.
      if (service.name.endsWith(identity.homeId!)) seen.reject(error);
      if (service.name.endsWith(otherIdentity.homeId!)) otherSeen.reject(error);
    }
  });
  browser.on("down", (service: { txt?: Record<string, unknown> }) => {
    if (service.txt?.homeId === identity.homeId) removed.resolve();
    if (service.txt?.homeId === otherIdentity.homeId) otherRemoved.resolve();
  });
  t.after(async () => {
    browser.stop();
    await new Promise<void>((resolve) => mdns.destroy(resolve));
  });
  const enabled = await network.update({ enabled: true, discoverable: true, name: "Discoverable Home" });
  const otherEnabled = await otherNetwork.update({ enabled: true, discoverable: true, name: "Discoverable Home" });
  assert.equal(enabled.discovering, true);
  assert.equal(otherEnabled.discovering, true);
  const [advertised, otherAdvertised] = await Promise.all([seen.promise, otherSeen.promise]);
  assert.equal(advertised.port, enabled.port);
  assert.equal(advertised.homeId, enabled.homeId);
  assert.equal(advertised.fingerprint, enabled.fingerprint);
  assert.deepEqual(advertised.methods, Object.keys(GATEWAY_METHODS));
  assert.deepEqual(advertised.events, Object.keys(GATEWAY_EVENTS));
  assert.notEqual(advertised.name, otherAdvertised.name, "equal display names must not collide during probing");
  assert.equal(otherAdvertised.homeId, otherEnabled.homeId);
  assert.equal(otherAdvertised.fingerprint, otherEnabled.fingerprint);
  await network.stop();
  await removed.promise;
  assert.equal(network.status().discovering, false);
  assert.equal(network.status().enabled, false);
  assert.ok(browser.services.some((service) => (service.txt as Record<string, unknown> | undefined)?.homeId === otherEnabled.homeId));
  await otherNetwork.stop();
  await otherRemoved.promise;
  assert.equal(otherNetwork.status().discovering, false);
  assert.equal(browser.services.filter((service) => {
    const homeId = (service.txt as Record<string, unknown> | undefined)?.homeId;
    return homeId === enabled.homeId || homeId === otherEnabled.homeId;
  }).length, 0);
});

test("mDNS capability changes are observed by a real LAN browser", {
  timeout: 20_000,
  skip: process.env.GITHUB_ACTIONS === "true",
}, async (t) => {
  const advertiser = new DeviceMdnsAdvertiser();
  const mdns = new Bonjour();
  t.after(async () => {
    await advertiser.stop();
    await new Promise<void>((resolve) => mdns.destroy(resolve));
  });
  const advertisement = {
    name: "Signature Home",
    homeId: randomUUID(),
    fingerprint: "c".repeat(64),
    port: 5052,
    methods: Object.keys(GATEWAY_METHODS),
    events: Object.keys(GATEWAY_EVENTS),
  };
  const changedMethods = [...advertisement.methods.slice(0, -1), "wire.updated"];
  const seen = Promise.withResolvers<DiscoveredLiosHome>();
  const browser = mdns.find({ type: "lios-home" }, (service) => {
    if ((service.txt as Record<string, unknown> | undefined)?.homeId !== advertisement.homeId) return;
    try {
      const home = discoveredHomeFromAdvertisement({
        name: service.name, host: service.referer?.address ?? service.host, port: service.port,
        txt: service.txt as Record<string, unknown>,
      });
      if (home.methods.includes("wire.updated")) seen.resolve(home);
    } catch (error) {
      seen.reject(error);
    }
  });
  t.after(() => browser.stop());
  await advertiser.sync(advertisement);
  await advertiser.sync({ ...advertisement, methods: changedMethods });
  const changed = await seen.promise;
  assert.deepEqual(changed.methods, changedMethods);
  assert.deepEqual(changed.events, advertisement.events);
});
