import assert from "node:assert/strict";
import test from "node:test";

import {
  getLifecycleActions,
  lifecycleActionSchema,
  lifecycleObjectKindSchema,
} from "./objectLifecycle";

test("project actions keep reversible organization ahead of destructive actions", () => {
  const actions = getLifecycleActions({ kind: "project", status: "active", pinned: false });

  assert.deepEqual(actions.map((action) => action.id), [
    "rename",
    "pin",
    "share",
    "archive",
    "delete",
  ]);
  assert.equal(actions.at(-1)?.danger, true);
});

test("temporary chats expose promotion before archive or delete", () => {
  const actions = getLifecycleActions({ kind: "chat", scope: "temporary", status: "active", pinned: false });

  assert.deepEqual(actions.map((action) => action.id), [
    "save_to_project",
    "rename",
    "pin",
    "delete",
  ]);
});

test("project chats expose pin state alongside rename and archive", () => {
  const pinned = getLifecycleActions({ kind: "chat", scope: "project", status: "active", pinned: true });

  assert.deepEqual(pinned.map((action) => action.id), ["rename", "unpin", "branch", "archive", "delete"]);
});

test("archived artifacts expose restore and permanent delete only", () => {
  const actions = getLifecycleActions({ kind: "artifact", status: "archived", pinned: false });

  assert.deepEqual(actions.map((action) => action.id), ["restore", "delete"]);
  assert.equal(actions[1].danger, true);
});

test("lifecycle schemas reject unsupported object and action identifiers", () => {
  assert.equal(lifecycleObjectKindSchema.safeParse("widget").success, false);
  assert.equal(lifecycleActionSchema.safeParse("publish_everywhere").success, false);
});
