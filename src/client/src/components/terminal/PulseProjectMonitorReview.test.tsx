import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PulseProjectMonitorReview } from "./PulseProjectMonitorReview";

const source = readFileSync(new URL("./PulseProjectMonitorReview.tsx", import.meta.url), "utf8");
const pulseSource = readFileSync(new URL("./LiosPulseStoryCard.tsx", import.meta.url), "utf8");

test("A08 uses current Project and P9 owner only; no alternate monitor API or implicit enablement", () => {
  assert.match(source, /import \{ useProjects \} from "@\/lib\/useProjects"/);
  assert.match(source, /import \{ createP9Workflow, useInvalidateP9Automation \} from "@\/lib\/useP9Automation"/);
  assert.match(source, /const \[projectId, setProjectId\] = useState<number \| null>\(null\)/);
  assert.match(source, /const selected = eligible\.find\(project => project\.id === projectId\)/);
  assert.match(source, /const saved = await createP9Workflow\(originalProjectId, preview\)/);
  assert.match(source, /saved\.enabled !== false \|\| saved\.action\.kind !== "project_what_changed"/);
  assert.match(source, /formatLiosAddress\(\{ kind: "project", projectId: savedProjectId \}\)/);
  assert.match(source, /requestInFlight\.current = true/);
  assert.match(source, /requestInFlight\.current = false/);
  assert.doesNotMatch(source, /runP9WorkflowNow|setP9WorkflowEnabled|localStorage|navigator\.geolocation|new WebSocket/);
});

test("A08 review only mounts from a followed, evidence-backed card and stays behind user click", () => {
  assert.match(pulseSource, /followed && subjectKey && evidence\.some\(source => !!source\.id\?\.trim\(\)\)/);
  assert.match(pulseSource, /setMonitorReviewOpen\(open => !open\)/);
  assert.match(pulseSource, /monitorReviewOpen && followed && subjectKey/);
  assert.match(pulseSource, /<PulseProjectMonitorReview key=\{card\.id\} card=\{card\}/);
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() },
    createElement(PulseProjectMonitorReview, {
      card: { id: "recorded-1", title: "Source backed", whatHappened: "Recorded", priority: "important",
        score: 70, subjectKey: "Solar Power", evidence: [{ id: "source-1", source: "Provider" }] },
      onClose: () => undefined,
    })));
  assert.match(html, /Review a Project change monitor/);
  assert.match(html, /Loading authorized Projects/);
  assert.match(html, /not the subject or publisher/);
  assert.match(html, /will save paused/);
  assert.doesNotMatch(html, /Saved Project|Enabled successfully|has started/);
});
