import * as React from "react";
import {useState} from "react";
import type {P8ScenarioComparison} from "@shared/p8ScenarioContracts";
const display=(value:unknown)=>value===null||value===undefined?"—":String(value);

/** Same P8 saved-family matrix in Workbench and Chat; no branch, merge, formula or execution controls. */
export function SavedScenarioComparison({comparison}:{comparison:P8ScenarioComparison}){
 const [page,setPage]=useState(0);const rows=comparison.matrix.filter(row=>row.changed);const pages=Math.max(1,Math.ceil(rows.length/80));const current=Math.min(page,pages-1);
 const [deltasOpen,setDeltasOpen]=useState(false);const [deltaPage,setDeltaPage]=useState(0);
 const deltaPages=Math.max(1,Math.ceil(comparison.waterfall.length/50));const currentDelta=Math.min(deltaPage,deltaPages-1);
 return <section aria-label="Exact saved scenario comparison" className="space-y-2 rounded border border-border/50 p-2">
  <p className="text-sm">Recorded scenarios · {comparison.base.title} · {rows.length} changed fields</p>
  <div className="max-h-96 overflow-auto"><table className="min-w-full text-sm"><thead><tr><th className="p-2 text-left">Field</th>{[comparison.base,...comparison.branches].map(item=><th key={item.artifactId} className="p-2 text-left">{item.title} · v{item.artifactVersion}</th>)}</tr></thead>
  <tbody>{rows.slice(current*80,(current+1)*80).map(row=><tr key={row.section+":"+row.key}><th className="border-t p-2 text-left">{row.section} · {row.key}</th>{[comparison.base,...comparison.branches].map(item=><td key={item.artifactId} className="border-t p-2 font-mono">{display(row.values[item.artifactId])}</td>)}</tr>)}</tbody></table></div>
  {pages>1&&<nav aria-label="Scenario comparison pages" className="flex gap-2"><button className="min-h-11 border px-3" disabled={!current} onClick={()=>setPage(current-1)}>Previous</button><span>Page {current+1} of {pages}</span><button className="min-h-11 border px-3" disabled={current+1===pages} onClick={()=>setPage(current+1)}>Next</button></nav>}
  {!!comparison.waterfall.length&&<section><button type="button" className="min-h-11 border px-3" aria-expanded={deltasOpen} onClick={()=>setDeltasOpen(open=>!open)}>Recorded assumption deltas ({comparison.waterfall.length})</button>{deltasOpen&&<><ul className="max-h-72 overflow-auto">{comparison.waterfall.slice(currentDelta*50,(currentDelta+1)*50).map(item=><li key={item.branchArtifactId+":"+item.key} className="p-2 font-mono text-sm">{item.key}: {display(item.baseValue)} → {display(item.branchValue)} · Δ {display(item.delta)}</li>)}</ul>{deltaPages>1&&<nav aria-label="Assumption delta pages" className="flex items-center gap-3"><button type="button" className="min-h-11 border px-3" disabled={!currentDelta} onClick={()=>setDeltaPage(currentDelta-1)}>Previous deltas</button><span>Page {currentDelta+1} of {deltaPages}</span><button type="button" className="min-h-11 border px-3" disabled={currentDelta+1===deltaPages} onClick={()=>setDeltaPage(currentDelta+1)}>Next deltas</button></nav>}</>}</section>}
 </section>;
}
