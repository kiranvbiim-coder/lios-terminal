/**
 * SP-03 packaged Research Alpha journey.
 *
 * Drives the real packaged Electron renderer over CDP, submits the canonical Research Alpha
 * request to the bounded agent, approves only the canonical read-only research-browser tool,
 * and verifies the resulting P4 ResearchArtifact plus P3 interaction lineage through authenticated
 * APIs. It installs no model, source, entitlement, entity, Artifact, browser or research fixture.
 * Missing production seams stay RED.
 *
 * Usage: npm run acceptance:sp03-packaged [-- --evidence <path>]
 * Env:
 *   LIOS_SP03_APP         packaged app binary (defaults to the macOS arm64 app)
 *   LIOS_SP03_AI_PROVIDER real configured provider (defaults to ollama)
 *   LIOS_SP03_AI_MODEL    real configured model (defaults to OLLAMA_MODEL or llama3.2:3b)
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { GATEWAY_EVENTS, gatewayEventFrameSchema } from "../shared/gatewayProtocol";
import type { ConversationRuntimeEvent } from "../shared/conversationRuntime";
import {
  hasCompleteSp03CheckSet,
  SP03_DEFAULT_REQUEST,
  SP03_DEFAULT_SUBJECT,
  type Sp03PackagedCheck,
  type Sp03PackagedCheckId,
  type Sp03PackagedEvidence,
} from "./sp03_packaged_contract";
import {
  inspectSp03ResearchArtifact,
  type Sp03ArtifactDetailLike,
  type Sp03ExecutionLike,
  type Sp03InteractionLike,
} from "./sp03_packaged_inspection";

const root = process.cwd();
const APP = process.env.LIOS_SP03_APP
  ?? path.join(root, "dist-app/mac-arm64/LiOS Intelligence Terminal.app/Contents/MacOS/LiOS Intelligence Terminal");
const APP_LOG = process.env.LIOS_SP03_APP_LOG?.trim() || path.join(os.tmpdir(), "lios-sp03-app.log");
const AI_PROVIDER = process.env.LIOS_SP03_AI_PROVIDER?.trim() || "ollama";
const AI_MODEL = process.env.LIOS_SP03_AI_MODEL?.trim() || process.env.OLLAMA_MODEL?.trim() || "llama3.2:3b";
const OWNER = { name: "SP03 Journey", email: "sp03-journey@example.com", password: "Quartz-Harbor!7391" };
const PROJECT = "SP03 Research Alpha";
const REQUEST = SP03_DEFAULT_REQUEST;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const APPROVABLE_RESEARCH_TOOLS = new Set([
  "lios.research.browser",
  // Backward-compatible generic browser route used by the already accepted SP-02 runtime.
  "agent.browser.navigate",
]);

const checks: Sp03PackagedCheck[] = [];
function record(id: Sp03PackagedCheckId, pass: boolean, detail: string): void {
  checks.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`);
  if (!pass) throw new Error(`SP-03 check failed: ${id} - ${detail}`);
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

function appLogTail(): string {
  try {
    const value = fs.readFileSync(APP_LOG, "utf8");
    return value.split("\n").slice(-80).join("\n").slice(-8_000);
  } catch {
    return "";
  }
}

class Page {
  private seq = 0;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private readonly conversationEvents: CapturedConversationEvent[] = [];

  identityEvidence(requestId: string): { sourceRefs: string[]; resolved: boolean } {
    const starts = this.conversationEvents
      .filter((entry) => entry.requestId === requestId && entry.event.type === "tool_start")
      .map((entry) => entry.event)
      .filter((event): event is Extract<ConversationRuntimeEvent, { type: "tool_start" }> =>
        event.type === "tool_start" && event.componentId === "lios.entity.resolve");
    const stepIds = new Set(starts.map((event) => event.stepId));
    const results = this.conversationEvents
      .filter((entry) => entry.requestId === requestId && entry.event.type === "tool_result")
      .map((entry) => entry.event)
      .filter((event): event is Extract<ConversationRuntimeEvent, { type: "tool_result" }> =>
        event.type === "tool_result" && stepIds.has(event.stepId));
    return {
      sourceRefs: [...new Set(results.flatMap((event) => event.sourceRefs).map((ref) => ref.trim()).filter(Boolean))],
      resolved: results.some((event) => /Resolved to canonical P5 identity/i.test(event.summary)),
    };
  }

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

  static async attach(port: number, timeoutMs = 300_000, child?: ChildProcess): Promise<Page> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as Array<{
          type: string;
          url: string;
          webSocketDebuggerUrl: string;
        }>;
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
      } catch {
        // Packaged renderer is still starting.
      }
      if (child?.exitCode !== null && child?.exitCode !== undefined) {
        const tail = appLogTail();
        throw new Error(
          `Packaged app exited before the CDP renderer appeared (code ${child.exitCode}, signal ${child.signalCode ?? "none"}).`
          + (tail ? ` App log tail:\n${tail}` : ""),
        );
      }
      if (Date.now() > deadline) {
        const tail = appLogTail();
        throw new Error(
          "Packaged renderer did not appear over CDP while the app process remained live."
          + (tail ? ` App log tail:\n${tail}` : ""),
        );
      }
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
        method: ${JSON.stringify(method)},
        headers: { "content-type": "application/json" },
        body: ${JSON.stringify(JSON.stringify(body))},
      });
      let result = null;
      try { result = await response.json(); } catch {}
      return { ok: response.ok, status: response.status, body: result };
    })()`);
    if (!response.ok) {
      const detail = response.body as { error?: { code?: unknown; message?: unknown } } | null;
      const code = typeof detail?.error?.code === "string" ? ` code=${detail.error.code}` : "";
      const message = typeof detail?.error?.message === "string" ? ` · ${detail.error.message.slice(0, 240)}` : "";
      throw new Error(`Authenticated API ${method} ${url} returned ${response.status}${code}${message}.`);
    }
    return response.body;
  }

  async clickButton(label: string, options: { exact?: boolean; timeoutMs?: number } = {}): Promise<void> {
    const deadline = Date.now() + (options.timeoutMs ?? 30_000);
    const script = `(() => {
      const label = ${JSON.stringify(label)};
      const exact = ${options.exact !== false};
      const elements = [...document.querySelectorAll("button,[role=button]")].filter((element) => {
        const value = (element.getAttribute("aria-label") || element.textContent || "").replace(/\\s+/g, " ").trim();
        return exact ? value.toLowerCase() === label.toLowerCase() : value.toLowerCase().includes(label.toLowerCase());
      });
      const element = elements.find((candidate) => !candidate.hasAttribute("disabled"));
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

  async fill(name: string, value: string, timeoutMs = 15_000): Promise<void> {
    const script = `(() => {
      const name = ${JSON.stringify(name)};
      const element = [...document.querySelectorAll("input,textarea")].find((candidate) =>
        candidate.placeholder === name
        || candidate.getAttribute("aria-label") === name
        || [...(candidate.labels ?? [])].some((label) => label.textContent.replace(/\\s+/g, " ").trim() === name)
      );
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (!setter) return false;
      setter.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`;
    const deadline = Date.now() + timeoutMs;
    while (!(await this.eval<boolean>(script))) {
      if (Date.now() > deadline) throw new Error(`Input not found: ${name}`);
      await sleep(300);
    }
  }

  async submitConversation(value: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const script = `(() => {
      const candidate = [...document.querySelectorAll('textarea,[contenteditable="true"]')]
        .find((element) => !element.closest('[aria-hidden="true"]') && !element.hasAttribute("disabled"));
      if (!candidate) return false;
      if (candidate instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        if (!setter) return false;
        setter.call(candidate, ${JSON.stringify(value)});
        candidate.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (candidate instanceof HTMLElement) {
        candidate.textContent = ${JSON.stringify(value)};
        candidate.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(value)} }));
      } else return false;
      const form = candidate.closest("form");
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
        return true;
      }
      const send = [...document.querySelectorAll("button,[role=button]")].find((element) => {
        const label = (element.getAttribute("aria-label") || element.textContent || "").trim();
        return /^(send|submit|run)$/i.test(label) && !element.hasAttribute("disabled");
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

  async waitTestId(testId: string, timeoutMs = 60_000): Promise<void> {
    await waitFor(
      () => this.eval<boolean>(`document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']') !== null`).catch(() => false),
      Boolean,
      `[data-testid="${testId}"]`,
      timeoutMs,
    );
  }

  async clickPendingReview(requestId: string, timeoutMs = 30_000): Promise<string | null> {
    return waitFor(
      () => this.eval<{ clicked: boolean; reviewId: string | null }>(`(() => {
        const button = [...document.querySelectorAll('[data-testid="governed-tool-allow-once"]')]
          .find((element) => element.getAttribute("data-request-id") === ${JSON.stringify(requestId)}
            && !element.hasAttribute("disabled"));
        if (!(button instanceof HTMLButtonElement)) return { clicked: false, reviewId: null };
        const reviewId = button.getAttribute("data-review-id");
        button.click();
        return { clicked: true, reviewId };
      })()`).catch(() => ({ clicked: false, reviewId: null })),
      (result) => result.clicked,
      "the exact request-bound Allow-once research review",
      timeoutMs,
    ).then((result) => result.reviewId);
  }

  async screenshot(file: string): Promise<void> {
    const captured = await this.command<{ data: string }>("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(file, Buffer.from(captured.data, "base64"));
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
interface ProjectArtifactRow {
  id: string;
  projectId: number;
  kind: string;
  origin: string;
  headVersion: number;
  title: string;
}
interface JournalRecord extends Sp03ExecutionLike {
  version: number;
  owner: { userId: number; projectId: number | null; chatId: number | null };
  status: "running" | "waiting_approval" | "completed" | "cancelled" | "failed" | "interrupted" | "denied";
  startedAt: string;
  endedAt: string | null;
  stdout: string;
  stderr: string;
  events?: unknown[];
}

async function launch(port: number, dirs: { data: string; user: string }): Promise<ChildProcess> {
  return spawn(APP, [`--user-data-dir=${dirs.user}`, `--remote-debugging-port=${port}`], {
    stdio: ["ignore", fs.openSync(APP_LOG, "w"), fs.openSync(APP_LOG, "a")],
    env: { ...process.env, LIMURIA_DATA_DIR: dirs.data },
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
  record("sp03.signin", signedIn.email === OWNER.email, "authenticated /api/auth/me identity matches the created owner");

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
  record("sp03.project_chat", true, `Project ${project.id} and Project Chat ${chat.id} exist in authenticated API state`);
  return { projectId: project.id, chatId: chat.id };
}

async function ensureWorkspaceReady(page: Page, context: string): Promise<"direct" | "retry"> {
  const state = await waitFor(
    () => page.eval<{ ready: boolean; retry: boolean }>(`(() => ({
      ready: document.querySelector('[data-testid="composer-agent-toggle"]') !== null,
      retry: [...document.querySelectorAll("button")].some((button) =>
        (button.textContent || "").replace(/\\s+/g, " ").trim().toLowerCase() === "retry opening lios")
    }))()`).catch(() => ({ ready: false, retry: false })),
    (value) => value.ready || value.retry,
    `${context} workspace or explicit session-retry UI`,
    90_000,
  );
  if (state.ready) return "direct";
  await page.clickButton("Retry opening LiOS", { exact: true, timeoutMs: 15_000 });
  await page.waitTestId("composer-agent-toggle", 90_000);
  return "retry";
}

async function configureRealAI(page: Page): Promise<void> {
  await page.requestJson("/api/setup/status", "PUT", { aiProviderId: AI_PROVIDER, aiModelId: AI_MODEL, complete: true });
  const verified = await page.requestJson<{ ok: boolean; provider: string; model: string }>("/api/setup/ai/test", "POST", {
    provider: AI_PROVIDER,
    model: AI_MODEL,
  });
  if (!verified.ok || verified.provider !== AI_PROVIDER || verified.model !== AI_MODEL) {
    throw new Error("The selected real AI provider/model was not live-verified.");
  }
  await page.requestJson("/api/wave-c/ai/state", "PUT", { state: "on", mode: "ai_assist" });
  await page.eval("location.reload();");
  await waitFor(
    () => page.eval<boolean>(`(() => {
      const button = document.querySelector('[data-testid="composer-agent-toggle"]');
      if (button instanceof HTMLButtonElement && !button.disabled) {
        if (button.getAttribute("aria-pressed") !== "true") button.click();
        return true;
      }

      // The packaged shell intentionally exposes this bounded reconnect path when the renderer
      // reload races native/server session restoration. Exercise the real recovery control rather
      // than treating a recoverable reconnect as research success or installing a fixture.
      const retry = [...document.querySelectorAll("button,[role=button]")].find((element) => {
        const label = (element.getAttribute("aria-label") || element.textContent || "").replace(/\\s+/g, " ").trim();
        return label.toLowerCase() === "retry opening lios";
      });
      if (retry instanceof HTMLElement && !retry.hasAttribute("disabled")) retry.click();
      return false;
    })()`),
    Boolean,
    "the bounded-agent composer after the packaged shell's real session-recovery path",
    120_000,
  );

  const restoredOwner = await page.fetchJson<AuthUser>("/api/auth/me");
  if (restoredOwner.email !== OWNER.email) {
    throw new Error("Packaged session recovery did not preserve the authenticated owner.");
  }
}

async function executionRecord(page: Page, chatId: number, requestId: string): Promise<JournalRecord> {
  const execution = await page.fetchJson<JournalRecord>(`/api/project-chats/${chatId}/executions/${requestId}`);
  if (execution.id !== requestId || execution.owner.chatId !== chatId) {
    throw new Error("Execution journal returned a different run or chat identity.");
  }
  return execution;
}

function waitingCall(record: JournalRecord): { toolCallId: string; toolId: string } | null {
  const events = (record.events ?? []).filter((event): event is Record<string, unknown> => event !== null && typeof event === "object");
  const waiting = [...events].reverse().find((event) => event.kind === "tool_call_waiting_approval");
  if (!waiting || typeof waiting.toolCallId !== "string") return null;
  const started = events.find((event) => event.kind === "tool_call_started" && event.toolCallId === waiting.toolCallId);
  return typeof started?.toolId === "string" ? { toolCallId: waiting.toolCallId, toolId: started.toolId } : null;
}

function journalSummary(record: JournalRecord | null): string {
  if (!record) return "unavailable";
  const events = (record.events ?? []).map((event) => {
    if (!event || typeof event !== "object") return "";
    const item = event as Record<string, unknown>;
    return [item.kind, item.toolId, item.status].filter((value) => typeof value === "string").join(":");
  }).filter(Boolean);
  const stderrTail = record.stderr.trim().split("\n").slice(-3).join(" | ").slice(-800);
  return `${record.status} ${events.slice(-18).join(",")}${stderrTail ? ` stderr=${stderrTail}` : ""}`;
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

async function waitForResearchRun(page: Page, chatId: number, requestId: string): Promise<JournalRecord> {
  const deadline = Date.now() + 8 * 60_000;
  const approvedCallIds = new Set<string>();
  for (;;) {
    const record = await executionRecord(page, chatId, requestId);
    if (record.status === "completed") return record;
    if (["failed", "cancelled", "interrupted", "denied"].includes(record.status)) {
      throw new Error(`Research run terminalized as ${journalSummary(record)}`);
    }
    if (record.status === "waiting_approval") {
      const call = waitingCall(record);
      if (!call) throw new Error("Research run is waiting for approval without an inspectable canonical waiting call.");
      if (!APPROVABLE_RESEARCH_TOOLS.has(call.toolId)) {
        throw new Error(`Research run requested unexpected consequential tool ${call.toolId}; packaged SP-03 will not auto-approve it.`);
      }
      if (!approvedCallIds.has(call.toolCallId)) {
        await page.clickPendingReview(requestId);
        approvedCallIds.add(call.toolCallId);
      }
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for Research Alpha completion. Journal: ${journalSummary(record)}`);
    await sleep(600);
  }
}

function artifactFingerprint(detail: Sp03ArtifactDetailLike): string {
  return JSON.stringify({
    id: detail.artifact.id,
    projectId: detail.artifact.projectId ?? null,
    kind: detail.artifact.kind ?? null,
    origin: detail.artifact.origin ?? null,
    headVersion: detail.artifact.headVersion ?? null,
    version: detail.version.version,
    contentHash: detail.version.contentHash,
    sourceRefs: detail.version.sourceRefs ?? [],
    dependencyRefs: detail.version.dependencyRefs ?? [],
    executionReceiptIds: detail.version.executionReceiptIds ?? [],
    content: detail.version.content,
  });
}

async function findResearchArtifact(input: {
  page: Page;
  projectId: number;
  baselineIds: Set<string>;
}): Promise<{ detail: Sp03ArtifactDetailLike; interactions: Sp03InteractionLike[] }> {
  const found = await waitFor(
    async () => {
      const rows = await input.page.fetchJson<ProjectArtifactRow[]>(`/api/projects/${input.projectId}/artifacts?kind=research&limit=100`);
      const fresh = rows.filter((row) => !input.baselineIds.has(row.id));
      for (const row of fresh) {
        const detail = await input.page.fetchJson<Sp03ArtifactDetailLike>(`/api/artifacts/${encodeURIComponent(row.id)}`);
        const content = detail.version.content as { kind?: unknown; evidence?: unknown };
        if (content?.kind !== "research" || !Array.isArray(content.evidence) || content.evidence.length < 2) continue;
        const interactions = await input.page.fetchJson<Sp03InteractionLike[]>(`/api/artifacts/${encodeURIComponent(row.id)}/interactions`);
        return { detail, interactions };
      }
      return null;
    },
    (value): value is { detail: Sp03ArtifactDetailLike; interactions: Sp03InteractionLike[] } => value !== null,
    "a newly created multi-source canonical ResearchArtifact",
    90_000,
  );
  if (!found) throw new Error("Research Artifact wait returned no result.");
  return found;
}

async function main(): Promise<void> {
  const evidenceArg = process.argv.indexOf("--evidence");
  const evidencePath = evidenceArg >= 0 && process.argv[evidenceArg + 1]
    ? path.resolve(process.argv[evidenceArg + 1]!)
    : path.join(os.tmpdir(), "lios-sp03-packaged-evidence.json");
  let projectId: number | null = null;
  let chatId: number | null = null;
  let artifactId: string | null = null;
  let artifactVersion: number | null = null;
  let evidenceSources: Sp03PackagedEvidence["sources"] = [];
  let scratch: string | null = null;
  let app: ChildProcess | null = null;
  let page: Page | null = null;
  let failure: unknown = null;
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
      throw new Error("SP-03 packaged journey is initially qualified for macOS arm64 only.");
    }
    if (!fs.existsSync(APP)) throw new Error(`Packaged app not found: ${APP}. Run npm run app:pack first.`);

    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lios-sp03-"));
    const dirs = { data: path.join(scratch, "data"), user: path.join(scratch, "ud") };
    fs.mkdirSync(dirs.data, { recursive: true });

    let port = await freePort();
    app = await launch(port, dirs);
    page = await Page.attach(port, 300_000, app);
    const scope = await bootstrapProjectChat(page);
    projectId = scope.projectId;
    chatId = scope.chatId;

    const baselineArtifacts = await page.fetchJson<ProjectArtifactRow[]>(`/api/projects/${projectId}/artifacts?kind=research&limit=100`);
    const baselineIds = new Set(baselineArtifacts.map((artifact) => artifact.id));
    await configureRealAI(page);
    await snapshot("before-research");

    await page.submitConversation(REQUEST);
    const requestId = await requestIdForSubmittedMessage(page, chatId);
    const started = await waitFor(
      () => executionRecord(page!, chatId!, requestId).catch(() => null),
      (record) => record !== null && record.id === requestId,
      "the exact Research Alpha execution journal record",
      60_000,
    );
    if (!started) throw new Error("Research Alpha execution journal record did not materialize.");
    if (started.owner.projectId !== projectId) throw new Error("Research Alpha run is not bound to the created Project.");

    const completed = await waitForResearchRun(page, chatId, requestId);
    const saved = await findResearchArtifact({ page, projectId, baselineIds });
    artifactId = saved.detail.artifact.id;
    artifactVersion = saved.detail.version.version;

    const identity = page.identityEvidence(requestId);
    const inspected = inspectSp03ResearchArtifact({
      detail: saved.detail,
      execution: completed,
      interactions: saved.interactions,
      requestId,
      identitySourceRefs: identity.sourceRefs,
      identityResolved: identity.resolved,
    });
    evidenceSources = inspected.sources;

    record("sp03.canonical_identity", inspected.canonicalIdentity.pass, inspected.canonicalIdentity.detail);
    record("sp03.multi_source_evidence", inspected.multiSourceEvidence.pass, inspected.multiSourceEvidence.detail);
    record("sp03.rights_freshness_asof", inspected.rightsFreshnessAsOf.pass, inspected.rightsFreshnessAsOf.detail);
    record("sp03.contradictions_gaps_unknowns", inspected.contradictionsGapsUnknowns.pass, inspected.contradictionsGapsUnknowns.detail);
    record("sp03.truth_classification", inspected.truthClassification.pass, inspected.truthClassification.detail);
    record("sp03.research_artifact", inspected.researchArtifact.pass, inspected.researchArtifact.detail);
    record("sp03.lineage_inspection", inspected.lineageInspection.pass, inspected.lineageInspection.detail);
    record("sp03.no_fake_success", inspected.noFakeSuccess.pass, inspected.noFakeSuccess.detail);
    await snapshot("research-artifact");

    const beforeRestart = artifactFingerprint(saved.detail);
    page.close();
    page = null;
    await quit(app);
    app = null;

    port = await freePort();
    app = await launch(port, dirs);
    page = await Page.attach(port, 300_000, app);
    await waitFor(
      () => page!.fetchJson<AuthUser>("/api/auth/me").catch(() => ({})),
      (user) => user.email === OWNER.email,
      "the restored authenticated owner",
      90_000,
    );
    const reopenPath = await ensureWorkspaceReady(page, "packaged restart");
    const restored = await page.fetchJson<Sp03ArtifactDetailLike>(`/api/artifacts/${encodeURIComponent(artifactId)}`);
    const restoredRows = await page.fetchJson<ProjectArtifactRow[]>(`/api/projects/${projectId}/artifacts?kind=research&limit=100`);
    const afterRestart = artifactFingerprint(restored);
    record(
      "sp03.restart_reopen",
      beforeRestart === afterRestart
        && restoredRows.some((row) => row.id === artifactId && row.headVersion === artifactVersion),
      `exact ${artifactId}@v${artifactVersion} content hash, source/dependency refs and ResearchArtifact content survived packaged restart/reopen; workspace restored via ${reopenPath === "retry" ? "the explicit one-click recovery path" : "direct session restoration"}`,
    );
    await snapshot("after-restart");
  } catch (error) {
    failure = error;
    await snapshot("failed").catch(() => undefined);
  } finally {
    page?.close();
    if (app) await quit(app);
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }

  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  const evidence: Sp03PackagedEvidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    commit: sha,
    platform: `${process.platform}/${process.arch}`,
    app: APP,
    subject: SP03_DEFAULT_SUBJECT,
    request: REQUEST,
    projectId,
    chatId,
    artifactId,
    artifactVersion,
    sources: evidenceSources,
    screenshots,
    passed: !failure && hasCompleteSp03CheckSet(checks),
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
