import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=(file:string)=>fs.readFileSync(path.join(root,file),"utf8");
const contracts=read("shared/p7ResearchContracts.ts");
const engine=read("server/p7ProjectIntelligence.ts");
const store=read("server/p7ProjectIntelligenceStore.ts");
const thesis=read("server/p7ThesisEngine.ts");
const filing=read("server/p7FilingDiff.ts");
const tools=read("server/p7ResearchTools.ts");
const conversation=read("server/conversationRuntime.ts");
const conversationTest=read("server/conversationRuntime.test.ts");
const p7EngineTest=read("server/p7ProjectIntelligence.test.ts");
const docling=read("server/p7DocumentIntelligence.ts");
const manifest=read("server/runtimeManifest.ts");
const artifact=read("shared/artifactContracts.ts");
const adapter=read("shared/artifactAdapterRegistry.ts");
const routes=read("server/p7ResearchRoutes.ts");
const routeRegistry=read("server/routes.ts");
const home=read("client/src/components/terminal/ProjectExperienceShell.tsx");
const projectHome=read("client/src/components/terminal/ProjectHome.tsx");
const panel=read("client/src/components/terminal/ProjectIntelligencePanel.tsx");
const artifactPane=read("client/src/components/terminal/ArtifactPane.tsx");
const artifactPanel=read("client/src/components/terminal/ProjectArtifactsPanel.tsx");
const migration=read("migrations/0070_lios_p7_project_intelligence.sql");
const journal=JSON.parse(read("migrations/meta/_journal.json"));
const roadmap=read("../docs/LIOS_EXECUTION_ROADMAP.md");
const plan=read("../docs/technical/P7_RESEARCH_PROJECT_INTELLIGENCE.md");
const thirdParty=JSON.parse(read("../third_party/components.json"));
const components=Array.isArray(thirdParty)?thirdParty:thirdParty.components;
const component=(id:string)=>components.find((item:any)=>item.id===id);

