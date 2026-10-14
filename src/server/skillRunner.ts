import type { SkillAdapter } from "@shared/runtimeContracts";
import type { RuntimeRegistry } from "@shared/runtimeRegistry";
import { invokeConversationTool } from "./conversationRuntime";
import type { GovernedToolCall } from "./governedTools";

/**
 * SI-02.16: a skill never executes anything itself. It can only name governed tools it declared, and every call goes
 * through the single governed tool registry, so the permission decision, GM-11a grants, cancellation and receipts are
 * exactly those of any other tool call. A skill chooses only a declared tool and its typed input: the trusted
 * `GovernedToolCall` (origin, tenant, Project, request, live authorization) is injected by the server/runtime boundary
 * through `trustedCall`, and nothing in skill data or in the invoking arguments can supply or widen it.
 */
export class SkillNotAvailableError extends Error {
  constructor(readonly skillId: string) {
    super(`Skill "${skillId}" is not installed.`);
    this.name = "SkillNotAvailableError";
  }
}

export class SkillToolNotDeclaredError extends Error {
  constructor(readonly skillId: string, readonly toolId: string) {
    super(`Skill "${skillId}" does not declare tool "${toolId}".`);
    this.name = "SkillToolNotDeclaredError";
  }
}

export type GovernedToolInvoker = (
  toolId: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
  call: GovernedToolCall,
) => Promise<unknown>;

export interface SkillRunner {
  /** Installed skill, or null. Presence in the registry means the P13 manager activated it as trusted. */
  getSkill(skillId: string): SkillAdapter | null;
  invokeSkillTool(input: {
    skillId: string;
    toolId: string;
    input: Record<string, unknown>;
    signal: AbortSignal;
  }): Promise<unknown>;
}

function isSkillAdapter(adapter: ReturnType<RuntimeRegistry["get"]>): adapter is SkillAdapter {
  return adapter !== null && adapter.descriptor.kind === "skill" && "definition" in adapter;
}

export function createSkillRunner(
  registry: RuntimeRegistry,
  /** Server-owned: builds the trusted call for this run at the moment of invocation (e.g. `createConversationToolCall`). */
  trustedCall: (toolId: string) => GovernedToolCall,
  invokeTool: GovernedToolInvoker = invokeConversationTool,
): SkillRunner {
  const getSkill = (skillId: string): SkillAdapter | null => {
    const adapter = registry.get(skillId);
    return isSkillAdapter(adapter) ? adapter : null;
  };
  return {
    getSkill,
    async invokeSkillTool({ skillId, toolId, input, signal }) {
      const skill = getSkill(skillId);
      if (!skill) throw new SkillNotAvailableError(skillId);
      if (!skill.definition.toolIds.includes(toolId)) throw new SkillToolNotDeclaredError(skillId, toolId);
      return invokeTool(toolId, input, signal, trustedCall(toolId));
    },
  };
}
