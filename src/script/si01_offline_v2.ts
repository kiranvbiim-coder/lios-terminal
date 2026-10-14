import fs from "node:fs";
import path from "node:path";
import {
  assertOfflineV2Accepted,
  buildOfflineV2Evidence,
  type OfflineV2Check,
} from "../server/si01-offline-evidence";

const baseUrl = (process.env.LIMURIA_BASE_URL || "http://127.0.0.1:5052").replace(/\/$/, "");
const email = process.env.LIMURIA_SMOKE_EMAIL;
const password = process.env.LIMURIA_SMOKE_PASSWORD;
if (!email || !password) {
  throw new Error(
    "Set LIMURIA_SMOKE_EMAIL and LIMURIA_SMOKE_PASSWORD for the authenticated SI-01.15 V2 journey.",
  );
}

const checks: OfflineV2Check[] = [];
const cookieJar = new Map<string, string>();
let cookie = "";
let csrfToken = "";

async function check(
  id: string,
  required: boolean,
  run: () => Promise<Record<string, unknown> | void>,
): Promise<void> {
  try {
    const result = await run();
    checks.push({
      id,
      required,
      status: "pass",
      detail: "Offline baseline check passed.",
      ...(result ? { evidence: result } : {}),
    });
  } catch (error) {
    checks.push({
      id,
      required,
      status: required ? "fail" : "unavailable",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function request(route: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Origin", new URL(baseUrl).origin);
  if (cookie) headers.set("Cookie", cookie);
  if (
    csrfToken &&
    init.method &&
    !["GET", "HEAD", "OPTIONS"].includes(init.method.toUpperCase())
  ) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(baseUrl + route, { ...init, headers });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";", 1)[0]!;
    cookieJar.set(pair.slice(0, pair.indexOf("=")), pair);
  }
  if (cookieJar.size) cookie = [...cookieJar.values()].join("; ");
  return response;
}

async function expectStatus(
  route: string,
  expected: number,
  init?: RequestInit,
): Promise<Response> {
  const response = await request(route, init);
  if (response.status !== expected) {
    throw new Error(
      `${route}: expected ${expected}, received ${response.status}: ${await response.text()}`,
    );
  }
  return response;
}

await check("desktop_local_loopback_health", true, async () => {
  const target = new URL(baseUrl);
  const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (!loopback.has(target.hostname)) {
    throw new Error(`Expected Desktop Local loopback, got ${target.hostname}.`);
  }
  await expectStatus("/health", 200);
  return { hostname: target.hostname };
});

await check("local_authenticated_session", true, async () => {
  const login = await request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (login.status !== 200) {
    throw new Error(
      `/api/auth/login: expected 200, received ${login.status}: ${await login.text()}`,
    );
  }
  for (const value of login.headers.getSetCookie()) {
    const pair = value.split(";", 1)[0]!;
    cookieJar.set(pair.slice(0, pair.indexOf("=")), pair);
  }
  cookie = [...cookieJar.values()].join("; ");
  if (!cookieJar.has("connect.sid")) {
    throw new Error("Offline login succeeded without a local session cookie.");
  }
  const csrf = await expectStatus("/api/security/csrf", 200);
  const token = await csrf.json() as { token?: string };
  if (!token.token) {
    throw new Error("Offline login succeeded without its CSRF token.");
  }
  csrfToken = token.token;
  return { sessionCookieCount: cookieJar.size, csrfTokenPresent: true };
});

await check("zero_vendor_runtime_home", true, async () => {
  if (!cookie) throw new Error("Authenticated session is unavailable.");
  const response = await expectStatus("/api/runtime/foundation", 200);
  const foundation = await response.json() as {
    home?: {
      mode?: string;
      egress?: { mode?: string; ruleCount?: number };
      profile?: Record<string, unknown>;
      conformance?: { conformant?: boolean; issues?: unknown[] };
    };
  };
  const home = foundation.home;
  if (!home) throw new Error("Runtime foundation did not expose the active Home snapshot.");
  if (home.mode !== "desktop_local") {
    throw new Error(`Expected desktop_local, got ${String(home.mode)}.`);
  }
  if (home.egress?.mode !== "offline") {
    throw new Error(`Expected LIOS_EGRESS_MODE=offline, got ${String(home.egress?.mode)}.`);
  }
  if (home.conformance?.conformant !== true) {
    throw new Error(
      `Home is not zero-vendor-runtime conformant: ${JSON.stringify(home.conformance?.issues ?? [])}`,
    );
  }

  const requiredProfile: Record<string, string> = {
    database: "lios.database.pglite",
    storage: "lios.storage.local-fs",
    execution: "lios.execution.local",
    identity: "lios.identity.local-session",
    license: "lios.license.signed-offline-lease",
    network: "lios.network.loopback",
  };
  for (const [slot, expected] of Object.entries(requiredProfile)) {
    const actual = home.profile?.[slot];
    if (actual !== expected) {
      throw new Error(`Offline target requires ${slot}=${expected}, got ${String(actual)}.`);
    }
  }
  return {
    mode: home.mode,
    egressMode: home.egress.mode,
    egressRuleCount: home.egress.ruleCount ?? 0,
    profile: requiredProfile,
    conformant: true,
  };
});

await check("local_project_chat_spine", true, async () => {
  if (!cookie) throw new Error("Authenticated session is unavailable.");
  let projectId: number | null = null;
  try {
    const projectResponse = await expectStatus("/api/projects", 200, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "SI-01.15 offline proof " + Date.now(),
        instructions: "Offline acceptance fixture; safe to remove.",
      }),
    });
    const project = await projectResponse.json() as { id?: number; name?: string };
    if (!Number.isInteger(project.id) || !project.id) {
      throw new Error("Offline Project creation returned no canonical Project id.");
    }
    projectId = project.id;

    const chatResponse = await expectStatus(`/api/projects/${projectId}/chats`, 200, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Offline proof chat" }),
    });
    const chat = await chatResponse.json() as { id?: number; projectId?: number; scope?: string };
    if (!Number.isInteger(chat.id) || chat.projectId !== projectId || chat.scope !== "project") {
      throw new Error("Offline Project Chat creation did not preserve canonical ownership/scope.");
    }

    const homeResponse = await expectStatus(`/api/projects/${projectId}/home`, 200);
    const home = await homeResponse.json() as {
      project?: { id?: number };
      chats?: Array<{ id?: number }>;
    };
    if (
      home.project?.id !== projectId ||
      !home.chats?.some((candidate) => candidate.id === chat.id)
    ) {
      throw new Error("Offline Project home did not persist the newly created Chat.");
    }
    return {
      projectId,
      chatId: chat.id,
      scope: chat.scope,
      persistedInProjectHome: true,
    };
  } finally {
    if (projectId) {
      await request(`/api/projects/${projectId}/trash`, { method: "POST" }).catch(() => undefined);
      await request(`/api/projects/${projectId}/permanent`, { method: "DELETE" }).catch(() => undefined);
    }
  }
});

