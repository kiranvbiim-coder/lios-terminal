/**
 * SP-02 packaged Agentic Alpha journey.
 *
 * Drives the real packaged Electron renderer over CDP and observes the real Gateway plus the
 * authenticated encrypted-journal API. It installs no model, tool, approval, journal, browser,
 * failure fixture, or execution backend. Missing production seams stay RED.
 *
 * Reuses the LiOS SP-01 packaged harness's CDP attach, first-run, scratch-root, launch,
 * strict-sandbox, and shutdown mechanisms. SP-02 adds Gateway frame capture and run-bound
 * durable ledger assertions rather than creating a second packaged-app driver.
 *
 * Usage: npm run acceptance:sp02-packaged [-- --evidence <path>]
 * Env:
 *   LIOS_SP02_APP          packaged app binary (defaults to the macOS arm64 app)
 *   LIOS_SP02_DOCKER_SOCK local Docker/Colima socket used by the strict sandbox
 */
import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { GATEWAY_EVENTS, gatewayEventFrameSchema } from "../shared/gatewayProtocol";
import type { ConversationRuntimeEvent } from "../shared/conversationRuntime";
import {
  buildSp02Request,
  hasBoundedPlanEvidence,
  hasCompleteSp02CheckSet,
  hasPersistedReceiptEvidence,
  inspectApprovalLedger,
  requireImmutableSandboxImage,
  inspectRecoveryLedger,
  type Sp02PackagedCheck,
  type Sp02PackagedCheckId,
  type Sp02PackagedEvidence,
} from "./sp02_packaged_contract";
import { inspectResumeReapproval } from "./sp02_resume_reapproval_contract";
import { signS3Request, S3StorageProvider } from "../server/s3StorageProvider";

const root = process.cwd();
const APP = process.env.LIOS_SP02_APP
  ?? path.join(root, "dist-app/mac-arm64/LiOS Intelligence Terminal.app/Contents/MacOS/LiOS Intelligence Terminal");
const DOCKER_SOCK = process.env.LIOS_SP02_DOCKER_SOCK ?? path.join(os.homedir(), ".colima/default/docker.sock");
const AI_PROVIDER = process.env.LIOS_SP02_AI_PROVIDER?.trim() || "ollama";
const AI_MODEL = process.env.LIOS_SP02_AI_MODEL?.trim() || process.env.OLLAMA_MODEL?.trim() || "llama3.2:3b";
const PUBLICATION_CONTAINER = process.env.LIOS_SP02_PUBLICATION_CONTAINER?.trim();
const OWNER = { name: "SP02 Journey", email: "sp02-journey@example.com", password: "Quartz-Harbor!7391" };
const PROJECT = "SP02 Agentic Alpha";
const RUN_MARKER = randomUUID();
const REQUEST = buildSp02Request(RUN_MARKER);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const checks: Sp02PackagedCheck[] = [];
function record(id: Sp02PackagedCheckId, pass: boolean, detail: string): void {
  checks.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`);
  if (!pass) throw new Error(`SP-02 check failed: ${id} - ${detail}`);
}

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

async function waitFor<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  description: string,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  for (;;) {
    last = await read();
    if (accept(last)) return last;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}.`);
    await sleep(400);
  }
}

function freePort(): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address() as net.AddressInfo;
    server.close(() => resolve(address.port));
  });
  return promise;
}

interface CdpCommandResult {
  result?: { value?: unknown };
  exceptionDetails?: { exception?: { description?: string } };
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  error?: { message: string };
  result?: unknown;
}

interface CapturedConversationEvent {
  requestId: string;
  runSeq: number;
  event: ConversationRuntimeEvent;
}

interface ApiEnvelope<T> {
  ok: boolean;
  status: number;
  body: T;
}

function summarizeGatewayEvents(events: readonly CapturedConversationEvent[], requestId: string): string[] {
  return events.filter((entry) => entry.requestId === requestId).map((entry) => {
    const event = entry.event as { type: string; summary?: unknown; message?: unknown; reason?: unknown; code?: unknown; status?: unknown; state?: unknown; field?: unknown };
    return [event.type, event.status, event.state, event.code, event.field, typeof event.reason === "string" ? event.reason.slice(0, 160) : "", typeof event.message === "string" ? event.message.slice(0, 200) : "", typeof event.summary === "string" ? event.summary.slice(0, 300) : ""].filter(Boolean).join(":");
  });
}

class Page {
  private seq = 0;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private readonly conversationEvents: CapturedConversationEvent[] = [];
  gatewaySummary(requestId: string): string[] { return summarizeGatewayEvents(this.conversationEvents, requestId); }