assert.ok(engine.includes("buildReactiveContextGraph")&&contracts.includes("p7ContextGraphSchema"),"P7-01 Reactive Context Graph missing.");
for(const dimension of ["entity","metric","period","date","event","portfolio","benchmark","scenario","geography","currency"]) {
  assert.ok(contracts.includes('"'+dimension+'"')&&engine.includes('kind: dimension'),"P7-01 finance Context Graph dimension missing "+dimension+".");
}
assert.ok(engine.includes("compileDeterministicInsights")&&panel.includes("Insight Lens"),"P7-02 deterministic Insight Lens missing.");
for(const kind of ["anomaly","trend","percentile","revision","risk","correlation","curve","regime"]) {
  assert.ok(contracts.includes('"'+kind+'"'),"P7-02 deterministic insight family missing "+kind+".");
}
assert.ok(engine.includes("deterministicInsights")&&engine.includes('const deterministicKinds = new Set'),"P7-02 explicit deterministic insight compiler metadata path missing.");
assert.ok(engine.includes("createProjectSnapshot")&&engine.includes("diffProjectSnapshots")&&panel.includes("Time Machine"),"P7-03 snapshot delta/Time Machine missing.");
assert.ok(migration.includes('project_intelligence_document_versions')&&store.includes("documentVersionValues")&&store.includes("getProjectIntelligenceHistoricalState")&&store.includes("projectIntelligenceAsKnownOn"),"P7-03 reconstructable historical-state store / As Known On missing.");
assert.ok(routes.includes("as-known-on")&&routes.includes("/state")&&panel.includes("As Known On")&&panel.includes("getProjectIntelligenceSnapshotState"),"P7-03 Time Machine historical-state API/UI wiring missing.");
assert.ok(store.includes("Historical Project Intelligence state is incomplete"),"P7-03 historical reconstruction must fail loudly when retained state is incomplete.");
assert.ok(engine.includes("buildResearchGraph")&&routes.includes("research-graph"),"P7-04 Research Graph missing.");
for(const dimension of ["metric","period","event","portfolio","benchmark","scenario","geography","currency"]) assert.ok(engine.includes('"'+dimension+'"'),"P7-04 Research Graph context projection missing "+dimension+".");
for(const token of ["listProjectChats","listProjectChatMessages","listProjectResources","listProjectArtifacts","listProjectLedgerEvents","contextMode !== \"excluded\""]) assert.ok(store.includes(token),"P7-05 Project Intelligence source convergence missing "+token);
assert.ok(migration.includes("project_intelligence_documents")&&migration.includes("project_intelligence_snapshots")&&migration.includes("ENABLE ROW LEVEL SECURITY"),"P7-05 tenant-scoped derived index persistence missing.");
assert.equal(journal.entries.filter((entry:any)=>entry.tag==="0070_lios_p7_project_intelligence").length,1,"P7 0070 migration is not registered exactly once in Drizzle journal.");
assert.ok(store.includes("SECRET_KEY")&&store.includes("SECRET_REF")&&store.includes("sanitizeIndexValue")&&store.includes("safeRefs"),"P7-05 credential-safe derived-index projection missing.");
assert.ok(store.includes("contextRefs: metadata.contextRefs")&&store.includes('sourceRef: artifact.id + ":timeline:" + event.id'),"P7-05 context/timeline source convergence missing.");
assert.ok(engine.includes("searchProjectDocuments")&&engine.includes("semanticWeight")&&docling.includes("parseLocalDocumentWithDocling")&&docling.includes("assertLocalByodRuntime"),"P7-06 local search/Docling adapter missing.");
assert.ok(manifest.includes('id: "research-docs"')&&manifest.includes('name: "docling"')&&manifest.includes('version: "2.129.0"')&&manifest.includes("ciSuperset: false"),"P7-06 optional Docling runtime pack missing.");
assert.equal(component("docling")?.commitSha,"14789f2c2c542f8d127a0aac85eb779d5bba554e","P7-06 Docling pin drifted.");
assert.equal(component("sqlite-vec")?.bundled,false,"P7-06 sqlite-vec must not become a second bundled state store.");
assert.equal(component("sqlite-vec")?.classification,"stub","P7-06 sqlite-vec must remain an optional accelerator until scale justifies activation.");
assert.ok(artifact.includes("thesisArtifactContentSchema")&&adapter.includes('id: "lios.thesis.native"')&&artifactPane.includes("ThesisEditor"),"P7-07 ThesisArtifact contract/adapter/UI missing.");
for(const token of ["expectedOutcomes","claims","catalysts","risks","invalidationConditions","openQuestions","postmortems"]) assert.ok(artifact.includes(token),"P7-07/P7-13 ThesisArtifact missing "+token);
assert.ok(artifactPane.includes("Refresh from Project evidence")&&artifactPane.includes("APPEND IMMUTABLE THESIS POSTMORTEM"),"P7-07/P7-08 Thesis user actions are not wired into the Artifact pane.");
assert.ok(thesis.includes("refreshThesisArtifact")&&thesis.includes("contradictions")&&thesis.includes("appendThesisPostmortem")&&routes.includes("/refresh")&&routes.includes("/postmortem"),"P7-08 thesis refresh/contradiction/postmortem missing.");
assert.ok(routes.includes("createArtifactVersion")&&routes.includes("evidenceSnapshot")&&routes.includes("currentSnapshot"),"P7-08 Thesis refresh must create versioned Artifact state tied to Project snapshots.");
assert.ok(engine.includes("buildUnifiedTimeline")&&routes.includes("/timeline"),"P7-09 unified timeline missing.");
assert.ok(store.includes('content.kind === "timeline"')&&store.includes('timelineEventType'),"P7-09 TimelineArtifact events are not individually indexed.");
assert.ok(filing.includes("comparePrimarySourceFilings")&&filing.includes("evidenceRefs")&&routes.includes("filing-diff"),"P7-10 evidence-linked filing diff missing.");
assert.ok(routes.includes('sourceRef: diffRef')&&routes.includes('sourceType: "research_evidence"')&&routes.includes("indexProjectDocument"),"P7-10 filing diff must persist as evidence-linked Project research state.");
assert.ok(artifact.includes("question: z.string")&&artifact.includes("plan: z.object")&&artifact.includes("evidence: z.array")&&artifact.includes("sourcePolicy: z.object")&&artifact.includes("contradictions: z.array")&&artifact.includes("executionTrail: z.array"),"P7 detailed research workflow state is incomplete in ResearchArtifact.");
assert.ok(artifact.includes('"only_refs"')&&artifactPane.includes("Use only these sources")&&artifactPane.includes("RESEARCH PLAN")&&artifactPane.includes("EVIDENCE")&&artifactPane.includes("CONTRADICTIONS")&&artifactPane.includes("EXECUTION TRAIL"),"P7 research planning/evidence/source-policy/trail UX is incomplete.");
assert.ok(contracts.includes("allowedSourceRefs")&&engine.includes("allowedRefs")&&conversation.includes("activeResearchSourceAllowList")&&conversation.includes("allowedSourceRefs"),"P7 only-source policy is stored but not enforced by deterministic Project search.");
assert.ok(artifactPanel.includes('sourcePolicy:{mode:"connected_sources"')&&store.includes('sourceRef: artifact.id + ":evidence:" + evidence.id')&&store.includes('sourceRef: artifact.id + ":contradiction:" + contradiction.id'),"P7 ResearchArtifact starter/index convergence missing.");
assert.ok(tools.includes("P7_RESEARCH_TOOLS")&&tools.includes("P7_RESEARCH_DONOR_ADAPTATIONS")&&tools.includes("P5 BrowserConnectorPolicy")&&tools.includes("P5 McpClientPolicy")&&tools.includes("unrestrictedNetwork: false"),"P7-11 governed research tool/donor boundary missing.");
for (const donor of ["tradingagents","dexter","langalpha","fin-agent","lse-terminal"]) {
  assert.ok(tools.includes('source: "'+donor+'"'),"P7-11 approved donor adaptation missing "+donor+".");
  assert.equal(component(donor)?.bundled,false,"P7-11 donor must remain selectively adapted, not bundled wholesale: "+donor+".");
}
assert.equal(component("lse-terminal")?.commitSha,"62c48a5ce6de37a1c115d6270dfd0eee75166d8b","P7-11 LSE donor pin drifted.");
assert.ok(conversation.includes('id: "lios.project.search"')&&conversation.includes('id: "lios.project.what_changed"')&&conversation.includes('id: "lios.project.insight_lens"')&&conversation.includes("executeP7ProjectIntelligence")&&conversation.includes('workflow: "p7_project_search"'),"P7-11 Conversation Runtime integration missing.");
assert.ok(routeRegistry.includes("registerP7ResearchRoutes(app)")&&projectHome.includes("ProjectIntelligencePanel")&&panel.includes("data-p7-project-intelligence"),"P7 live route/Project Home wiring missing.");

