import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { escapeLikeTerm, extractMemoryQueryTerms, hasCjk, MAX_MEMORY_TERMS } from "./memoryQueryTerms";

test("CJK runs become overlapping bigrams, mixed text keeps its words, particles and noise stay out", () => {
  assert.deepEqual(extractMemoryQueryTerms("项目预算"), { words: [], cjk: ["项目", "目预", "预算"] });
  assert.deepEqual(extractMemoryQueryTerms("用React部署方案"), { words: ["react"], cjk: ["用", "部署", "署方", "方案"] });
  assert.deepEqual(extractMemoryQueryTerms("経済政策について"), { words: [], cjk: ["経済", "済政", "政策", "策に", "につ", "つい", "いて"] });
  assert.deepEqual(extractMemoryQueryTerms("的"), { words: [], cjk: [] }, "a lone particle is not a query");
  assert.deepEqual(extractMemoryQueryTerms("budget plan"), { words: ["budget", "plan"], cjk: [] }, "non-CJK tokenization is unchanged");
  const distinct = Array.from({ length: 100 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join("");
  assert.equal(extractMemoryQueryTerms(distinct).cjk.length, MAX_MEMORY_TERMS, "the term list is bounded");
  assert.equal(hasCjk("budget"), false);
  assert.equal(hasCjk("预算"), true);
  assert.equal(escapeLikeTerm("50%_\\"), "50\\%\\_\\\\");
});

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-memory-cjk-"));
process.env.LIMURIA_DATA_DIR = dataDir;
const { initDb, closeDb, getDb } = await import("./db");
const { runWithRequestIdentity } = await import("./requestContext");
const { appendDurableMemory, deleteDurableMemory, listDurableMemories } = await import("./aiMemory");
const { users } = await import("@shared/schema");

test("owner-scoped CJK memory is found by overlapping substrings without leaking, matching metacharacters or resurrecting deletions", async t => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const db = getDb();
  const [owner, other] = await Promise.all(["owner", "other"].map(name => db.insert(users).values({
    email: `cjk-${name}-${Math.random().toString(36).slice(2)}@example.com`, passwordHash: "x", role: "internal_analyst", organizationId: null, name,
  }).returning().then(rows => rows[0]!)));
  const as = <T>(user: { id: number }, fn: () => T) => runWithRequestIdentity({ userId: user.id, organizationId: null }, fn);
  const save = (user: { id: number }, content: string) => as(user, () => appendDurableMemory({
    content, kind: "note", originKind: "user_note", epistemicStatus: "observed", observedAt: new Date().toISOString(),
  }));
  const budget = await save(owner, "项目预算是五十万，下周评审。");
  await save(owner, "経済政策について議論した。");
  await save(owner, "Use React for the dashboard 部署方案。");
  await save(owner, "unrelated English note");
  await save(other, "项目预算是另一个人的机密。");
  const find = (query: string, matchAnyTerm = true) => as(owner, () => listDurableMemories({ query, matchAnyTerm }));

  assert.deepEqual((await find("预算")).map(row => row.content), ["项目预算是五十万，下周评审。"], "a different substring recalls the Chinese note");
  assert.equal((await find("项目预算")).length, 1, "owner isolation: the other owner's matching note is never returned");
  assert.equal((await find("経済政策")).length, 1, "Japanese kanji+kana note is recalled");
  assert.equal((await find("用React部署")).length, 1, "mixed ASCII/CJK query keeps both halves");
  assert.equal((await find("的")).length, 0, "a particle-only query returns nothing");
  assert.equal((await find("预算", false)).length, 1, "the plain query path also works for CJK");
  assert.equal((await find("%")).length, 0, "LIKE metacharacters never match everything");
  assert.equal((await find("unrelated")).length, 1, "ASCII search is unchanged");
  assert.equal((await find("天气预报")).length, 0, "no fuzzy widening: an unrelated phrase matches nothing");

  await as(owner, () => deleteDurableMemory({ memoryKey: budget!.memoryKey, expectedRevision: budget!.revision }));
  assert.equal((await find("预算")).length, 0, "a deleted memory is not recalled");
});
