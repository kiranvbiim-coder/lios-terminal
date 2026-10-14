import crypto from "node:crypto";
import { z } from "zod";
import { containsCredentialShape } from "@shared/workingContext";
import type { GovernedToolCall, GovernedToolDescriptor } from "../governedTools";
import type { TenantContext } from "../tenantContext";
import { createProjectResource } from "../projectResourceStore";
import { acpSessionResource } from "./session-binding";
import { redactSensitiveText } from "./error-format";
import {
  applyCodingPatch,
  inspectCodingWorkspace,
  previewCodingPatch,
  type CodingCheckKind,
  type CodingPatchChange,
} from "./coding-workspace";
import { consumeApprovedCodingCheckOperation, executeApprovedCodingCheckOperation } from "./coding-exec-operation";

type CodingToolKind = "retrieve" | "calculate";

interface CodingToolResult {
  output: unknown;
  summary: string;
  deterministic: boolean;
  sourceRefs: string[];
}

const resultSchema = z.object({
  output: z.unknown().optional(),
  summary: z.string().max(2_000),
  deterministic: z.boolean(),
  sourceRefs: z.array(z.string().max(1_000)).max(100),
}).strict().transform((value): CodingToolResult => {
  if (value.output === undefined) throw new Error("Coding tool results must declare output.");
  return { ...value, output: value.output };
});

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const relativePathSchema = z.string().trim().min(1).max(500).refine((value) =>
  !value.includes("\0") && !value.includes("\\") && !value.startsWith("/") && !value.split("/").includes(".."),
  "Path must stay within the configured coding workspace.",
);
const patchChangeSchema = z.object({
  path: relativePathSchema,
  beforeSha256: sha256Schema,
  content: z.string().max(512 * 1024),
}).strict().superRefine((value, ctx) => {
  if (containsCredentialShape(value.content)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["content"],
      message: "Credential-shaped content cannot enter durable coding plan state.",
    });
  }
});

const inspectInputSchema = z.object({
  paths: z.array(relativePathSchema).max(32).default([]),
}).strict();
const previewInputSchema = z.object({
  workspaceSha256: sha256Schema,
  changes: z.array(patchChangeSchema).min(1).max(16),
}).strict();
const applyInputSchema = previewInputSchema.extend({
  previewSha256: sha256Schema,
}).strict();
export const codingCheckInputSchema = z.object({
  workspaceSha256: sha256Schema,
  check: z.enum(["npm-check", "npm-test", "git-diff-check", "node-test"]),
  targets: z.array(relativePathSchema).max(10).default([]),
}).strict();

interface CodingScope {
  tenant: TenantContext;
  user: { id: number; organizationId: number | null; role: TenantContext["role"] };
  projectId: number;
  chatId: number;
  requestId: string;
  sessionRef: string;
}

function codingScope(call: GovernedToolCall): CodingScope {
  if (call.source !== "agent") throw new Error("Coding tools are available only through the canonical agent run.");
  if (!call.requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(call.requestId)) {
    throw new Error("Coding tools require the canonical agent request id.");
  }
  if (!call.tenant || typeof call.tenant !== "object" || !("userId" in call.tenant)) {
    throw new Error("Coding tools require authenticated server context.");
  }
  const tenant = call.tenant as TenantContext;
  const projectId = Number(call.projectId);
  const chatId = Number(call.chatId);
  if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(chatId) || chatId <= 0) {
    throw new Error("Coding tools require a saved Project chat.");
  }
  const sessionRef = acpSessionResource({
    requestId: call.requestId,
    userId: tenant.userId,
    organizationId: tenant.organizationId,
    projectId,
    sessionId: null,
    conversationId: chatId,
    activeObjectId: null,
    dataClassification: "private",
    approvedActions: [],
  });
  return {
    tenant,
    user: { id: tenant.userId, organizationId: tenant.organizationId, role: tenant.role },
    projectId,
    chatId,
    requestId: call.requestId,
    sessionRef,
  };
}

