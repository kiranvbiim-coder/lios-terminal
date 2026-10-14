// Canonical definitions now live in shared/dataStatus.ts (both terminal apps
// and the server need the same taxonomy). Re-exported here so every
// existing `from "./dataStatus"` call site across server/ keeps working
// unchanged.
export type { DataFreshness, DataStatus } from "@shared/dataStatus";
export { buildDataStatus } from "@shared/dataStatus";
