import test from "node:test";
import assert from "node:assert/strict";
import {
  ambiguousMentionTokens, eligibleProjectMentions, latestMentionQuery,
  normalizedMentionToken, stageResourceMention, userMentionTokens,
  type ProjectMentionResource,
} from "./mentionContext";

const resource = (id: string, label: string, changes: Partial<ProjectMentionResource> = {}): ProjectMentionResource => ({
  id, label, projectId: 5, contextMode: "on_demand", status: "active", trashedAt: null, ...changes,
});

test("WS-20 editor and server share exact normalized mention spelling", () => {
  assert.equal(normalizedMentionToken("  Revenue Growth  "), "revenue_growth");
  assert.equal(normalizedMentionToken("AAPL!"), "aapl");
  assert.deepEqual([...userMentionTokens("Compare @Revenue_Growth with @AAPL")], ["revenue_growth", "aapl"]);
});

test("WS-20 email addresses and concatenated @ are never parsed as resource references", () => {
  assert.deepEqual([...userMentionTokens("Send to alice@quarterly_report.com and read@cashflow")], []);
  assert.deepEqual([...userMentionTokens("Read @cashflow")], ["cashflow"]);
  assert.equal(latestMentionQuery("alice@draft"), null);
  assert.equal(latestMentionQuery("Read @draft"), "draft");
});

test("WS-20 suggestions are limited to the current named Project", () => {
  const own = resource("a", "Annual Results");
  const other = resource("b", "Annual Report", { projectId: 9 });
  assert.deepEqual(eligibleProjectMentions([own, other], "Review @ann", 5, "project", "auto", true), [own]);
});

test("WS-20 Quick and Temporary Chat never silently acquire Project references", () => {
  for (const mode of ["quick", "temporary"] as const)
    assert.deepEqual(eligibleProjectMentions([resource("a", "Budget")], "@budget", 5, mode, "auto", true), []);
  assert.deepEqual(eligibleProjectMentions([resource("a","Budget")], "@budget", null, "project", "auto", true), []);
});

test("WS-20 Web/Files scope and denied AI resource-sharing hide Project source suggestions", () => {
  for (const scope of ["web","files"] as const)
    assert.deepEqual(eligibleProjectMentions([resource("a","Budget")], "@bud", 5, "project", scope, true), []);
  assert.deepEqual(eligibleProjectMentions([resource("a","Budget")], "@bud", 5, "project", "my_data", false), []);
});

test("WS-20 excluded/archived/trashed Project resources are never offered", () => {
  const list = [
    resource("active", "Business Plan"),
    resource("excluded", "Business Secret", { contextMode: "excluded" }),
    resource("archived", "Business Closed", { status: "archived" }),
    resource("trashed", "Business Trash", { trashedAt: "2026-10-20T00:00:00Z" }),
  ];
  assert.deepEqual(eligibleProjectMentions(list, "Check @business", 5, "project", "my_data", true).map(x=>x.id), ["active"]);
});

test("WS-20 normalized collisions cannot resolve an arbitrary pair of on-demand resources", () => {
  const list=[resource("a", "Quarterly Report"),resource("b","Quarterly_Report")];
  assert.deepEqual(eligibleProjectMentions(list, "Open @quarter", 5, "project", "auto", true), []);
  assert.deepEqual(ambiguousMentionTokens(list, "Open @quarterly_report"), ["quarterly_report"]);
});

test("WS-20 excluded resource does not make an otherwise unique mention ambiguous", () => {
  const list=[resource("a","Revenue"),resource("excluded","Revenue",{ contextMode:"excluded" })];
  assert.deepEqual(ambiguousMentionTokens(list, "Review @revenue"), []);
  assert.deepEqual(eligibleProjectMentions(list,"@rev",5,"project","auto",true).map(x=>x.id), ["a"]);
});

test("WS-20 chosen mention only stages canonical editable text without sending anything", () => {
  assert.equal(stageResourceMention("Look at @quar", "Quarterly Results"), "Look at @quarterly_results ");
  assert.equal(stageResourceMention("@quar", "Quarterly Results"), "@quarterly_results ");
  assert.equal(stageResourceMention("contact alice@help.example", "Revenue"), "contact alice@help.example");
  assert.equal(stageResourceMention("No mention", "Revenue"), "No mention");
});

test("WS-20 no resource-token collision can be bypassed by punctuation or case", () => {
  const list=[resource("a","Revenue Growth"),resource("b","revenue_growth!")];
  assert.deepEqual(ambiguousMentionTokens(list,"Compare @REVENUE_GROWTH"),["revenue_growth"]);
  assert.deepEqual(eligibleProjectMentions(list,"@rev",5,"project","auto",true),[]);
});

test("WS-20 suggestion list stays bounded and never invents provider/source availability", () => {
  const list=Array.from({length:20},(_,i)=>resource(String(i),"Resource_"+i));
  assert.equal(eligibleProjectMentions(list,"@resource",5,"project","auto",true).length,6);
  assert.equal(eligibleProjectMentions(list,"@resource",5,"project","auto",true,0).length,0);
});
