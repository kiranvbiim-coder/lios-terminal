import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(clientRoot, "App.tsx"), "utf8");
const preview = fs.readFileSync(path.join(clientRoot, "pages", "PublicProductPreview.tsx"), "utf8");
const login = fs.readFileSync(path.join(clientRoot, "pages", "Login.tsx"), "utf8");
const serverRoot = path.resolve(clientRoot, "..", "..", "server");
const publicRoutes = fs.readFileSync(path.join(serverRoot, "publicRoutes.ts"), "utf8");

test("signed-out LiOS renders a public product preview, not an executable guest terminal", () => {
  assert.ok(app.includes("PublicProductPreview"), "signed-out app must render the public product preview");
  assert.equal(app.includes("GuestConversationHome"), false, "guest execution shell must not remain an entry path");
  assert.ok(!app.includes("PersonaOnboarding"), "persona onboarding must not block authenticated first value");
  assert.ok(!app.includes("environmentSetupNeeded"), "environment setup must not become a startup gate");
  assert.ok(app.includes('managementView === "connections" && session && <DataConnectionCenter embedded'), "Connection Center must remain authenticated and contextual after sign-in");
  assert.ok(app.includes("data-lios-workspace hidden={domainPickerOpen}"), "Connection setup must not hide or remount the authenticated conversation");
});

test("public demo is illustrative while real product actions remain authentication-gated", () => {
  for (const copy of [
    "OPEN APP",
    "DEMO DATA",
    "EXAMPLE CONNECTIONS · DEMO",
    "Not a live calculation or source receipt",
  ]) {
    assert.ok(preview.replace(/\s+/g, " ").includes(copy), "public preview missing contract copy: " + copy);
  }
  assert.ok(preview.includes("const requireSignIn = () =>"), "preview actions must converge on sign-in");
  assert.ok(preview.includes("const requireRegistration = () =>"), "public create-account actions must open registration explicitly");
  assert.ok(preview.includes('initialMode={loginMode}'), "preview must pass the selected auth mode into the login surface");
  for (const plan of ["Trial", "Starter", "Pro", "Enterprise"]) {
    assert.ok(preview.includes(plan), "public preview must expose the plan family: " + plan);
  }
  assert.equal(preview.includes("/api/public/research/quick"), false, "preview must not call the retired guest research route");
  assert.equal(preview.includes("fetch("), false, "preview must not execute network research/data calls");
});

test("anonymous server surface cannot execute LiOS research, AI, data or engines", () => {
  assert.ok(publicRoutes.includes("/api/public/leads"), "explicit lead capture remains allowed");
  for (const forbidden of ["/api/public/research/quick", "runGuestPublicResearch", "guestResearchRequestSchema"]) {
    assert.equal(publicRoutes.includes(forbidden), false, "anonymous execution path reintroduced: " + forbidden);
  }
});

test("interactive login preserves the internal/client audience boundary", () => {
  assert.ok(app.includes("const acceptSession"), "session restore and interactive login must share one role-routing guard");
  assert.ok(app.includes("setAudienceFromRole"), "the accepted session role must select the runtime audience");
  assert.ok(app.includes("onLoginSuccess={(nextSession) => { acceptSession(nextSession); }}"), "preview login must use the guarded session acceptance path");
});


test("authentication surface accepts the explicit preview intent without bypassing the auth boundary", () => {
  assert.ok(login.includes('initialMode?: "signin" | "register"'), "login surface must expose a typed initial auth mode");
  assert.ok(login.includes("useState<\"signin\" | \"register\">(initialMode)"), "one login page serves sign-in and trial registration");
  assert.ok(login.includes("Sign in and continue directly where your work left off."), "sign-in copy must preserve the returning-workspace intent");
  assert.ok(login.includes("lios-reference-login"), "authentication should retain the supplied reference visual style.");
});


test("public marketing entry is singular and cannot bypass the auth-aware app shell", () => {
  assert.equal(app.includes('window.location.hash === "#/experience"'), false, "legacy Experience Center hash must not bypass the session boundary");
  assert.equal(app.includes('import ExperienceCenter'), false, "App must not mount a second public entry surface");
});

