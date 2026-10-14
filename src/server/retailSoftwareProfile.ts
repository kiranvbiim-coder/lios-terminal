/**
 * Retail (customer) software profile — desktop + hosted client terminal.
 * Internal Limuria builds and default internal dev remain unrestricted for engineering.
 */
export function isRetailSoftwareProfile(env: NodeJS.ProcessEnv = process.env): boolean {
  const profile = (env.LIOS_SOFTWARE_PROFILE ?? "").trim().toLowerCase();
  if (profile === "retail" || profile === "client") return true;
  if (profile === "internal") return false;
  if ((env.LIOS_DESKTOP_CHANNEL ?? "").trim().toLowerCase() === "client") return true;
  return false;
}
