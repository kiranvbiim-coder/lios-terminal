import assert from "node:assert/strict";
import test from "node:test";
import "./p7TimelineIntelligence.test";
import "./researchSourceComposition.test";
import "./p7ResearchBranching.test";
import { P7_RESEARCH_DONOR_ADAPTATIONS, P7_RESEARCH_TOOLS, assertP7ResearchToolPermission, p7AgentRuntimeContract } from "./p7ResearchTools";
import { P7_DOCLING_UPSTREAM_COMMIT, P7_DOCLING_VERSION, p7DocumentRuntimeStatus } from "./p7DocumentIntelligence";

test("P7 Agent Runtime registry keeps deterministic Project tools AI-independent", () => {
  const search=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.project.search");
  assert.ok(search);
  assert.equal(search.deterministic,true);
  assert.equal(search.requiresAI,false);
  assert.equal(search.permissionClass,"safe_auto");
  const privateResearch=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.entity.private_research");
  assert.ok(privateResearch);
  assert.equal(privateResearch.deterministic,true);
  assert.equal(privateResearch.requiresAI,false);
  assert.equal(privateResearch.permissionClass,"safe_auto");
  const composition=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.research.compose_sources");
  assert.ok(composition);
  assert.equal(composition.deterministic,true);
  assert.equal(composition.requiresAI,false);
  assert.equal(composition.permissionClass,"safe_auto");
  assert.equal(composition.projectScoped,true);
  assert.equal(composition.externalSideEffects,false);
  const providerAccess=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.provider.access");
  assert.ok(providerAccess);
  assert.equal(providerAccess.deterministic,true);
  assert.equal(providerAccess.requiresAI,false);
  assert.equal(providerAccess.permissionClass,"safe_auto");
  assert.equal(providerAccess.externalSideEffects,false);
  const livingThesis=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.thesis.living_review");
  assert.ok(livingThesis);
  assert.equal(livingThesis.deterministic,true);
  assert.equal(livingThesis.requiresAI,false);
  assert.equal(livingThesis.permissionClass,"safe_auto");
  assert.equal(livingThesis.projectScoped,true);
  assert.equal(livingThesis.externalSideEffects,false);
  const alternativeEvidence=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.research.alternative_evidence");
  assert.ok(alternativeEvidence);
  assert.equal(alternativeEvidence.deterministic,true);
  assert.equal(alternativeEvidence.requiresAI,false);
  assert.equal(alternativeEvidence.permissionClass,"safe_auto");
  assert.equal(alternativeEvidence.externalSideEffects,false);
  const knowledgeState=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.project.knowledge_state");
  assert.ok(knowledgeState);
  assert.equal(knowledgeState.deterministic,true);
  assert.equal(knowledgeState.requiresAI,false);
  assert.equal(knowledgeState.permissionClass,"safe_auto");
  assert.equal(knowledgeState.projectScoped,true);
  assert.equal(knowledgeState.externalSideEffects,false);
  const financialEvents=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.project.financial_events");
  assert.ok(financialEvents);
  assert.equal(financialEvents.deterministic,true);
  assert.equal(financialEvents.requiresAI,false);
  assert.equal(financialEvents.permissionClass,"safe_auto");
  assert.equal(financialEvents.projectScoped,true);
  assert.equal(financialEvents.externalSideEffects,false);
  const numericEvidence=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.project.numeric_evidence");
  assert.ok(numericEvidence);
  assert.equal(numericEvidence.deterministic,true);
  assert.equal(numericEvidence.requiresAI,false);
  assert.equal(numericEvidence.permissionClass,"safe_auto");
  assert.equal(numericEvidence.projectScoped,true);
  assert.equal(numericEvidence.externalSideEffects,false);
  const disclosureChanges=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.project.disclosure_changes");
  assert.ok(disclosureChanges);
  assert.equal(disclosureChanges.deterministic,true);
  assert.equal(disclosureChanges.requiresAI,false);
  assert.equal(disclosureChanges.permissionClass,"safe_auto");
  assert.equal(disclosureChanges.projectScoped,true);
  assert.equal(disclosureChanges.externalSideEffects,false);
  const estimateEvidence=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.research.estimate_evidence");
  assert.ok(estimateEvidence);
  assert.equal(estimateEvidence.deterministic,true);
  assert.equal(estimateEvidence.requiresAI,false);
  assert.equal(estimateEvidence.permissionClass,"safe_auto");
  assert.equal(estimateEvidence.externalSideEffects,false);
  const crossSearch=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.project.cross_search");
  assert.ok(crossSearch);
  assert.equal(crossSearch.deterministic,true);
  assert.equal(crossSearch.requiresAI,false);
  assert.equal(crossSearch.permissionClass,"user_confirm");
  const contract=p7AgentRuntimeContract();
  assert.equal(contract.canonicalStateOwner,"LiOS Project/Artifact/Ledger");
  assert.equal(contract.unrestrictedFilesystem,false);
  assert.equal(contract.unrestrictedNetwork,false);
  assert.equal(contract.directSecretExposure,false);
});

