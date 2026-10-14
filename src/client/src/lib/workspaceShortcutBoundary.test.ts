import assert from "node:assert/strict";
import test from "node:test";
import { canHandleWorkspaceShortcut } from "./workspaceShortcutBoundary";

const visible = { querySelector: () => null } as Pick<Document, "querySelector">;
const hidden = { querySelector: () => ({}) } as Pick<Document, "querySelector">;
const event = (target: EventTarget | null = null, defaultPrevented = false) => ({ target, defaultPrevented });

test("contextual setup suspends preserved workspace shortcuts", () => {
  assert.equal(canHandleWorkspaceShortcut(event(), hidden), false);
  assert.equal(canHandleWorkspaceShortcut(event(), visible), true);
});

test("modal typing cannot activate the underlying workspace", () => {
  const modalTarget = { closest: () => ({}) } as unknown as EventTarget;
  const workspaceTarget = { closest: () => null } as unknown as EventTarget;
  assert.equal(canHandleWorkspaceShortcut(event(modalTarget), visible), false);
  assert.equal(canHandleWorkspaceShortcut(event(workspaceTarget), visible), true);
});

test("handled events remain handled and non-element targets remain safe", () => {
  assert.equal(canHandleWorkspaceShortcut(event(null, true), visible), false);
  assert.equal(canHandleWorkspaceShortcut(event({} as EventTarget), visible), true);
});
