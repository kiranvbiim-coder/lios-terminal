import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import type { Server } from "node:https";
import { isIP, Socket } from "node:net";
import { hostname, networkInterfaces } from "node:os";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { deviceNetworkSettingsSchema } from "@shared/deviceNetwork";
import type { DeviceNetworkSettings, DeviceNetworkStatus } from "@shared/deviceNetwork";
import { GATEWAY_EVENTS, GATEWAY_METHODS } from "@shared/gatewayProtocol";
import { stateDir } from "./dataRoot";
import { DeviceMdnsAdvertiser } from "./deviceMdnsAdvertiser";
import type { BonjourFactory } from "./deviceMdnsAdvertiser";
import { loadOrCreateDeviceTlsIdentity } from "./deviceTls";
import type { DeviceTlsIdentity } from "./deviceTls";
import type { GatewayAuthenticator, GatewayHub } from "./gatewayHub";

export interface DeviceNetworkOptions {
  hub: GatewayHub;
  authenticator: GatewayAuthenticator;
  settingsFile?: string;
  identityDirectory?: string;
  host?: string;
  port?: number;
  addresses?: () => string[];
  /** Multicast transport factory; defaults to real Bonjour. Tests inject a controlled transport. */
  createBonjour?: BonjourFactory;
}

interface DeviceListener {
  server: Server;
  webSockets: WebSocketServer;
  sockets: Set<Socket>;
  identity: DeviceTlsIdentity;
  port: number;
}

const SOCKET_LIMIT = 64;
const HTTP_TIMEOUT_MS = 10_000;
const SHUTDOWN_GRACE_MS = 250;

/** A separate opt-in TLS-only device surface; it never owns/shuts down the local session Gateway. */
export class DeviceNetwork {
  private readonly settingsFile: string;
  private readonly identityDirectory: string;
  private readonly mdns: DeviceMdnsAdvertiser;
  private settings: DeviceNetworkSettings = { enabled: false, discoverable: false, name: hostname().slice(0, 80).trim() || "LiOS Home" };
  private listener: DeviceListener | null = null;
  private queue: Promise<void> = Promise.resolve();
  private lastError: string | null = null;

  constructor(private readonly options: DeviceNetworkOptions) {
    this.settingsFile = options.settingsFile ?? path.join(stateDir(), "device-network.json");
    this.identityDirectory = options.identityDirectory ?? path.join(stateDir(), "device-tls");
    this.mdns = new DeviceMdnsAdvertiser(options.createBonjour);
  }

