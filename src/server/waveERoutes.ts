/** Wave E Network, collaboration, cross-domain, AI workspace and skill routes. */
import crypto from "node:crypto";
import type { Express, Request } from "express";
import { z } from "zod";
import { requireRole } from "./auth";
import { personaPreferenceUser } from "./waveDStateStore";
import { getWaveEState, updateWaveEState } from "./waveEStateStore";
import {
  ensureFirstPartySkillsInstalled,
  listInstalledSkillCatalog,
} from "./skillRuntime";
import {
  buildCrossDomainRelationships,
  canShareObject,
  circleSchema,
  declarativeWorkspaceSchema,
  diffPortableObjects,
  enforceWorkspacePlan,
  FIRST_PARTY_SKILL_PACKS,
  followSchema,
  networkPostSchema,
  networkProfileSchema,
  networkTargetSchema,
  planDeclarativeWorkspace,
  portableAnalyticalObjectSchema,
  rehydrateEntitlements,
  shareGrantSchema,
  skillManifestSchema,
  structuredIdeaSchema,
  type Circle,
  type CrossDomainNode,
  type NetworkPost,
  type PortableAnalyticalObject,
  type WorkspaceBlock,
  WAVE_E_CONTRACT_VERSION,
} from "@shared/waveEContracts";
import { answerContextualQuestion } from "./waveDIntegrations";

const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;
const AUTHOR_ROLES = ["internal_admin", "internal_analyst"] as const;
const MODERATION_ROLES = ["internal_admin", "internal_compliance"] as const;
const id = (prefix: string): string => `wave-e:${prefix}:${crypto.randomUUID()}`;
const now = (): string => new Date().toISOString();
const ACTION_WINDOW_MS = 60_000;
const ACTION_LIMIT = 60;
const actionWindows = new Map<string, { startedAt: number; count: number }>();

function allowAction(userId: number, action: string): boolean {
  const key = `${userId}:${action}`;
  const current = actionWindows.get(key);
  const timestamp = Date.now();
  if (!current || timestamp - current.startedAt >= ACTION_WINDOW_MS) {
    actionWindows.set(key, { startedAt: timestamp, count: 1 });
    return true;
  }
  if (current.count >= ACTION_LIMIT) return false;
  current.count += 1;
  return true;
}

function rateLimited(userId: number, action: string, res: { status: (code: number) => { json: (body: unknown) => unknown } }): boolean {
  if (allowAction(userId, action)) return false;
  res.status(429).json({ error: "Wave E action rate limit exceeded.", retryAfterSeconds: Math.ceil(ACTION_WINDOW_MS / 1_000) });
  return true;
}

