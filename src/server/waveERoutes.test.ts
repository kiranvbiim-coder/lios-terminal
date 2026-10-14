import assert from "node:assert/strict";
import test from "node:test";
import { FIRST_PARTY_SKILL_PACKS } from "@shared/waveEContracts";
import { registerWaveERoutes } from "./waveERoutes";

test("Wave E registers every governed network, collaboration, cross-domain, AI and skill surface", () => {
  const routes: string[] = [];
  const app = {
    get(path: string) { routes.push(`GET ${path}`); return this; },
    post(path: string) { routes.push(`POST ${path}`); return this; },
    put(path: string) { routes.push(`PUT ${path}`); return this; },
    delete(path: string) { routes.push(`DELETE ${path}`); return this; },
  };
  registerWaveERoutes(app as never);
  for (const expected of [
    "GET /api/readiness/wave-e",
    "GET /api/wave-e/profile", "PUT /api/wave-e/profile", "PUT /api/wave-e/profile/disclosure",
    "GET /api/wave-e/follows", "POST /api/wave-e/follows", "DELETE /api/wave-e/follows/:kind/:id",
    "GET /api/wave-e/messages/:threadId", "POST /api/wave-e/messages",
    "GET /api/wave-e/circles", "POST /api/wave-e/circles", "POST /api/wave-e/circles/:id/members",
    "GET /api/wave-e/feed", "POST /api/wave-e/posts", "POST /api/wave-e/posts/:id/reactions", "POST /api/wave-e/posts/:id/save", "POST /api/wave-e/posts/:id/replies",
    "GET /api/wave-e/rooms", "POST /api/wave-e/rooms", "GET /api/wave-e/notifications",
    "POST /api/wave-e/moderation/report", "POST /api/wave-e/moderation/block", "POST /api/wave-e/moderation/mute", "GET /api/wave-e/moderation/cases",
    "GET /api/wave-e/objects", "POST /api/wave-e/objects", "POST /api/wave-e/objects/:id/share", "POST /api/wave-e/objects/:id/open", "POST /api/wave-e/objects/:id/fork", "POST /api/wave-e/objects/:id/recompute", "POST /api/wave-e/objects/:id/diff", "GET /api/wave-e/sharing/policy",
    "GET /api/wave-e/cross-domain/relationships", "POST /api/wave-e/cross-domain/relationships", "POST /api/wave-e/cross-domain/scenarios", "POST /api/wave-e/cross-domain/explain",
    "POST /api/wave-e/ai/workspaces/plan", "POST /api/wave-e/ai/workspaces/preview", "POST /api/wave-e/ai/workspaces/confirm", "POST /api/wave-e/ai/monitors/build", "POST /api/wave-e/ai/reports/build",
    "GET /api/wave-e/skills", "GET /api/wave-e/skills/packs", "POST /api/wave-e/skills/validate", "POST /api/wave-e/skills/install", "POST /api/wave-e/skills/:id/approval", "POST /api/wave-e/workspaces", "GET /api/wave-e/workspaces",
  ]) assert.ok(routes.includes(expected), `missing ${expected}`);
});


test("Wave E cannot approve or activate third-party skills outside P13", async () => {
  type Handler = (req: any, res: any, next?: () => void) => unknown;
  const posts = new Map<string, Handler[]>();
  const app = {
    get() { return this; },
    put() { return this; },
    delete() { return this; },
    post(path: string, ...handlers: Handler[]) {
      posts.set(path, handlers);
      return this;
    },
  };
  registerWaveERoutes(app as never);

  const thirdParty = {
    ...FIRST_PARTY_SKILL_PACKS[0]!,
    id: "third.party.skill",
    firstParty: false,
    approval: "pending" as const,
    publisher: "External Publisher",
  };
  let status = 200;
  let payload: any = null;
  const res = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { payload = value; return this; },
  };

  const install = posts.get("/api/wave-e/skills/install")!.at(-1)!;
  await install({ body: { manifest: thirdParty } }, res);
  assert.equal(status, 409);
  assert.equal(payload.authority, "p13");
  assert.match(payload.reason, /signed, trusted P13 plugin package/);

  status = 200;
  payload = null;
  const approve = posts.get("/api/wave-e/skills/:id/approval")!.at(-1)!;
  await approve({ params: { id: thirdParty.id }, body: { approval: "approved" } }, res);
  assert.equal(status, 409);
  assert.equal(payload.authority, "p13");
  assert.match(payload.reason, /P13 package trust\/signature verification/);
});
