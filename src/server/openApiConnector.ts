import { fetchWithEndpointPolicy, readBoundedText, validateSourceEndpoint } from "./sourceConnectionPolicy";

export interface OpenApiOperationDescriptor {
  operationId: string;
  method: string;
  path: string;
  summary: string | null;
  tags: string[];
  parameters: Array<{ name: string; in: string; required: boolean }>;
}

export interface OpenApiDiscovery {
  title: string | null;
  version: string | null;
  specification: "openapi3" | "swagger2";
  servers: string[];
  operations: OpenApiOperationDescriptor[];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function parseOpenApiDocument(raw: unknown): OpenApiDiscovery {
  const doc = object(raw);
  const openapi = typeof doc.openapi === "string" ? doc.openapi : null;
  const swagger = typeof doc.swagger === "string" ? doc.swagger : null;
  if (!openapi?.startsWith("3.") && swagger !== "2.0") throw new Error("Document is not OpenAPI 3.x or Swagger 2.0 JSON.");
  const info = object(doc.info);
  const paths = object(doc.paths);
  const operations: OpenApiOperationDescriptor[] = [];
  for (const [route, pathValue] of Object.entries(paths)) {
    const pathItem = object(pathValue);
    for (const method of ["get","post","put","patch","delete","head","options"]) {
      const op = object(pathItem[method]);
      if (!Object.keys(op).length) continue;
      const operationId = typeof op.operationId === "string" && op.operationId.trim()
        ? op.operationId.trim()
        : `${method.toUpperCase()} ${route}`;
      const parameters = Array.isArray(op.parameters) ? op.parameters : [];
      operations.push({
        operationId,
        method: method.toUpperCase(),
        path: route,
        summary: typeof op.summary === "string" ? op.summary : null,
        tags: Array.isArray(op.tags) ? op.tags.filter((v): v is string => typeof v === "string") : [],
        parameters: parameters.map((parameter) => {
          const p = object(parameter);
          return { name: String(p.name ?? ""), in: String(p.in ?? ""), required: p.required === true };
        }).filter((p) => p.name),
      });
    }
  }
  const servers = openapi
    ? (Array.isArray(doc.servers) ? doc.servers.map(object).map((item) => item.url).filter((v): v is string => typeof v === "string") : [])
    : (() => {
        const schemes = Array.isArray(doc.schemes) ? doc.schemes.filter((v): v is string => typeof v === "string") : ["https"];
        const host = typeof doc.host === "string" ? doc.host : null;
        const basePath = typeof doc.basePath === "string" ? doc.basePath : "";
        return host ? schemes.map((scheme) => `${scheme}://${host}${basePath}`) : [];
      })();
  return {
    title: typeof info.title === "string" ? info.title : null,
    version: typeof info.version === "string" ? info.version : null,
    specification: openapi ? "openapi3" : "swagger2",
    servers,
    operations: operations.slice(0, 5_000),
  };
}

export async function discoverOpenApiJson(
  url: string,
  bearer: string | null = null,
): Promise<OpenApiDiscovery> {
  const policy = await validateSourceEndpoint(url);
  if (!policy.valid || !policy.normalizedEndpoint) throw new Error(`OpenAPI endpoint rejected: ${policy.reason}.`);
  const response = await fetchWithEndpointPolicy(policy.normalizedEndpoint, {
    method: "GET",
    headers: {
      Accept: "application/json, application/vnd.oai.openapi+json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`OpenAPI discovery returned HTTP ${response.status}.`);
  const text = await readBoundedText(response, 5 * 1024 * 1024);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("OpenAPI discovery currently requires a JSON document."); }
  return parseOpenApiDocument(parsed);
}
