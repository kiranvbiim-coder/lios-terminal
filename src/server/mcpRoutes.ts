import crypto from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import { decideToolPermission } from "./governedTools";
import { invokeMCPTool, type MCPToolHandler } from "./mcpTransport";
import { requireAuth } from "./auth";
import { getQuotes } from "./marketData";
import { getIndicatorQuotes } from "./fredData";
import { auditActor, recordAuditEvent } from "./auditEvents";
import { registerBuiltInCalculationJobRunners } from "./calculationJobRunners";
import { FINANCE_MCP_HANDLERS } from "./mcpFinanceTools";

const rpcSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.enum(["tools/list", "tools/call"]),
  params: z.record(z.unknown()).default({}),
});

const toolCallSchema = z.object({
  name: z.string().trim().min(1),
  arguments: z.record(z.unknown()).default({}),
}).strict();

const quoteInputSchema = z.object({
  symbol: z.string().trim().min(1).max(30),
}).strict();

const macroInputSchema = z.object({
  seriesId: z.string().trim().min(1).max(100),
}).strict();

const GENERAL_MCP_ROLES = [
  "internal_admin",
  "internal_analyst",
  "internal_compliance",
  "client_admin",
  "client_user",
] as const;

const MCP_HANDLERS: MCPToolHandler[] = [
  {
    descriptor: {
      id: "lios.quote",
      label: "Get current market quote",
      kind: "mcp",
      permissionClass: "safe_auto",
      allowedRoles: GENERAL_MCP_ROLES,
      access: "read",
      sideEffect: "none",
      replaySafe: true,
      inputSchema: quoteInputSchema,
      outputSchema: z.unknown(),
      maxOutputBytes: 256 * 1024,
      cancel: null,
    },
    invoke: async (argumentsValue) => {
      const symbol = quoteInputSchema.parse(argumentsValue).symbol.toUpperCase();
      const [quote] = await getQuotes([symbol]);
      if (!quote) throw new Error("Quote is unavailable.");
      return quote;
    },
  },
  {
    descriptor: {
      id: "lios.macro",
      label: "Get economic indicator",
      kind: "mcp",
      permissionClass: "safe_auto",
      allowedRoles: GENERAL_MCP_ROLES,
      access: "read",
      sideEffect: "none",
      replaySafe: true,
      inputSchema: macroInputSchema,
      outputSchema: z.unknown(),
      maxOutputBytes: 256 * 1024,
      cancel: null,
    },
    invoke: async (argumentsValue) => {
      const seriesId = macroInputSchema.parse(argumentsValue).seriesId.toUpperCase();
      const [indicator] = await getIndicatorQuotes([seriesId]);
      if (!indicator) throw new Error("Macro indicator is unavailable.");
      return indicator;
    },
  },
  ...FINANCE_MCP_HANDLERS,
];

function visibleHandlers(role: string): MCPToolHandler[] {
  return MCP_HANDLERS.filter((handler) =>
    decideToolPermission(handler.descriptor, { role }, null).decision !== "deny"
  );
}

export function mcpVisibleToolIdsForRole(role: string): string[] {
  return visibleHandlers(role).map((handler) => handler.descriptor.id);
}

export function registerMCPRoutes(app: Express): void {
  // Idempotent registration keeps MCP execution valid even when this route
  // module is embedded without the generic calculation-job REST routes.
  registerBuiltInCalculationJobRunners();

  app.post("/api/mcp", requireAuth, async (req, res) => {
    const parsed = rpcSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid MCP JSON-RPC request." } });
      return;
    }

    const request = parsed.data;
    if (request.method === "tools/list") {
      const tools = visibleHandlers(req.user!.role).map(({ descriptor }) => ({
        name: descriptor.id,
        description: descriptor.label,
        inputSchema: { type: "object", additionalProperties: true },
      }));
      res.json({ jsonrpc: "2.0", id: request.id, result: { tools } });
      return;
    }

    const call = toolCallSchema.safeParse(request.params);
    if (!call.success) {
      res.status(400).json({ jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "Invalid MCP tool call." } });
      return;
    }

    try {
      const requestId = crypto.randomUUID();
      const result = await invokeMCPTool(call.data.name, call.data.arguments, {
        requestId,
        userId: req.user!.id,
        organizationId: req.user!.organizationId ?? null,
        role: req.user!.role,
        projectId: null,
      }, MCP_HANDLERS);
      await recordAuditEvent(req.user!.id, "mcp_tool_invoked", {
        toolId: result.toolId,
        attribution: result.attribution,
        ...auditActor(req.user!),
      });
      res.json({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{ type: "json", json: result.output }],
          attribution: result.attribution,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "Invalid MCP tool arguments." } });
        return;
      }
      res.status(403).json({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32001, message: "MCP tool invocation failed." },
      });
    }
  });
}