  private constructor(private readonly ws: WebSocket) {
    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as CdpMessage;
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
        return;
      }
      if (message.method !== "Network.webSocketFrameReceived") return;
      const params = message.params as { response?: { payloadData?: unknown } } | undefined;
      const payloadData = params?.response?.payloadData;
      if (typeof payloadData !== "string") return;
      try {
        const frame = gatewayEventFrameSchema.safeParse(JSON.parse(payloadData));
        if (!frame.success || frame.data.type !== "event" || frame.data.event !== "conversation.event") return;
        const payload = GATEWAY_EVENTS["conversation.event"].safeParse(frame.data.payload);
        if (!payload.success) return;
        this.conversationEvents.push(payload.data);
      } catch {
        // Non-JSON WebSocket traffic is unrelated to the LiOS Gateway protocol.
      }
    });
  }

  static async attach(port: number, timeoutMs = 120_000): Promise<Page> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    let lastTargets: string[] = [];
    for (;;) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
        lastTargets = targets.map(candidate => `${candidate.type}:${candidate.url}`);
        const target = targets.find((candidate) => candidate.type === "page" && /^http:\/\/localhost:\d+\//.test(candidate.url));
        if (target) {
          const ws = new WebSocket(target.webSocketDebuggerUrl);
          const { promise, resolve, reject } = Promise.withResolvers<void>();
          ws.once("open", () => resolve());
          ws.once("error", reject);
          await promise;
          const page = new Page(ws);
          await page.command("Network.enable", {});
          return page;
        }
      } catch (error) {
        lastError = error;
      }
      if (Date.now() > deadline) throw new Error(`Packaged renderer did not appear over CDP. Last targets=${JSON.stringify(lastTargets)}; last error=${lastError instanceof Error ? lastError.message : String(lastError)}`);
      await sleep(500);
    }
  }

  private command<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = ++this.seq;
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    this.pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  async eval<T>(expression: string): Promise<T> {
    const response = await this.command<CdpCommandResult>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? "evaluate failed");
    }
    return response.result?.value as T;
  }

  async fetchJson<T>(url: string): Promise<T> {
    const response = await this.eval<ApiEnvelope<T>>(`(async () => {
      const response = await fetch(${JSON.stringify(url)}, { cache: "no-store" });
      let body = null;
      try { body = await response.json(); } catch {}
      return { ok: response.ok, status: response.status, body };
    })()`);
    if (!response.ok) throw new Error(`Authenticated API ${url} returned ${response.status}.`);
    return response.body;
  }

  async requestJson<T>(url: string, method: "POST" | "PUT", body: Record<string, unknown>): Promise<T> {
    const response = await this.eval<ApiEnvelope<T>>(`(async () => {
      const response = await fetch(${JSON.stringify(url)}, {
        method: ${JSON.stringify(method)}, headers: { 'content-type': 'application/json' },
        body: ${JSON.stringify(JSON.stringify(body))},
      });
      return { ok: response.ok, status: response.status, body: await response.json() };
    })()`);
    if (!response.ok) {
      const detail = response.body as { error?: { code?: unknown } } | null;
      const code = typeof detail?.error?.code === "string" ? ` (${detail.error.code})` : "";
      throw new Error(`Authenticated API ${method} ${url} returned ${response.status}${code}.`);
    }
    return response.body;
  }

  async clickReview(requestId: string, reviewId: string): Promise<void> {
    await waitFor(
      () => this.eval<boolean>(`(() => {
        const button = [...document.querySelectorAll('[data-testid="governed-tool-allow-once"]')]
          .find((element) => element.getAttribute('data-request-id') === ${JSON.stringify(requestId)}
            && element.getAttribute('data-review-id') === ${JSON.stringify(reviewId)});
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
      })()`),
      Boolean,
      "the exact request-bound Allow-once review",
    );
  }

  async screenshot(file: string): Promise<void> {
    const captured = await this.command<{ data: string }>("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(file, Buffer.from(captured.data, "base64"));
  }

  testIdExists(testId: string): Promise<boolean> {
    return this.eval<boolean>(`document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']') !== null`)
      .catch(() => false);
  }

  testIdText(testId: string): Promise<string> {
    return this.eval<string>(`(() => {
      const selector = '[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']';
      return document.querySelector(selector)?.textContent ?? '';
    })()`).catch(() => "");
  }

  async waitTestId(testId: string, timeoutMs = 60_000): Promise<void> {
    await waitFor(
      () => this.testIdExists(testId),
      (exists) => exists,
      `[data-testid="${testId}"]`,
      timeoutMs,
    );
  }

  testIdForRequestExists(testId: string, requestId: string): Promise<boolean> {
    return this.eval<boolean>(`(() => {
      const selector = '[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']';
      return [...document.querySelectorAll(selector)].some((element) => element.getAttribute('data-request-id') === ${JSON.stringify(requestId)});
    })()`).catch(() => false);
  }

  async clickTestIdForRequest(testId: string, requestId: string): Promise<boolean> {
    return this.eval<boolean>(`(() => {
      const selector = '[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']';
      const element = [...document.querySelectorAll(selector)].find((candidate) => candidate.getAttribute('data-request-id') === ${JSON.stringify(requestId)});
      if (!(element instanceof HTMLElement) || element.hasAttribute('disabled')) return false;
      element.click();
      return true;
    })()`);
  }

  async clickButton(label: string, options: { exact?: boolean; timeoutMs?: number } = {}): Promise<void> {
    const deadline = Date.now() + (options.timeoutMs ?? 30_000);
    const script = `(() => {
      const label = ${JSON.stringify(label)};
      const exact = ${options.exact !== false};
      const elements = [...document.querySelectorAll('button,[role=button]')].filter((element) => {
        const text = (element.getAttribute('aria-label') || element.textContent || '').replace(/\\s+/g, ' ').trim();
        return exact ? text.toLowerCase() === label.toLowerCase() : text.toLowerCase().includes(label.toLowerCase());
      });
      const element = elements.find((candidate) => !candidate.hasAttribute('disabled'));
      if (!(element instanceof HTMLElement)) return false;
      element.click();
      return true;
    })()`;
    for (;;) {
      if (await this.eval<boolean>(script)) return;
      if (Date.now() > deadline) throw new Error(`Control not found: ${label}`);
      await sleep(300);
    }
  }

  async clickWithinTestId(testId: string, label: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const script = `(() => {
      const selector = '[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']';
      const root = document.querySelector(selector);
      if (!root) return false;
      const label = ${JSON.stringify(label)};
      const element = [...root.querySelectorAll('button,[role=button]')].find((candidate) => {
        const text = (candidate.getAttribute('aria-label') || candidate.textContent || '').replace(/\\s+/g, ' ').trim();
        return text.toLowerCase() === label.toLowerCase() && !candidate.hasAttribute('disabled');
      });
      if (!(element instanceof HTMLElement)) return false;
      element.click();
      return true;
    })()`;
    for (;;) {
      if (await this.eval<boolean>(script)) return;
      if (Date.now() > deadline) throw new Error(`Control ${label} not found inside [data-testid="${testId}"].`);
      await sleep(300);
    }
  }

  async fill(name: string, value: string, timeoutMs = 15_000): Promise<void> {
    const script = `(() => {
      const name = ${JSON.stringify(name)};
      const element = [...document.querySelectorAll('input,textarea')].find((candidate) => candidate.placeholder === name
        || candidate.getAttribute('aria-label') === name
        || [...(candidate.labels ?? [])].some((label) => label.textContent.replace(/\\s+/g, ' ').trim() === name));
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (!setter) return false;
      setter.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`;
    const deadline = Date.now() + timeoutMs;
    while (!(await this.eval<boolean>(script))) {
      if (Date.now() > deadline) throw new Error(`Input not found: ${name}`);
      await sleep(300);
    }
  }

  async submitConversation(text: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const script = `(() => {
      const candidate = [...document.querySelectorAll('textarea,[contenteditable="true"]')]
        .find((element) => !element.closest('[aria-hidden="true"]') && !element.hasAttribute('disabled'));
      if (!candidate) return false;
      if (candidate instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (!setter) return false;
        setter.call(candidate, ${JSON.stringify(text)});
        candidate.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (candidate instanceof HTMLElement) {
        candidate.textContent = ${JSON.stringify(text)};
        candidate.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
      } else return false;
      const form = candidate.closest('form');
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
        return true;
      }
      const send = [...document.querySelectorAll('button,[role=button]')].find((element) => {
        const label = (element.getAttribute('aria-label') || element.textContent || '').trim();
        return /^(send|submit|run)$/i.test(label) && !element.hasAttribute('disabled');
      });
      if (!(send instanceof HTMLElement)) return false;
      send.click();
      return true;
    })()`;
    for (;;) {
      if (await this.eval<boolean>(script)) return;
      if (Date.now() > deadline) throw new Error("Conversation composer/send control not found.");
      await sleep(300);
    }
  }

  async waitConversationEvent(
    requestId: string,
    accept: (event: CapturedConversationEvent) => boolean,
    description: string,
    timeoutMs = 120_000,
  ): Promise<CapturedConversationEvent> {
    return waitFor(
      async () => this.conversationEvents.find((entry) => entry.requestId === requestId && accept(entry)) ?? null,
      (entry): entry is CapturedConversationEvent => entry !== null,
      description,
      timeoutMs,
    );
  }

  persistedReceipt(requestId: string): Promise<unknown[]> {
    return this.eval<unknown[]>(`(() => {
      const prefix = 'lios.runtime-receipt.v1.';
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || !key.startsWith(prefix) || key === prefix + 'index') continue;
        try {
          const events = JSON.parse(localStorage.getItem(key) ?? '[]');
          if (Array.isArray(events) && events.some((event) => event?.requestId === ${JSON.stringify(requestId)})) return events;
        } catch {}
      }
      return [];
    })()`).catch(() => []);
  }

  close(): void {
    this.ws.close();
  }
}

