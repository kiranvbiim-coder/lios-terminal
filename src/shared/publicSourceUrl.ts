const SECRET_QUERY_FIELDS = /^(?:api[_-]?key|access[_-]?token|token|password|passwd|secret|client[_-]?secret|auth|authorization|signature|sig|session[_-]?id)$/i;

/** Public source metadata must never publish credential-bearing links. */
export function safePublicSourceUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    if ([...url.searchParams.keys()].some(name => SECRET_QUERY_FIELDS.test(name))) return null;
    return url.href;
  } catch { return null; }
}
