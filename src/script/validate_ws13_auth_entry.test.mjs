import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../client/src/", import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), "utf8");
const login = read("pages/Login.tsx");
const app = read("App.tsx");
const preview = read("pages/PublicProductPreview.tsx");
const lifecycle = read("lib/sessionLifecycle.ts");
const policy = read("lib/authEntryState.ts");

test("WS-13 original App routes signed-in sessions directly to the single Terminal/Chat", () => {
  assert.match(app, /const terminal = <Terminal session=\{session\}/);
  assert.match(app, /<Route path="\/">\{terminal\}<\/Route>/);
  assert.match(app, /<Route path="\/p\/\*">\{terminal\}<\/Route>/);
  assert.match(app, /<Route path="\/c\/\*">\{terminal\}<\/Route>/);
  assert.match(app, /<PublicProductPreview onLoginSuccess=/);
  assert.match(preview, /<Login onLoginSuccess=\{onLoginSuccess\}/);
});

test("WS-13 session restoration remains fail closed and distinguishes explicit 401 vs unavailable", () => {
  assert.match(app, /restoreSession<SessionData>\("\/api\/auth\/me", \{ signal: controller\.signal \}\)/);
  assert.match(app, /if \(sessionError\)/);
  assert.match(app, /Retry opening LiOS/);
  assert.match(lifecycle, /if \(response\.status === 401\) return null/);
  assert.match(lifecycle, /if \(!response\.ok\) throw new Error/);
  assert.match(app, /session && session\.mustChangePassword/);
});

test("WS-13 first-run security refuses unknown setup state and offers a real retry", () => {
  assert.match(login, /const \[bootstrapError, setBootstrapError\] = useState\(false\)/);
  assert.match(login, /authEntryFetch\("\/api\/auth\/bootstrap\/status"/);
  assert.match(login, /typeof data\?\.setupRequired !== "boolean" \|\| typeof data\?\.setupAllowed !== "boolean"/);
  assert.match(login, /setBootstrapError\(true\)/);
  assert.doesNotMatch(login, /setBootstrapStatus\(\{ setupRequired: false, setupAllowed: false, mode: null \}\)/);
  assert.match(login, /if \(bootstrapStatus === null\)/);
  assert.match(login, /onClick=\{\(\) => setBootstrapRetry\(\(value\) => value \+ 1\)\}/);
  assert.match(login, /<FirstRunAdminSetup onComplete=\{onLoginSuccess\}/);
});

test("WS-13 no simulated handshake, no fabricated progress percentage, no delayed success", () => {
  assert.doesNotMatch(login, /simulateHandshake|setProgressVal|<Progress|setTimeout\(\(\) => \{\s*onLoginSuccess/);
  assert.match(login, /setStatusText\(\["Credentials accepted\. Verifying your saved session/);
  assert.match(login, /setStatusText\(\["Account request accepted\. Verifying your session/);
  assert.match(login, /setStatusText\(\["Organization approval confirmed\. Verifying your session/);
  assert.match(login, /role="status" aria-live="polite"/);
});

test("WS-13 sign-in, SSO and registration all require fresh server-verified identity", () => {
  assert.equal((login.match(/verifiedEntrySession<SessionData>\(\)/g) ?? []).length, 3);
  assert.equal((login.match(/onLoginSuccess\(session\)/g) ?? []).length, 3);
  assert.equal((login.match(/if \(authPending\.current\) return/g) ?? []).length, 3);
  assert.equal((login.match(/authPending\.current = true/g) ?? []).length, 3);
  assert.equal((login.match(/authPending\.current = false/g) ?? []).length, 3);
  assert.match(policy, /restoreSession<T>\("\/api\/auth\/me", options\)/);
});

test("WS-13 never renders unsanitized auth backend error or unverified license promises", () => {
  assert.doesNotMatch(login, /setErrorMsg\((?:data|sessionData|poll|authorization)\.error/);
  assert.doesNotMatch(login, /7-Day Pro|7-day Pro|14-day access|setTimeout\(\(\) => onLoginSuccess/);
  assert.match(login, /authEntryErrorMessage\("signin", response\.status, body\?\.reason\)/);
  assert.match(login, /authEntryErrorMessage\("register", response\.status, body\?\.reason\)/);
  assert.match(login, /safeSsoVerificationUrl\(authorization\?\.verificationUrl\)/);
  assert.match(login, /Start free trial/);
});

test("WS-13 each auth network stage is a real bounded request, no new credential store", () => {
  assert.match(login, /authEntryFetch\("\/api\/auth\/login"/);
  assert.match(login, /authEntryFetch\("\/api\/auth\/register"/);
  assert.match(login, /authEntryFetch\("\/api\/client\/auth\/sso\/device\/start"/);
  assert.match(login, /authEntryFetch\("\/api\/client\/auth\/sso\/device\/poll"/);
  assert.match(policy, /Promise\.race\(/);
  assert.match(policy, /controller\.abort\(\)/);
  assert.doesNotMatch(policy + login, /localStorage\.setItem|sessionStorage\.setItem/);
});

test("WS-13 evidence boundaries and existing entry-PR ownership remain explicit", () => {
  const evidence = fs.readFileSync(new URL("../../docs/ux/LIOS_WS13_AUTH_ENTRY_JOURNEY_2026-10-23.md", import.meta.url), "utf8");
  assert.match(evidence, /#99/);
  assert.match(evidence, /#91/);
  assert.match(evidence, /200% zoom[\s\S]{0,100}NOT_RUN/);
  assert.match(evidence, /VoiceOver\/Narrator[\s\S]{0,100}NOT_RUN/);
});