const profilePatchSchema = z.object({
  handle: z.string().trim().min(2).max(80).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
  displayName: z.string().trim().min(1).max(160).optional(),
  bio: z.string().trim().max(2_000).optional(),
  visibility: z.enum(["private", "organization", "public"]).optional(),
  disclosures: z.array(z.string().trim().min(1).max(240)).max(20).optional(),
}).strict();
const followInputSchema = z.object({ target: networkTargetSchema }).strict();
const messageSchema = z.object({ recipientId: z.number().int().positive(), threadId: z.string().trim().max(160).optional(), body: z.string().trim().min(1).max(10_000) }).strict();
const circleInputSchema = z.object({ name: z.string().trim().min(1).max(160), description: z.string().trim().max(2_000).default(""), visibility: z.enum(["private", "organization", "public"]).default("private") }).strict();
const memberSchema = z.object({ userId: z.number().int().positive(), role: z.enum(["moderator", "member"]).default("member") }).strict();
const postInputSchema = z.object({ kind: z.enum(["discussion", "idea"]), title: z.string().trim().max(240).optional(), body: z.string().trim().min(1).max(20_000), structuredIdea: structuredIdeaSchema.optional(), circleId: z.string().trim().max(160).optional(), roomKey: z.string().trim().max(240).optional(), visibility: z.enum(["private", "organization", "public"]).default("private"), evidenceIds: z.array(z.string().trim().min(1).max(240)).max(100).default([]) }).strict();
const reactionInputSchema = z.object({ kind: z.enum(["useful", "insightful", "challenge"]) }).strict();
const replySchema = z.object({ body: z.string().trim().min(1).max(20_000), visibility: z.enum(["private", "organization", "public"]).default("private"), evidenceIds: z.array(z.string().trim().min(1).max(240)).max(100).default([]) }).strict();
const moderationInputSchema = z.object({ subjectType: z.enum(["user", "post", "message", "circle"]), subjectId: z.string().trim().min(1).max(240), reason: z.string().trim().min(1).max(2_000) }).strict();
const objectInputSchema = z.object({ kind: z.enum(["dcf", "chart", "screener", "scenario", "portfolio_analysis", "report", "workspace"]), title: z.string().trim().min(1).max(240), version: z.string().trim().min(1).max(80).default("1.0.0"), payload: z.record(z.unknown()), sourceReferences: z.array(z.object({ id: z.string().trim().min(1).max(240), revision: z.string().trim().min(1).max(240), licensed: z.boolean().default(false) }).strict()).max(500).default([]), requiredCapabilities: z.array(z.string().trim().min(1).max(160)).max(100).default([]), visibility: z.enum(["private", "organization", "public"]).default("private") }).strict();
const shareInputSchema = z.object({ recipientUserId: z.number().int().positive().nullable().default(null), organizationId: z.number().int().positive().nullable().default(null), access: z.enum(["view", "fork", "recompute"]), external: z.boolean().default(false), expiresAt: z.string().datetime().nullable().default(null) }).strict();
const entitlementSchema = z.object({ capabilities: z.array(z.string().trim().min(1).max(160)).default([]), sourceIds: z.array(z.string().trim().min(1).max(240)).default([]) }).strict();
const crossDomainInputSchema = z.object({ nodes: z.array(z.object({ kind: z.enum(["macro", "policy", "supply_chain", "company", "valuation", "portfolio"]), key: z.string().trim().min(1).max(240), label: z.string().trim().min(1).max(240) }).strict()).min(1).max(50), evidenceIds: z.array(z.string().trim().min(1).max(240)).max(100).default([]), asOf: z.string().datetime().nullable().default(null) }).strict();
const scenarioInputSchema = z.object({ title: z.string().trim().min(1).max(240), nodes: crossDomainInputSchema.shape.nodes, shocks: z.record(z.number().finite()).default({}), evidenceIds: z.array(z.string().trim().min(1).max(240)).max(100).default([]) }).strict();
const workspacePromptSchema = z.object({ prompt: z.string().trim().min(1).max(2_000) }).strict();
const workspaceConfirmSchema = z.object({ planId: z.string().trim().min(1).max(160), confirmed: z.literal(true), permissions: z.array(z.string().trim().min(1).max(160)).default([]), title: z.string().trim().min(1).max(240).default("AI workspace") }).strict();
const workspaceBlockInputSchema = z.object({ title: z.string().trim().min(1).max(240), blocks: z.array(z.object({ id: z.string().trim().min(1).max(160), primitive: z.enum(["quote", "chart", "table", "metric", "news", "scenario", "report", "relationship"]), title: z.string().trim().min(1).max(240), config: z.record(z.unknown()) }).strict()).max(50), visibility: z.enum(["private", "organization", "public"]).default("private") }).strict();

function waveEUser(req: Request) {
  return personaPreferenceUser(req.user!);
}

function visiblePost(post: NetworkPost, userId: number, state: Awaited<ReturnType<typeof getWaveEState>>): boolean {
  if (post.authorId === userId || post.visibility === "public") return true;
  if (post.visibility === "organization") return true;
  if (post.circleId) return state.circles.some((circle) => circle.id === post.circleId && circle.members.some((member) => member.userId === userId));
  return false;
}

function profileForUser(state: Awaited<ReturnType<typeof getWaveEState>>, userId: number): ReturnType<typeof networkProfileSchema.parse> | null {
  return state.profile?.id === userId ? state.profile : null;
}

function mentionsInBody(body: string, postId: string, createdAt: string) {
  const ids = [...body.matchAll(/(?:^|\s)@(\d+)\b/g)].map((match) => Number(match[1])).filter((value) => Number.isInteger(value) && value > 0);
  return [...new Set(ids)].slice(0, 20).map((mentionedUserId) => ({
    id: id("mention"),
    postId,
    mentionedUserId,
    status: "unread" as const,
    createdAt,
  }));
}

