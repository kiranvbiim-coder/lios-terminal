export type CustodyExportFormat = "pdf" | "xlsx" | "csv" | "json" | "zip" | "other";

async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Registers a local-only export custody receipt. The export bytes never leave
 * the desktop through this function: only content SHA-256, filename SHA-256,
 * byte size, format and generation time. The readable filename never reaches
 * the hosted control plane.
 *
 * Receipt registration is intentionally best-effort and must never block the
 * user's local download.
 */
export async function registerLocalExportCustody(input: {
  filename: string;
  format: CustodyExportFormat;
  bytes: Uint8Array;
  generatedAt?: Date;
}): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const sha256 = await sha256Hex(input.bytes);
  const artifactNameHash = await sha256Hex(new TextEncoder().encode(input.filename.slice(0, 240)));
  if (!sha256 || !artifactNameHash) return false;
  try {
    const response = await fetch("/api/client/export-custody", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        format: input.format,
        artifactNameHash,
        sha256,
        byteSize: input.bytes.byteLength,
        generatedAt: (input.generatedAt ?? new Date()).toISOString(),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
