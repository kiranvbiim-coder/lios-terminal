/**
 * SP-01 packaged macOS journey: install-equivalent launch -> owner sign-in -> Project/Chat ->
 * exact-operation approval/denial -> shared governed Terminal -> receipt -> reload/cancel ->
 * restart/restore. Drives the packaged Electron renderer over CDP against an isolated scratch
 * data root and the strict Docker sandbox. This is evidence tooling, not a mock: every step uses
 * the real UI, server, Gateway, Docker engine and encrypted journal.
 *
 * Usage: npm run acceptance:sp01-packaged [-- --evidence <path>]
 * Env: LIOS_SP01_APP (app binary), LIOS_SP01_DOCKER_SOCK (default Colima socket).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const root = process.cwd();
const APP = process.env.LIOS_SP01_APP
  ?? path.join(root, "dist-app/mac-arm64/LiOS Intelligence Terminal.app/Contents/MacOS/LiOS Intelligence Terminal");
const DOCKER_SOCK = process.env.LIOS_SP01_DOCKER_SOCK ?? path.join(os.homedir(), ".colima/default/docker.sock");
const OWNER = { name: "SP01 Journey", email: "journey@example.com", password: "Quartz-Harbor!7391" };
const PROJECT = "SP01 Acceptance";

type Check = { id: string; pass: boolean; detail: string };
const checks: Check[] = [];
function record(id: string, pass: boolean, detail: string): void {
  checks.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`);
  if (!pass) throw new Error(`SP-01 check failed: ${id} - ${detail}`);
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

interface EvaluateResult {
  result: { value?: unknown };
  exceptionDetails?: { exception?: { description?: string } };
}

class Page {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: EvaluateResult) => void; reject: (e: Error) => void }>();
  private constructor(private readonly ws: WebSocket) {
    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as { id?: number; error?: { message: string }; result: EvaluateResult };
      const waiter = message.id !== undefined ? this.pending.get(message.id) : undefined;
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
  }

  static async attach(port: number, timeoutMs = 120_000): Promise<Page> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
        const target = targets.find((t) => t.type === "page" && /^http:\/\/localhost:\d+\//.test(t.url));
        if (target) {
          const ws = new WebSocket(target.webSocketDebuggerUrl);
          await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
          return new Page(ws);
        }
      } catch { /* app still starting */ }
      if (Date.now() > deadline) throw new Error("Packaged renderer did not appear over CDP.");
      await sleep(500);
    }
  }

  async eval<T>(expression: string): Promise<T> {
    const id = ++this.seq;
    const result = await new Promise<EvaluateResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "evaluate failed");
    return result.result.value as T;
  }

  text(): Promise<string> {
    return this.eval<string>("document.body?.innerText ?? ''").catch(() => "");
  }

  async waitText(pattern: RegExp, timeoutMs = 60_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const text = await this.text();
      if (pattern.test(text)) return text;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${pattern}. Page tail: ${text.slice(-400)}`);
      await sleep(400);
    }
  }

  /** Click a button/link by visible text or aria-label. `last` picks the final match (chat and terminal both expose Stop). */
  async click(label: string, opts: { exact?: boolean; last?: boolean; timeoutMs?: number } = {}): Promise<void> {
    const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
    const script = `(() => {
      const label = ${JSON.stringify(label)}; const exact = ${opts.exact !== false}; const last = ${opts.last === true};
      const els = [...document.querySelectorAll('button,a,[role=button]')].filter((el) => {
        const t = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
        const a = t.toLowerCase(), b = label.toLowerCase();
        return exact ? a === b : a.includes(b);
      }).filter((el) => !el.disabled);
      const el = last ? els[els.length - 1] : els[0];
      if (!el) return false; el.click(); return true; })()`;
    for (;;) {
      if (await this.eval<boolean>(script)) return;
      if (Date.now() > deadline) throw new Error(`Control not found: ${label}`);
      await sleep(300);
    }
  }

  async fill(name: string, value: string, timeoutMs = 15_000): Promise<void> {
    const script = `(() => {
      const name = ${JSON.stringify(name)};
      const el = [...document.querySelectorAll('input,textarea')].find((e) => e.placeholder === name
        || e.getAttribute('aria-label') === name
        || [...(e.labels ?? [])].some((l) => l.textContent.replace(/\\s+/g, ' ').trim() === name));
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
    const deadline = Date.now() + timeoutMs;
    while (!(await this.eval<boolean>(script))) {
      if (Date.now() > deadline) throw new Error(`Input not found: ${name}`);
      await sleep(300);
    }
  }

  reload(): Promise<unknown> { return this.eval("location.reload()").catch(() => undefined); }
  close(): void { this.ws.close(); }
}

async function launch(port: number, dirs: { data: string; user: string }): Promise<ChildProcess> {
  const child = spawn(APP, [`--user-data-dir=${dirs.user}`, `--remote-debugging-port=${port}`], {
    stdio: "ignore",
    env: {
      ...process.env,
      LIMURIA_DATA_DIR: dirs.data,
      LIOS_EXECUTION_ISOLATION: "strict",
      LIOS_EXECUTION_SANDBOX_ENGINE: "docker",
      LIOS_EXECUTION_SANDBOX_TARGET: `unix://${DOCKER_SOCK}`,
    },
  });
  return child;
}

async function quit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 20_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

function sandboxContainers(): string[] {
  const result = spawnSync("docker", [`--host=unix://${DOCKER_SOCK}`, "ps", "-a", "--filter", "name=lios-exec", "--format", "{{.Names}}"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`docker ps failed: ${result.stderr}`);
  return result.stdout.split("\n").filter(Boolean);
}

/** Ordinary chat has no sandbox control; the advanced reviewed-operation flow is opened with the /sandbox slash command. */
async function openSandboxWithSlashCommand(page: Page): Promise<void> {
  await page.fill("Ask LiOS", "/sandbox");
  await page.click("Send");
}

async function main(): Promise<void> {
  const evidenceArg = process.argv.indexOf("--evidence");
  const evidencePath = evidenceArg > 0 ? path.resolve(process.argv[evidenceArg + 1]) : path.join(os.tmpdir(), "lios-sp01-packaged-evidence.json");
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("SP-01 packaged journey is qualified for macOS arm64 only.");
  if (!fs.existsSync(APP)) throw new Error(`Packaged app not found: ${APP}. Run npm run app:pack first.`);
  if (!fs.existsSync(DOCKER_SOCK)) throw new Error(`Local Docker/Colima socket not found: ${DOCKER_SOCK}`);
  if (sandboxContainers().length) throw new Error("Stale lios-exec containers exist before the journey; remove them first.");

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lios-sp01-"));
  const dirs = { data: path.join(scratch, "data"), user: path.join(scratch, "ud") };
  fs.mkdirSync(dirs.data, { recursive: true });
  let app: ChildProcess | null = null;
  let page: Page | null = null;
  let failure: unknown = null;
  let sessionLabel = "";

  try {
    // 1. Install-equivalent first launch and owner sign-in.
    let port = await freePort();
    app = await launch(port, dirs);
    page = await Page.attach(port);
    await page.waitText(/SIGN IN/i);
    await page.click("SIGN IN");
    await page.waitText(/Secure First-Run Setup/i);
    await page.fill("Full name", OWNER.name);
    await page.fill("name@company.com", OWNER.email);
    await page.fill("12+ characters", OWNER.password);
    await page.fill("Repeat password", OWNER.password);
    await page.click("CREATE ADMINISTRATOR");
    await page.waitText(/What do you want to understand/i);
    record("sp01.signin", true, "owner created and authenticated workspace restored");

    // 2. Project and Project Chat.
    await page.click("Create a Project");
    await page.fill("Project name", PROJECT);
    await page.click("Create Project");
    await page.waitText(/PROJECT HOME/i);
    await page.click("+ New chat", { exact: false });
    await page.waitText(/What do you want to understand/i);
    record("sp01.project_chat", true, "Project and Project Chat opened");

    // 3. Denial path: exact operation shown, denied, nothing executed.
    await openSandboxWithSlashCommand(page);
    const card = await page.waitText(/Approve this exact sandbox operation\?/i);
    record("sp01.exact_operation_card", /Operation digest: [a-f0-9]{64}/.test(card) && /Approval digest: [a-f0-9]{64}/.test(card) && /deny network/i.test(card),
      "card shows exact argv, operation/approval digests and isolation facts");
    await page.click("Deny");
    const denied = await page.waitText(/Trust receipt: denied/i);
    record("sp01.denial", /not bound before denial/i.test(denied) && sandboxContainers().length === 0, "denial recorded without execution; no container created");

    // 4. Approve once -> live governed session shared by Chat and Terminal.
    await openSandboxWithSlashCommand(page);
    await page.waitText(/Approve this exact sandbox operation\?/i);
    await page.click("Approve once and open Terminal");
    await page.waitText(/Restricted terminal input ready/i, 120_000);
    for (const [input, expected] of [["pwd", /\n\/tmp\n/], ["id -u", /\n10001\n/], ["ls /tmp", /total \d+/]] as const) {
      await page.click(input, { last: true });
      await page.waitText(expected, 30_000);
    }
    record("sp01.governed_terminal", true, "reviewed read-only inputs returned real sandbox output (/tmp, uid 10001, ls)");

    // 5. Reconnect: reload restores the running session with its output.
    await page.reload();
    await page.waitText(/total \d+/, 60_000);
    record("sp01.reconnect", true, "reload restored running session output");

    // 6. Cancel and extinction proof; trust receipt.
    await page.click("Reopen last sandbox session");
    await page.waitText(/Execution Terminal[\s\S]*RUNNING/, 60_000);
    await page.click("Stop", { last: true });
    const cancelled = await page.waitText(/CANCELLED/, 60_000);
    const receipt = cancelled.match(/Trust receipt: approved[\s\S]*?Interactive input digests: (\d+)/);
    sessionLabel = (cancelled.match(/Execution Terminal\s+([a-f0-9]{8})/) ?? [])[1] ?? "";
    record("sp01.receipt", Boolean(receipt) && receipt![1] === "3" && /Operation SHA-256: [a-f0-9]{64}/.test(cancelled) && /Policy SHA-256: [a-f0-9]{64}/.test(cancelled),
      "approved trust receipt with digests and 3 input digests (raw inputs not stored)");
    await sleep(2_000);
    record("sp01.extinction", sandboxContainers().length === 0, "no lios-exec container survives cancellation");

    // 7. Restart: persisted history, no automatic command resume.
    page.close(); page = null;
    await quit(app);
    port = await freePort();
    app = await launch(port, dirs);
    page = await Page.attach(port);
    await page.waitText(/What do you want to understand/i, 90_000);
    await page.click("Reopen last sandbox session");
    const restored = await page.waitText(/CANCELLED/, 60_000);
    record("sp01.restart_restore", /Trust receipt: approved/.test(restored) && /total \d+/.test(restored) && sandboxContainers().length === 0,
      `auth/Project/Chat and session ${sessionLabel} history restored as CANCELLED; nothing resumed`);
  } catch (error) {
    failure = error;
  } finally {
    page?.close();
    if (app) await quit(app);
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  fs.writeFileSync(evidencePath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    commit: sha,
    platform: `${process.platform}/${process.arch}`,
    app: APP,
    passed: !failure && checks.length === 9,
    checks,
    error: failure instanceof Error ? failure.message : undefined,
  }, null, 2) + "\n");
  console.log(`Evidence: ${evidencePath}`);
  if (failure) throw failure;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
