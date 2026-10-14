/**
 * API keys must be ASCII — Node/fetch header values cannot contain Unicode.
 * Users often paste BOMs, zero-width spaces, or UI symbols (✓/✗) by mistake.
 */
export function normalizeProviderApiCredential(raw: string): { value: string; rejection: string | null } {
  let value = raw
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\r\n\t]+/g, "")
    .trim();
  value = value.replace(/^[\u2713\u2714\u2717]\s*/, "");

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 255) {
      return {
        value,
        rejection:
          `The API key contains a non-ASCII character (Unicode U+${code.toString(16).toUpperCase().padStart(4, "0")} at position ${i + 1}). ` +
          "Copy only the key from the provider dashboard — not labels, quotes, or text from LiOS error banners.",
      };
    }
  }

  if (!value) {
    return { value, rejection: "A non-empty credential is required." };
  }

  return { value, rejection: null };
}