  readSettings(): DeviceNetworkSettings {
    try {
      return deviceNetworkSettingsSchema.parse(JSON.parse(readFileSync(this.settingsFile, "utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { enabled: false, discoverable: false, name: hostname().slice(0, 80).trim() || "LiOS Home" };
      }
      throw new Error(`Invalid device network settings: ${error instanceof Error ? error.message : "unreadable settings"}`, { cause: error });
    }
  }

  status(): DeviceNetworkStatus {
    const listener = this.listener;
    let urls: string[] = [];
    if (listener) {
      const discovered = this.options.addresses?.() ?? Object.values(networkInterfaces()).flatMap((entries) => (entries ?? [])
        .filter((address) => !address.internal && address.family === "IPv4").map((address) => address.address));
      const addresses = new Set(discovered.filter((address) => (isIP(address) === 4 && address !== "0.0.0.0") || address === "localhost"));
      if (!addresses.size) addresses.add("localhost");
      urls = [...addresses].slice(0, 32).map((address) => `wss://${address}:${listener.port}/gateway/device`);
    }
    const discovering = this.mdns.isPublishing();
    return {
      enabled: listener !== null && listener.server.listening,
      discoverable: this.settings.discoverable,
      discovering,
      name: this.settings.name,
      port: listener?.port ?? null,
      urls,
      fingerprint: listener?.identity.fingerprint ?? null,
      homeId: listener?.identity.homeId ?? null,
      error: this.lastError ?? this.mdns.error(),
    };
  }

  start(): Promise<void> {
    return this.serialize(async () => {
      const settings = this.readSettings();
      if (!this.listener) this.settings = settings;
      if (settings.enabled) {
        if (!this.listener) this.listener = await this.openListener();
      } else {
        await this.closeListener();
      }
      this.settings = settings;
      await this.syncDiscovery();
    }, true);
  }

  update(input: DeviceNetworkSettings): Promise<DeviceNetworkStatus> {
    return this.serialize(async () => {
      const settings = deviceNetworkSettingsSchema.parse({
        ...input,
        discoverable: input.enabled ? input.discoverable : false,
      });
      let created: DeviceListener | null = null;
      // Bind and validate identity before publishing enabled=true to disk or in status.
      if (settings.enabled && !this.listener) created = await this.openListener();
      try {
        await this.persistSettings(settings);
      } catch (error) {
        if (created) await this.closeListener(created);
        throw error;
      }
      if (created) this.listener = created;
      if (!settings.enabled) await this.closeListener();
      this.settings = settings;
      await this.syncDiscovery();
      this.lastError = null;
      return this.status();
    }, true);
  }

  /** Stops actual networking without changing the owner's saved opt-in setting. */
  stop(): Promise<void> {
    return this.serialize(async () => {
      await this.closeListener();
      await this.syncDiscovery();
    }, false);
  }

  private serialize<T>(operation: () => Promise<T>, clearError: boolean): Promise<T> {
    const result = this.queue.then(async () => {
      try {
        const value = await operation();
        if (clearError) this.lastError = null;
        return value;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : "Device networking failed.";
        throw error;
      }
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async persistSettings(settings: DeviceNetworkSettings): Promise<void> {
    await mkdir(path.dirname(this.settingsFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.settingsFile}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(settings)}\n`, { flag: "wx", mode: 0o600 });
      await rename(temporary, this.settingsFile);
    } finally {
      try { await unlink(temporary); } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
  }

  private async openListener(): Promise<DeviceListener> {
    const identity = await loadOrCreateDeviceTlsIdentity(this.identityDirectory);
    const server = createServer({
      cert: identity.certificatePem,
      key: identity.privateKeyPem,
      minVersion: "TLSv1.2",
      handshakeTimeout: HTTP_TIMEOUT_MS,
    }, (_request, response) => {
      response.writeHead(404, { "Content-Length": "0", "Connection": "close" });
      response.end();
    });
    server.headersTimeout = HTTP_TIMEOUT_MS;
    server.requestTimeout = HTTP_TIMEOUT_MS;
    server.keepAliveTimeout = 1_000;
    const webSockets = new WebSocketServer({ noServer: true, maxPayload: this.options.hub.policy.maxPayload, perMessageDeflate: false });
    const sockets = new Set<Socket>();
    const listener: DeviceListener = { server, webSockets, sockets, identity, port: 0 };
    server.on("connection", (socket) => {
      if (!(socket instanceof Socket)) { socket.destroy(); return; }
      if (sockets.size >= SOCKET_LIMIT) {
        socket.destroy();
        return;
      }
      sockets.add(socket);
      socket.setTimeout(HTTP_TIMEOUT_MS, () => socket.destroy());
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => socket.destroy());
    });
    server.on("upgrade", (request, socket, head) => {
      if (request.url !== "/gateway/device" || request.method !== "GET") {
        socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        request.socket.setTimeout(0);
        this.options.hub.attachUnauthenticated(webSocket, this.options.authenticator, request.socket.remoteAddress);
      });
    });
    server.on("tlsClientError", (_error, socket) => socket.destroy());
    server.on("clientError", (_error, socket) => socket.destroy());
    // Keep a handler installed after bind too; listener errors never become process-wide exceptions.
    server.on("error", (error) => { this.lastError = error.message; });
    const listening = Promise.withResolvers<void>();
    const onListening = () => listening.resolve();
    const onError = (error: Error) => listening.reject(error);
    server.once("listening", onListening);
    server.once("error", onError);
    try {
      server.listen(this.options.port ?? 0, this.options.host ?? "0.0.0.0");
      await listening.promise;
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Device TLS listener did not bind a TCP port.");
      listener.port = address.port;
      return listener;
    } catch (error) {
      await this.closeListener(listener);
      throw error;
    } finally {
      server.off("listening", onListening);
      server.off("error", onError);
    }
  }

  private async syncDiscovery(): Promise<void> {
    const listener = this.listener;
    if (!listener || !this.settings.enabled || !this.settings.discoverable) {
      await this.mdns.sync(null);
      return;
    }
    await this.mdns.sync({
      name: this.settings.name,
      port: listener.port,
      homeId: listener.identity.homeId,
      fingerprint: listener.identity.fingerprint,
      methods: Object.keys(GATEWAY_METHODS),
      events: Object.keys(GATEWAY_EVENTS),
    });
  }

  private async closeListener(listener: DeviceListener | null = this.listener): Promise<void> {
    if (!listener) return;
    if (this.listener === listener) this.listener = null;
    const closedDiscovery = this.syncDiscovery();
    const closedHttp = Promise.withResolvers<void>();
    const closedWebSockets = Promise.withResolvers<void>();
    listener.server.close(() => closedHttp.resolve());
    listener.webSockets.close(() => closedWebSockets.resolve());
    for (const socket of listener.webSockets.clients) {
      if (socket.readyState === WebSocket.OPEN) socket.close(1001, "Device networking disabled");
    }
    listener.server.closeIdleConnections();
    // Upgraded/hanging TLS sockets are outside closeIdleConnections; force only this listener's transports.
    const forceClose = () => {
      for (const socket of listener.webSockets.clients) socket.terminate();
      for (const socket of listener.sockets) socket.destroy();
    };
    const timer = setTimeout(forceClose, SHUTDOWN_GRACE_MS);
    try {
      await Promise.all([closedDiscovery, closedHttp.promise, closedWebSockets.promise]);
    } finally {
      clearTimeout(timer);
      forceClose();
    }
  }
}