assert.ok(artifact.includes("question: z.string")&&artifact.includes("plan: z.object")&&artifact.includes("sourcePolicy: z.object")&&store.includes('sourceRef: artifact.id + ":claim:"')&&store.includes('sourceRef: artifact.id + ":evidence:"')&&store.includes('sourceRef: artifact.id + ":contradiction:"'),"P7-12 question→plan→permitted sources→claim/evidence/contradiction Artifact pipeline missing.");
assert.ok(artifact.includes("expectedOutcomes")&&thesis.includes("outcome_occurred")&&thesis.includes("outcome_missed")&&store.includes('insightKind: "expected_outcome"'),"P7-13 Thesis expected-outcome history is not operational.");
assert.ok(artifact.includes("timelineArtifactContentSchema")&&artifactPanel.includes('if(kind==="timeline")return{kind,events:[]}')&&store.includes('content.kind === "timeline"'),"P7-14 Timeline is not a first-class Project Artifact.");
for (const token of ["artifactRefs","modelRefs","decisionRef"]) assert.ok(contracts.includes(token)&&engine.includes(token),"P7-15 timeline linkage missing "+token+".");
for (const token of ["sourceRef","entityRef","artifactRef","modelRef","decisionRef"]) assert.ok(routes.includes(token),"P7-15 timeline route filter missing "+token+".");
assert.ok(panel.includes("All event types")&&panel.includes("Filter source / entity / model / Artifact / decision ref"),"P7-15 timeline filter UX missing.");
assert.ok(conversation.includes('id: "lios.project.what_changed"')&&conversation.includes('workflow === "p7_project_changes"')&&conversationTest.includes('p7_project_changes')&&p7EngineTest.includes("diffProjectSnapshots"),"P7-16 first-class tested What Changed workflow missing.");

for(let id=1;id<=16;id+=1){
  const taskId="LIOS-P7-"+String(id).padStart(2,"0");
  const rowPattern=new RegExp("\\|\\s*"+taskId.replaceAll("-","\\-")+"\\s*\\|","g");
  const matches=roadmap.match(rowPattern)??[];
  assert.equal(matches.length,1,"P7 roadmap must contain exactly one canonical table row for "+taskId+"; found "+matches.length+".");
  assert.ok(plan.includes(taskId),"P7 technical source of truth missing "+taskId+".");
}

console.log("P7 Research, Project Intelligence & Thesis State acceptance P7-01…P7-16: PASS");