test("P7 timeline intelligence is deterministic, Project-scoped and side-effect free", () => {
  const timeline=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.project.timeline");
  assert.ok(timeline);
  assert.equal(timeline.deterministic,true);
  assert.equal(timeline.requiresAI,false);
  assert.equal(timeline.permissionClass,"safe_auto");
  assert.equal(timeline.projectScoped,true);
  assert.equal(timeline.externalSideEffects,false);
});

test("P7 research branching keeps status safe-auto while branch creation and promotion require explicit approval", () => {
  const create=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.research.branch_create");
  const status=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.research.branch_status");
  const promote=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.research.branch_promote");
  assert.ok(create);
  assert.ok(status);
  assert.ok(promote);
  for(const tool of [create,status,promote]) {
    assert.equal(tool.deterministic,true);
    assert.equal(tool.requiresAI,false);
    assert.equal(tool.projectScoped,true);
    assert.equal(tool.externalSideEffects,false);
  }
  assert.equal(create.permissionClass,"user_confirm");
  assert.equal(status.permissionClass,"safe_auto");
  assert.equal(promote.permissionClass,"user_confirm");
  const refresh=P7_RESEARCH_TOOLS.find((tool)=>tool.id==="lios.research.refresh");
  assert.ok(refresh);
  assert.equal(refresh.deterministic,true);
  assert.equal(refresh.requiresAI,false);
  assert.equal(refresh.projectScoped,true);
  assert.equal(refresh.externalSideEffects,false);
  assert.equal(refresh.permissionClass,"user_confirm");
});

test("P7 approved donor capabilities stay mapped behind LiOS-owned runtime authority", () => {
  assert.deepEqual(P7_RESEARCH_DONOR_ADAPTATIONS.map((item)=>item.source),["tradingagents","dexter","langalpha","fin-agent","lse-terminal"]);
  assert.equal(P7_RESEARCH_DONOR_ADAPTATIONS.every((item)=>item.bundled===false),true);
  const contract=p7AgentRuntimeContract();
  assert.equal(contract.donorAdaptations.length,5);
  assert.equal(contract.donorAdaptations.every((item)=>item.authority.startsWith("LiOS")),true);
});

test("P7 external browser MCP local document and canonical-state branching actions require explicit approval", () => {
  for(const id of ["lios.project.cross_search","lios.research.browser","lios.research.external_mcp","lios.research.docling_index","lios.thesis.refresh","lios.research.branch_create","lios.research.branch_promote","lios.research.refresh"]) {
    assert.throws(()=>assertP7ResearchToolPermission(id,false),/explicit approval/);
    assert.doesNotThrow(()=>assertP7ResearchToolPermission(id,true));
  }
  assert.doesNotThrow(()=>assertP7ResearchToolPermission("lios.research.branch_status",false));
});

test("P7 Docling posture is pinned local optional and sqlite-vec is not a second canonical store", () => {
  assert.equal(P7_DOCLING_VERSION,"2.129.0");
  assert.match(P7_DOCLING_UPSTREAM_COMMIT,/^[a-f0-9]{40}$/);
  const status=p7DocumentRuntimeStatus();
  assert.equal(status.semanticSearch.baseline,"builtin_lexical");
  assert.equal(status.semanticSearch.canonicalStore,"postgres_pglite");
  assert.equal(status.semanticSearch.sqliteVecActive,false);
});