interface AuthUser {
  email?: string;
}

interface ProjectRow {
  id: number;
  name: string;
}

interface ProjectChatRow {
  id: number;
  projectId: number | null;
}

interface ProjectMessageRow {
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
}

interface JournalRecord {
  version: number;
  id: string;
  owner: { userId: number; projectId: number | null; chatId: number | null };
  status: "running" | "waiting_approval" | "completed" | "cancelled" | "failed" | "interrupted" | "denied";
  startedAt: string;
  endedAt: string | null;
  events?: unknown[];
  checkpoint?: unknown;
}

let sandboxImage = "";

async function launch(port: number, dirs: { data: string; user: string }): Promise<ChildProcess> {
  return spawn(APP, [`--user-data-dir=${dirs.user}`, `--remote-debugging-port=${port}`], {
    stdio: ["ignore", fs.openSync(path.join(os.tmpdir(), "lios-sp02-app.log"), "w"), fs.openSync(path.join(os.tmpdir(), "lios-sp02-app.log"), "a")],
    env: {
      ...process.env,
      LIMURIA_DATA_DIR: dirs.data,
      LIOS_EXECUTION_ISOLATION: "strict",
      LIOS_EXECUTION_SANDBOX_ENGINE: "docker",
      LIOS_EXECUTION_SANDBOX_TARGET: `unix://${DOCKER_SOCK}`,
      LIOS_EXECUTION_SANDBOX_IMAGE: sandboxImage,
    },
  });
}

