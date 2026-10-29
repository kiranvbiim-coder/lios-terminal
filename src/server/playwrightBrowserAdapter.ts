import fs from "node:fs";
import path from "node:path";
import { sanitizeBrowserDownloadFilename, assertBrowserDownloadInsideRoots } from "./browserDownloadSafety";
import type {
  BrowserAutomationAdapter,
  BrowserProjectNetworkAuthority,
} from "./browserConnectorRuntime";
import type { ExecutionBackend, ExecutionBackendLaunchPlan } from "./exec/backends/types";
import {
  BrowserRuntimeIsolationUnavailableError,
  assertBrowserRuntimeIsolationBackend,
  prepareBrowserRuntimeIsolationBackend,
} from "./exec/browser-isolation";
import { sandboxIsolationMode } from "./exec/sandbox-runtime-profile";

export const PLAYWRIGHT_BROWSER_ADAPTER_ID = "lios.playwright.optional";

type DynamicImporter = (specifier: string) => Promise<any>;
const dynamicImport: DynamicImporter = new Function("specifier", "return import(specifier)") as DynamicImporter;

async function bindAdapterToNetworkProject(
  adapter: BrowserAutomationAdapter,
  projectId: BrowserProjectNetworkAuthority["projectId"],
): Promise<BrowserAutomationAdapter> {
  if (adapter.networkProjectId !== undefined && adapter.networkProjectId !== projectId) {
    try {
      await adapter.close();
    } catch {
      throw new BrowserRuntimeIsolationUnavailableError(
        "Conflicting isolated browser adapter could not be closed safely.",
      );
    }
    throw new BrowserRuntimeIsolationUnavailableError(
      "Isolated browser transport returned an adapter bound to a different Project network authority.",
    );
  }
  const bound: BrowserAutomationAdapter = {
    id: adapter.id,
    networkProjectId: projectId,
    navigate: (url, timeoutMs) => adapter.navigate(url, timeoutMs),
    extract: (input) => adapter.extract(input),
    close: () => adapter.close(),
  };
  if (adapter.interact) bound.interact = input => adapter.interact!(input);
  if (adapter.download) {
    bound.download = (url, filename, maxBytes, allowedRoots) =>
      adapter.download!(url, filename, maxBytes, allowedRoots);
  }
  return bound;
}

/**
 * Approved Browser Runtime Pack transport for the canonical isolated path.
 *
 * `worker` identifies only the fixed browser worker entrypoint. `open()` must
 * execute the exact prepared backend plan through the canonical GM-10/GM-11
 * execution path and route every browser network request through the supplied
 * Project-scoped network authority. There is intentionally no default host
 * implementation and no raw-network fallback.
 */
export interface IsolatedPlaywrightBackendTransport {
  worker: {
    argv: readonly string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  };
  open(
    plan: ExecutionBackendLaunchPlan,
    networkAuthority: BrowserProjectNetworkAuthority,
  ): Promise<BrowserAutomationAdapter>;
}

export interface PlaywrightBrowserAdapterOptions {
  /**
   * Legacy host mode preserves today's optional local adapter behavior.
   * SI-01/SP-01 strict flows must request canonical-isolated instead.
   */
  isolationMode?: "host-policy-only" | "canonical-isolated";
  backend?: ExecutionBackend;
  /** Registry/scope-owned cancellation from SI-02 L7. */
  signal?: AbortSignal;
  /** Project BrowserConnectorPolicy authority required by strict brokered egress. */
  networkAuthority?: BrowserProjectNetworkAuthority;
  /** Required for canonical-isolated mode; host Playwright is never substituted. */
  isolatedTransport?: IsolatedPlaywrightBackendTransport;
}

export async function createPlaywrightBrowserAdapter(
  options: PlaywrightBrowserAdapterOptions = {},
): Promise<BrowserAutomationAdapter> {
  const isolationMode = sandboxIsolationMode() === "strict"
    ? "canonical-isolated"
    : (options.isolationMode ?? "host-policy-only");
  if (isolationMode === "canonical-isolated") {
    const backend = assertBrowserRuntimeIsolationBackend(options.backend);
    const networkAuthority = options.networkAuthority;
    if (!networkAuthority) {
      throw new BrowserRuntimeIsolationUnavailableError(
        "Project-scoped browser network authority is not configured; raw browser egress is refused.",
      );
    }
    const transport = options.isolatedTransport;
    if (!transport) {
      throw new BrowserRuntimeIsolationUnavailableError(
        "Canonical isolated Playwright backend transport is not configured; host Chromium launch is refused.",
      );
    }
    const plan = await prepareBrowserRuntimeIsolationBackend(backend, {
      argv: transport.worker.argv,
      cwd: transport.worker.cwd,
      env: transport.worker.env,
      signal: options.signal,
    });
    const adapter = await transport.open(plan, networkAuthority);
    return await bindAdapterToNetworkProject(adapter, networkAuthority.projectId);
  }

  let playwright: any;
  try {
    playwright = await dynamicImport("playwright");
  } catch {
    throw new Error("Optional Playwright browser runtime is not installed. Install/enable the approved Browser Runtime Pack.");
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: false });
  const page = await context.newPage();

  return {
    id: PLAYWRIGHT_BROWSER_ADAPTER_ID,
    async navigate(url, timeoutMs) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      return page.url();
    },
    async extract(input) {
      const selector = input.selector?.trim() || null;
      if (input.kind === "snapshot") {
        throw new BrowserRuntimeIsolationUnavailableError("Accessible page snapshots require the approved isolated Browser Runtime Pack.");
      }
      if (input.kind === "text") {
        return selector
          ? await page.locator(selector).allTextContents()
          : await page.locator("body").innerText();
      }
      if (input.kind === "links") {
        const target = selector || "a";
        return page.locator(target).evaluateAll((elements: any[]) =>
          elements.slice(0, 5_000).map((element) => ({
            text: String(element.textContent ?? "").trim(),
            href: typeof element.href === "string" ? element.href : element.getAttribute?.("href") ?? null,
          })),
        );
      }
      const raw = selector
        ? await page.locator(selector).innerText()
        : await page.locator("body").innerText();
      try { return JSON.parse(raw); }
      catch { throw new Error("Browser JSON extraction expected valid JSON text."); }
    },
    async download(url, filename, maxBytes, allowedRoots) {
      if (!allowedRoots.length) throw new Error("Browser downloads require at least one Project-approved filesystem root.");
      const root = path.resolve(allowedRoots[0]);
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      // A symlinked root is not a trustworthy Project filesystem authority.
      // macOS /tmp and /var often have symlinked ancestors by design; deny
      // an alias at the Project root itself, not legitimate OS ancestry.
      if (fs.lstatSync(root).isSymbolicLink()) throw new Error("Browser download root must not itself be a symlink.");
      const target = path.resolve(root, sanitizeBrowserDownloadFilename(filename));
      assertBrowserDownloadInsideRoots(target, [root]);
      const response = await context.request.get(url, { timeout: 30_000, failOnStatusCode: true });
      const body: Buffer = await response.body();
      if (body.byteLength > maxBytes) throw new Error("Browser download exceeded Project byte limit.");
      // Exclusive creation prevents an existing symlink or file from becoming
      // an arbitrary overwrite primitive (the donor's watchdog regression).
      fs.writeFileSync(target, body, { mode: 0o600, flag: "wx" });
      return { path: target, bytes: body.byteLength };
    },
    async close() {
      await context.close();
      await browser.close();
    },
  };
}
