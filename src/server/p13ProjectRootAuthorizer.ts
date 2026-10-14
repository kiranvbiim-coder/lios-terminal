import fs from "node:fs";
import path from "node:path";
import type { RuntimeExecutionContext } from "@shared/runtimeContracts";
import { dataPath } from "./dataRoot";
import { getProject } from "./projectStore";
import type { P13PluginFileReadAuthorizer } from "./p13PluginHost";
import type { TenantContext } from "./tenantContext";

/**
 * The one server-owned filesystem root a Project's plugins may read.
 *
 * It is derived only from authenticated identifiers (never from a plugin, a request body or a user-supplied path):
 * `<data root>/project-workspaces/<organizationId>/<projectId>`. Organization is part of the path so two tenants can
 * never share a directory even if Project ids were ever reused.
 */
export function projectWorkspaceRoot(organizationId: number, projectId: number): string {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 || !Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new Error("A Project workspace root requires positive organization and Project ids.");
  }
  return dataPath("project-workspaces", String(organizationId), String(projectId));
}

/** Creates the root owner-only if it does not exist and returns its real path. */
export function ensureProjectWorkspaceRoot(organizationId: number, projectId: number): string {
  const root = projectWorkspaceRoot(organizationId, projectId);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return fs.realpathSync.native(root);
}

export interface ProjectRootAuthorizerDependencies {
  /** Defaults to the canonical tenant-scoped Project lookup; injectable for tests only. */
  getProject?: (ctx: TenantContext, id: number) => Promise<unknown>;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function sameDirectory(left: string, right: string): boolean {
  try {
    return fs.realpathSync.native(left) === fs.realpathSync.native(right);
  } catch {
    return false;
  }
}

/**
 * Production {@link P13PluginFileReadAuthorizer}. It is evaluated by the broker before every read and again before the
 * bytes are returned, so revocation takes effect on the next call and mid-read:
 *
 * - only the `project` scope with root index 0 is ever allowed (user-selected roots stay denied);
 * - the execution context must carry positive user, organization and Project ids;
 * - the Project must still exist for exactly that user and organization and must not be in the trash;
 * - the root the plugin was granted must be the canonical workspace of that same organization and Project, by real
 *   path, so a symlinked or swapped directory cannot widen it.
 */
export function createProjectRootFileReadAuthorizer(
  dependencies: ProjectRootAuthorizerDependencies = {},
): P13PluginFileReadAuthorizer {
  const lookup = dependencies.getProject ?? getProject;
  return async ({ context, scope, root, rootIndex }: {
    context: RuntimeExecutionContext;
    scope: "project" | "user_selected";
    root: string;
    rootIndex: number;
  }) => {
    if (scope !== "project" || rootIndex !== 0) return false;
    const { userId, organizationId, projectId } = context;
    if (!positiveInteger(userId) || !positiveInteger(organizationId) || !positiveInteger(projectId)) return false;
    if (!path.isAbsolute(root)) return false;
    try {
      // The role never widens ownership: getProject filters on exact owner and organization.
      await lookup({ userId, organizationId, role: "internal_analyst" }, projectId);
    } catch {
      return false;
    }
    return sameDirectory(root, projectWorkspaceRoot(organizationId, projectId));
  };
}
