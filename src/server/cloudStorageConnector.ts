import { fetchWithEndpointPolicy, readBoundedText, validateSourceEndpoint } from "./sourceConnectionPolicy";

export interface CloudObjectResult {
  endpoint: string;
  contentType: string;
  bytes: number;
  etag: string | null;
  retrievedAt: string;
  value: unknown;
}
export async function fetchCloudObject(input: {
  endpoint: string;
  bearer?: string | null;
  maxBytes?: number;
}): Promise<CloudObjectResult> {
  const policy = await validateSourceEndpoint(input.endpoint);
  if (!policy.valid || !policy.normalizedEndpoint) throw new Error(`Cloud object endpoint rejected: ${policy.reason}.`);
  const headers: Record<string, string> = { Accept: "application/json,text/csv,text/plain,application/octet-stream" };
  if (input.bearer) headers.Authorization = `Bearer ${input.bearer}`;
  const response = await fetchWithEndpointPolicy(policy.normalizedEndpoint, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Cloud object endpoint returned HTTP ${response.status}.`);
  const maxBytes = Math.min(Math.max(input.maxBytes ?? 10 * 1024 * 1024, 1), 50 * 1024 * 1024);
  const text = await readBoundedText(response, maxBytes);
  const contentType = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
  let value: unknown = text;
  if (contentType === "application/json" || contentType.endsWith("+json")) {
    try { value = JSON.parse(text); } catch { throw new Error("Cloud object declared JSON but contained invalid JSON."); }
  }
  return {
    endpoint: policy.normalizedEndpoint,
    contentType,
    bytes: Buffer.byteLength(text, "utf8"),
    etag: response.headers.get("etag"),
    retrievedAt: new Date().toISOString(),
    value,
  };
}
