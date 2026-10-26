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

export function isLiosLightPalette(palette: LiosProductPalette): boolean {
  return palette === "chatgpt-light" || palette === "claude-light";
}

function applyLiosProductPalette(palette: LiosProductPalette): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const light = isLiosLightPalette(palette);
  root.setAttribute("data-lios-palette", palette);
  root.setAttribute("data-theme", light ? "light" : "dark");
  root.classList.toggle("dark", !light);
}

export function setLiosProductPalette(palette: LiosProductPalette): void {
  applyLiosProductPalette(palette);
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(LIOS_PALETTE_STORAGE_KEY, palette); } catch { /* In-memory theme still applies. */ }
  }
}

export function initializeLiosProductPalette(): void {
  applyLiosProductPalette(readLiosProductPalette());
}
