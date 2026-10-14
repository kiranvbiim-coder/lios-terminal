/**
 * Wave E — Network & Moat contracts.
 *
 * This module is deliberately provider-neutral and deterministic. It defines
 * the safe object/permission vocabulary shared by the terminal and server;
 * persistence and any live OAuth/licensed-data adapters remain separate.
 */
import { z } from "zod";

export const WAVE_E_CONTRACT_VERSION = "1.0.0" as const;

export const visibilitySchema = z.enum(["private", "organization", "public"]);
export type WaveEVisibility = z.infer<typeof visibilitySchema>;

export const networkTargetSchema = z.object({
  kind: z.enum(["person", "entity", "topic"]),
  id: z.string().trim().min(1).max(240),
}).strict();
export type NetworkTarget = z.infer<typeof networkTargetSchema>;

export const networkProfileSchema = z.object({
  id: z.number().int().positive(),
  handle: z.string().trim().min(2).max(80).regex(/^[a-zA-Z0-9_.-]+$/),
  displayName: z.string().trim().min(1).max(160),
  bio: z.string().trim().max(2_000),
  visibility: visibilitySchema,
  disclosures: z.array(z.string().trim().min(1).max(240)).max(20),
  updatedAt: z.string().datetime(),
}).strict();
export type NetworkProfile = z.infer<typeof networkProfileSchema>;

export const followSchema = z.object({
  id: z.string().trim().min(1).max(160),
  target: networkTargetSchema,
  createdAt: z.string().datetime(),
}).strict();
export type FollowRecord = z.infer<typeof followSchema>;

export const directMessageSchema = z.object({
  id: z.string().trim().min(1).max(160),
  threadId: z.string().trim().min(1).max(160),
  senderId: z.number().int().positive(),
  recipientId: z.number().int().positive(),
  body: z.string().trim().min(1).max(10_000),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
}).strict();
export type DirectMessage = z.infer<typeof directMessageSchema>;

export const circleMemberSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(["owner", "moderator", "member"]),
  joinedAt: z.string().datetime(),
}).strict();
export type CircleMember = z.infer<typeof circleMemberSchema>;

export const circleSchema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000),
  visibility: visibilitySchema,
  ownerId: z.number().int().positive(),
  members: z.array(circleMemberSchema).max(500),
  createdAt: z.string().datetime(),
}).strict();
export type Circle = z.infer<typeof circleSchema>;

export const structuredIdeaSchema = z.object({
  thesis: z.string().trim().min(1).max(4_000),
  catalyst: z.string().trim().max(4_000),
  risks: z.array(z.string().trim().min(1).max(1_000)).max(20),
  invalidation: z.string().trim().max(2_000),
  horizon: z.string().trim().max(120),
  evidenceIds: z.array(z.string().trim().min(1).max(240)).max(100),
}).strict();
export type StructuredIdea = z.infer<typeof structuredIdeaSchema>;

export const networkPostSchema = z.object({
  id: z.string().trim().min(1).max(160),
  authorId: z.number().int().positive(),
  kind: z.enum(["discussion", "idea", "reply"]),
  title: z.string().trim().max(240).nullable(),
  body: z.string().trim().min(1).max(20_000),
  structuredIdea: structuredIdeaSchema.nullable(),
  circleId: z.string().trim().max(160).nullable(),
  roomKey: z.string().trim().max(240).nullable(),
  parentId: z.string().trim().max(160).nullable(),
  visibility: visibilitySchema,
  evidenceIds: z.array(z.string().trim().min(1).max(240)).max(100),
  createdAt: z.string().datetime(),
}).strict();
export type NetworkPost = z.infer<typeof networkPostSchema>;

export const reactionSchema = z.object({
  id: z.string().trim().min(1).max(160),
  postId: z.string().trim().min(1).max(160),
  userId: z.number().int().positive(),
  kind: z.enum(["useful", "insightful", "challenge"]),
  createdAt: z.string().datetime(),
}).strict();
export type PostReaction = z.infer<typeof reactionSchema>;

export const saveSchema = z.object({
  id: z.string().trim().min(1).max(160),
  postId: z.string().trim().min(1).max(160),
  userId: z.number().int().positive(),
  createdAt: z.string().datetime(),
}).strict();
export type SavedPost = z.infer<typeof saveSchema>;

export const mentionSchema = z.object({
  id: z.string().trim().min(1).max(160),
  postId: z.string().trim().min(1).max(160),
  mentionedUserId: z.number().int().positive(),
  status: z.enum(["unread", "read"]),
  createdAt: z.string().datetime(),
}).strict();
export type Mention = z.infer<typeof mentionSchema>;

