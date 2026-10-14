import assert from "node:assert/strict";
import test from "node:test";

import { getLifecycleMenuItems } from "./objectLifecycleMenu";

test("menu items filter unsupported actions without changing lifecycle order", () => {
  const items = getLifecycleMenuItems(
    { kind: "artifact", status: "active", pinned: false },
    { hidden: ["compare", "export", "delete"] },
  );

  assert.deepEqual(items.map((item) => item.id), ["open", "rename", "fork", "archive"]);
});

test("menu items preserve a disabled reason for policy-blocked actions", () => {
  const items = getLifecycleMenuItems(
    { kind: "project", status: "active", pinned: false },
    { disabled: { share: "Sharing is disabled for this Project." } },
  );

  const share = items.find((item) => item.id === "share");
  assert.equal(share?.disabledReason, "Sharing is disabled for this Project.");
});