async function quit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    resolve();
  }, 20_000);
  child.once("exit", () => {
    clearTimeout(timer);
    resolve();
  });
  await promise;
}

function sandboxContainers(): string[] {
  const result = spawnSync(
    "docker",
    [`--host=unix://${DOCKER_SOCK}`, "ps", "-a", "--filter", "name=lios-exec", "--format", "{{.Names}}"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`docker ps failed: ${result.stderr}`);
  return result.stdout.split("\n").filter(Boolean);
}

async function bootstrapProjectChat(page: Page): Promise<{ projectId: number; chatId: number }> {
  await page.clickButton("SIGN IN");
  await page.fill("Full name", OWNER.name);
  await page.fill("name@company.com", OWNER.email);
  await page.fill("12+ characters", OWNER.password);
  await page.fill("Repeat password", OWNER.password);
  await page.clickButton("CREATE ADMINISTRATOR");

  const signedIn = await waitFor(
    () => page.fetchJson<AuthUser>("/api/auth/me").catch(() => ({})),
    (user) => user.email === OWNER.email,
    "the authenticated owner API identity",
    60_000,
  );
  record("sp02.signin", signedIn.email === OWNER.email, "authenticated /api/auth/me identity matches the created owner");

  await page.clickButton("Create a Project");
  await page.fill("Project name", PROJECT);
  await page.clickButton("Create Project");
  const projects = await waitFor(
    () => page.fetchJson<ProjectRow[]>("/api/projects"),
    (rows) => rows.filter((row) => row.name === PROJECT).length === 1,
    "the exact Project API record",
  );
  const project = projects.find((row) => row.name === PROJECT)!;
  await page.clickButton("+ New chat", { exact: false });
  const chats = await waitFor(
    () => page.fetchJson<ProjectChatRow[]>(`/api/projects/${project.id}/chats`),
    (rows) => rows.filter((row) => row.projectId === project.id).length === 1,
    "the exact Project Chat API record",
  );
  const chat = chats.find((row) => row.projectId === project.id)!;
  record("sp02.project_chat", true, `Project ${project.id} and Project Chat ${chat.id} exist in authenticated API state`);
  return { projectId: project.id, chatId: chat.id };
}

async function configureRealAI(page: Page): Promise<void> {
  const verified = await page.requestJson<{ ok: boolean; provider: string; model: string }>("/api/setup/ai/test", "POST", {
    provider: AI_PROVIDER, model: AI_MODEL,
  });
  if (!verified.ok || verified.provider !== AI_PROVIDER || verified.model !== AI_MODEL) {
    throw new Error("The selected real AI provider/model was not live-verified.");
  }
  await page.requestJson("/api/setup/status", "PUT", { aiProviderId: AI_PROVIDER, aiModelId: AI_MODEL, complete: true });
  await page.requestJson("/api/wave-c/ai/state", "PUT", { state: "on", mode: "ai_assist" });
  await page.eval("location.reload();");
  await page.waitTestId("composer-agent-toggle");
  const selected = await waitFor(
    () => page.eval<boolean>(`(() => {
      const button = document.querySelector('[data-testid="composer-agent-toggle"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      if (button.getAttribute('aria-pressed') !== 'true') button.click();
      return true;
    })()`),
    Boolean,
    "the accessible bounded-agent composer control with real AI configured",
  );
  if (!selected) throw new Error("The bounded-agent composer opt-in could not be selected.");
}

function changePublicationAvailability(command: "stop" | "start"): void {
  if (!PUBLICATION_CONTAINER || !/^lios-si02-publication-[0-9]+$/.test(PUBLICATION_CONTAINER)) {
    throw new Error("LIOS_SP02_PUBLICATION_CONTAINER must identify the dedicated real lios-si02-publication-<date> service.");
  }
  const result = spawnSync("docker", [`--host=unix://${DOCKER_SOCK}`, command, PUBLICATION_CONTAINER], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`The dedicated real publication service could not ${command}.`);
}

async function executionRecord(page: Page, chatId: number, requestId: string): Promise<JournalRecord> {
  const record = await page.fetchJson<JournalRecord>(`/api/project-chats/${chatId}/executions/${requestId}`);
  if (record.id !== requestId || record.owner.chatId !== chatId) {
    throw new Error("Execution journal returned a different run or chat identity.");
  }
  return record;
}

function waitingCall(record: JournalRecord): { toolCallId: string; toolId: string } | null {
  const events = (record.events ?? []).filter((event): event is Record<string, unknown> => event !== null && typeof event === "object");
  const waiting = [...events].reverse().find((event) => event.kind === "tool_call_waiting_approval");
  if (!waiting || typeof waiting.toolCallId !== "string") return null;
  const started = events.find((event) => event.kind === "tool_call_started" && event.toolCallId === waiting.toolCallId);
  return typeof started?.toolId === "string" ? { toolCallId: waiting.toolCallId, toolId: started.toolId } : null;
}

function callEvents(record: JournalRecord, toolCallId: string): unknown[] {
  return (record.events ?? []).filter((event) => event !== null && typeof event === "object"
    && "toolCallId" in event && event.toolCallId === toolCallId);
}

function publicationConfiguration() {
  const endpoint = process.env.LIOS_PUBLICATION_S3_ENDPOINT;
  const bucket = process.env.LIOS_PUBLICATION_S3_BUCKET;
  const accessKeyId = process.env.LIOS_PUBLICATION_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.LIOS_PUBLICATION_S3_SECRET_ACCESS_KEY;
  const region = process.env.LIOS_PUBLICATION_S3_REGION;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !region) {
    throw new Error("The packaged journey requires its real authenticated external publication target.");
  }
  return { endpoint, bucket, accessKeyId, secretAccessKey, region };
}

