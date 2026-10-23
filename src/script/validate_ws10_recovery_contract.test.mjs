import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const root = new URL("../client/src/", import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), "utf8");
const state = read("lib/asyncSurfaceState.ts");
const widget = read("components/terminal/AsyncSurfaceNotice.tsx");
const artifact = read("components/terminal/ArtifactPane.tsx");
const hook = read("lib/useArtifacts.ts");
const connections = read("pages/DataConnectionCenter.tsx");
const chat = read("components/terminal/ProjectExperienceShell.tsx");

test("WS-10 status taxonomy is query-derived and preserves displayed data", () => {
  for (const value of ['"loading"', '"ready"', '"signed_out"', '"denied"', '"missing"', '"failed"'])
    assert.ok(state.includes(value), "Missing read outcome " + value);
  assert.match(state, /if \(query\.hasData\) return "ready"/);
  assert.match(state, /if \(query\.isPending\) return "loading"/);
  assert.match(state, /if \(!query\.isError\) return "missing"/);
  assert.match(state, /status === 401/);
  assert.match(state, /status === 403/);
  assert.match(state, /status === 404 \|\| status === 410/);
});

test("WS-10 notice has actual status, restricted access and deliberate retry action", () => {
  assert.match(widget, /role=\{loading \? "status" : "alert"\}/);
  assert.match(widget, /aria-busy=\{loading \|\| retrying\}/);
  assert.match(widget, /data-read-state=\{state\}/);
  assert.match(widget, /disabled=\{retrying\}/);
  assert.match(widget, /state !== "denied"/);
  assert.match(widget, /onClick=\{onRetry\}/);
  assert.match(widget, /onClick=\{onLeave\}/);
});

test("WS-10 shared UI never exposes the backend body or bypasses custody", () => {
  assert.doesNotMatch(widget, /\{error\}|\{error\.message\}|onComplete|onSave|apiRequest|localStorage|fetch\(/);
  assert.match(widget, /The saved Artifact or requested revision cannot be found here/);
  assert.match(widget, /Your current account does not have access/);
  assert.match(widget, /no provider was connected, tested, or authorized/i);
});

test("WS-10 Artifact keeps HTTP status and shows specific retry/exit UI", () => {
  assert.ok(hook.includes('Artifact request failed.'), "Failed Artifact read must include HTTP status");
  assert.ok(hook.includes('res.status'), "HTTP status must not be erased");
  assert.match(artifact, /resolveAsyncSurfaceState\(\{ hasData: Boolean\(data\), isPending: detail\.isPending, isError: detail\.isError, error: detail\.error \}\)/);
  assert.match(artifact, /surface="artifact"/);
  assert.match(artifact, /onRetry=\{\(\) => \{ void detail\.refetch\(\); \}\}/);
  assert.match(artifact, /onLeave=\{onClose\}/);
  assert.doesNotMatch(artifact, /detail\.isLoading\?"Loading Artifact…":"Artifact unavailable\."/);
});

test("WS-10 Connections refuses empty success screen when setup service fails", () => {
  assert.match(connections, /const setupReadState = resolveAsyncSurfaceState/);
  assert.match(connections, /hasData: Boolean\(setupQuery\.data\) && !setupQuery\.isError/);
  assert.match(connections, /if \(setupReadState !== "ready"\)/);
  assert.match(connections, /surface="connections"/);
  assert.match(connections, /onRetry=\{\(\) => \{ void setupQuery\.refetch\(\); \}\}/);
  assert.match(connections, /onLeave=\{onLogout\}/);
});

test("WS-10 Chat preserves its existing recovery and stops leaking arbitrary raw failure bodies", () => {
  assert.match(chat, /shellLoadState === "loading"/);
  assert.match(chat, /shellLoadState === "error"/);
  assert.match(chat, /const shellErrorStatus = asyncSurfaceStatus\(shellError\)/);
  assert.match(chat, /shellErrorStatus === 401/);
  assert.match(chat, /shellErrorStatus === 403/);
  assert.doesNotMatch(chat, /shellError instanceof Error \? shellError\.message/);
  assert.match(chat, /Retry restore/);
});

test("WS-10 failed Chat retries never record a success event", () => {
  const area = chat.slice(chat.indexOf("const retryShell = async () =>"), chat.indexOf("const updateTransmissionPolicy ="));
  assert.match(area, /const results = await Promise\.all/);
  assert.match(area, /results\.some\(\(result\) => result && typeof result === "object" && "isError" in result && result\.isError\)/);
  assert.ok(area.indexOf('recordP1ShellEvent("shell_recovered")') > area.indexOf("results.some"));
});

test("WS-10 truth-level documentation keeps native acceptance unclaimed", () => {
  const doc = fs.readFileSync(new URL("../../docs/ux/LIOS_WS10_LOADING_DENIED_RECOVERY_2026-10-23.md", import.meta.url), "utf8");
  assert.match(doc, /200% zoom[\s\S]{0,65}NOT_RUN/);
  assert.match(doc, /VoiceOver[\s\S]{0,80}NOT_RUN/);
  for (const pr of ["#105","#102","#98"]) assert.ok(doc.includes(pr));
});
