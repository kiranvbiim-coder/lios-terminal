import { z } from "zod";

export const lifecycleObjectKindSchema = z.enum([
  "project",
  "chat",
  "source",
  "artifact",
  "session",
  "decision",
  "monitor",
]);
export type LifecycleObjectKind = z.infer<typeof lifecycleObjectKindSchema>;

export const lifecycleActionSchema = z.enum([
  "open",
  "rename",
  "pin",
  "unpin",
  "move",
  "save_to_project",
  "share",
  "branch",
  "fork",
  "compare",
  "export",
  "archive",
  "restore",
  "delete",
  "delete_permanently",
]);
export type LifecycleAction = z.infer<typeof lifecycleActionSchema>;

export const lifecycleStatusSchema = z.enum(["active", "archived", "trashed"]);
export type LifecycleStatus = z.infer<typeof lifecycleStatusSchema>;

export const lifecycleScopeSchema = z.enum(["project", "quick", "temporary"]);
export type LifecycleScope = z.infer<typeof lifecycleScopeSchema>;

export interface LifecycleTarget {
  kind: LifecycleObjectKind;
  status: LifecycleStatus;
  pinned?: boolean;
  scope?: LifecycleScope;
}

export interface LifecycleActionDescriptor {
  id: LifecycleAction;
  label: string;
  danger?: boolean;
}

const descriptor = (
  id: LifecycleAction,
  label: string,
  danger = false,
): LifecycleActionDescriptor => ({ id, label, ...(danger ? { danger: true } : {}) });

function activeActions(target: LifecycleTarget): LifecycleActionDescriptor[] {
  if (target.kind === "project") {
    return [
      descriptor("rename", "Rename"),
      descriptor(target.pinned ? "unpin" : "pin", target.pinned ? "Unpin" : "Pin"),
      descriptor("share", "Share"),
      descriptor("archive", "Archive"),
      descriptor("delete", "Move to Trash", true),
    ];
  }

  if (target.kind === "chat") {
    const actions: LifecycleActionDescriptor[] = [];
    if (target.scope === "temporary" || target.scope === "quick") {
      actions.push(descriptor("save_to_project", "Save to Project"));
    }
    actions.push(descriptor("rename", "Rename"));
    actions.push(descriptor(target.pinned ? "unpin" : "pin", target.pinned ? "Unpin" : "Pin"));
    if (target.scope !== "temporary") actions.push(descriptor("branch", "Branch"));
    if (target.scope !== "temporary") actions.push(descriptor("archive", "Archive"));
    actions.push(descriptor("delete", "Move to Trash", true));
    return actions;
  }

  if (target.kind === "artifact") {
    return [
      descriptor("open", "Open"),
      descriptor("rename", "Rename"),
      descriptor("fork", "Fork"),
      descriptor("compare", "Compare"),
      descriptor("export", "Export"),
      descriptor("archive", "Archive"),
      descriptor("delete", "Move to Trash", true),
    ];
  }

  if (target.kind === "session") {
    return [
      descriptor("rename", "Rename"),
      descriptor("fork", "Fork"),
      descriptor("compare", "Compare"),
      descriptor("archive", "Archive"),
      descriptor("delete", "Move to Trash", true),
    ];
  }

  if (target.kind === "source") {
    return [
      descriptor("rename", "Rename"),
      descriptor("share", "Share"),
      descriptor("archive", "Archive"),
      descriptor("delete", "Remove", true),
    ];
  }

  return [
    descriptor("rename", "Rename"),
    descriptor("share", "Share"),
    descriptor("archive", "Archive"),
    descriptor("delete", "Move to Trash", true),
  ];
}

export function getLifecycleActions(target: LifecycleTarget): LifecycleActionDescriptor[] {
  lifecycleObjectKindSchema.parse(target.kind);
  lifecycleStatusSchema.parse(target.status);
  if (target.scope !== undefined) lifecycleScopeSchema.parse(target.scope);

  if (target.status === "archived") {
    return [descriptor("restore", "Restore"), descriptor("delete", "Move to Trash", true)];
  }

  if (target.status === "trashed") {
    return [descriptor("restore", "Restore"), descriptor("delete_permanently", "Delete permanently", true)];
  }

  return activeActions(target);
}