async function publicationKeys(): Promise<string[]> {
  const config = publicationConfiguration();
  const endpoint = new URL(config.endpoint);
  const canonicalPath = `${endpoint.pathname.replace(/\/+$/, "")}/${encodeURIComponent(config.bucket)}`;
  const signed = signS3Request({
    ...config, method: "GET", host: endpoint.host, canonicalPath,
    payloadSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    now: new Date(),
  });
  const { host: _host, ...headers } = signed.headers;
  const response = await fetch(`${endpoint.origin}${canonicalPath}`, { headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`The real external object inventory could not be read (${response.status}).`);
  const xml = await response.text();
  if (Buffer.byteLength(xml) > 2 * 1024 * 1024 || !/<IsTruncated>false<\/IsTruncated>/.test(xml)) {
    throw new Error("External object inventory is not complete within its qualification bound.");
  }
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1]!);
}

async function executionIds(page: Page, chatId: number): Promise<string[]> {
  const records = await page.fetchJson<JournalRecord[]>(`/api/project-chats/${chatId}/executions`);
  return records.map((record) => record.id).sort();
}

async function requestIdForSubmittedMessage(page: Page, chatId: number): Promise<string> {
  const messages = await waitFor(
    () => page.fetchJson<ProjectMessageRow[]>(`/api/project-chats/${chatId}/messages`),
    (rows) => rows.some((row) => row.role === "user" && row.content === REQUEST
      && typeof row.metadata?.runtimeRequestId === "string" && UUID.test(row.metadata.runtimeRequestId)),
    "the submitted message's server-owned runtimeRequestId",
    60_000,
  );
  const message = [...messages].reverse().find((row) => row.role === "user" && row.content === REQUEST)!;
  return String(message.metadata?.runtimeRequestId);
}

