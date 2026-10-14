import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { containsCredentialShape } from "@shared/workingContext";
import { parseSecretRef } from "@shared/secretRef";
import type { ConversationToolDefinition } from "./conversationRuntime";
import type { GovernedToolCall } from "./governedTools";
import { assertNotAborted } from "./conversationRuntimeCore";
import { resolveCredential } from "./credentialVault";
import { getProject } from "./projectStore";
import { tenantContext } from "./tenantContext";
import type { TenantContext } from "./tenantContext";
import { S3DispatchNoEffectError, S3StorageProvider } from "./s3StorageProvider";
import type { S3ImmutablePutReceipt, S3StorageConfig } from "./s3StorageProvider";
import { redactSensitiveText } from "./acp/error-format";

const MAX_CONTENT_BYTES = 64 * 1024;
export const PROJECT_PUBLICATION_RETRY_BACKOFF_MS = 2_000;

export const projectObjectPublicationInputSchema = z.object({
  title: z.string().trim().min(1).max(300).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Publication title cannot contain control characters."),
  content: z.string().min(1).max(MAX_CONTENT_BYTES).refine((value) => !value.includes("\0") && Buffer.byteLength(value, "utf8") <= MAX_CONTENT_BYTES, "Publication content exceeds its byte bound or contains NUL."),
}).strict().superRefine((value, ctx) => {
  if (containsCredentialShape(value) || redactSensitiveText(value.title) !== value.title || redactSensitiveText(value.content) !== value.content) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Credential-shaped content cannot be published." });
  }
  if (Buffer.byteLength(JSON.stringify({ schemaVersion: "lios.project-publication/1", title: value.title, content: value.content }), "utf8") > 70 * 1024) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Serialized publication exceeds its object byte bound." });
  }
});

export const projectObjectPublicationOutputSchema = z.object({
  output: z.object({
    objectRef: z.string().regex(/^publication-object:[a-f0-9]{64}$/),
    commitRef: z.string().regex(/^publication-commit:[a-f0-9]{64}$/),
    destinationRef: z.string().regex(/^publication-target:[a-f0-9]{64}$/),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive().max(70 * 1024),
    disposition: z.enum(["created", "matched"]),
    immutable: z.literal(true),
    external: z.literal(true),
    mediaType: z.literal("application/json"),
  }).strict(),
  summary: z.string().max(2_000),
  deterministic: z.literal(true),
  sourceRefs: z.array(z.string().max(100)).max(3),
}).strict();

const tenantSchema = z.object({
  userId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
  role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
});

interface PublicationTarget {
  provider: S3StorageProvider | null;
  policySha256: string;
  credentialValues: readonly string[];
}

interface PublicationScope {
  tenant: TenantContext;
  projectId: number;
  requestId: string;
  idempotencyKey: string;
}

/** Resolves only the operator-owned publication target, never Home blob settings or model arguments. */
function publicationTarget(): PublicationTarget {
  const endpoint = process.env.LIOS_PUBLICATION_S3_ENDPOINT?.trim() ?? "";
  const bucket = process.env.LIOS_PUBLICATION_S3_BUCKET?.trim() ?? "";
  const region = process.env.LIOS_PUBLICATION_S3_REGION?.trim() ?? "";
  const accessKeyId = process.env.LIOS_PUBLICATION_S3_ACCESS_KEY_ID?.trim() ?? "";
  const secretRef = process.env.LIOS_PUBLICATION_S3_SECRET_ACCESS_KEY_REF?.trim() ?? "";
  const literalSecret = process.env.LIOS_PUBLICATION_S3_SECRET_ACCESS_KEY?.trim() ?? "";
  let secretAccessKey = literalSecret;
  let provider: S3StorageProvider | null = null;
  let valid = false;
  try {
    if (secretRef && (!parseSecretRef(secretRef) || literalSecret)) throw new Error("Ambiguous publication secret configuration.");
    if (!literalSecret && secretRef) secretAccessKey = resolveCredential("", secretRef) ?? "";
    if (!endpoint || !bucket || !region || !accessKeyId || !secretAccessKey
      || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(region)
      || /[\s\u0000-\u001f\u007f]/.test(accessKeyId) || accessKeyId.length > 128
      || /[\u0000-\u001f\u007f]/.test(secretAccessKey) || secretAccessKey.length > 4_096
      || endpoint.length > 2_048) throw new Error("Incomplete publication configuration.");
    const config: S3StorageConfig = Object.freeze({ endpoint, bucket, region, accessKeyId, secretAccessKey, timeoutMs: 30_000 });
    provider = new S3StorageProvider(config);
    valid = true;
  } catch {
    // Configuration errors are visible as disabled; exception text can contain operator paths/URLs.
    provider = null;
  }
  const policySha256 = crypto.createHash("sha256").update(JSON.stringify({
    schema: "lios.publication-target/1", enabled: valid,
    endpoint, bucket, region, accessKeyId, secretRef,
    credentialGeneration: crypto.createHash("sha256").update(secretAccessKey).digest("hex"),
    conditional: "if-none-match:*", retryBackoffMs: PROJECT_PUBLICATION_RETRY_BACKOFF_MS,
  })).digest("hex");
  return { provider, policySha256, credentialValues: [accessKeyId, secretAccessKey].filter(Boolean) };
}

