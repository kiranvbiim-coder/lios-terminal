import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { P7InsightLens, P7ContextGraph } from "@shared/p7ResearchContracts";
import { ProjectEvidenceBriefingStudio } from "./ProjectEvidenceBriefingStudio";

const sha = "f".repeat(64);
const lens: P7InsightLens = { schemaVersion:"1", projectId:52, generatedAt:"2026-10-27T12:00:00Z",
  insights:[{id:"id1",title:"Recorded source event",summary:"Retained, not revalidated",kind:"change",
    severity:"info",sourceRefs:["source:id1"],entityRefs:[],deterministic:true,occurredAt:null}],counts:{} };
const graph: P7ContextGraph = {schemaVersion:"1",projectId:52,generatedAt:"2026-10-27T12:00:00Z",
  contentHash:sha,nodes:[],edges:[]};

test("Briefing Studio renders P7 source selections and does not create an artifact on mount", () => {
  const qc=new QueryClient();
  qc.setQueryData(["/api/projects",52,"intelligence","insights"],lens);
  qc.setQueryData(["/api/projects",52,"intelligence"],{documentCount:1,graph,researchGraph:graph,timeline:[]});
  const html=renderToStaticMarkup(createElement(QueryClientProvider,{client:qc},
    createElement(ProjectEvidenceBriefingStudio,{projectId:52,onOpenArtifact:()=>undefined})));
  assert.match(html,/Briefing Studio/);
  assert.match(html,/Recorded source event/);
  assert.match(html,/Save editable report/);
  assert.doesNotMatch(html,/Saved report as a versioned/);
  assert.doesNotMatch(html,/<iframe|<script|href=/);
});

test("Briefing Studio does not display other Project intelligence", () => {
  const qc=new QueryClient();
  qc.setQueryData(["/api/projects",53,"intelligence","insights"],lens);
  const html=renderToStaticMarkup(createElement(QueryClientProvider,{client:qc},
    createElement(ProjectEvidenceBriefingStudio,{projectId:53,onOpenArtifact:()=>undefined})));
  assert.doesNotMatch(html,/Recorded source event|source:id1/);
});

