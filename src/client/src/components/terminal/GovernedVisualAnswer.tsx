import * as React from "react";
import {Component,lazy,Suspense,useState} from "react";
import type {GovernedVisualAnswerRequest,GovernedVisualProjection} from "@shared/governedVisualAnswer";
import {resolveGovernedVisualAnswer} from "@shared/governedVisualAnswer";
import {projectSavedTableGeography} from "@/lib/governedTableGeography";
import {recordedGeographicPoints} from "@/lib/phase3InvestigationPresentation";
import {useConversationVisual} from "@/lib/useArtifacts";

const ArtifactChart=lazy(()=>import("./ArtifactChart"));
const TableArtifactTable=lazy(()=>import("./ArtifactPane").then(module=>({default:module.TableArtifactTable})));
const ArtifactTimeline=lazy(()=>import("./ArtifactTimeline").then(module=>({default:module.ArtifactTimeline})));
const OfflineProjectWorldMap=lazy(()=>import("./OfflineProjectWorldMap").then(module=>({default:module.OfflineProjectWorldMap})));
const ProjectEvidenceGraph=lazy(()=>import("./ProjectEvidenceGraph").then(module=>({default:module.ProjectEvidenceGraph})));
const ProjectIntelligenceTimeline=lazy(()=>import("./ProjectIntelligenceTimeline").then(module=>({default:module.ProjectIntelligenceTimeline})));
const SavedScenarioComparison=lazy(()=>import("./SavedScenarioComparison").then(module=>({default:module.SavedScenarioComparison})));

class VisualBoundary extends Component<{children:React.ReactNode},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<p role="alert">Visual renderer unavailable. The canonical saved source is unchanged; inspect it in its existing Project or Workbench.</p>:this.props.children;}
}

const VISUAL_LABELS: Record<GovernedVisualAnswerRequest["intent"]["kind"], string> = {
 chart: "Chart",
 table: "Table",
 timeline: "Timeline",
 table_map: "Map",
 project_timeline: "Timeline",
 insight_graph: "Evidence graph",
 insight_map: "Evidence map",
 revision_comparison: "Revision comparison",
 scenario_comparison: "Scenario comparison",
};

export function GovernedVisualAnswer({request}:{request:GovernedVisualAnswerRequest}){
 // A visual answer is the answer, not an advanced setting. Show its existing
 // authorized projection in Chat immediately; keep collapse for compact work.
 const [expanded,setExpanded]=useState(true);
 return <section aria-label="Governed visual answer from saved evidence" data-testid="governed-chat-visual-answer" className="mb-2 min-w-0 rounded-xl border border-border/55 bg-card/45 p-3">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <h3 className="font-ui text-sm font-semibold text-foreground">{VISUAL_LABELS[request.intent.kind] ?? "Visual answer"}</h3>
   <button type="button" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)} className="min-h-10 rounded-lg border border-border/60 px-3 font-ui text-sm text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{expanded?"Collapse":"Show visual"}</button>
  </div>
  {expanded&&<SavedVisual key={JSON.stringify(request)} request={request}/>}
 </section>;
}
function Projection({request,projection}:{request:GovernedVisualAnswerRequest;projection:GovernedVisualProjection}){
 if(projection.kind==="artifact"){
  const decision=resolveGovernedVisualAnswer(request,projection.detail);
  if(decision.status!=="ready")return <p role="alert">{decision.reason}</p>;
  if(decision.kind==="chart")return <ArtifactChart content={decision.content} artifactSourceRefs={decision.sourceRefs} readOnly/>;
  if(decision.kind==="timeline")return <ArtifactTimeline content={decision.content}/>;
  if(request.intent.kind==="table_map"){
   const geography=projectSavedTableGeography(decision);
   return geography.points.length?<OfflineProjectWorldMap points={geography.points} origin="P4 saved table"/>:<p role="status">No exact permitted numeric source coordinates exist in this saved table. No geography was inferred.</p>;
  }
  return <TableArtifactTable content={decision.content}/>;
 }
 if(projection.kind==="revision_comparison")return <section aria-label="Exact saved revision comparison" className="space-y-2 text-sm">
  <p>Compared exact v{projection.comparison.leftVersion} with v{projection.comparison.rightVersion}: {projection.comparison.changed?"Content changed":"Content unchanged"}</p>
  <p>Changed content fields: {projection.comparison.topLevelChangedKeys.join(", ")||"None"}</p>
  <p>Spreadsheet cell differences: {projection.comparison.spreadsheetDiffs.length}</p>
  <details><summary>Exact revision hashes</summary><p className="break-all">{projection.comparison.leftHash}</p><p className="break-all">{projection.comparison.rightHash}</p></details>
 </section>;
 if(projection.kind==="scenario_comparison")return <SavedScenarioComparison comparison={projection.comparison}/>;
 if(request.projectId===null)return <p role="alert">The Project visual owner is unavailable.</p>;
 if(request.intent.kind==="project_timeline")return <ProjectIntelligenceTimeline events={projection.timeline}/>;
 if(request.intent.kind==="insight_graph")return <ProjectEvidenceGraph projectId={request.projectId} graph={projection.graph} insight={projection.insight}/>;
 if(request.intent.kind==="insight_map"){
  const sourceRefs=new Set(projection.insight?.sourceRefs??[]);
  const points=recordedGeographicPoints(request.projectId,projection.graph).filter(point=>point.sourceRef!==null&&sourceRefs.has(point.sourceRef));
  return points.length?<OfflineProjectWorldMap points={points} origin="P7 Project graph"/>:<p role="status">This saved insight has no exact source-bound coordinates. No locations were inferred.</p>;
 }
 return <p role="alert">The saved visual owner does not match the requested presentation.</p>;
}
function SavedVisual({request}:{request:GovernedVisualAnswerRequest}){
 const query=useConversationVisual(request);
 const loading=query.isPending||query.isFetching||!query.isFetchedAfterMount;
 const projection=!loading&&!query.isError?query.data?.projection:null;
 return <div data-testid="governed-chat-visual-content" className="mt-3 space-y-3">
  {!loading&&<button type="button" onClick={()=>void query.refetch()} className="min-h-11 rounded border px-3">Recheck current source permissions</button>}
  {loading&&<p role="status">Checking exact saved evidence and current source authority…</p>}
  {!loading&&!projection&&<p role="alert">Authorization, source permission or the exact saved projection is unavailable. No cached visual is displayed.</p>}
  {projection&&<><p className="text-xs text-muted-foreground">Read-only saved evidence. This presentation creates no source rights, calculation, approval or execution.</p><VisualBoundary><Suspense fallback={<p role="status">Loading saved visual renderer…</p>}><Projection request={request} projection={projection}/></Suspense></VisualBoundary></>}
  <details className="text-xs"><summary>Recorded source references ({request.sourceRefs.length})</summary><ul className="max-h-32 overflow-auto">{request.sourceRefs.map(ref=><li key={ref} className="break-all">{ref}</li>)}</ul></details>
 </div>;
}