export function registerWaveERoutes(app: Express): void {
  app.get("/api/readiness/wave-e", requireRole(...READ_ROLES), async (req, res) => {
    const state = await getWaveEState(waveEUser(req));
    const installedSkills = listInstalledSkillCatalog();
    res.json({
      contractVersion: WAVE_E_CONTRACT_VERSION,
      local: {
        profile: Boolean(state.profile),
        posts: state.posts.length,
        objects: state.objects.length,
        relationships: state.relationships.length,
        scenarios: state.scenarios.length,
        workspaces: state.workspaces.length,
        skills: installedSkills.length,
      },
      workstreams: {
        network: "local-first",
        collaborativeAnalytics: "local-first",
        crossDomainIntelligence: "local-first",
        aiBuiltExperiences: "governed-proposal-first",
        skills: "curated-first-party",
      },
      externalBlockers: [
        "Production multi-user discovery and message delivery require a shared network/notification adapter.",
        "OAuth, tenant data and licensed-provider entitlement adapters remain deployment-specific.",
        "Enterprise external sharing requires an organization policy and entitlement service.",
        "Cross-domain AI explanation requires a configured Wave D AI provider credential.",
        "Deterministic recomputation remains queued behind the existing calculation runtime.",
      ],
      updatedAt: state.updatedAt,
    });
  });

  // V4-15 — Network
  app.get("/api/wave-e/profile", requireRole(...READ_ROLES), async (req, res) => {
    const state = await getWaveEState(waveEUser(req));
    res.json({ profile: profileForUser(state, req.user!.id), visibilityModel: ["private", "organization", "public"], disclosureRequiredForPublic: true });
  });

  app.put("/api/wave-e/profile", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = profilePatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid network profile.", issues: parsed.error.issues });
    const user = waveEUser(req); const state = await getWaveEState(user);
    const profile = networkProfileSchema.parse({ id: user.id, handle: parsed.data.handle ?? state.profile?.handle ?? `analyst-${user.id}`, displayName: parsed.data.displayName ?? state.profile?.displayName ?? user.email, bio: parsed.data.bio ?? state.profile?.bio ?? "", visibility: parsed.data.visibility ?? state.profile?.visibility ?? "private", disclosures: parsed.data.disclosures ?? state.profile?.disclosures ?? [], updatedAt: now() });
    if (profile.visibility === "public" && profile.disclosures.length === 0) return res.status(422).json({ error: "A public profile requires at least one disclosure." });
    const next = await updateWaveEState(user, (current) => ({ ...current, profile }));
    res.json({ profile, persisted: true, updatedAt: next.updatedAt });
  });

  app.put("/api/wave-e/profile/disclosure", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = z.object({ disclosures: z.array(z.string().trim().min(1).max(240)).max(20) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid disclosure list.", issues: parsed.error.issues });
    const user = waveEUser(req); const current = await getWaveEState(user);
    const profile = networkProfileSchema.parse({ id: user.id, handle: current.profile?.handle ?? `analyst-${user.id}`, displayName: current.profile?.displayName ?? user.email, bio: current.profile?.bio ?? "", visibility: current.profile?.visibility ?? "private", disclosures: parsed.data.disclosures, updatedAt: now() });
    const next = await updateWaveEState(user, (state) => ({ ...state, profile }));
    res.json({ profile, persisted: true, updatedAt: next.updatedAt });
  });

  app.get("/api/wave-e/follows", requireRole(...READ_ROLES), async (req, res) => res.json({ follows: (await getWaveEState(waveEUser(req))).follows }));
  app.post("/api/wave-e/follows", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = followInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid follow target.", issues: parsed.error.issues });
    const user = waveEUser(req); if (rateLimited(user.id, "follow", res)) return; const record = followSchema.parse({ id: id("follow"), target: parsed.data.target, createdAt: now() });
    const next = await updateWaveEState(user, (state) => ({ ...state, follows: [...state.follows.filter((item) => item.target.kind !== record.target.kind || item.target.id !== record.target.id), record] }));
    res.status(201).json({ follow: record, persisted: true, updatedAt: next.updatedAt });
  });
  app.delete("/api/wave-e/follows/:kind/:id", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const user = waveEUser(req); const next = await updateWaveEState(user, (state) => ({ ...state, follows: state.follows.filter((item) => item.target.kind !== req.params.kind || item.target.id !== req.params.id) }));
    res.json({ status: "unfollowed", persisted: true, updatedAt: next.updatedAt });
  });

  app.get("/api/wave-e/messages/:threadId", requireRole(...READ_ROLES), async (req, res) => {
    const user = waveEUser(req); const messages = (await getWaveEState(user)).messages.filter((message) => message.threadId === req.params.threadId && (message.senderId === user.id || message.recipientId === user.id));
    res.json({ messages });
  });
  app.post("/api/wave-e/messages", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid direct message.", issues: parsed.error.issues });
    const user = waveEUser(req); if (rateLimited(user.id, "message", res)) return; const message = { id: id("message"), threadId: parsed.data.threadId ?? id("thread"), senderId: user.id, recipientId: parsed.data.recipientId, body: parsed.data.body, createdAt: now(), readAt: null };
    const notification = { id: id("notification"), userId: message.recipientId, kind: "message" as const, subjectId: message.threadId, read: false, createdAt: message.createdAt };
    const next = await updateWaveEState(user, (state) => ({ ...state, messages: [...state.messages, message], notifications: [...state.notifications, notification] }));
    res.status(201).json({ message, persisted: true, notificationQueued: true, updatedAt: next.updatedAt });
  });

  app.get("/api/wave-e/circles", requireRole(...READ_ROLES), async (req, res) => {
    const user = waveEUser(req); const state = await getWaveEState(user); res.json({ circles: state.circles.filter((circle) => circle.visibility === "public" || circle.ownerId === user.id || circle.members.some((member) => member.userId === user.id)) });
  });
  app.post("/api/wave-e/circles", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = circleInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid circle.", issues: parsed.error.issues });
    const user = waveEUser(req); const circle = circleSchema.parse({ id: id("circle"), ...parsed.data, ownerId: user.id, members: [{ userId: user.id, role: "owner", joinedAt: now() }], createdAt: now() });
    const next = await updateWaveEState(user, (state) => ({ ...state, circles: [...state.circles, circle] })); res.status(201).json({ circle, persisted: true, updatedAt: next.updatedAt });
  });
  app.post("/api/wave-e/circles/:id/members", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = memberSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid circle member.", issues: parsed.error.issues });
    const user = waveEUser(req); let changed = false;
    const next = await updateWaveEState(user, (state) => ({ ...state, circles: state.circles.map((circle) => { if (circle.id !== req.params.id || circle.ownerId !== user.id) return circle; changed = true; return { ...circle, members: [...circle.members.filter((member) => member.userId !== parsed.data.userId), { userId: parsed.data.userId, role: parsed.data.role, joinedAt: now() }] }; }) }));
    if (!changed) return res.status(404).json({ error: "Circle not found or membership change not permitted." }); res.json({ circle: next.circles.find((circle) => circle.id === req.params.id), persisted: true, updatedAt: next.updatedAt });
  });

  app.get("/api/wave-e/feed", requireRole(...READ_ROLES), async (req, res) => {
    const user = waveEUser(req); const state = await getWaveEState(user); const following = new Set(state.follows.filter((item) => item.target.kind === "person").map((item) => Number(item.target.id)));
    const feed = state.posts.filter((post) => visiblePost(post, user.id, state) && (req.query.roomKey ? post.roomKey === String(req.query.roomKey) : true) && (req.query.following === "true" ? (post.authorId === user.id || following.has(post.authorId)) : true)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ posts: feed, reactions: state.reactions, saves: state.saves });
  });
  app.post("/api/wave-e/posts", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = postInputSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid network post.", issues: parsed.error.issues });
    if (parsed.data.kind === "idea" && !parsed.data.structuredIdea) return res.status(400).json({ error: "Structured ideas require thesis, catalyst, risks, invalidation, horizon and evidence." });
    const user = waveEUser(req); if (rateLimited(user.id, "post", res)) return; const post = networkPostSchema.parse({ id: id("post"), authorId: user.id, kind: parsed.data.kind, title: parsed.data.title ?? null, body: parsed.data.body, structuredIdea: parsed.data.structuredIdea ?? null, circleId: parsed.data.circleId ?? null, roomKey: parsed.data.roomKey ?? null, parentId: null, visibility: parsed.data.visibility, evidenceIds: parsed.data.evidenceIds, createdAt: now() });
    const mentions = mentionsInBody(post.body, post.id, post.createdAt);
    const mentionNotifications = mentions.map((mention) => ({ id: id("notification"), userId: mention.mentionedUserId, kind: "mention" as const, subjectId: post.id, read: false, createdAt: post.createdAt }));
    const next = await updateWaveEState(user, (state) => ({ ...state, posts: [...state.posts, post], mentions: [...state.mentions, ...mentions], notifications: [...state.notifications, ...mentionNotifications] })); res.status(201).json({ post, mentions, persisted: true, updatedAt: next.updatedAt });
  });
  app.post("/api/wave-e/posts/:id/reactions", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = reactionInputSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid reaction.", issues: parsed.error.issues });
    const user = waveEUser(req); if (rateLimited(user.id, "reaction", res)) return; const postId = String(req.params.id); const reaction = { id: id("reaction"), postId, userId: user.id, kind: parsed.data.kind, createdAt: now() };
    const next = await updateWaveEState(user, (state) => ({ ...state, reactions: [...state.reactions.filter((item) => !(item.postId === reaction.postId && item.userId === user.id)), reaction] })); res.status(201).json({ reaction, persisted: true, updatedAt: next.updatedAt });
  });
  app.post("/api/wave-e/posts/:id/save", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const user = waveEUser(req); const postId = String(req.params.id); const save = { id: id("save"), postId, userId: user.id, createdAt: now() }; const next = await updateWaveEState(user, (state) => ({ ...state, saves: [...state.saves.filter((item) => !(item.postId === save.postId && item.userId === user.id)), save] })); res.status(201).json({ save, persisted: true, updatedAt: next.updatedAt });
  });
  app.post("/api/wave-e/posts/:id/replies", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = replySchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid reply.", issues: parsed.error.issues });
    const user = waveEUser(req); if (rateLimited(user.id, "reply", res)) return; const postId = String(req.params.id); const parent = (await getWaveEState(user)).posts.find((post) => post.id === postId); if (!parent) return res.status(404).json({ error: "Post not found." });
    const reply = networkPostSchema.parse({ id: id("reply"), authorId: user.id, kind: "reply", title: null, body: parsed.data.body, structuredIdea: null, circleId: parent.circleId, roomKey: parent.roomKey, parentId: parent.id, visibility: parsed.data.visibility, evidenceIds: parsed.data.evidenceIds, createdAt: now() });
    const notification = { id: id("notification"), userId: parent.authorId, kind: "reply" as const, subjectId: parent.id, read: false, createdAt: reply.createdAt }; const mentions = mentionsInBody(reply.body, reply.id, reply.createdAt); const mentionNotifications = mentions.map((mention) => ({ id: id("notification"), userId: mention.mentionedUserId, kind: "mention" as const, subjectId: reply.id, read: false, createdAt: reply.createdAt })); const next = await updateWaveEState(user, (state) => ({ ...state, posts: [...state.posts, reply], mentions: [...state.mentions, ...mentions], notifications: [...state.notifications, notification, ...mentionNotifications] })); res.status(201).json({ post: reply, mentions, persisted: true, updatedAt: next.updatedAt });
  });
  app.get("/api/wave-e/rooms", requireRole(...READ_ROLES), async (req, res) => { const state = await getWaveEState(waveEUser(req)); const rooms = [...new Set(state.posts.map((post) => post.roomKey).filter((key): key is string => !!key))].map((key) => ({ key, postCount: state.posts.filter((post) => post.roomKey === key).length })); res.json({ rooms }); });
  app.post("/api/wave-e/rooms", requireRole(...AUTHOR_ROLES), async (req, res) => { const parsed = z.object({ key: z.string().trim().min(1).max(240), visibility: z.enum(["private", "organization", "public"]).default("private") }).strict().safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid room.", issues: parsed.error.issues }); res.status(201).json({ room: { ...parsed.data, createdAt: now() }, persisted: false, reason: "Rooms are materialized by attributed posts; create the first post to persist activity." }); });

  app.get("/api/wave-e/notifications", requireRole(...READ_ROLES), async (req, res) => { const user = waveEUser(req); res.json({ notifications: (await getWaveEState(user)).notifications.filter((notification) => notification.userId === user.id) }); });
  app.post("/api/wave-e/moderation/report", requireRole(...AUTHOR_ROLES), async (req, res) => { const parsed = moderationInputSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid report.", issues: parsed.error.issues }); const user = waveEUser(req); const item = { id: id("moderation"), reporterId: user.id, ...parsed.data, action: "report" as const, status: "open" as const, createdAt: now() }; const next = await updateWaveEState(user, (state) => ({ ...state, moderationCases: [...state.moderationCases, item] })); res.status(201).json({ case: item, persisted: true, updatedAt: next.updatedAt }); });
  app.post("/api/wave-e/moderation/block", requireRole(...AUTHOR_ROLES), async (req, res) => { const parsed = moderationInputSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid block.", issues: parsed.error.issues }); const user = waveEUser(req); const item = { id: id("moderation"), reporterId: user.id, ...parsed.data, action: "block" as const, status: "resolved" as const, createdAt: now() }; const next = await updateWaveEState(user, (state) => ({ ...state, moderationCases: [...state.moderationCases, item] })); res.status(201).json({ case: item, persisted: true, updatedAt: next.updatedAt }); });
  app.post("/api/wave-e/moderation/mute", requireRole(...AUTHOR_ROLES), async (req, res) => { const parsed = moderationInputSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid mute.", issues: parsed.error.issues }); const user = waveEUser(req); const item = { id: id("moderation"), reporterId: user.id, ...parsed.data, action: "mute" as const, status: "resolved" as const, createdAt: now() }; const next = await updateWaveEState(user, (state) => ({ ...state, moderationCases: [...state.moderationCases, item] })); res.status(201).json({ case: item, persisted: true, updatedAt: next.updatedAt }); });
  app.get("/api/wave-e/moderation/cases", requireRole(...MODERATION_ROLES), async (_req, res) => { res.json({ cases: (await getWaveEState(waveEUser(_req))).moderationCases }); });

  // V4-16 — Collaborative analytics
  app.get("/api/wave-e/objects", requireRole(...READ_ROLES), async (req, res) => { const user = waveEUser(req); const state = await getWaveEState(user); res.json({ objects: state.objects.filter((object) => object.ownerId === user.id || object.visibility !== "private"), shares: state.shares.filter((share) => share.grantorId === user.id || share.recipientUserId === user.id) }); });
  app.post("/api/wave-e/objects", requireRole(...AUTHOR_ROLES), async (req, res) => { const parsed = objectInputSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid portable analytical object.", issues: parsed.error.issues }); const user = waveEUser(req); const object = portableAnalyticalObjectSchema.parse({ id: id("object"), ownerId: user.id, ...parsed.data, forkOf: null, createdAt: now(), updatedAt: now() }); const next = await updateWaveEState(user, (state) => ({ ...state, objects: [...state.objects, object] })); res.status(201).json({ object, persisted: true, updatedAt: next.updatedAt }); });
  app.post("/api/wave-e/objects/:id/share", requireRole(...AUTHOR_ROLES), async (req, res) => { const parsed = shareInputSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid share grant.", issues: parsed.error.issues }); const user = waveEUser(req); const state = await getWaveEState(user); const object = state.objects.find((item) => item.id === req.params.id); if (!object) return res.status(404).json({ error: "Analytical object not found." }); const grant = shareGrantSchema.parse({ id: id("share"), objectId: object.id, grantorId: user.id, ...parsed.data, createdAt: now() }); const policy = canShareObject(object, grant, user.id); if (!policy.allowed) return res.status(403).json({ status: "blocked", reason: policy.reason }); const next = await updateWaveEState(user, (current) => ({ ...current, shares: [...current.shares, grant] })); res.status(201).json({ grant, persisted: true, updatedAt: next.updatedAt }); });
  app.post("/api/wave-e/objects/:id/open", requireRole(...READ_ROLES), async (req, res) => { const user = waveEUser(req); const state = await getWaveEState(user); const object = state.objects.find((item) => item.id === req.params.id && (item.ownerId === user.id || item.visibility !== "private")); if (!object) return res.status(404).json({ error: "Analytical object not found." }); const parsed = entitlementSchema.safeParse(req.body ?? {}); const entitlements = parsed.success ? rehydrateEntitlements(object, parsed.data.capabilities, parsed.data.sourceIds) : { status: "blocked" as const, availableReferences: [], missingReferences: ["invalid_entitlement_payload"], licensedReferences: [], reason: "Invalid entitlement payload." }; res.status(entitlements.status === "blocked" ? 403 : 200).json({ object: { ...object, payload: entitlements.status === "blocked" ? {} : object.payload }, entitlements }); });
  app.post("/api/wave-e/objects/:id/fork", requireRole(...AUTHOR_ROLES), async (req, res) => { const user = waveEUser(req); const state = await getWaveEState(user); const object = state.objects.find((item) => item.id === req.params.id); if (!object) return res.status(404).json({ error: "Analytical object not found." }); const grant = state.shares.find((share) => share.objectId === object.id && share.recipientUserId === user.id && (share.access === "fork" || share.access === "recompute")); if (object.ownerId !== user.id && !grant) return res.status(403).json({ error: "Fork permission is required." }); const fork = portableAnalyticalObjectSchema.parse({ ...object, id: id("object"), ownerId: user.id, title: `${object.title} (Fork)`, forkOf: object.id, visibility: "private", createdAt: now(), updatedAt: now() }); const next = await updateWaveEState(user, (current) => ({ ...current, objects: [...current.objects, fork] })); res.status(201).json({ object: fork, persisted: true, updatedAt: next.updatedAt }); });
  app.post("/api/wave-e/objects/:id/recompute", requireRole(...AUTHOR_ROLES), async (req, res) => { const user = waveEUser(req); const state = await getWaveEState(user); const object = state.objects.find((item) => item.id === req.params.id); if (!object) return res.status(404).json({ error: "Analytical object not found." }); const parsed = entitlementSchema.safeParse(req.body ?? {}); if (!parsed.success) return res.status(400).json({ error: "Invalid recipient entitlement payload.", issues: parsed.error.issues }); const entitlements = rehydrateEntitlements(object, parsed.data.capabilities, parsed.data.sourceIds); if (entitlements.status === "blocked") return res.status(403).json({ status: "blocked", entitlements }); res.json({ status: "queued", recomputed: false, entitlements, reason: "Recipient entitlements are valid; deterministic engine recomputation is queued behind the existing calculation runtime." }); });
  app.post("/api/wave-e/objects/:id/diff", requireRole(...READ_ROLES), async (req, res) => { const parsed = portableAnalyticalObjectSchema.safeParse(req.body?.other); if (!parsed.success) return res.status(400).json({ error: "A valid comparison object is required.", issues: parsed.error.issues }); const state = await getWaveEState(waveEUser(req)); const object = state.objects.find((item) => item.id === req.params.id); if (!object) return res.status(404).json({ error: "Analytical object not found." }); res.json({ diff: diffPortableObjects(object, parsed.data) }); });
  app.get("/api/wave-e/sharing/policy", requireRole(...READ_ROLES), (_req, res) => res.json({ licensedData: "never_copied", externalSharing: "enterprise_entitlement_required", recipientRecompute: "rehydrate_before_execute", confirmationRequired: true }));

  // V4-20 — Cross-domain intelligence
  app.get("/api/wave-e/cross-domain/relationships", requireRole(...READ_ROLES), async (req, res) => { const state = await getWaveEState(waveEUser(req)); res.json({ relationships: state.relationships }); });
  app.post("/api/wave-e/cross-domain/relationships", requireRole(...AUTHOR_ROLES), async (req, res) => { const parsed = crossDomainInputSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid cross-domain graph.", issues: parsed.error.issues }); const relationships = buildCrossDomainRelationships(parsed.data.nodes as CrossDomainNode[], parsed.data.evidenceIds, parsed.data.asOf); const user = waveEUser(req); const next = await updateWaveEState(user, (state) => ({ ...state, relationships: [...state.relationships.filter((item) => !relationships.some((candidate) => candidate.id === item.id)), ...relationships] })); res.status(201).json({ relationships, persisted: true, updatedAt: next.updatedAt }); });
  app.post("/api/wave-e/cross-domain/scenarios", requireRole(...AUTHOR_ROLES), async (req, res) => { const parsed = scenarioInputSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid cross-domain scenario.", issues: parsed.error.issues }); const scenario = { id: id("scenario"), title: parsed.data.title, nodes: parsed.data.nodes as CrossDomainNode[], shocks: parsed.data.shocks, status: "queued" as const, reason: "Cross-domain shocks are staged for the existing deterministic scenario runtime; no observations are fabricated.", createdAt: now() }; const user = waveEUser(req); const next = await updateWaveEState(user, (state) => ({ ...state, scenarios: [...state.scenarios, scenario] })); res.status(201).json({ scenario, persisted: true, updatedAt: next.updatedAt }); });
  app.post("/api/wave-e/cross-domain/explain", requireRole(...READ_ROLES), async (req, res) => { const parsed = crossDomainInputSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid cross-domain explanation request.", issues: parsed.error.issues }); const relationships = buildCrossDomainRelationships(parsed.data.nodes as CrossDomainNode[], parsed.data.evidenceIds, parsed.data.asOf); const card = { id: id("cross-domain-card"), kind: "ai_insight" as const, title: "Cross-domain relationship explanation", whatHappened: `${relationships.length} governed relationship(s) were identified.`, whyItMatters: "Relationships are shown only with explicit evidence or an unavailable status.", whyItMattersToUser: "Review the linked sources before using the relationship in a decision.", nextActions: ["analyse", "save", "ask"] as Array<"analyse" | "save" | "ask">, createdAt: now(), unread: true, evidence: parsed.data.evidenceIds.map((evidenceId) => ({ id: evidenceId, source: "cross-domain request" })) , score: 0, priority: "fyi" as const, status: "unread" as const }; const answer = await answerContextualQuestion(card, "Explain the observed cross-domain relationships and their limitations."); res.json({ relationships, answerStatus: answer.status, answer: answer.answer, answerReason: answer.reason, provider: answer.provider, model: answer.model, attribution: answer.attribution }); });

  // V4-21 — AI-built experiences
  app.post("/api/wave-e/ai/workspaces/plan", requireRole(...AUTHOR_ROLES), async (req, res) => { const parsed = workspacePromptSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid workspace prompt.", issues: parsed.error.issues }); const user = waveEUser(req); const plan = planDeclarativeWorkspace(parsed.data.prompt, id("workspace-plan"), user.id); const next = await updateWaveEState(user, (state) => ({ ...state, workspacePlans: [...state.workspacePlans, plan] })); res.status(201).json({ plan, persisted: true, updatedAt: next.updatedAt }); });
  app.post("/api/wave-e/ai/workspaces/preview", requireRole(...READ_ROLES), async (req, res) => { const parsed = workspacePromptSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid workspace prompt.", issues: parsed.error.issues }); const user = waveEUser(req); res.json({ plan: planDeclarativeWorkspace(parsed.data.prompt, id("workspace-preview"), user.id), previewOnly: true, confirmationRequired: true }); });
  app.post("/api/wave-e/ai/workspaces/confirm", requireRole(...AUTHOR_ROLES), async (req, res) => { const parsed = workspaceConfirmSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid workspace confirmation.", issues: parsed.error.issues }); const user = waveEUser(req); const state = await getWaveEState(user); const plan = state.workspacePlans.find((item) => item.id === parsed.data.planId); if (!plan) return res.status(404).json({ error: "Workspace plan not found." }); const policy = enforceWorkspacePlan(plan, parsed.data.permissions, parsed.data.confirmed); if (!policy.allowed) return res.status(403).json({ status: "blocked", reason: policy.reason }); const blocks = plan.operations.flatMap((operation) => operation.block ? [operation.block] : []); const workspace = declarativeWorkspaceSchema.parse({ id: id("workspace"), ownerId: user.id, title: parsed.data.title, blocks, requiredCapabilities: [], visibility: "private", status: "confirmed", createdAt: now(), updatedAt: now() }); const next = await updateWaveEState(user, (current) => ({ ...current, workspaces: [...current.workspaces, workspace], workspacePlans: current.workspacePlans.map((item) => item.id === plan.id ? { ...item, status: "confirmed" as const } : item) })); res.status(201).json({ workspace, persisted: true, updatedAt: next.updatedAt }); });
  app.post("/api/wave-e/ai/monitors/build", requireRole(...AUTHOR_ROLES), async (req, res) => { const parsed = workspacePromptSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid monitor prompt.", issues: parsed.error.issues }); res.json({ status: "proposal", prompt: parsed.data.prompt, requiresConfirmation: true, reason: "AI may propose a monitor, but Wave D's explicit signal/schedule route remains the only activation path." }); });
  app.post("/api/wave-e/ai/reports/build", requireRole(...AUTHOR_ROLES), async (req, res) => { const parsed = workspacePromptSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid report prompt.", issues: parsed.error.issues }); res.json({ status: "proposal", prompt: parsed.data.prompt, requiresConfirmation: true, reason: "Report configuration is a reviewable proposal; no report is sent or published automatically." }); });

  // V4-22 — Skill/template ecosystem. P13 is the sole install/trust/runtime authority.
  app.get("/api/wave-e/skills", requireRole(...READ_ROLES), (_req, res) => {
    res.json({ skills: listInstalledSkillCatalog(), authority: "p13" });
  });
  app.get("/api/wave-e/skills/packs", requireRole(...READ_ROLES), (_req, res) => {
    const packs = listInstalledSkillCatalog().filter((skill) => skill.firstParty);
    res.json({ packs, authority: "p13" });
  });
  app.post("/api/wave-e/skills/validate", requireRole(...AUTHOR_ROLES), (req, res) => {
    const parsed = skillManifestSchema.safeParse(req.body?.manifest ?? req.body);
    if (!parsed.success) return res.status(400).json({ valid: false, errors: parsed.error.issues });
    const knownFirstParty = FIRST_PARTY_SKILL_PACKS.some((pack) => pack.id === parsed.data.id);
    res.json({
      valid: true,
      manifest: parsed.data,
      executableInstallAuthority: "p13",
      installableHere: Boolean(parsed.data.firstParty && knownFirstParty),
      approvalRequired: !parsed.data.firstParty,
    });
  });
  app.post("/api/wave-e/skills/install", requireRole(...AUTHOR_ROLES), (req, res) => {
    const parsed = skillManifestSchema.safeParse(req.body?.manifest ?? req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid skill manifest.", issues: parsed.error.issues });
    const canonical = FIRST_PARTY_SKILL_PACKS.find((pack) => pack.id === parsed.data.id);
    if (!canonical || !parsed.data.firstParty) {
      return res.status(409).json({
        status: "blocked",
        authority: "p13",
        reason: "Third-party executable skills require a signed, trusted P13 plugin package; Wave E cannot approve or activate them.",
      });
    }
    if (JSON.stringify(skillManifestSchema.parse(canonical)) !== JSON.stringify(parsed.data)) {
      return res.status(409).json({
        status: "blocked",
        authority: "p13",
        reason: "Built-in skill metadata must match the bundled canonical catalogue exactly.",
      });
    }
    ensureFirstPartySkillsInstalled();
    const skill = listInstalledSkillCatalog().find((item) => item.id === canonical.id);
    res.status(201).json({ skill, installed: Boolean(skill), authority: "p13", persisted: false, bundled: true });
  });
  app.post("/api/wave-e/skills/:id/approval", requireRole(...MODERATION_ROLES), (_req, res) => {
    res.status(409).json({
      status: "blocked",
      authority: "p13",
      reason: "Skill approval is owned by P13 package trust/signature verification; Wave E keeps no independent approval state.",
    });
  });
  app.post("/api/wave-e/workspaces", requireRole(...AUTHOR_ROLES), async (req, res) => { const parsed = workspaceBlockInputSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid declarative workspace.", issues: parsed.error.issues }); const user = waveEUser(req); const workspace = declarativeWorkspaceSchema.parse({ id: id("workspace"), ownerId: user.id, title: parsed.data.title, blocks: parsed.data.blocks as WorkspaceBlock[], requiredCapabilities: [], visibility: parsed.data.visibility, status: "confirmed", createdAt: now(), updatedAt: now() }); const next = await updateWaveEState(user, (state) => ({ ...state, workspaces: [...state.workspaces, workspace] })); res.status(201).json({ workspace, persisted: true, updatedAt: next.updatedAt }); });
  app.get("/api/wave-e/workspaces", requireRole(...READ_ROLES), async (req, res) => { const user = waveEUser(req); res.json({ workspaces: (await getWaveEState(user)).workspaces.filter((workspace) => workspace.ownerId === user.id || workspace.visibility !== "private") }); });
}
