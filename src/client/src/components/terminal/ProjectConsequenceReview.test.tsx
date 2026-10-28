import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectConsequenceReview } from "./ProjectConsequenceReview";
import type { P7Insight } from "@shared/p7ResearchContracts";
const insight: P7Insight = { id:"i",kind:"change",title:"Saved insight",summary:"",severity:"watch",
  sourceRefs:["src:1"],entityRefs:[],deterministic:true,occurredAt:null };
test("stored path renders opt-in read-only UI and escapes potentially hostile source data",()=>{
  const html=renderToStaticMarkup(createElement(ProjectConsequenceReview,{projectId:7,insight,onInvestigate:()=>{},
    review:{status:"ready",graphHash:"a".repeat(64),total:1,omitted:0,targets:[{
      id:"d",kind:"decision",label:"<script>unsafe</script>",
      steps:[{id:"edge",from:"event",to:"d",relation:"references",forward:true,evidenceRefs:["src:1"]}]
    }]}}));
  assert.match(html,/Recorded decision and portfolio references/);
  assert.match(html,/Review path in Chat/);
  assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>|<iframe|<form|href=/);
});
test("unsourced review does not expose an action",()=>{
  const html=renderToStaticMarkup(createElement(ProjectConsequenceReview,{projectId:7,insight,onInvestigate:()=>{},
    review:{status:"no_sources",graphHash:null,total:0,omitted:0,targets:[]}}));
  assert.match(html,/No saved source supports/);
  assert.doesNotMatch(html,/Review path in Chat/);
});

test("C03 saved consequence review labels evidence counts and never executes a tool", () => {
  const html = renderToStaticMarkup(createElement(ProjectConsequenceReview, {
    projectId: 7, insight, onInvestigate: () => { throw new Error("SSR must not act"); },
    review: { status: "ready", graphHash: "a".repeat(64), total: 1, omitted: 0, targets: [{
      id: "linked", kind: "portfolio", label: "Saved reference",
      steps: [{ id: "edge-1", from: "saved:filing", to: "linked",
        relation: "mentions", forward: true, evidenceRefs: ["filing:001"] }],
    }] },
  }));
  assert.match(html, /1 saved adjacency link/);
  assert.match(html, /1 distinct recorded edge source ID/);
  assert.match(html, /requires its own user approval/);
  assert.match(html, /Review path in Chat/);
  assert.doesNotMatch(html, /<form|<script|portfolio holdings confirmed|execute action/);
});

test("C07 existing P7 consequence view offers only an opt-in disabled P9 Project monitor draft",()=>{
  const html=renderToStaticMarkup(createElement(ProjectConsequenceReview,{projectId:7,insight,onInvestigate:()=>{},
    review:{status:"ready",graphHash:"a".repeat(64),total:0,omitted:0,targets:[]}}));
  assert.match(html,/data-testid="c07-project-monitor-handoff"/);
  const denied=renderToStaticMarkup(createElement(ProjectConsequenceReview,{projectId:7,insight,onInvestigate:()=>{},
    review:{status:"ready",graphHash:null,total:0,omitted:0,targets:[]}}));
  assert.doesNotMatch(denied,/c07-project-monitor-handoff/);
});
