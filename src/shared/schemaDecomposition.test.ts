import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "shared");
const read = (name: string) => fs.readFileSync(path.join(root, name), "utf8");

test("shared schema keeps PostgreSQL enum declarations in an acyclic dedicated module", () => {
  const schema = read("schema.ts");
  const enums = read("schemaEnums.ts");

  assert.doesNotMatch(schema, /\bpgEnum\s*\(/);
  assert.match(schema, /export \* from "\.\/schemaEnums";/);
  assert.match(enums, /import \{ pgEnum \} from "drizzle-orm\/pg-core";/);
  assert.doesNotMatch(enums, /from "\.\/schema"/);

  const declared = [...enums.matchAll(/^export const ([A-Za-z0-9_]+) = pgEnum\(/gm)].map((match) => match[1]);
  assert.equal(declared.length, 59, "All canonical PostgreSQL enums must stay extracted from the table barrel.");
  assert.equal(new Set(declared).size, declared.length, "Enum declarations must remain unique.");
});

test("every extracted enum is still used by the schema barrel or a domain schema module", () => {
  const enums = read("schemaEnums.ts");
  const declared = [...enums.matchAll(/^export const ([A-Za-z0-9_]+) = pgEnum\(/gm)].map((match) => match[1]);
  // Tables moved out of schema.ts into domain modules (schemaCore, schemaProjects, ...), which import the enums they use.
  const consumers = fs.readdirSync(root)
    .filter((file) => /^schema.*\.ts$/.test(file) && file !== "schemaEnums.ts" && !file.endsWith(".test.ts"))
    .map((file) => read(file));

  for (const name of declared) {
    assert.ok(consumers.some((source) => new RegExp("\\b" + name + "\\b").test(source)), name + " is declared in schemaEnums.ts but no schema module uses it");
  }
});

test("identity and Project persistence are split into one-way domain modules", () => {
  const schema = read("schema.ts");
  const core = read("schemaCore.ts");
  const projects = read("schemaProjects.ts");

  assert.match(schema, /export \* from "\.\/schemaCore";/);
  assert.match(schema, /export \* from "\.\/schemaProjects";/);

  assert.match(core, /export const licensees = pgTable/);
  assert.match(core, /export const organizations = pgTable/);
  assert.match(core, /export const users = pgTable/);
  assert.match(core, /export const projects = pgTable/);
  assert.doesNotMatch(core, /from "\.\/schema"/);

  for (const table of [
    "projectChats",
    "projectChatMessages",
    "projectResources",
    "projectSessions",
    "projectLedgerStreamHeads",
    "projectLedgerEvents",
    "projectArtifacts",
    "projectArtifactVersions",
    "projectArtifactReferences",
    "projectArtifactProposals",
    "artifactInteractionReceipts",
  ]) {
    assert.match(projects, new RegExp("export const " + table + " = pgTable"));
  }
  assert.match(projects, /from "\.\/schemaCore"/);
  assert.doesNotMatch(projects, /from "\.\/schema"/);

  assert.doesNotMatch(schema, /export const projects = pgTable/);
  assert.doesNotMatch(schema, /export const projectChats = pgTable/);
  assert.doesNotMatch(schema, /export const projectArtifacts = pgTable/);
});

test("schema compatibility barrel still has local bindings needed by later relations and domains", () => {
  const schema = read("schema.ts");
  for (const name of [
    "licensees",
    "organizations",
    "users",
    "projects",
    "projectChats",
    "projectSessions",
    "projectArtifacts",
  ]) {
    assert.match(schema, new RegExp("\\b" + name + "\\b"), "compatibility barrel lost local binding " + name);
  }
});

test("leaf schema domains are isolated from the compatibility barrel", () => {
  const schema = read("schema.ts");
  const dataFabric = read("schemaDataFabric.ts");
  const intelligence = read("schemaProjectIntelligence.ts");
  const automation = read("schemaAutomation.ts");

  assert.match(schema, /export \* from "\.\/schemaDataFabric";/);
  assert.match(schema, /export \* from "\.\/schemaProjectIntelligence";/);
  assert.match(schema, /export \* from "\.\/schemaAutomation";/);

  for (const module of [dataFabric, intelligence, automation]) {
    assert.match(module, /from "\.\/schemaCore"/);
    assert.doesNotMatch(module, /from "\.\/schema"/);
  }

  assert.match(dataFabric, /export const dataCoverageLedger = pgTable/);
  assert.match(dataFabric, /export const semanticMetricDefinitions = pgTable/);
  assert.match(dataFabric, /export const dataLineageReceipts = pgTable/);
  assert.match(dataFabric, /export const externalRightsAssessments = pgTable/);

  assert.match(intelligence, /export const projectIntelligenceDocuments = pgTable/);
  assert.match(intelligence, /export const projectIntelligenceDocumentVersions = pgTable/);
  assert.match(intelligence, /export const projectIntelligenceSnapshots = pgTable/);

  assert.match(automation, /export const projectAutomationWorkflows = pgTable/);
  assert.match(automation, /export const projectAutomationRuns = pgTable/);
  assert.match(automation, /export const projectAutomationNotifications = pgTable/);

  assert.doesNotMatch(schema, /export const dataCoverageLedger = pgTable/);
  assert.doesNotMatch(schema, /export const projectIntelligenceDocuments = pgTable/);
  assert.doesNotMatch(schema, /export const projectAutomationWorkflows = pgTable/);
});

test("schema decomposition leaves the compatibility barrel substantially smaller", () => {
  const schemaLines = read("schema.ts").split("\n").length;
  assert.ok(schemaLines < 3_000, `schema.ts regressed to ${schemaLines} lines; keep extracted domains out of the barrel.`);
});
