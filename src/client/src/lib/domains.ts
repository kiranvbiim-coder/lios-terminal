// Mirrors server-side `domains` table slugs. "shared" isn't a real domain
// row -- it's the sidebar's tag for platform tools (dev console, admin,
// publish desk) that show up no matter which domain is active.
export type DomainSlug = "finance" | "economics_policy" | "supply_chain" | "environment_sustainability" | "marketing_pr" | "tourism_hospitality" | "shared";

export interface DomainInfo {
  id: number;
  slug: string;
  name: string;
  icon: string | null;
  active: boolean;
}

export const LAST_DOMAIN_STORAGE_KEY = "limuria.lastDomain";
export const DEFAULT_DOMAIN_SLUG = "finance";
export const FALLBACK_FINANCE_DOMAIN: DomainInfo = {
  id: -1,
  slug: DEFAULT_DOMAIN_SLUG,
  name: "Finance",
  icon: "trending-up",
  active: true,
};

export function pickDefaultDomain(domains: DomainInfo[], storedSlug?: string | null): DomainInfo | null {
  const active = domains.filter((domain) => domain.active);
  if (storedSlug) {
    const stored = active.find((domain) => domain.slug === storedSlug);
    if (stored) return stored;
  }
  return active.find((domain) => domain.slug === DEFAULT_DOMAIN_SLUG) ?? active[0] ?? null;
}
