import { z } from "zod";

/** DNS-SD type segment for LiOS Homes (`_lios-home._tcp`). */
export const LIOS_HOME_MDNS_SERVICE_TYPE = "lios-home";

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const capabilitySchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/);
const capabilityListSchema = z.array(capabilitySchema).max(64);
const capabilityCountSchema = z.string().regex(/^(?:0|[1-9]\d?)$/).refine((value) => Number(value) <= 64);
/** RFC 6763: each complete key=value character-string has a one-byte length. */
export const DEVICE_DISCOVERY_TXT_STRING_MAX_BYTES = 255;
export const DEVICE_DISCOVERY_TXT_MAX_BYTES = 1_300;
const textEncoder = new TextEncoder();
const identityTxtKeys: Record<string, true> = { v: true, homeId: true, fp: true, methods: true, events: true };

function readCapabilities(txt: Record<string, string>, prefix: "m" | "e", count: string): string[] {
  const keys = Object.keys(txt).filter((key) => key.startsWith(prefix) && /^\d+$/.test(key.slice(1)));
  const entries: string[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const chunk = txt[`${prefix}${index}`];
    if (!chunk) throw new Error("Discovery capability chunks must be nonempty and contiguous.");
    entries.push(...chunk.split(","));
  }
  const parsed = capabilityListSchema.parse(entries);
  if (parsed.length !== Number(count) || new Set(parsed).size !== parsed.length) {
    throw new Error("Discovery capability counts must match unique advertised capabilities.");
  }
  return parsed;
}

export const deviceDiscoveryTxtSchema = z.object({
  v: z.literal("2"),
  homeId: z.string().uuid(),
  fp: fingerprintSchema,
  methods: capabilityCountSchema,
  events: capabilityCountSchema,
}).catchall(z.string()).superRefine((txt, context) => {
  let bytes = 0;
  for (const [key, value] of Object.entries(txt)) {
    if (!Object.hasOwn(identityTxtKeys, key) && !/^[me](?:0|[1-9]\d?)$/.test(key)) {
      context.addIssue({ code: "custom", message: "Unknown discovery TXT field.", path: [key] });
    }
    const length = textEncoder.encode(`${key}=${value}`).length;
    bytes += length + 1;
    if (length > DEVICE_DISCOVERY_TXT_STRING_MAX_BYTES) {
      context.addIssue({ code: "custom", message: "Discovery TXT character-string exceeds 255 bytes.", path: [key] });
    }
  }
  if (bytes > DEVICE_DISCOVERY_TXT_MAX_BYTES) {
    context.addIssue({ code: "custom", message: "Discovery TXT record exceeds 1300 bytes." });
  }
  for (const [prefix, count] of [["m", txt.methods], ["e", txt.events]] as const) {
    try {
      readCapabilities(txt, prefix, count);
    } catch {
      context.addIssue({ code: "custom", message: "Invalid discovery capability chunks or count.", path: [prefix] });
    }
  }
});
export type DeviceDiscoveryTxt = z.infer<typeof deviceDiscoveryTxtSchema>;

export const discoveredLiosHomeSchema = z.object({
  name: z.string().min(1).max(80),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65_535),
  homeId: z.string().uuid(),
  fingerprint: fingerprintSchema,
  methods: capabilityListSchema,
  events: capabilityListSchema,
}).strict();
export type DiscoveredLiosHome = z.infer<typeof discoveredLiosHomeSchema>;

function appendCapabilities(txt: Record<string, string>, prefix: "m" | "e", entries: readonly string[]): void {
  let index = 0;
  let chunk = "";
  for (const entry of entries) {
    const candidate = chunk ? `${chunk},${entry}` : entry;
    if (textEncoder.encode(`${prefix}${index}=${candidate}`).length > DEVICE_DISCOVERY_TXT_STRING_MAX_BYTES) {
      txt[`${prefix}${index}`] = chunk;
      index += 1;
      chunk = entry;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) txt[`${prefix}${index}`] = chunk;
}

export function buildDeviceDiscoveryTxt(input: {
  homeId: string;
  fingerprint: string;
  methods: readonly string[];
  events: readonly string[];
}): DeviceDiscoveryTxt {
  const methods = capabilityListSchema.parse([...new Set(input.methods.map((entry) => entry.trim()).filter(Boolean))]);
  const events = capabilityListSchema.parse([...new Set(input.events.map((entry) => entry.trim()).filter(Boolean))]);
  const txt: Record<string, string> = {
    v: "2",
    homeId: input.homeId,
    fp: input.fingerprint,
    methods: String(methods.length),
    events: String(events.length),
  };
  appendCapabilities(txt, "m", methods);
  appendCapabilities(txt, "e", events);
  return deviceDiscoveryTxtSchema.parse(txt);
}

/** Normalises Bonjour TXT records (string or byte values) into the strict LiOS advertisement contract. */
export function parseDeviceDiscoveryTxt(txt: Record<string, unknown>): DeviceDiscoveryTxt {
  const normalized: Record<string, string> = {};
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const [key, value] of Object.entries(txt)) {
    if (typeof value === "string") normalized[key] = value;
    else if (value instanceof Uint8Array) normalized[key] = decoder.decode(value);
    else if (Array.isArray(value) && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
      normalized[key] = decoder.decode(Uint8Array.from(value));
    } else {
      throw new Error(`Invalid discovery TXT value for ${key}.`);
    }
  }
  return deviceDiscoveryTxtSchema.parse(normalized);
}

export function discoveredHomeFromAdvertisement(input: {
  name: string;
  host: string;
  port: number;
  txt: Record<string, unknown>;
}): DiscoveredLiosHome {
  const parsed = parseDeviceDiscoveryTxt(input.txt);
  return discoveredLiosHomeSchema.parse({
    name: input.name.trim().slice(0, 80),
    host: input.host,
    port: input.port,
    homeId: parsed.homeId,
    fingerprint: parsed.fp,
    methods: readCapabilities(parsed, "m", parsed.methods),
    events: readCapabilities(parsed, "e", parsed.events),
  });
}

/** mDNS instance names must stay readable on the LAN without leaking secrets. */
export function sanitizeMdnsServiceName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ").slice(0, 63);
  const sanitized = trimmed.replace(/[^\w .-]/g, "").replace(/\./g, "-").trim();
  return sanitized.length > 0 ? sanitized : "LiOS Home";
}
