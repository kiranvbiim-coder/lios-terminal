import assert from "node:assert/strict";
import test from "node:test";
import { DATABASE_FAILURE_MESSAGE, userSafeErrorMessage } from "./safeErrorMessage";

test("database driver errors never expose SQL, parameters or identifiers", () => {
  const raw = new Error('Failed query: insert into "project_ledger_stream_heads" ("stream_id") values ($1) on conflict do nothing\nparams: chat:75,,75,100,67,1');
  assert.equal(userSafeErrorMessage(raw, "x"), DATABASE_FAILURE_MESSAGE);
  const wrapped = new Error("Request failed", { cause: new Error('insert or update on table "t" violates foreign key constraint "fk"') });
  assert.equal(userSafeErrorMessage(wrapped, "x"), DATABASE_FAILURE_MESSAGE);
  assert.equal(userSafeErrorMessage(new Error('relation "project_ledger_events" does not exist'), "x"), DATABASE_FAILURE_MESSAGE);
});

test("ordinary product errors pass through unchanged", () => {
  assert.equal(userSafeErrorMessage(new Error("Project not found."), "x"), "Project not found.");
  assert.equal(userSafeErrorMessage(new Error("Conversation execution exceeded its bounded runtime budget."), "x"), "Conversation execution exceeded its bounded runtime budget.");
  assert.equal(userSafeErrorMessage(undefined, "fallback"), "fallback");
  assert.equal(userSafeErrorMessage("", "fallback"), "fallback");
});
