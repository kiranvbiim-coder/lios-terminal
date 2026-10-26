/**
 * User-owned visual preference only: never affects tenant/session authority.
 * Palette references describe colors, not an affiliation with model providers.
 */
export const LIOS_PALETTE_STORAGE_KEY = "lios-product-palette-v1";
export const DEFAULT_LIOS_PALETTE = "chatgpt-dark" as const;
export const LIOS_PRODUCT_PALETTES = [
  { id: "chatgpt-dark", label: "Graphite · ChatGPT-inspired dark" },
  { id: "chatgpt-light", label: "White · ChatGPT-inspired light" },
  { id: "claude-light", label: "Ivory · Claude-inspired light" },
  { id: "claude-dark", label: "Clay · Claude-inspired dark" },
  { id: "lios-classic", label: "LiOS Classic · black & gold" },
] as const;
export type LiosProductPalette = typeof LIOS_PRODUCT_PALETTES[number]["id"];

export function resolveLiosProductPalette(raw: unknown): LiosProductPalette {
  return LIOS_PRODUCT_PALETTES.find((theme) => theme.id === raw)?.id ?? DEFAULT_LIOS_PALETTE;
}

export function readLiosProductPalette(): LiosProductPalette {
  if (typeof window === "undefined") return DEFAULT_LIOS_PALETTE;
  try {
    return resolveLiosProductPalette(window.localStorage.getItem(LIOS_PALETTE_STORAGE_KEY));
  } catch {
    return DEFAULT_LIOS_PALETTE;
  }
}

export function setLiosProductPalette(palette: LiosProductPalette): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-lios-palette", palette);
  }
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(LIOS_PALETTE_STORAGE_KEY, palette); } catch { /* In-memory theme still applies. */ }
  }
}

export function initializeLiosProductPalette(): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-lios-palette", readLiosProductPalette());
  }
}