/** Server-only policy identity, including disabled/malformed configuration and credential rotation. */
export function projectObjectPublicationPolicyBindingSha256(): string {
  return publicationTarget().policySha256;
}

function publicationScope(call: GovernedToolCall): PublicationScope {
  const parsed = tenantSchema.safeParse(call.tenant);
  if (call.source !== "agent" || !parsed.success || call.userId !== parsed.data.userId
    || !Number.isSafeInteger(call.projectId) || (call.projectId ?? 0) <= 0
    || !call.requestId || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(call.requestId)
    || !call.idempotencyKey || call.idempotencyKey.length > 512 || /[\u0000-\u001f\u007f]/.test(call.idempotencyKey)
    || !call.beforeExternalDispatch || !call.markExternalDispatchNoEffect) {
    throw new Error("Object publication requires authenticated canonical agent, Project, request and idempotent dispatch scope.");
  }
  const tenant = tenantContext({ id: parsed.data.userId, organizationId: parsed.data.organizationId, role: parsed.data.role });
  return { tenant, projectId: call.projectId!, requestId: call.requestId, idempotencyKey: call.idempotencyKey };
}

/** Register in the existing conversation registry. L5/L6 alone own dispatch durability and resume. */
export function createProjectObjectPublicationTool(): ConversationToolDefinition {
  return {
    id: "lios.project.publish_object",
    label: "Publish immutable Project object to your configured external S3 target (title and content; exact approval required)",
    kind: "calculate",
    permissionClass: "user_confirm",
    allowProjectApproval: false,
    access: "write",
    sideEffect: "external",
    replaySafe: true,
    policyBindingSha256: projectObjectPublicationPolicyBindingSha256,
    inputSchema: projectObjectPublicationInputSchema,
    outputSchema: projectObjectPublicationOutputSchema,
    maxOutputBytes: 4 * 1024,
    cancel: null,
    invoke: async (rawInput, signal, call) => {
      let input: z.infer<typeof projectObjectPublicationInputSchema>;
      let scope: PublicationScope;
      let target: PublicationTarget;
      let provider: S3StorageProvider;
      try {
        assertNotAborted(signal);
        const parsed = projectObjectPublicationInputSchema.safeParse(rawInput);
        if (!parsed.success) throw new Error("Object publication input is invalid or credential-shaped.");
        input = parsed.data;
        scope = publicationScope(call);
        target = publicationTarget();
        if (!target.provider) throw new Error("External object publication is unavailable: configure a valid LIOS_PUBLICATION_S3 target and resolvable credentials. No object was published.");
        provider = target.provider;
        if (target.credentialValues.some((value) => input.title.includes(value) || input.content.includes(value))) {
          throw new Error("Publication content contains configured credentials; no object was published.");
        }
        try {
          await getProject(scope.tenant, scope.projectId);
        } catch {
          throw new Error("Object publication Project is unavailable to its authenticated owner.");
        }
        assertNotAborted(signal);
        if (publicationTarget().policySha256 !== target.policySha256) {
          throw new Error("Object publication destination or credentials changed; fresh approval is required.");
        }
      } catch (error) {
        // Registry intent is durable before invoke; every path in this block is provably local.
        const proofRef = `publication-no-effect:${crypto.createHash("sha256").update(JSON.stringify({ requestId: call.requestId ?? null, evidence: "local-publication-preflight-rejected" })).digest("hex")}`;
        await call.markExternalDispatchNoEffect?.(proofRef);
        throw error;
      }
      const binding = target.policySha256;
      let requestEntered = false;
      const assertTargetBinding = () => {
        assertNotAborted(signal);
        if (publicationTarget().policySha256 !== binding) {
          throw new Error("Object publication destination or credentials changed; fresh approval is required.");
        }
      };
      const beforeRequest = () => {
        assertTargetBinding();
        requestEntered = true;
      };
      const identity = crypto.createHash("sha256").update(JSON.stringify({
        schema: "lios.project-publication-identity/1", ownerUserId: scope.tenant.userId,
        organizationId: scope.tenant.organizationId, projectId: scope.projectId,
        requestId: scope.requestId, idempotencyKey: scope.idempotencyKey,
      })).digest("hex");
      const key = `publications/v1/tenant-${scope.tenant.organizationId ?? "local"}/owner-${scope.tenant.userId}/project-${scope.projectId}/${identity}.json`;
      const bytes = Buffer.from(JSON.stringify({ schemaVersion: "lios.project-publication/1", title: input.title, content: input.content }), "utf8");
      const options = { signal, beforeRequest };
      let receipt: S3ImmutablePutReceipt;
      try {
        receipt = await provider.putImmutable(key, bytes, options);
      } catch (error) {
        if (!requestEntered) {
          const proofRef = `publication-no-effect:${crypto.createHash("sha256").update(JSON.stringify({ binding, identity, attempt: 1, evidence: "publication-transport-not-entered" })).digest("hex")}`;
          await call.markExternalDispatchNoEffect!(proofRef);
          throw error;
        }
        if (!(error instanceof S3DispatchNoEffectError)) throw error;
        const proofRef = `publication-no-effect:${crypto.createHash("sha256").update(JSON.stringify({ binding, identity, attempt: 1, evidence: "new-socket-connect-ECONNREFUSED" })).digest("hex")}`;
        await call.markExternalDispatchNoEffect!(proofRef);
        assertNotAborted(signal);
        await call.reportExternalDispatchStatus?.("External publication connection refused before transmission. No object was published. One retry is pending in 2 seconds; Stop cancels this backoff.");
        await delay(PROJECT_PUBLICATION_RETRY_BACKOFF_MS, undefined, { signal });
        assertTargetBinding();
        await call.beforeExternalDispatch!();
        requestEntered = false;
        try {
          receipt = await provider.putImmutable(key, bytes, options);
        } catch (retryError) {
          if (!requestEntered || retryError instanceof S3DispatchNoEffectError) {
            const retryProofRef = `publication-no-effect:${crypto.createHash("sha256").update(JSON.stringify({ binding, identity, attempt: 2, evidence: requestEntered ? "new-socket-connect-ECONNREFUSED" : "publication-transport-not-entered" })).digest("hex")}`;
            await call.markExternalDispatchNoEffect!(retryProofRef);
          }
          throw retryError;
        }
      }
      const objectRef = `publication-object:${crypto.createHash("sha256").update(`${binding}\0${key}`).digest("hex")}`;
      const commitRef = `publication-commit:${crypto.createHash("sha256").update(`${objectRef}\0${receipt.contentSha256}`).digest("hex")}`;
      const destinationRef = `publication-target:${binding}`;
      return {
        output: {
          objectRef, commitRef, destinationRef, contentSha256: receipt.contentSha256,
          bytes: bytes.length, disposition: receipt.disposition,
          immutable: true as const, external: true as const, mediaType: "application/json" as const,
        },
        summary: receipt.disposition === "created"
          ? "Published one immutable JSON object to the configured external target. The provider acknowledged the conditional commit; opaque object and content-hash receipts are attached."
          : "The external provider already holds exactly the same immutable JSON object. Its actual bytes were reconciled by SHA-256; no duplicate object was created.",
        deterministic: true as const,
        sourceRefs: [objectRef, commitRef, destinationRef],
      };
    },
  };
}
