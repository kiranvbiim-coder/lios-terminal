import test from "node:test";
import assert from "node:assert/strict";
import type {P7Insight} from "@shared/p7ResearchContracts";
import type {ConsequenceReview} from "./recordedConsequenceReview";
import {reviewedProjectMonitorHandoff} from "./reviewedProjectMonitorHandoff";
const insight={id:"insight:1",kind:"change",title:"Private title, do not leak",sourceRefs:["private:source-ref"],entityRefs:[],severity:"watch"} as P7Insight;
const review={status:"ready",graphHash:"b".repeat(64),total:1,omitted:0,targets:[]} as ConsequenceReview;
test("C07 requests an inactive, project-scoped P9 draft using the canonical monitor template",()=>{
 const x=reviewedProjectMonitorHandoff(5,insight,review);
 assert.equal(x.status,"ready");
 if(x.status!=="ready")return;
 assert.equal(x.intervalMinutes,60);
 assert.match(x.prompt,/Enabled: false/);
 assert.match(x.prompt,/Project ID: 5/);
 assert.match(x.prompt,/project_what_changed/);
 assert.match(x.prompt,/explicitly confirm/);
 assert.doesNotMatch(x.prompt,/Private title|private:source-ref/);
});
test("C07 denies missing/invalid Project source identity and all non-ready graph states",()=>{
 for(const r of [{...review,status:"no_sources" as const},{...review,graphHash:null},{...review,graphHash:"wrong"}]){
  assert.equal(reviewedProjectMonitorHandoff(5,insight,r).status,"blocked");
 }
 assert.equal(reviewedProjectMonitorHandoff(0,insight,review).status,"blocked");
 assert.equal(reviewedProjectMonitorHandoff(5,{...insight,sourceRefs:[]},review).status,"blocked");
});