export const notificationSchema = z.object({
  id: z.string().trim().min(1).max(160),
  userId: z.number().int().positive(),
  kind: z.enum(["mention", "reply", "follow", "message", "moderation"]),
  subjectId: z.string().trim().min(1).max(240),
  read: z.boolean(),
  createdAt: z.string().datetime(),
}).strict();
export type NetworkNotification = z.infer<typeof notificationSchema>;

export const moderationCaseSchema = z.object({
  id: z.string().trim().min(1).max(160),
  reporterId: z.number().int().positive(),
  subjectType: z.enum(["user", "post", "message", "circle"]),
  subjectId: z.string().trim().min(1).max(240),
  action: z.enum(["report", "block", "mute"]),
  reason: z.string().trim().min(1).max(2_000),
  status: z.enum(["open", "reviewed", "resolved"]),
  createdAt: z.string().datetime(),
}).strict();
export type ModerationCase = z.infer<typeof moderationCaseSchema>;

export const portableObjectKindSchema = z.enum(["dcf", "chart", "screener", "scenario", "portfolio_analysis", "report", "workspace"]);
export type PortableObjectKind = z.infer<typeof portableObjectKindSchema>;

export const portableAnalyticalObjectSchema = z.object({
  id: z.string().trim().min(1).max(160),
  ownerId: z.number().int().positive(),
  kind: portableObjectKindSchema,
  title: z.string().trim().min(1).max(240),
  version: z.string().trim().min(1).max(80),
  payload: z.record(z.unknown()),
  sourceReferences: z.array(z.object({ id: z.string().trim().min(1).max(240), revision: z.string().trim().min(1).max(240), licensed: z.boolean() }).strict()).max(500),
  requiredCapabilities: z.array(z.string().trim().min(1).max(160)).max(100),
  visibility: visibilitySchema,
  forkOf: z.string().trim().max(160).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type PortableAnalyticalObject = z.infer<typeof portableAnalyticalObjectSchema>;

export const shareGrantSchema = z.object({
  id: z.string().trim().min(1).max(160),
  objectId: z.string().trim().min(1).max(160),
  grantorId: z.number().int().positive(),
  recipientUserId: z.number().int().positive().nullable(),
  organizationId: z.number().int().positive().nullable(),
  access: z.enum(["view", "fork", "recompute"]),
  external: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
}).strict();
export type ShareGrant = z.infer<typeof shareGrantSchema>;

export interface ObjectDiff {
  changed: string[];
  added: string[];
  removed: string[];
  status: "identical" | "changed";
}

export interface EntitlementRehydration {
  status: "ready" | "degraded" | "blocked";
  availableReferences: string[];
  missingReferences: string[];
  licensedReferences: string[];
  reason: string;
}

export const crossDomainNodeSchema = z.object({
  kind: z.enum(["macro", "policy", "supply_chain", "company", "valuation", "portfolio"]),
  key: z.string().trim().min(1).max(240),
  label: z.string().trim().min(1).max(240),
}).strict();
export type CrossDomainNode = z.infer<typeof crossDomainNodeSchema>;

export const crossDomainRelationshipSchema = z.object({
  id: z.string().trim().min(1).max(160),
  source: crossDomainNodeSchema,
  target: crossDomainNodeSchema,
  relation: z.enum(["impacts", "exposes", "depends_on", "values", "hedges"]),
  strength: z.number().finite().min(-1).max(1).nullable(),
  evidenceIds: z.array(z.string().trim().min(1).max(240)).max(100),
  asOf: z.string().datetime().nullable(),
  status: z.enum(["observed", "inferred", "unavailable"]),
}).strict();
export type CrossDomainRelationship = z.infer<typeof crossDomainRelationshipSchema>;

export const scenarioOrchestrationSchema = z.object({
  id: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(240),
  nodes: z.array(crossDomainNodeSchema).min(1).max(50),
  shocks: z.record(z.number().finite()),
  status: z.enum(["draft", "queued", "blocked"]),
  reason: z.string().trim().min(1).max(2_000),
  createdAt: z.string().datetime(),
}).strict();
export type ScenarioOrchestration = z.infer<typeof scenarioOrchestrationSchema>;

export const workspacePrimitiveSchema = z.enum(["quote", "chart", "table", "metric", "news", "scenario", "report", "relationship"]);
export type WorkspacePrimitive = z.infer<typeof workspacePrimitiveSchema>;

export const workspaceBlockSchema = z.object({
  id: z.string().trim().min(1).max(160),
  primitive: workspacePrimitiveSchema,
  title: z.string().trim().min(1).max(240),
  config: z.record(z.unknown()),
}).strict();
export type WorkspaceBlock = z.infer<typeof workspaceBlockSchema>;

export const declarativeWorkspaceSchema = z.object({
  id: z.string().trim().min(1).max(160),
  ownerId: z.number().int().positive(),
  title: z.string().trim().min(1).max(240),
  blocks: z.array(workspaceBlockSchema).max(50),
  requiredCapabilities: z.array(z.string().trim().min(1).max(160)).max(100),
  visibility: visibilitySchema,
  status: z.enum(["draft", "preview", "confirmed"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type DeclarativeWorkspace = z.infer<typeof declarativeWorkspaceSchema>;

export const workspacePlanSchema = z.object({
  id: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(2_000),
  operations: z.array(z.object({ action: z.enum(["add_block", "remove_block", "set_visibility"]), block: workspaceBlockSchema.nullable(), visibility: visibilitySchema.nullable() }).strict()).max(100),
  requiredConfirmation: z.boolean(),
  status: z.enum(["proposed", "confirmed", "blocked"]),
  reason: z.string().trim().min(1).max(2_000),
  createdAt: z.string().datetime(),
}).strict();
export type WorkspacePlan = z.infer<typeof workspacePlanSchema>;

export const skillManifestSchema = z.object({
  id: z.string().trim().min(1).max(160).regex(/^[a-z0-9][a-z0-9_.-]*$/),
  name: z.string().trim().min(1).max(240),
  version: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2_000),
  requiredInputs: z.array(z.string().trim().min(1).max(160)).max(100),
  requiredCapabilities: z.array(z.string().trim().min(1).max(160)).max(100),
  supportedObjectKinds: z.array(portableObjectKindSchema).max(20),
  firstParty: z.boolean(),
  approval: z.enum(["pending", "approved", "blocked"]),
  publisher: z.string().trim().min(1).max(160),
  updatedAt: z.string().datetime(),
}).strict();
export type SkillManifest = z.infer<typeof skillManifestSchema>;

export interface WaveEStoredState {
  profile: NetworkProfile | null;
  follows: FollowRecord[];
  messages: DirectMessage[];
  circles: Circle[];
  posts: NetworkPost[];
  reactions: PostReaction[];
  saves: SavedPost[];
  mentions: Mention[];
  notifications: NetworkNotification[];
  moderationCases: ModerationCase[];
  objects: PortableAnalyticalObject[];
  shares: ShareGrant[];
  relationships: CrossDomainRelationship[];
  scenarios: ScenarioOrchestration[];
  workspaces: DeclarativeWorkspace[];
  workspacePlans: WorkspacePlan[];
  skills: SkillManifest[];
  updatedAt: string | null;
}

export const EMPTY_WAVE_E_STATE: WaveEStoredState = {
  profile: null, follows: [], messages: [], circles: [], posts: [], reactions: [], saves: [], mentions: [], notifications: [], moderationCases: [], objects: [], shares: [], relationships: [], scenarios: [], workspaces: [], workspacePlans: [], skills: [], updatedAt: null,
};

function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }

export function normalizeWaveEState(value: unknown): WaveEStoredState {
  if (!isRecord(value)) return { ...EMPTY_WAVE_E_STATE };
  const array = <T>(key: keyof WaveEStoredState): T[] => Array.isArray(value[key]) ? value[key].filter(isRecord) as T[] : [];
  return {
    profile: isRecord(value.profile) ? value.profile as unknown as NetworkProfile : null,
    follows: array<FollowRecord>("follows"), messages: array<DirectMessage>("messages"), circles: array<Circle>("circles"), posts: array<NetworkPost>("posts"), reactions: array<PostReaction>("reactions"), saves: array<SavedPost>("saves"), mentions: array<Mention>("mentions"), notifications: array<NetworkNotification>("notifications"), moderationCases: array<ModerationCase>("moderationCases"), objects: array<PortableAnalyticalObject>("objects"), shares: array<ShareGrant>("shares"), relationships: array<CrossDomainRelationship>("relationships"), scenarios: array<ScenarioOrchestration>("scenarios"), workspaces: array<DeclarativeWorkspace>("workspaces"), workspacePlans: array<WorkspacePlan>("workspacePlans"), skills: array<SkillManifest>("skills"), updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

export function boundedWaveEState(state: WaveEStoredState, maxBytes = 48_000): WaveEStoredState {
  const next: WaveEStoredState = {
    ...state,
    follows: state.follows.slice(-500), messages: state.messages.slice(-500), circles: state.circles.slice(-100), posts: state.posts.slice(-500), reactions: state.reactions.slice(-1_000), saves: state.saves.slice(-500), mentions: state.mentions.slice(-500), notifications: state.notifications.slice(-500), moderationCases: state.moderationCases.slice(-200), objects: state.objects.slice(-200), shares: state.shares.slice(-500), relationships: state.relationships.slice(-500), scenarios: state.scenarios.slice(-100), workspaces: state.workspaces.slice(-50), workspacePlans: state.workspacePlans.slice(-100), skills: state.skills.slice(-100),
  };
  if (Buffer.byteLength(JSON.stringify(next), "utf8") <= maxBytes) return next;
  return { ...next, messages: next.messages.slice(-100), posts: next.posts.slice(-150), reactions: next.reactions.slice(-300), objects: next.objects.slice(-50), shares: next.shares.slice(-100), relationships: next.relationships.slice(-100), notifications: next.notifications.slice(-100) };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function diffPortableObjects(left: PortableAnalyticalObject, right: PortableAnalyticalObject): ObjectDiff {
  const keys = new Set([...Object.keys(left.payload), ...Object.keys(right.payload)]);
  const changed: string[] = []; const added: string[] = []; const removed: string[] = [];
  for (const key of [...keys].sort()) {
    const hasLeft = Object.prototype.hasOwnProperty.call(left.payload, key); const hasRight = Object.prototype.hasOwnProperty.call(right.payload, key);
    if (!hasLeft) added.push(key); else if (!hasRight) removed.push(key); else if (stable(left.payload[key]) !== stable(right.payload[key])) changed.push(key);
  }
  return { changed, added, removed, status: changed.length || added.length || removed.length || left.version !== right.version ? "changed" : "identical" };
}

export function rehydrateEntitlements(object: PortableAnalyticalObject, availableCapabilities: readonly string[], availableSourceIds: readonly string[]): EntitlementRehydration {
  const availableCaps = new Set(availableCapabilities); const availableSources = new Set(availableSourceIds);
  const missingReferences = object.requiredCapabilities.filter((capability) => !availableCaps.has(capability));
  const licensedReferences = object.sourceReferences.filter((reference) => reference.licensed).map((reference) => reference.id);
  const missingLicensed = licensedReferences.filter((id) => !availableSources.has(id));
  const missing = [...new Set([...missingReferences, ...missingLicensed])];
  return { status: missing.length ? (missingLicensed.length ? "blocked" : "degraded") : "ready", availableReferences: object.sourceReferences.filter((reference) => availableSources.has(reference.id)).map((reference) => reference.id), missingReferences: missing, licensedReferences, reason: missing.length ? "Recipient capabilities or licensed source entitlements are unavailable; no source values were copied." : "All required capabilities and source entitlements are available." };
}

export function canShareObject(object: PortableAnalyticalObject, grant: ShareGrant, actorId: number): { allowed: boolean; reason: string } {
  if (grant.grantorId !== actorId || object.ownerId !== actorId) return { allowed: false, reason: "Only the object owner may create or use this share grant." };
  if (grant.external && object.sourceReferences.some((reference) => reference.licensed)) return { allowed: false, reason: "Licensed source references cannot be shared externally without an enterprise entitlement." };
  if (grant.access !== "view" && object.visibility === "private") return { allowed: false, reason: "Fork/recompute access requires an explicit recipient or organization grant." };
  return { allowed: true, reason: "Share grant is within the owner and entitlement policy." };
}

export function buildCrossDomainRelationships(nodes: readonly CrossDomainNode[], evidenceIds: readonly string[], asOf: string | null = null): CrossDomainRelationship[] {
  const result: CrossDomainRelationship[] = [];
  const add = (source: CrossDomainNode, target: CrossDomainNode, relation: CrossDomainRelationship["relation"]): void => { result.push({ id: `relationship:${source.kind}:${source.key}:${target.kind}:${target.key}:${relation}`, source, target, relation, strength: null, evidenceIds: [...new Set(evidenceIds)], asOf, status: evidenceIds.length ? "observed" : "unavailable" }); };
  for (const source of nodes) for (const target of nodes) {
    if (source === target) continue;
    if ((source.kind === "macro" || source.kind === "policy") && (target.kind === "company" || target.kind === "portfolio")) add(source, target, "impacts");
    else if (source.kind === "supply_chain" && target.kind === "company") add(source, target, "depends_on");
    else if (source.kind === "company" && target.kind === "valuation") add(source, target, "values");
    else if (source.kind === "valuation" && target.kind === "portfolio") add(source, target, "exposes");
  }
  return result;
}

export function planDeclarativeWorkspace(prompt: string, id: string, ownerId: number, now = new Date()): WorkspacePlan {
  const normalized = prompt.trim().toLowerCase();
  const primitives: Array<WorkspaceBlock["primitive"]> = [];
  if (/quote|price|market/.test(normalized)) primitives.push("quote");
  if (/chart|trend|history/.test(normalized)) primitives.push("chart");
  if (/table|compare|screener/.test(normalized)) primitives.push("table");
  if (/metric|valuation|dcf/.test(normalized)) primitives.push("metric");
  if (/news|research/.test(normalized)) primitives.push("news");
  if (/scenario|stress/.test(normalized)) primitives.push("scenario");
  if (/report|memo/.test(normalized)) primitives.push("report");
  if (/impact|relationship|macro|policy|supply/.test(normalized)) primitives.push("relationship");
  const unique = [...new Set(primitives)];
  const selectedPrimitives: Array<WorkspaceBlock["primitive"]> = unique.length ? unique : ["table"];
  const blocks = selectedPrimitives.map((primitive, index) => ({ id: `block:${id}:${index + 1}`, primitive, title: `${primitive[0].toUpperCase()}${primitive.slice(1)} view`, config: {} } satisfies WorkspaceBlock));
  return { id, prompt: prompt.trim(), operations: [{ action: "add_block", block: blocks[0] ?? null, visibility: null }, ...blocks.slice(1).map((block) => ({ action: "add_block" as const, block, visibility: null }))], requiredConfirmation: true, status: "proposed", reason: "Plan uses only governed workspace primitives and requires explicit confirmation before persistence.", createdAt: now.toISOString() };
}

export function enforceWorkspacePlan(plan: WorkspacePlan, permissions: readonly string[], confirmed: boolean): { allowed: boolean; reason: string } {
  if (!confirmed) return { allowed: false, reason: "Explicit confirmation is required before applying an AI-built workspace." };
  if (plan.operations.some((operation) => operation.action === "set_visibility" && operation.visibility === "public") && !permissions.includes("workspace:publish")) return { allowed: false, reason: "workspace:publish permission is required for public visibility." };
  return { allowed: true, reason: "Workspace plan passed primitive and permission checks." };
}

export const FIRST_PARTY_SKILL_PACKS: readonly SkillManifest[] = [
  { id: "first-party.india-bank", name: "India Bank Research", version: "1.0.0", description: "Bank-specific research, asset-quality and valuation workflow.", requiredInputs: ["symbol", "financial_statements", "macro_context"], requiredCapabilities: ["finance:read", "workspace:write"], supportedObjectKinds: ["dcf", "chart", "report", "portfolio_analysis"], firstParty: true, approval: "approved", publisher: "LiOS", updatedAt: "2026-09-18T00:00:00.000Z" },
  { id: "first-party.saas-valuation", name: "SaaS Valuation", version: "1.0.0", description: "ARR, retention, margin and multiple-driven SaaS valuation workflow.", requiredInputs: ["symbol", "financial_statements", "operating_metrics"], requiredCapabilities: ["finance:read", "model:run"], supportedObjectKinds: ["dcf", "scenario", "report"], firstParty: true, approval: "approved", publisher: "LiOS", updatedAt: "2026-09-18T00:00:00.000Z" },
  { id: "first-party.reit", name: "REIT Analysis", version: "1.0.0", description: "NAV, FFO, leverage and property-risk analysis workflow.", requiredInputs: ["symbol", "financial_statements", "property_context"], requiredCapabilities: ["finance:read", "workspace:write"], supportedObjectKinds: ["dcf", "chart", "report", "portfolio_analysis"], firstParty: true, approval: "approved", publisher: "LiOS", updatedAt: "2026-09-18T00:00:00.000Z" },
];

export function validateSkillManifest(value: unknown): { valid: boolean; manifest?: SkillManifest; errors: string[] } {
  const parsed = skillManifestSchema.safeParse(value);
  return parsed.success ? { valid: true, manifest: parsed.data, errors: [] } : { valid: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`) };
}
