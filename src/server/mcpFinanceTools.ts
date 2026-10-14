import type { CalculationJob } from "@shared/schema";
import { z } from "zod";
import {
  FACTOR_RISK_CALCULATION_KIND,
  SCENARIO_PIPELINE_CALCULATION_KIND,
} from "./calculationJobRunners";
import {
  enqueueCalculationJob,
  getCalculationJob,
  type CalculationJobOwner,
  type CalculationJobScope,
} from "./calculationJobService";
import { factorRiskSnapshotRequestSchema } from "./factorRiskRoutes";
import type { MCPGovernedToolDescriptor, MCPInvocationContext, MCPToolHandler } from "./mcpTransport";
import { scenarioPipelineRequestSchema } from "./scenarioPipeline";

export const FINANCE_MCP_TOOL_IDS = [
  "lios.factor_risk_capture",
  "lios.scenario_pipeline",
  "lios.calculation_job",
] as const;

export const FINANCE_MCP_COMPUTE_TOOL_IDS = [
  "lios.factor_risk_capture",
  "lios.scenario_pipeline",
] as const;

const calculationJobLookupSchema = z.object({
  jobId: z.string().uuid(),
}).strict();

const outputSchema = z.unknown();

const FINANCE_ANALYST_ROLES = ["internal_admin", "internal_analyst"] as const;
const FINANCE_JOB_READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;

function financeDescriptor(input: {
  id: (typeof FINANCE_MCP_TOOL_IDS)[number];
  label: string;
  inputSchema: MCPGovernedToolDescriptor["inputSchema"];
  access: "read" | "write";
  sideEffect: "none" | "internal_write";
  replaySafe: boolean;
  allowedRoles: readonly string[];
}): MCPGovernedToolDescriptor {
  return {
    id: input.id,
    label: input.label,
    kind: "mcp",
    permissionClass: input.access === "write" ? "user_confirm" : "safe_auto",
    allowedRoles: input.allowedRoles,
    access: input.access,
    sideEffect: input.sideEffect,
    replaySafe: input.replaySafe,
    inputSchema: input.inputSchema,
    outputSchema,
    maxOutputBytes: 256 * 1024,
    cancel: null,
  };
}

export interface FinanceMCPDependencies {
  enqueueCalculationJob: (
    kind: string,
    input: unknown,
    owner: CalculationJobOwner,
  ) => Promise<CalculationJob>;
  getCalculationJob: (
    id: string,
    scope: CalculationJobScope,
  ) => Promise<CalculationJob | null>;
}

const defaultDependencies: FinanceMCPDependencies = {
  enqueueCalculationJob: (kind, input, owner) => enqueueCalculationJob(kind, input, owner),
  getCalculationJob,
};

function ownerFromContext(context: MCPInvocationContext): CalculationJobOwner {
  return {
    userId: context.userId,
    organizationId: context.organizationId,
  };
}

function scopeFromContext(context: MCPInvocationContext): CalculationJobScope {
  // MCP deliberately never widens to organization scope. Even compliance
  // callers can only inspect their own calculation jobs through this tool.
  return {
    userId: context.userId,
    organizationId: context.organizationId,
  };
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Safe MCP projection of a durable calculation job. Worker leases, owner IDs,
 * retry internals, and raw inputs remain server-side; deterministic results
 * and lifecycle timestamps are enough for an AI orchestrator to continue the
 * workflow without gaining extra tenant or operational visibility.
 */
export function financeMCPJobView(job: CalculationJob) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    progressPct: job.progressPct,
    result: job.result,
    error: job.error,
    recoveryReason: job.recoveryReason,
    queuedAt: iso(job.queuedAt),
    startedAt: iso(job.startedAt),
    completedAt: iso(job.completedAt),
    updatedAt: iso(job.updatedAt),
    execution: {
      deterministic: true,
      durable: true,
      kind: job.kind,
    },
  };
}

export function createFinanceMCPHandlers(
  dependencies: FinanceMCPDependencies = defaultDependencies,
): MCPToolHandler[] {
  return [
    {
      descriptor: financeDescriptor({
        id: "lios.factor_risk_capture",
        label: "Queue deterministic factor-risk capture",
        inputSchema: factorRiskSnapshotRequestSchema,
        access: "write",
        sideEffect: "internal_write",
        replaySafe: false,
        allowedRoles: FINANCE_ANALYST_ROLES,
      }),
      invoke: async (argumentsValue, context) => {
        const input = factorRiskSnapshotRequestSchema.parse(argumentsValue);
        const job = await dependencies.enqueueCalculationJob(
          FACTOR_RISK_CALCULATION_KIND,
          input,
          ownerFromContext(context),
        );
        return financeMCPJobView(job);
      },
    },
    {
      descriptor: financeDescriptor({
        id: "lios.scenario_pipeline",
        label: "Queue deterministic scenario-to-action pipeline",
        inputSchema: scenarioPipelineRequestSchema,
        access: "write",
        sideEffect: "internal_write",
        replaySafe: false,
        allowedRoles: FINANCE_ANALYST_ROLES,
      }),
      invoke: async (argumentsValue, context) => {
        const input = scenarioPipelineRequestSchema.parse(argumentsValue);
        const job = await dependencies.enqueueCalculationJob(
          SCENARIO_PIPELINE_CALCULATION_KIND,
          input,
          ownerFromContext(context),
        );
        return financeMCPJobView(job);
      },
    },
    {
      descriptor: financeDescriptor({
        id: "lios.calculation_job",
        label: "Read deterministic calculation job",
        inputSchema: calculationJobLookupSchema,
        access: "read",
        sideEffect: "none",
        replaySafe: true,
        allowedRoles: FINANCE_JOB_READ_ROLES,
      }),
      invoke: async (argumentsValue, context) => {
        const { jobId } = calculationJobLookupSchema.parse(argumentsValue);
        const job = await dependencies.getCalculationJob(jobId, scopeFromContext(context));
        if (!job) throw new Error("Calculation job not found.");
        return financeMCPJobView(job);
      },
    },
  ];
}

export const FINANCE_MCP_HANDLERS = createFinanceMCPHandlers();
