// js-yaml ships no types and LiOS reads only these two members (server/skillDocument.ts).
declare module "js-yaml" {
  export const FAILSAFE_SCHEMA: unknown;
  export function load(text: string, options: Record<string, unknown>): unknown;
}