function digest(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function persistCodingReceipt(
  scope: CodingScope,
  call: GovernedToolCall,
  operation: "apply_patch" | "check",
  metadata: Record<string, unknown>,
): Promise<string> {
  const safe = {
    version: 1,
    operation,
    requestId: scope.requestId,
    sessionRef: scope.sessionRef,
    ...metadata,
  };
  const receiptRef = `coding-receipt:${digest(safe)}`;
  await createProjectResource(scope.tenant, {
    projectId: scope.projectId,
    kind: "coding_receipt",
    label: operation === "apply_patch" ? "Coding patch receipt" : "Coding check receipt",
    resourceRef: receiptRef,
    contextMode: "on_demand",
    metadata: safe,
  });
  await call.coding?.recordReceipt?.(receiptRef);
  return receiptRef;
}

const inspectTool: GovernedToolDescriptor<CodingToolKind, CodingToolResult> = {
  id: "lios.coding.inspect",
  label: "Inspect governed coding workspace",
  kind: "retrieve",
  permissionClass: "safe_auto",
  access: "read",
  sideEffect: "none",
  replaySafe: true,
  inputSchema: inspectInputSchema,
  outputSchema: resultSchema,
  maxOutputBytes: 512 * 1024,
  cancel: null,
  invoke: async (raw, signal, call) => {
    codingScope(call);
    const input = inspectInputSchema.parse(raw);
    const inspected = await inspectCodingWorkspace(input.paths);
    if (signal.aborted) throw new DOMException("Coding inspection cancelled.", "AbortError");
    const excerpts = inspected.previews
      .flatMap((file) => file.text ? [`--- ${file.path} @ ${file.sha256.slice(0, 12)} ---\n${file.text}`] : [])
      .join("\n")
      .slice(0, 1_500);
    return {
      output: inspected,
      summary: [
        `Coding workspace fingerprint ${inspected.workspaceSha256}; ${inspected.fileCount} bounded file(s) indexed; ${inspected.previews.length} file preview(s) returned.`,
        excerpts,
      ].filter(Boolean).join("\n").slice(0, 2_000),
      deterministic: true,
      sourceRefs: inspected.previews.map((file) => `coding-file:${file.sha256}`).slice(0, 100),
    };
  },
};

const previewTool: GovernedToolDescriptor<CodingToolKind, CodingToolResult> = {
  id: "lios.coding.preview_patch",
  label: "Preview bounded coding patch",
  kind: "retrieve",
  permissionClass: "safe_auto",
  access: "read",
  sideEffect: "none",
  replaySafe: true,
  inputSchema: previewInputSchema,
  outputSchema: resultSchema,
  maxOutputBytes: 256 * 1024,
  cancel: null,
  invoke: async (raw, signal, call) => {
    codingScope(call);
    const input = previewInputSchema.parse(raw);
    const preview = await previewCodingPatch(input.workspaceSha256, input.changes as CodingPatchChange[]);
    if (signal.aborted) throw new DOMException("Coding patch preview cancelled.", "AbortError");
    const excerpt = preview.diff.slice(0, 1_300);
    return {
      output: preview,
      summary: `Patch preview ${preview.previewSha256} for ${preview.files.length} file(s). Review before applying:\n${excerpt}`,
      deterministic: true,
      sourceRefs: preview.files.map((file) => `coding-file:${file.beforeSha256}`).slice(0, 100),
    };
  },
};

const applyTool: GovernedToolDescriptor<CodingToolKind, CodingToolResult> = {
  id: "lios.coding.apply_patch",
  label: "Apply reviewed bounded coding patch",
  kind: "calculate",
  permissionClass: "user_confirm",
  allowProjectApproval: false,
  access: "write",
  sideEffect: "internal_write",
  replaySafe: false,
  inputSchema: applyInputSchema,
  outputSchema: resultSchema,
  maxOutputBytes: 256 * 1024,
  cancel: null,
  invoke: async (raw, signal, call) => {
    const scope = codingScope(call);
    const input = applyInputSchema.parse(raw);
    if (signal.aborted) throw new DOMException("Coding patch cancelled.", "AbortError");
    const applied = await applyCodingPatch(input.workspaceSha256, input.previewSha256, input.changes as CodingPatchChange[]);
    if (signal.aborted) throw new DOMException("Coding patch cancelled.", "AbortError");
    const receiptRef = await persistCodingReceipt(scope, call, "apply_patch", {
      workspaceSha256Before: applied.workspaceSha256,
      workspaceSha256After: applied.workspaceSha256After,
      previewSha256: applied.previewSha256,
      files: applied.files,
      outcome: "applied",
    });
    return {
      output: { ...applied, receiptRef },
      summary: `Applied reviewed patch ${applied.previewSha256} to ${applied.files.map((file) => file.path).join(", ")}. New workspace fingerprint ${applied.workspaceSha256After}. Receipt ${receiptRef}.`,
      deterministic: true,
      sourceRefs: [receiptRef, ...applied.files.map((file) => `coding-file:${file.afterSha256}`)].slice(0, 100),
    };
  },
};

const checkTool: GovernedToolDescriptor<CodingToolKind, CodingToolResult> = {
  id: "lios.coding.run_check",
  label: "Run reviewed coding check",
  kind: "calculate",
  permissionClass: "user_confirm",
  allowProjectApproval: false,
  access: "write",
  sideEffect: "internal_write",
  replaySafe: false,
  inputSchema: codingCheckInputSchema,
  outputSchema: resultSchema,
  maxOutputBytes: 256 * 1024,
  cancel: null,
  invoke: async (raw, signal, call) => {
    const scope = codingScope(call);
    const input = codingCheckInputSchema.parse(raw);
    if (!call.toolCallId) throw new Error("Coding check requires its canonical tool-call identity.");
    const approved = await consumeApprovedCodingCheckOperation({
      user: scope.user,
      projectId: scope.projectId,
      chatId: scope.chatId,
      requestId: scope.requestId,
      toolCallId: call.toolCallId,
      workspaceSha256: input.workspaceSha256,
      check: input.check as CodingCheckKind,
      targets: input.targets,
    });
    const check = await executeApprovedCodingCheckOperation(approved, call.coding?.processSupervisor);
    if (signal.aborted) throw new DOMException("Coding check cancelled.", "AbortError");
    const receiptRef = await persistCodingReceipt(scope, call, "check", {
      workspaceSha256Before: input.workspaceSha256,
      workspaceSha256After: check.workspaceSha256After,
      check: check.check,
      targets: check.targets,
      commandDigest: check.commandDigest,
      outcome: check.outcome,
      durationMs: check.durationMs,
      outputSha256: check.outputSha256,
    });
    const stdout = redactSensitiveText(check.stdout).slice(-20_000);
    const stderr = redactSensitiveText(check.stderr).slice(-20_000);
    const excerpt = [stdout, stderr].filter(Boolean).join("\n").slice(-900);
    return {
      output: { ...check, stdout, stderr, receiptRef },
      summary: `Coding check ${check.check} ${check.outcome}; command ${check.commandDigest}; receipt ${receiptRef}.${excerpt ? `\n${excerpt}` : ""}`,
      deterministic: true,
      sourceRefs: [receiptRef],
    };
  },
};

export const codingConversationToolDescriptors = Object.freeze([
  inspectTool,
  previewTool,
  applyTool,
  checkTool,
]);
