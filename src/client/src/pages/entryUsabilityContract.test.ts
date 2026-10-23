import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const login = readFileSync(new URL("./Login.tsx", import.meta.url), "utf8");
const notFound = readFileSync(new URL("./not-found.tsx", import.meta.url), "utf8");

/** Source contract only; actual browser focus, zoom and AT testing is still required. */
test("sign-in and registration fields have stable associated labels and autocomplete", () => {
  const tick = String.fromCharCode(96);
  for (const id of ["name", "organization", "email", "password", "confirm"]) {
    const marker = tick + "$" + "{formId}-" + id + tick;
    assert.ok(login.includes("htmlFor={" + marker + "}"), "Missing associated label for " + id);
    assert.ok(login.includes("id={" + marker + "}"), "Missing input ID for " + id);
  }
  for (const token of ['autoComplete="name"', 'autoComplete="organization"', 'autoComplete="email"', 'autoComplete="new-password"', '"current-password"']) {
    assert.ok(login.includes(token), "Missing autofill semantics " + token);
  }
  assert.match(login, /role="alert"/);
  assert.match(login, /min-h-11/);
  assert.match(login, /text-sm/);
  // Authentication and entitlement checks must stay in the original owner functions.
  for (const action of ["handleLogin", "handleRegister", "handleEnterpriseSso"]) {
    assert.ok(login.includes(action), "Original auth flow missing: " + action);
  }
});

test("unknown route gives a LiOS-themed explanation and safe route back to Chat", () => {
  assert.match(notFound, /aria-labelledby=/);
  assert.match(notFound, /Back to LiOS Chat/);
  assert.match(notFound, /href="#\/"/);
  assert.doesNotMatch(notFound, /Did you forget to add the page to the router/);
  assert.doesNotMatch(notFound, /bg-gray-50/);
});
