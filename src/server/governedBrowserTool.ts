import { z } from "zod";
import type { BrowserConnectorPolicy } from "@shared/universalDataFabric";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import { createBrowserProjectNetworkAuthority, executeBrowserConnector } from "./browserConnectorRuntime";
import { createBrowserBrokeredExecutionBackend } from "./exec/backends/browser-brokered";
import { requireStrictSandboxRuntime } from "./exec/sandbox-runtime-profile";
import { createPlaywrightBrowserAdapter } from "./playwrightBrowserAdapter";
import { createBrowserRuntimePackTransport } from "./browserRuntimePack";
import { indexProjectDocument } from "./p7ProjectIntelligenceStore";
import { tenantContext } from "./tenantContext";
import { assertNotAborted } from "./conversationRuntimeCore";

type BrowserConnectorResult = Awaited<ReturnType<typeof executeBrowserConnector>>;

export function browserTextEvidenceDocuments(
  result: BrowserConnectorResult,
  extraction: { kind: "text" | "links" | "json"; selector?: string | null },
) {
  if (extraction.kind !== "text") return [];
  return result.pages.flatMap((page) => {
    const payload = page.output;
    const text = typeof payload === "string" ? payload
      : payload && typeof payload === "object" && "text" in payload && typeof payload.text === "string" ? payload.text : null;
    if (!text?.trim()) return [];
    const refs = [...new Set([page.resolvedUrl, page.requestedUrl])];
    return [{
      sourceRef: page.resolvedUrl,
      title: page.resolvedUrl,
      body: text,
      sourceRefs: refs,
      occurredAt: null,
      metadata: {
        provider: result.adapterId,
        sourceUrl: page.resolvedUrl,
        requestedUrl: page.requestedUrl,
        resolvedUrl: page.resolvedUrl,
        retrievedAt: result.completedAt,
        publishedAt: null,
        effectiveAt: null,
        originClass: "untrusted",
        evidenceKind: "claim",
        extraction,
        extractionCompleteness: "bounded_not_verified",
        acquisitionRef: result.id,
        acquisitionOutputHash: result.outputHash,
      },
    }];
  });
}

const browserToolInputSchema = z.object({
  urls: z.array(z.string().url().max(2_000)).min(1).max(10),
  extraction: z.object({
    kind: z.enum(["text", "links", "json"]),
    selector: z.string().trim().max(1_000).nullable().optional(),
  }).strict(),
}).strict();

export interface GovernedBrowserToolDependencies {
  env?: NodeJS.ProcessEnv;
  resolvePolicy?: (projectId: number, urls: string[]) => Promise<BrowserConnectorPolicy>;
}

export function browserConversationToolDescriptor(
  dependencies: GovernedBrowserToolDependencies = {},
): ConversationToolDefinition {
  return {
    id: "agent.browser.navigate",
    label: "Governed isolated browser navigation",
    kind: "retrieve",
    permissionClass: "user_confirm",
    access: "write",
    sideEffect: "external",
    replaySafe: false,
    inputSchema: browserToolInputSchema,
    outputSchema: z.object({
      output: z.unknown().optional(),
      summary: z.string().trim().max(2_000),
      deterministic: z.boolean(),
      sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(500),
    }).strict().transform((value): ConversationToolResult => {
      if (value.output === undefined) throw new Error("Browser tool result must declare output.");
      return { ...value, output: value.output };
    }),
    maxOutputBytes: 256 * 1024,
    cancel: null,
    invoke: async (input, signal, call): Promise<ConversationToolResult> => {
      if (call.source !== "agent") throw new Error("Browser navigation is available only to the bounded agent loop.");
      const projectId = Number(call.projectId);
      if (!Number.isSafeInteger(projectId) || projectId <= 0 || !call.tenant || !call.sourceScope) {
        throw new Error("Governed browser navigation requires authenticated Project/source context.");
      }
      if (call.sourceScope !== "web" && call.sourceScope !== "auto") {
        throw new Error("Conversation source scope does not permit external browser navigation.");
      }
      const parsed = browserToolInputSchema.parse(input);
      if (call.allowedSourceRefs?.length && parsed.urls.some((url) => !call.allowedSourceRefs!.includes(url))) {
        throw new Error("Browser URL is outside the active Research Artifact source selection.");
      }
      const env = dependencies.env ?? process.env;
      const profile = requireStrictSandboxRuntime(env);
      const policy = dependencies.resolvePolicy
        ? await dependencies.resolvePolicy(projectId, parsed.urls)
        : {
            projectId,
            allowedDomains: [...new Set(parsed.urls.map((url) => new URL(url).hostname.toLowerCase()))],
            allowDownloads: false,
            downloadMaxBytes: 0,
            filesystemWriteRoots: [],
            navigationTimeoutMs: 30_000,
            maxPages: Math.min(parsed.urls.length, 10),
          };
      if (policy.projectId !== projectId) throw new Error("Browser Project policy does not match authenticated Project context.");
      const backend = createBrowserBrokeredExecutionBackend(profile.backend);
      const adapter = await createPlaywrightBrowserAdapter({
        isolationMode: "canonical-isolated",
        backend,
        signal,
        networkAuthority: createBrowserProjectNetworkAuthority(policy),
        isolatedTransport: createBrowserRuntimePackTransport(profile, env),
      });
      const result = await executeBrowserConnector(policy, parsed, adapter);
      assertNotAborted(signal);
      if (call.sourceScope === "auto" && parsed.extraction.kind === "text") {
        const tenant = z.object({
          userId: z.number().int().positive(),
          organizationId: z.number().int().positive().nullable(),
          role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]),
        }).parse(call.tenant);
        if (tenant.userId !== call.userId) throw new Error("Browser evidence owner does not match the run.");
        const ctx = tenantContext({ id: tenant.userId, organizationId: tenant.organizationId, role: tenant.role });
        for (const evidence of browserTextEvidenceDocuments(result, parsed.extraction)) {
          assertNotAborted(signal);
          await indexProjectDocument(ctx, {
            projectId,
            sourceType: "research_evidence",
            ...evidence,
          });
        }
      }
      return {
        output: result,
        summary: `Governed isolated browser retrieved ${result.outputs.length} approved page${result.outputs.length === 1 ? "" : "s"}.`,
        deterministic: false,
        sourceRefs: [...new Set(result.pages.flatMap((page) => [page.resolvedUrl, page.requestedUrl]))],
      };
    },
  };
}
