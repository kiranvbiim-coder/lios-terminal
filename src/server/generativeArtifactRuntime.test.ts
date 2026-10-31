import test from "node:test";
import assert from "node:assert/strict";
import { conversationRequestSchema, type ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { extractConversationEntityQuery } from "./conversationCapabilityResolver";
import { executeConversationRuntime, planConversationWorkflow } from "./conversationRuntime";
import { AIProviderError, createAttribution } from "./byoaiRouter";
import { markdownReportContent, markdownTableContent } from "./generativeArtifactTools";

test("AI-written Markdown becomes editable report blocks and tables without depending on model JSON", () => {
  const report = markdownReportContent("```markdown\n# Climate memo\nIntro line one\ncontinues **here**.\n\n- First point\n- Second point\n## Next\nClosing.\n```");
  assert.equal(report.kind, "report");
  if (report.kind !== "report") return;
  assert.deepEqual(report.blocks.map(block => [block.type, block.text]), [
    ["callout", "AI-written draft. Review factual claims before use."],
    ["heading", "Climate memo"], ["paragraph", "Intro line one continues here."],
    ["bullet_list", "First point\nSecond point"], ["heading", "Next"], ["paragraph", "Closing."],
  ]);
  const table = markdownTableContent("| Country | Target |\n|---|---|\n| UK | 2050 |\n| India | |");
  assert.equal(table.kind, "table");
  if (table.kind === "table") assert.deepEqual(table.rows, [{ c1: "UK", c2: "2050" }, { c1: "India", c2: null }]);
  assert.throws(() => markdownTableContent("no table here"), /did not return a table/);
});

const request = (message: string) => conversationRequestSchema.parse({ requestId: "ed1d8976-bce1-4bb1-8936-b00e9be9d778", message, executionMode: "ai_assisted", context: { symbol: "AAPL" } });

test("explicit subjects beat Workbench context and unrelated questions do not inherit its ticker", () => {
  assert.equal(extractConversationEntityQuery(request("chart MSFT")).symbol, "MSFT");
  assert.deepEqual(extractConversationEntityQuery(request("tell me about the history of Rome")), { symbol: null, entityQuery: null });
  assert.equal(extractConversationEntityQuery(request("what is its P/E?")).symbol, "AAPL");
  assert.equal(planConversationWorkflow(request("write a memo on climate policy")).intent.parameters.workflow, "generative_artifact");
  assert.equal(planConversationWorkflow(request("create an image of a forest")).intent.parameters.generationKind, "image");
});

test("document requests with a modifier become documents; coding requests and questions do not", () => {
  for (const message of ["Write a short memo on how rising interest rates affect small businesses", "Draft a brief on tariffs", "write a 1-page report about inflation", "Prepare a one page summary of the Fed decision", "Make a table comparing Python and Go"]) {
    assert.equal(planConversationWorkflow(request(message)).intent.parameters.workflow, "generative_artifact", message);
  }
  for (const message of ["write a function to compute the plan", "Write a script to build the report", "what is a memo?"]) {
    assert.notEqual(planConversationWorkflow(request(message)).intent.parameters.workflow, "generative_artifact", message);
  }
});

test("provider auth failure emits reconnect while a rate limit remains retryable", async () => {
  for (const status of [401, 429]) {
    const events: ConversationRuntimeEvent[] = [];
    await assert.rejects(executeConversationRuntime({ tenant: { userId: 1, organizationId: null, role: "internal_admin" }, scope: "temporary", chatId: null, projectId: null, history: [], request: request("hello"), aiCompletion: async () => { throw new AIProviderError(status === 401 ? "upstream_error" : "rate_limited", "Provider rejected request", { status, provider: "openai" }); }, emit: event => { events.push(event); } }));
    assert.ok(events.some(event => event.type === "error" && event.code === (status === 401 ? "ai_not_connected" : "runtime_failed")));
  }
});

test("web sources survive in answer and receipt without granting search for private file scopes", async () => {
  for (const sourceScope of ["auto", "my_data"] as const) {
    const events: ConversationRuntimeEvent[] = [];
    const result = await executeConversationRuntime({ tenant: { userId: 1, organizationId: null, role: "internal_admin" }, scope: "temporary", chatId: null, projectId: null, history: [], request: { ...request("hello"), sourceScope }, aiCompletion: async input => {
      assert.equal(input.webSearch, sourceScope === "auto");
      return { provider: "openai", model: "gpt-4o", text: "A response", attribution: createAttribution({ provider: "openai", model: "gpt-4o", prompt: "hello", output: "A response" }), ...(sourceScope === "auto" ? { webSearch: { status: "used" as const, sources: [{ title: "Source", url: "https://example.com/report" }] } } : {}) };
    }, emit: event => { events.push(event); } });
    if (sourceScope === "auto") {
      assert.match(result.text, /https:\/\/example.com\/report/);
      assert.ok(events.some(event => event.type === "receipt" && event.receipt.sourceRefs.includes("https://example.com/report")));
    } else assert.doesNotMatch(result.text, /https:\/\//);
  }
});
