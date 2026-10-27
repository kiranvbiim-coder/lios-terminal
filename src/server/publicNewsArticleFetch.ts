/**
 * Untrusted publisher HTML intake only. Unlike provider-to-provider fetchText,
 * a reader can supply an arbitrary article URL. Never expose local Home
 * services/IMDS through News read-through, including via HTTP redirects or
 * DNS rebinding between validation and connection.
 *
 * Uses existing IP-policy classification, DNS-pins the HTTP(S) socket,
 * limits redirects/response bytes and never forwards credentials.
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import {
  isBlockedSpecialUseIpv4Address, isBlockedSpecialUseIpv6Address,
  isCloudMetadataIpAddress, isIpv4Address, isPrivateOrLoopbackIpAddress,
  parseCanonicalIpAddress,
} from "./netPolicy/ip";

const MAX_HTML_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const INTERNAL_NAMES = new Set(["localhost", "metadata", "instance-data", "metadata.google.internal"]);

export function validatePublicNewsUrl(input: string): URL {
  if (typeof input !== "string" || input.length > 2048) throw new Error("Invalid public news URL.");
  const url = new URL(input);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!["http:", "https:"].includes(url.protocol) || !host || url.username || url.password ||
      url.port && !["80", "443"].includes(url.port) ||
      net.isIP(host) !== 0 || !host.includes(".") ||
      INTERNAL_NAMES.has(host) ||
      [".localhost", ".local", ".internal", ".test", ".invalid", ".onion", ".arpa"].some(suffix => host.endsWith(suffix))) {
    throw new Error("Article URL must be a public HTTP(S) publisher hostname.");
  }
  return url;
}

export function isPermittedNewsIp(address: string): boolean {
  const parsed = parseCanonicalIpAddress(address);
  if (!parsed || isCloudMetadataIpAddress(address) || isPrivateOrLoopbackIpAddress(address)) return false;
  return isIpv4Address(parsed)
    ? !isBlockedSpecialUseIpv4Address(parsed)
    : !isBlockedSpecialUseIpv6Address(parsed);
}

export async function resolvePublicNewsAddress(
  host: string,
  resolver: typeof dnsLookup = dnsLookup,
): Promise<{ address: string; family: number }> {
  const addresses = await resolver(host, { all: true });
  if (!addresses.length || addresses.some(record => !isPermittedNewsIp(record.address))) {
    throw new Error("News publisher resolved to a private or unsupported address.");
  }
  const address = addresses[0];
  return { address: address.address, family: address.family };
}

async function readOnePublicArticle(
  url: URL,
  hop: number,
): Promise<string> {
  if (hop > MAX_REDIRECTS) throw new Error("Too many news redirects.");
  const pinned = await resolvePublicNewsAddress(url.hostname);
  const driver = url.protocol === "https:" ? https : http;
  return new Promise<string>((resolve, reject) => {
    const req = driver.get(url, {
      agent: false,
      headers: {
        "User-Agent": "LiOS-Terminal/1.0 (bounded source article read-through)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.7",
        "Accept-Encoding": "identity",
      },
      // DNS is checked before this socket opens; the socket MUST connect only
      // to that already-reviewed address, retaining the URL hostname for TLS.
      lookup: (_host, _options, callback) => {
        const done = callback as (error: NodeJS.ErrnoException | null, address: string, family: number) => void;
        done(null, pinned.address, pinned.family);
      },
    }, response => {
      const status = response.statusCode ?? 0;
      if (REDIRECT_STATUS.has(status)) {
        const location = response.headers.location;
        response.resume();
        if (typeof location !== "string") {
          reject(new Error("Publisher redirect omitted location."));
          return;
        }
        try {
          const next = validatePublicNewsUrl(new URL(location, url).href);
          readOnePublicArticle(next, hop + 1).then(resolve, reject);
        } catch (error) { reject(error); }
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error("Publisher response unavailable."));
        return;
      }
      const kind = String(response.headers["content-type"] ?? "").toLowerCase();
      if (!/^(text\/html|application\/xhtml\+xml|text\/plain)(?:\s*;|$)/.test(kind)) {
        response.resume();
        reject(new Error("Publisher did not return readable article text."));
        return;
      }
      let bytes = 0;
      const chunks: Buffer[] = [];
      response.on("data", (part: Buffer) => {
        const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
        bytes += chunk.length;
        if (bytes > MAX_HTML_BYTES) {
          response.destroy(new Error("News article exceeds the 1 MiB read-through budget."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks, bytes).toString("utf8")));
      response.on("error", reject);
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("News article request timed out.")));
    req.on("error", reject);
  });
}

/** A source fetch never reads files, localhost, link-local or private ports. */
export async function fetchPublicNewsArticleHtml(input: string): Promise<string> {
  return readOnePublicArticle(validatePublicNewsUrl(input), 0);
}
