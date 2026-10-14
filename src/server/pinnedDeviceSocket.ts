import { createHash, timingSafeEqual, X509Certificate } from "node:crypto";
import { Agent } from "node:https";
import type { RequestOptions } from "node:https";
import type { Duplex } from "node:stream";
import { connect } from "node:tls";
import { WebSocket } from "ws";
import type { GatewaySocket, GatewaySocketConstructor } from "../client/src/lib/gateway/gatewayClient";

const TLS_TIMEOUT_MS = 10_000;

/** Releases the TLS socket to HTTPS only after the leaf pin and validity are checked. */
class PinnedAgent extends Agent {
  constructor(private readonly fingerprint: Buffer) {
    // Trust comes exclusively from the out-of-band leaf pin, not a system/self-signed chain.
    super({ keepAlive: false, maxCachedSessions: 0 });
  }

  override createConnection(options: RequestOptions, callback?: (error: Error | null, stream: Duplex) => void): undefined {
    if (!callback) throw new Error("Pinned device TLS requires an asynchronous connection callback.");
    const socket = connect({ ...options, host: options.host ?? undefined, socket: undefined, path: undefined, port: Number(options.port ?? 443), rejectUnauthorized: false, minVersion: "TLSv1.2" });
    let settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      callback(error, socket);
      if (error) socket.destroy();
    };
    socket.setTimeout(TLS_TIMEOUT_MS, () => finish(new Error("Pinned device TLS handshake timed out.")));
    socket.on("error", (error) => finish(error));
    socket.once("close", () => {
      if (!settled) finish(new Error("Pinned device TLS closed before certificate verification."));
    });
    socket.once("secureConnect", () => {
      try {
        const peer = socket.getPeerCertificate();
        if (!peer.raw?.length) throw new Error("Pinned device TLS peer did not provide a leaf certificate.");
        const actual = createHash("sha256").update(peer.raw).digest();
        if (!timingSafeEqual(actual, this.fingerprint)) throw new Error("Device TLS certificate fingerprint does not match the invitation pin.");
        const certificate = new X509Certificate(peer.raw);
        const now = Date.now();
        const notBefore = Date.parse(certificate.validFrom);
        const notAfter = Date.parse(certificate.validTo);
        if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter) || notBefore > now || notAfter <= now) {
          throw new Error("Pinned device TLS certificate is expired or not yet valid.");
        }
        finish(null);
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Pinned device TLS certificate verification failed."));
      }
    });
    // Returning the socket here would let HTTPS write its upgrade before pin verification.
    return undefined;
  }
}

/** Node-only Gateway transport: a correct QR pin is mandatory before open/message/send can occur. */
export function createPinnedDeviceSocket(fingerprint: string): GatewaySocketConstructor {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error("A lowercase SHA-256 device certificate fingerprint is required.");
  const expected = Buffer.from(fingerprint, "hex");
  return class PinnedDeviceSocket implements GatewaySocket {
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    private readonly socket: WebSocket;

    constructor(value: string) {
      const url = new URL(value);
      if (url.protocol !== "wss:" || url.username || url.password || url.hash) throw new Error("Device connections require a wss:// URL without credentials or a fragment.");
      const agent = new PinnedAgent(expected);
      this.socket = new WebSocket(url, { agent, perMessageDeflate: false, followRedirects: false, handshakeTimeout: TLS_TIMEOUT_MS });
      this.socket.on("open", () => this.onopen?.({}));
      this.socket.on("message", (data, isBinary) => this.onmessage?.({ data: isBinary ? data : data.toString() }));
      this.socket.on("error", (error) => this.onerror?.(error));
      this.socket.on("close", (code, reason) => {
        agent.destroy();
        this.onclose?.({ code, reason: reason.toString("utf8") });
      });
    }

    send(data: string): void {
      this.socket.send(data);
    }

    close(code?: number, reason?: string): void {
      this.socket.close(code, reason);
    }
  };
}
