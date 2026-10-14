/** apiRequest rejects with "<status>: <body>"; return the server's `error` text verbatim, or the raw body when it is not JSON. */
export function serverErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const body = raw.replace(/^\d+:\s*/, "");
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch { /* Not JSON: show the text as-is. */ }
  return body;
}
