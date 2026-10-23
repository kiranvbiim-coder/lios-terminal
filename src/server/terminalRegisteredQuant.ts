import { terminalExecutionTargetSchema } from "@shared/terminalArtifact";
import type { TenantContext } from "./tenantContext";
import { validateTerminalExecutionTarget } from "./terminalArtifactTool";
import { executeRegisteredPythonQuant } from "./advancedQuantExecution";
import { createTerminalArtifactEngineVersion } from "./artifactStore";

export class TerminalQuantTargetError extends Error {
  constructor(message: string, public readonly status: 400 | 409 = 409) { super(message); this.name = "TerminalQuantTargetError"; }
}
/** No substitute model: the original HTTP route supplies its own parsed numerical body. */
export async function executeOriginalTerminalQuant(ctx: TenantContext, rawTarget: unknown, route: string, apiEndpoint: string, parameters: Record<string, unknown>) {
  const parsed = terminalExecutionTargetSchema.safeParse(rawTarget);
  if (!parsed.success) throw new TerminalQuantTargetError("Invalid exact terminal execution target.", 400);
  const target = parsed.data;
  try { await validateTerminalExecutionTarget(ctx, target, new AbortController().signal); }
  catch (error) { throw new TerminalQuantTargetError(error instanceof Error ? error.message : "The selected terminal target is no longer current."); }
  const execution = await executeRegisteredPythonQuant(route, apiEndpoint, parameters, ctx.userId);
  let version;
  try { version = await createTerminalArtifactEngineVersion(ctx, target, execution); }
  catch (error) { throw new TerminalQuantTargetError(`The original engine completed but its result was not retained: ${error instanceof Error ? error.message : "terminal target changed"}`); }
  return { ...execution.response, terminalArtifact: { artifactId: version.artifactId, baseVersion: target.baseVersion, version: version.version, contentHash: version.contentHash } };
}