async function main(): Promise<void> {
  const evidenceArg = process.argv.indexOf("--evidence");
  const evidencePath = evidenceArg >= 0 && process.argv[evidenceArg + 1]
    ? path.resolve(process.argv[evidenceArg + 1]!)
    : path.join(os.tmpdir(), "lios-sp02-packaged-evidence.json");
  let requestId: string | null = null;
  let projectId: number | null = null;
  let chatId: number | null = null;
  let scratch: string | null = null;
  let app: ChildProcess | null = null;
  let page: Page | null = null;
  let failure: unknown = null;
  let publicationStopped = false;
  const screenshots: string[] = [];
  const screenshotDir = evidencePath.replace(/\.json$/, "") + "-screens";
  fs.mkdirSync(screenshotDir, { recursive: true });
  const snapshot = async (name: string) => {
    if (!page) return;
    const file = path.join(screenshotDir, name + ".png");
    await page.screenshot(file);
    screenshots.push(file);
  };

  try {
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      throw new Error("SP-02 packaged journey is initially qualified for macOS arm64 only.");
    }
    if (!fs.existsSync(APP)) throw new Error(`Packaged app not found: ${APP}. Run npm run app:pack first.`);
    if (!fs.existsSync(DOCKER_SOCK)) throw new Error(`Local Docker/Colima socket not found: ${DOCKER_SOCK}`);
    sandboxImage = requireImmutableSandboxImage(process.env.LIOS_SP02_SANDBOX_IMAGE);
    const packagedManifestPath = path.join(path.dirname(APP), "..", "Resources", "sandbox-image-dist", "sandbox-image.json");
    const packagedManifest: { image?: unknown } = JSON.parse(fs.readFileSync(packagedManifestPath, "utf8"));
    if (packagedManifest.image !== sandboxImage) throw new Error(`Selected sandbox differs from the actual packaged immutable image ${String(packagedManifest.image)}; use the package's manifest identity.`);
    const inspected = spawnSync("docker", [`--host=unix://${DOCKER_SOCK}`, "image", "inspect", "--format", "{{.Id}}", sandboxImage], { encoding: "utf8" });
    if (inspected.status !== 0) throw new Error(`Sandbox image ${sandboxImage} is not available in the local engine; load it before the journey.`);
    const imageId = inspected.stdout.trim();
    if (/^sha256:[a-f0-9]{64}$/i.test(sandboxImage) && imageId.toLowerCase() !== sandboxImage.toLowerCase()) {
      throw new Error("Local sandbox image id does not match LIOS_SP02_SANDBOX_IMAGE.");
    }
    if (sandboxContainers().length > 0) {
      throw new Error("Stale lios-exec containers exist before the SP-02 journey; remove them first.");
    }

    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lios-sp02-"));
    const dirs = { data: path.join(scratch, "data"), user: path.join(scratch, "ud") };
    fs.mkdirSync(dirs.data, { recursive: true });

    let port = await freePort();
    app = await launch(port, dirs);
    page = await Page.attach(port);
    const scope = await bootstrapProjectChat(page);
    projectId = scope.projectId;
    chatId = scope.chatId;
    const baselineIds = await executionIds(page, chatId);
    const baselineObjectKeys = await publicationKeys();
    await configureRealAI(page);

    await page.submitConversation(REQUEST);
    requestId = await requestIdForSubmittedMessage(page, chatId);
    const afterStartIds = await waitFor(
      () => executionIds(page!, chatId!),
      (ids) => ids.length === baselineIds.length + 1 && ids.includes(requestId!),
      "one new exact execution journal record",
    );

    const planFrame = await page.waitConversationEvent(
      requestId,
      (entry) => entry.event.type === "plan",
      "the exact run's structured Gateway plan event",
      300_000,
    ).catch(async (error: unknown) => {
      const diagnostic = await executionRecord(page!, chatId!, requestId!).catch(() => null);
      const summary = (diagnostic?.events ?? []).map((event) => {
        const item = event as { type?: unknown; kind?: unknown; state?: unknown; message?: unknown };
        return [item.type, item.kind, item.state, typeof item.message === "string" ? item.message.slice(0, 160) : ""].filter(Boolean).join(":");
      });
      const visible = await page!.eval<string>(`Array.from(document.querySelectorAll('[role="alert"],[data-testid*="error"],[data-testid*="notice"]')).map((node) => node.textContent || '').join(' | ').slice(0, 600)`).catch(() => "");
      throw new Error(`${error instanceof Error ? error.message : "plan wait failed"} Journal status=${diagnostic?.status ?? "unavailable"} events=${JSON.stringify(summary)} visible=${JSON.stringify(visible)}`);
    });
    record(
      "sp02.bounded_plan",
      hasBoundedPlanEvidence(planFrame.event, requestId),
      "structured plan event is bound to the requestId, has multiple steps, and carries bounded step/duration/AI budgets",
    );

    let approvalFrame: CapturedConversationEvent | null = null;
    let waitingRecord: JournalRecord | null = null;
    let publicationCallId: string | null = null;
    let afterSeq = planFrame.runSeq;
    for (let review = 0; review < 6; review += 1) {
      const frame = await page.waitConversationEvent(
        requestId,
        (entry) => entry.runSeq > afterSeq && entry.event.type === "governed_tool_approval_required",
        "the exact run's next consequential-tool review",
      ).catch(async (error: unknown) => {
        const diagnostic = await executionRecord(page!, chatId!, requestId!).catch(() => null);
        const summary = (diagnostic?.events ?? []).map((event) => {
          const item = event as { type?: unknown; kind?: unknown; state?: unknown; stepId?: unknown; toolId?: unknown; status?: unknown; message?: unknown };
          return [item.type, item.kind, item.state, item.status, item.stepId, item.toolId, typeof item.message === "string" ? item.message.slice(0, 140) : ""].filter(Boolean).join(":");
        });
        throw new Error(`${error instanceof Error ? error.message : "approval wait failed"} Journal status=${diagnostic?.status ?? "unavailable"} events=${JSON.stringify(summary)} gateway=${JSON.stringify(page!.gatewaySummary(requestId!).slice(-12))}`);
      });
      if (frame.event.type !== "governed_tool_approval_required") throw new Error("Unexpected approval event type.");
      const pending = await waitFor(
        () => executionRecord(page!, chatId!, requestId!),
        (candidate) => candidate.status === "waiting_approval" && waitingCall(candidate) !== null,
        "the exact run's durable approval pause",
      );
      const call = waitingCall(pending)!;
      if (call.toolId === "lios.project.publish_object") {
        approvalFrame = frame;
        waitingRecord = pending;
        publicationCallId = call.toolCallId;
        break;
      }
      if (call.toolId !== "agent.python.data" && call.toolId !== "agent.browser.navigate") {
        throw new Error(`The qualification request selected an unexpected consequential tool: ${call.toolId}.`);
      }
      await page.clickReview(requestId, frame.event.reviewId);
      afterSeq = frame.runSeq;
    }
    if (!approvalFrame || !waitingRecord || !publicationCallId || approvalFrame.event.type !== "governed_tool_approval_required") {
      throw new Error("The real bounded plan did not reach external publication within its approved step bound.");
    }
    const approvalEvent = approvalFrame.event;
    await page.waitTestId("governed-tool-approval");
    const approvalText = await page.testIdText("governed-tool-approval");
    await snapshot("external-review");
    record(
      "sp02.approval_pause",
      approvalEvent.requestId === requestId
        && !approvalText.includes(approvalEvent.reviewId)
        && !approvalText.includes(requestId)
        && waitingRecord.version === 2,
      "opaque governed review UI is visible while the same encrypted run record is durably waiting_approval",
    );

    changePublicationAvailability("stop");
    publicationStopped = true;
    await page.clickReview(requestId, approvalEvent.reviewId);
    const resumedRecord = await waitFor(
      () => executionRecord(page!, chatId!, requestId!),
      (candidate) => inspectApprovalLedger(callEvents(candidate, publicationCallId!)) !== null,
      "the exact publication call's durable release",
    );
    const approvalProof = inspectApprovalLedger(callEvents(resumedRecord, publicationCallId));
    const afterApprovalIds = await executionIds(page, chatId);
    record(
      "sp02.approval_bound",
      approvalProof !== null
        && JSON.stringify(afterApprovalIds) === JSON.stringify(afterStartIds)
        && resumedRecord.id === requestId,
      `opaque review released tool call ${approvalProof?.toolCallId ?? "missing"} inside requestId ${requestId} without creating another run`,
    );

    await page.waitConversationEvent(
      requestId,
      (entry) => entry.runSeq > approvalFrame!.runSeq && entry.event.type === "status"
        && entry.event.message.includes("connection refused before transmission"),
      "the real external provider outage's certified no-effect retry backoff",
    );
    const cancelVisible = await waitFor(
      () => page!.testIdForRequestExists("agent-run-cancel", requestId!),
      (exists) => exists,
      `the request-bound cancel control for ${requestId}`,
      30_000,
    ).catch(() => false);
    const cancelClicked = cancelVisible && await page.clickTestIdForRequest("agent-run-cancel", requestId);
    if (!cancelClicked) {
      record(
        "sp02.cancel_control",
        false,
        "production renderer has no data-testid=agent-run-cancel control bound by data-request-id",
      );
    }
    await page.waitConversationEvent(
      requestId,
      (entry) => entry.event.type === "done" && entry.event.status === "cancelled",
      "the exact run's cancelled terminal event",
      60_000,
    );
    const cancelledRecord = await waitFor(
      () => executionRecord(page!, chatId!, requestId!),
      (record) => record.status === "cancelled" || record.status === "interrupted",
      "the exact run's durable cancelled/interrupted state",
    );
    record(
      "sp02.cancel_control",
      cancelledRecord.endedAt !== null,
      `renderer Stop control durably terminalized requestId ${requestId} as ${cancelledRecord.status}`,
    );

    const cancelledFingerprint = JSON.stringify({
      status: cancelledRecord.status,
      endedAt: cancelledRecord.endedAt,
      events: cancelledRecord.events ?? [],
      checkpoint: cancelledRecord.checkpoint ?? null,
    });
    page.close();
    page = null;
    await quit(app);
    app = null;

    port = await freePort();
    app = await launch(port, dirs);
    page = await Page.attach(port);
    await waitFor(
      () => page!.fetchJson<AuthUser>("/api/auth/me").catch(() => ({})),
      (user) => user.email === OWNER.email,
      "the restored authenticated owner",
      90_000,
    );
    const restoredOnce = await executionRecord(page, chatId, requestId);
    await sleep(3_000);
    const restoredTwice = await executionRecord(page, chatId, requestId);
    const restoredFingerprint = JSON.stringify({
      status: restoredTwice.status,
      endedAt: restoredTwice.endedAt,
      events: restoredTwice.events ?? [],
      checkpoint: restoredTwice.checkpoint ?? null,
    });
    record(
      "sp02.restart_no_autoresume",
      restoredOnce.status === restoredTwice.status
        && cancelledFingerprint === restoredFingerprint
        && sandboxContainers().length === 0,
      `restart preserved ${requestId} without event growth, status transition, dispatch, or surviving sandbox execution`,
    );

    const resumeVisible = await waitFor(
      () => page!.testIdForRequestExists("agent-run-resume", requestId!),
      (exists) => exists,
      `the request-bound explicit resume control for ${requestId}`,
      30_000,
    ).catch(() => false);
    changePublicationAvailability("start");
    await waitFor(() => publicationKeys().catch(() => null), (keys) => Array.isArray(keys), "the restored real authenticated publication provider", 30_000);
    publicationStopped = false;
    const resumeClicked = resumeVisible && await page.clickTestIdForRequest("agent-run-resume", requestId);
    const resumedAfterRestart = resumeClicked
      ? await waitFor(
          () => executionRecord(page!, chatId!, requestId!),
          (record) => (record.status === "running" || record.status === "waiting_approval")
            && JSON.stringify(record.events ?? []) !== JSON.stringify(restoredTwice.events ?? []),
          "an actual same-requestId durable resume transition",
          60_000,
        ).catch(() => null)
      : null;
    // The resumed confirm-class call is a fresh call: it needs its OWN request-bound review through the opaque governed UI.
    // Nothing from the first Allow-once carries over, so the harness must click Allow once a second time.
    const reapprovalFrame = resumedAfterRestart
      ? await page.waitConversationEvent(
          requestId,
          (entry) => entry.event.type === "governed_tool_approval_required",
          "the resumed run's fresh governed-tool approval event",
          60_000,
        ).catch(() => null)
      : null;
    const reapprovalEvent = reapprovalFrame?.event.type === "governed_tool_approval_required" ? reapprovalFrame.event : null;
    let reapprovalClicked = false;
    if (reapprovalEvent) {
      await page.waitTestId("governed-tool-approval");
      const reapprovalText = await page.testIdText("governed-tool-approval");
      reapprovalClicked = reapprovalEvent.requestId === requestId
        && reapprovalEvent.reviewId !== approvalEvent.reviewId
        && !reapprovalText.includes(reapprovalEvent.reviewId)
        && !reapprovalText.includes(requestId);
      if (reapprovalClicked) await page.clickReview(requestId, reapprovalEvent.reviewId);
    }
    const reapprovedRecord = reapprovalClicked
      ? await waitFor(
          () => executionRecord(page!, chatId!, requestId!),
          (record) => inspectResumeReapproval(record.events ?? []) !== null,
          "the resumed call's second durable same-run release",
          60_000,
        ).catch(() => null)
      : null;
    record(
      "sp02.explicit_resume",
      resumeClicked && resumedAfterRestart?.id === requestId && reapprovedRecord?.id === requestId,
      !resumeVisible
        ? "production renderer has no data-testid=agent-run-resume control bound by data-request-id"
        : !resumedAfterRestart
          ? "request-bound renderer control was clicked but the canonical record did not resume"
          : !reapprovalEvent
            ? "resumed run never asked for a fresh request-bound approval"
            : !reapprovalClicked
              ? "resumed run's approval review was not fresh and opaque"
              : reapprovedRecord
                ? "resume re-paused for a fresh opaque Allow-once; the second approval released the linked retry call in the same run"
                : "second Allow-once was clicked but the linked retry call was not durably released",
    );

    const recoveredRecord = await waitFor(
      () => executionRecord(page!, chatId!, requestId!),
      (candidate) => candidate.status === "completed" && inspectRecoveryLedger(candidate.events ?? []) !== null,
      "durable no-effect then exactly-once external-side-effect recovery evidence",
      180_000,
    ).catch(() => null);
    const recoveryProof = inspectRecoveryLedger(recoveredRecord?.events ?? []);
    const finalObjectKeys = await publicationKeys();
    const newObjectKeys = finalObjectKeys.filter((key) => !baselineObjectKeys.includes(key));
    const publication = newObjectKeys.length === 1
      ? JSON.parse((await new S3StorageProvider(publicationConfiguration()).get(newObjectKeys[0]!, { maxBytes: 70 * 1024 })).toString("utf8")) as { title?: unknown; content?: unknown }
      : null;
    const actualExternalResult = typeof publication?.title === "string" && publication.title.includes(RUN_MARKER)
      && typeof publication.content === "string" && /(?:^|\D)5(?:\D|$)/.test(publication.content);
    record(
      "sp02.no_duplicate_side_effect",
      recoveryProof !== null && recoveredRecord?.status === "completed" && newObjectKeys.length === 1 && actualExternalResult,
      recoveryProof
        ? `idempotency key ${recoveryProof.idempotencyKey}: call ${recoveryProof.noEffectToolCallId} attempt ${recoveryProof.noEffectAttempt} proven no-effect, linked retry call ${recoveryProof.toolCallId} attempt ${recoveryProof.committedAttempt} committed once (durable commit count ${recoveryProof.durableCommitCount})`
        : "no production run recorded one no-effect dispatch plus one same-key commit in a linked retry call",
    );

    await page.waitConversationEvent(
      requestId,
      (entry) => entry.event.type === "done" && entry.event.status === "completed",
      "the exact resumed run's completed event",
      60_000,
    );
    await page.waitTestId("trace-receipt", 60_000);
    await snapshot("completed-result");
    const persistedBeforeRestart = await waitFor(
      () => page!.persistedReceipt(requestId!),
      (events) => hasPersistedReceiptEvidence(events, requestId!),
      "the exact run's compact renderer receipt persistence",
      60_000,
    );

    page.close();
    page = null;
    await quit(app);
    app = null;
    port = await freePort();
    app = await launch(port, dirs);
    page = await Page.attach(port);
    await page.waitTestId("trace-receipt", 90_000);
    const persistedAfterRestart = await page.persistedReceipt(requestId);
    const finalRecord = await executionRecord(page, chatId, requestId);
    record(
      "sp02.receipt",
      hasPersistedReceiptEvidence(persistedBeforeRestart, requestId)
        && hasPersistedReceiptEvidence(persistedAfterRestart, requestId)
        && finalRecord.status === "completed",
      `data-testid=trace-receipt and its exact ${requestId} compact event set survived a second packaged restart`,
    );
  } catch (error) {
    failure = error;
    await snapshot("failed").catch(() => undefined);
  } finally {
    page?.close();
    if (app) await quit(app);
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    if (publicationStopped) changePublicationAvailability("start");
  }

  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  const evidence: Sp02PackagedEvidence = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    commit: sha,
    platform: `${process.platform}/${process.arch}`,
    app: APP,
    request: REQUEST,
    sandboxImage,
    aiProvider: AI_PROVIDER,
    aiModel: AI_MODEL,
    screenshots,
    requestId,
    projectId,
    chatId,
    passed: !failure && hasCompleteSp02CheckSet(checks),
    checks,
    error: failure instanceof Error ? failure.message : undefined,
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  console.log(`Evidence: ${evidencePath}`);
  if (failure) throw failure;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
