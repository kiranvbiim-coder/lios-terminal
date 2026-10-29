import crypto from "node:crypto";
import { sanitizeBrowserDownloadFilename, assertBrowserDownloadInsideRoots } from "./browserDownloadSafety";
import { browserConnectorPolicySchema, type BrowserConnectorPolicy } from "@shared/universalDataFabric";
import { isCredentialSafeReference } from "@shared/dataFabric";
import { hashLedgerValue, sanitizeLedgerPayload } from "./ledgerStore";

export interface BrowserConnectorRequest {
  urls: string[];
  extraction: { kind: "text" | "links" | "json" | "snapshot"; selector?: string | null };
  interaction?: { kind: "click"; selector: string };
  download?: { url: string; filename: string } | null;
}

export interface BrowserAutomationAdapter {
  id: string;
  /** Present for isolated adapters whose network authority is bound to one Project. */
  readonly networkProjectId?: BrowserConnectorPolicy["projectId"];
  navigate(url: string, timeoutMs: number): Promise<string | void>;
  extract(input: BrowserConnectorRequest["extraction"]): Promise<unknown>;
  interact?(input: NonNullable<BrowserConnectorRequest["interaction"]>): Promise<string>;
  download?(url: string, filename: string, maxBytes: number, allowedRoots: string[]): Promise<{ path: string; bytes: number }>;
  close(): Promise<void>;
}

/**
 * Project-scoped URL authority for an isolated browser transport.
 *
 * This is deliberately authorization-only: it neither opens sockets nor owns
 * browser policy. A broker/transport must present every navigation/subresource
 * URL here before using the existing host-side pinned network transport.
 */
export interface BrowserProjectNetworkAuthority {
  readonly projectId: BrowserConnectorPolicy["projectId"];
  authorize(url: string): URL;
}

function hostnameAllowed(hostname: string, domains: string[]): boolean {
  const normalized = hostname.toLowerCase();
  return domains.some((domain) => {
    const allowed = domain.toLowerCase();
    return normalized === allowed || normalized.endsWith(`.${allowed}`);
  });
}

export function assertBrowserUrlAllowed(url: string, policy: BrowserConnectorPolicy): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Browser connector permits HTTPS targets only.");
  if (!hostnameAllowed(parsed.hostname, policy.allowedDomains)) throw new Error(`Browser domain "${parsed.hostname}" is outside Project policy.`);
  if (parsed.username || parsed.password || !isCredentialSafeReference(url)) throw new Error("Browser URL must not embed credentials.");
  return parsed;
}

export function createBrowserProjectNetworkAuthority(
  rawPolicy: BrowserConnectorPolicy,
): BrowserProjectNetworkAuthority {
  const policy = browserConnectorPolicySchema.parse(rawPolicy);
  return Object.freeze({
    projectId: policy.projectId,
    authorize(url: string) {
      return assertBrowserUrlAllowed(url, policy);
    },
  });
}

export async function executeBrowserConnector(
  rawPolicy: BrowserConnectorPolicy,
  request: BrowserConnectorRequest,
  adapter: BrowserAutomationAdapter,
) {
  const startedAt = new Date().toISOString();
  const outputs: unknown[] = [];
  try {
    const policy = browserConnectorPolicySchema.parse(rawPolicy);
    if (request.urls.length === 0 || request.urls.length > policy.maxPages) {
      throw new Error(`Browser request must contain 1..${policy.maxPages} URLs.`);
    }
    request.urls.forEach((url) => assertBrowserUrlAllowed(url, policy));
    if (adapter.networkProjectId !== undefined && adapter.networkProjectId !== policy.projectId) {
      throw new Error("Browser adapter network authority does not match active Project policy.");
    }
    if (request.interaction && (request.urls.length !== 1 || request.interaction.kind !== "click" ||
        typeof request.interaction.selector !== "string" || !request.interaction.selector.trim() ||
        request.interaction.selector.length > 1_000 || !adapter.interact)) {
      throw new Error("A reviewed browser click requires one URL, one bounded exact selector and an isolated interaction adapter.");
    }
    const pages: Array<{ requestedUrl: string; resolvedUrl: string; output: unknown }> = [];
    for (const url of request.urls) {
      const navigatedUrl = await adapter.navigate(url, policy.navigationTimeoutMs);
      let resolvedUrl = typeof navigatedUrl === "string" && navigatedUrl.trim() ? navigatedUrl : url;
      // Navigation transports can observe redirects. Re-check the final page
      // identity through the same Project authority before accepting extraction.
      assertBrowserUrlAllowed(resolvedUrl, policy);
      if (request.interaction) {
        resolvedUrl = await adapter.interact!(request.interaction);
        // Actions can change navigation after initial admission; validate before accepting any page evidence.
        assertBrowserUrlAllowed(resolvedUrl, policy);
      }
      const output = sanitizeLedgerPayload(await adapter.extract(request.extraction));
      outputs.push(output);
      pages.push({ requestedUrl: url, resolvedUrl, output });
    }
    let download: { path: string; bytes: number } | null = null;
    if (request.download) {
      if (!policy.allowDownloads || !adapter.download) throw new Error("Browser download is not permitted by Project policy.");
      assertBrowserUrlAllowed(request.download.url, policy);
      // Every adapter receives only the sanitized basename (browser-use
      // download watchdog adaptation); no caller can feed a path traversal.
      const filename = sanitizeBrowserDownloadFilename(request.download.filename);
      download = await adapter.download(request.download.url, filename, policy.downloadMaxBytes, policy.filesystemWriteRoots);
      if (!Number.isSafeInteger(download.bytes) || download.bytes < 0 || download.bytes > policy.downloadMaxBytes) {
        throw new Error("Browser download exceeded Project byte limit or returned invalid byte accounting.");
      }
      assertBrowserDownloadInsideRoots(download.path, policy.filesystemWriteRoots);
    }
    return {
      id: crypto.randomUUID(),
      adapterId: adapter.id,
      projectId: policy.projectId,
      outputs,
      pages,
      download,
      startedAt,
      completedAt: new Date().toISOString(),
      inputHash: hashLedgerValue({ urls: request.urls, extraction: request.extraction, ...(request.interaction ? { interaction: request.interaction } : {}), downloadRequested: Boolean(request.download) }),
      outputHash: hashLedgerValue({ pages, download: download ? { bytes: download.bytes, filename: request.download?.filename } : null }),
    };
  } finally {
    await adapter.close();
  }
}

export function unavailableBrowserAdapter(): BrowserAutomationAdapter {
  const unavailable = async () => { throw new Error("No approved browser automation runtime is installed. Add an optional Playwright-compatible adapter/runtime pack."); };
  return { id: "unavailable", navigate: unavailable, extract: unavailable, close: async () => {} };
}
