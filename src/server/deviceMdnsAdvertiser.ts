import type { EventEmitter } from "node:events";
import Bonjour from "bonjour-service";
import type { Service } from "bonjour-service";
import {
  buildDeviceDiscoveryTxt,
  LIOS_HOME_MDNS_SERVICE_TYPE,
  sanitizeMdnsServiceName,
} from "@shared/deviceDiscovery";

export interface DeviceMdnsAdvertisement {
  name: string;
  port: number;
  homeId: string;
  fingerprint: string;
  methods: readonly string[];
  events: readonly string[];
}

// bonjour-service 1.4.4 forwards query-response errors, but not all publication/bind failures.
// Observe its existing multicast transport so a failed send cannot become a misleading "up" event.
interface BonjourTransport {
  server: {
    mdns: EventEmitter & {
      respond: (packet: unknown, callback: (error?: Error) => void) => void;
    };
  };
}

const PUBLICATION_DEADLINE_MS = 5_000;

/** Publishes a LiOS Home on the LAN. No secrets are advertised; pairing still requires owner approval. */
export class DeviceMdnsAdvertiser {
  private bonjour: Bonjour | null = null;
  private service: Service | null = null;
  private signature: string | null = null;
  private lastError: string | null = null;

  isPublishing(): boolean {
    return this.service?.published === true && this.service.activated && !this.service.destroyed && this.lastError === null;
  }

  error(): string | null {
    return this.lastError;
  }

  async sync(advertisement: DeviceMdnsAdvertisement | null): Promise<void> {
    if (!advertisement) {
      await this.stop();
      this.lastError = null;
      return;
    }
    const txt = buildDeviceDiscoveryTxt(advertisement);
    // A display name is not an identity. Distinct Homes (and repeated test fixtures) must not fail probing
    // against one another or a previous Home's cached goodbye just because their display names are equal.
    const name = `${sanitizeMdnsServiceName(advertisement.name).slice(0, 26)} ${txt.homeId}`;
    const signature = JSON.stringify({ name, port: advertisement.port, txt });
    if (this.signature === signature && this.isPublishing()) return;
    await this.stop();
    this.lastError = null;
    const published = Promise.withResolvers<void>();
    const onError = (error: Error) => {
      if (this.bonjour !== bonjour) return;
      this.lastError = `LiOS LAN discovery failed: ${error.message}. Check local-network permission and UDP 5353 access.`;
      published.reject(new Error(this.lastError, { cause: error }));
      if (this.service?.published) {
        void this.stop().catch((stopError: unknown) => {
          this.lastError = stopError instanceof Error ? stopError.message : "LiOS LAN discovery could not stop.";
        });
      }
    };
    const bonjour = new Bonjour({}, onError);
    this.bonjour = bonjour;
    const transport = (bonjour as unknown as BonjourTransport).server.mdns;
    const respond = transport.respond;
    transport.respond = (packet, callback) => {
      respond.call(transport, packet, (error) => {
        if (error) onError(error);
        callback(error);
      });
    };
    transport.on("error", onError);
    transport.on("warning", (error: Error) => {
      if ("code" in error && (error.code === "EACCES" || error.code === "EPERM")) onError(error);
    });
    const timer = setTimeout(() => {
      published.reject(new Error("LiOS LAN discovery did not publish within 5 seconds. Check for a conflicting Home instance, local-network permission and UDP 5353 access."));
    }, PUBLICATION_DEADLINE_MS);
    timer.unref();
    try {
      const service = bonjour.publish({
        name,
        type: LIOS_HOME_MDNS_SERVICE_TYPE,
        port: advertisement.port,
        txt,
      });
      this.service = service;
      service.once("up", published.resolve);
      this.signature = signature;
      await published.promise;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "LiOS LAN discovery could not publish.";
      await this.stop();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async stop(): Promise<void> {
    const bonjour = this.bonjour;
    const service = this.service;
    this.bonjour = null;
    this.service = null;
    this.signature = null;
    if (!bonjour) return;
    // unpublishAll clears Bonjour's registry before destroy sees it. Mark the captured service too so
    // its delayed probe/reannouncement callbacks cannot outlive this publication.
    if (service) service.destroyed = true;
    try {
      await new Promise<void>((resolve, reject) => {
        bonjour.unpublishAll((error?: Error) => error ? reject(error) : resolve());
      });
    } finally {
      await new Promise<void>((resolve) => bonjour.destroy(resolve));
    }
  }
}