await check("deterministic_personal_finance", true, async () => {
  if (!cookie) throw new Error("Authenticated session is unavailable.");
  const financeInput = {
    schemaVersion: "1",
    asOf: "2026-10-04",
    accounts: [
      { id: "cash", kind: "bank", balance: 100_000, currency: "INR" },
      { id: "loan", kind: "loan", balance: 20_000, currency: "INR" },
    ],
    transactions: [
      { id: "salary", at: "2026-09-20", amount: 50_000, category: "salary", accountId: "cash" },
      { id: "expense", at: "2026-09-25", amount: -10_000, category: "living", accountId: "cash" },
    ],
    debts: [],
    goals: [],
    retirement: null,
  };
  const response = await expectStatus("/api/finance/p6-personal-finance", 200, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(financeInput),
  });
  const finance = await response.json() as {
    engineId?: string;
    deterministic?: boolean;
    netWorth?: number;
    trailingMonthlyCashFlow?: number;
    inputHash?: string;
  };
  if (finance.engineId !== "lios.personal-finance.core-v1" || finance.deterministic !== true) {
    throw new Error(`Offline deterministic engine proof failed: ${JSON.stringify(finance)}`);
  }
  if (finance.netWorth !== 80_000 || finance.trailingMonthlyCashFlow !== 40_000) {
    throw new Error(`Offline deterministic result mismatch: ${JSON.stringify(finance)}`);
  }
  if (!/^[a-f0-9]{64}$/.test(finance.inputHash ?? "")) {
    throw new Error("Offline deterministic result did not include its reproducibility input hash.");
  }
  return {
    engineId: finance.engineId,
    netWorth: finance.netWorth,
    trailingMonthlyCashFlow: finance.trailingMonthlyCashFlow,
    inputHash: finance.inputHash,
  };
});

// The live single-process probe cannot truthfully prove restart/restore. Those
// are mandatory V1 integration suites in this workstream and are recorded here
// as an explicit non-live limitation rather than a fake pass.
checks.push({
  id: "restart_backup_restore_live",
  required: false,
  status: "unavailable",
  detail:
    "A single running HTTP process cannot prove app restart or backup restore; use the required session/journal/backup integration suites and SP-01 packaged restart journey.",
});

const evidence = buildOfflineV2Evidence({ baseUrl, checks });
const serialized = JSON.stringify(evidence, null, 2) + "\n";
process.stdout.write(serialized);

const evidencePath = process.env.LIOS_SI01_OFFLINE_EVIDENCE_PATH?.trim();
if (evidencePath) {
  const destination = path.resolve(evidencePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.writeFileSync(destination, serialized, { mode: 0o600 });
}

assertOfflineV2Accepted(evidence);
