/** Fixed Browser Runtime Pack worker executed inside the deny-network sandbox. */
export const BROWSER_RUNTIME_WORKER_SOURCE = String.raw`
"use strict";
const readline = require("node:readline");
const protocol = "lios-browser-broker/1";
const modulePath = process.argv[1];
const executablePath = process.argv[2];
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_INPUT_LINE_BYTES = 4 * 1024 * 1024;
const MAX_NETWORK_REQUESTS = 64;
const MAX_TEXT_BYTES = 32 * 1024;
const MAX_LINKS = 200;
let browser;
let page;
let networkSequence = 0;
let networkRequests = 0;
let commandTail = Promise.resolve();
const pendingNetwork = new Map();

function safeText(value, maxBytes) {
  const bytes = Buffer.from(String(value));
  if (bytes.byteLength <= maxBytes) return bytes.toString("utf8");
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0b11000000) === 0b10000000) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

function send(frame) {
  const line = JSON.stringify(frame);
  if (Buffer.byteLength(line) > MAX_FRAME_BYTES) {
    process.stdout.write(JSON.stringify({ protocol, kind: "fatal", code: "frame_too_large" }) + "\n");
    return;
  }
  process.stdout.write(line + "\n");
}

function filteredHeaders(headers) {
  const output = {};
  let count = 0;
  for (const [name, value] of Object.entries(headers)) {
    if (count >= 100) break;
    if (/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|host|content-length|connection|proxy-connection|transfer-encoding|upgrade|expect|te|trailer|keep-alive)$/i.test(name)) continue;
    if (!/^[A-Za-z0-9-]+$/.test(name) || /[\r\n]/.test(String(value))) continue;
    output[name] = safeText(value, 8192);
    count += 1;
  }
  return output;
}

function requestNetwork(request) {
  if (++networkRequests > MAX_NETWORK_REQUESTS) return Promise.reject(new Error("network_request_limit"));
  const requestId = "network-" + (++networkSequence);
  const completion = Promise.withResolvers();
  pendingNetwork.set(requestId, completion);
  Promise.resolve(request.allHeaders()).then((headers) => {
    send({ protocol, kind: "network.request", requestId, url: request.url(), method: request.method(), headers: filteredHeaders(headers) });
  }, completion.reject);
  return completion.promise.finally(() => pendingNetwork.delete(requestId));
}

async function routeRequest(route) {
  const request = route.request();
  if (!/^https:\/\//i.test(request.url()) || !["GET", "HEAD"].includes(request.method())) {
    await route.abort("blockedbyclient").catch(() => undefined);
    return;
  }
  try {
    const response = await requestNetwork(request);
    await route.fulfill({ status: response.status, headers: response.headers, body: Buffer.from(response.bodyBase64, "base64") });
  } catch {
    await route.abort("failed").catch(() => undefined);
  }
}

async function extract(input) {
  const selector = typeof input.selector === "string" && input.selector ? input.selector : "body";
  const locator = page.locator(selector).first();
  if (input.kind === "links") {
    return locator.locator("a[href]").evaluateAll((elements, maximum) => elements.slice(0, maximum).map((element) => ({
      text: (element.textContent || "").trim().slice(0, 500),
      href: element.href.slice(0, 4000),
    })), MAX_LINKS);
  }
  const text = await locator.innerText({ timeout: 5000 });
  if (input.kind === "json") {
    if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new Error("extraction_too_large");
    return JSON.parse(text);
  }
  return { text: safeText(text, MAX_TEXT_BYTES) };
}

async function command(frame) {
  if (frame.method === "navigate") {
    networkRequests = 0;
    await page.goto(frame.url, { waitUntil: "domcontentloaded", timeout: frame.timeoutMs });
    return { url: page.url() };
  }
  if (frame.method === "extract") return extract(frame.input || {});
  if (frame.method === "shutdown") {
    await browser.close();
    browser = undefined;
    return { closed: true };
  }
  throw new Error("unknown_command");
}

function receive(frame) {
  if (!frame || frame.protocol !== protocol || typeof frame.kind !== "string") return;
  if (frame.kind === "network.response" || frame.kind === "network.error") {
    const pending = pendingNetwork.get(frame.requestId);
    if (!pending) return;
    if (frame.kind === "network.response") pending.resolve(frame);
    else pending.reject(new Error("broker_request_failed"));
    return;
  }
  if (frame.kind !== "command" || typeof frame.requestId !== "string") return;
  commandTail = commandTail.then(async () => {
    try {
      const result = await command(frame);
      send({ protocol, kind: "command.result", requestId: frame.requestId, result });
      if (frame.method === "shutdown") setImmediate(() => process.exit(0));
    } catch (error) {
      const code = error && typeof error.message === "string" && /^[a-z0-9_]+$/.test(error.message) ? error.message : "command_failed";
      send({ protocol, kind: "command.error", requestId: frame.requestId, code });
    }
  });
}

async function shutdown() {
  try { await browser?.close(); } catch {}
}

(async () => {
  if (!modulePath || !executablePath || !modulePath.startsWith("/") || !executablePath.startsWith("/")) throw new Error("runtime_pack_paths_invalid");
  const playwright = require(modulePath);
  if (!playwright || !playwright.chromium) throw new Error("playwright_runtime_unavailable");
  browser = await playwright.chromium.launch({ executablePath, headless: true, args: ["--disable-dev-shm-usage"] });
  const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block" });
  await context.route("**/*", routeRequest);
  page = await context.newPage();
  context.on("page", (candidate) => { if (candidate !== page) void candidate.close().catch(() => undefined); });
  page.on("download", (download) => void download.cancel().catch(() => undefined));
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (Buffer.byteLength(line) > MAX_INPUT_LINE_BYTES) {
      send({ protocol, kind: "fatal", code: "input_frame_too_large" });
      void shutdown().finally(() => process.exit(1));
      return;
    }
    try { receive(JSON.parse(line)); } catch {
      send({ protocol, kind: "fatal", code: "invalid_json" });
      void shutdown().finally(() => process.exit(1));
    }
  });
  send({ protocol, kind: "ready" });
})().catch((error) => {
  const code = error && typeof error.message === "string" && /^[a-z0-9_]+$/.test(error.message) ? error.message : "runtime_pack_unavailable";
  send({ protocol, kind: "fatal", code });
  void shutdown().finally(() => process.exit(1));
});
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(143)));
process.once("SIGINT", () => void shutdown().finally(() => process.exit(130)));
`;
