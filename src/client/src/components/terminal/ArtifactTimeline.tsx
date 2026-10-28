import * as React from "react";
import {useState} from "react";
import type {ArtifactContent} from "@shared/artifactContracts";

/** Shared display-only saved chronology; all records remain reachable with bounded DOM. */
export function ArtifactTimeline({content}:{content:Extract<ArtifactContent,{kind:"timeline"}>}) {
 const [page,setPage]=useState(0);const size=50;const pages=Math.max(1,Math.ceil(content.events.length/size));const current=Math.min(page,pages-1);
 const end=content.events.length-current*size;const events=content.events.slice(Math.max(0,end-size),end).reverse();
 return <section aria-label="Saved Artifact chronology" className="space-y-2">
  <p className="text-sm text-muted-foreground">{content.events.length} recorded events · newest saved entries first</p>
  {events.map(event=><div key={event.id} className="rounded-lg border border-border/50 p-3">
   <div className="flex flex-wrap gap-2"><span className="font-terminal text-xs text-amber-300">{event.type.toUpperCase()}</span><span className="font-ui text-sm">{event.title}</span><time dateTime={event.at} className="ml-auto font-terminal text-xs text-muted-foreground">{new Date(event.at).toLocaleString()}</time></div>
   <div className="mt-1 whitespace-pre-wrap font-ui text-sm text-muted-foreground">{event.summary}</div>
  </div>)}
  {pages>1&&<nav aria-label="Saved timeline pages" className="flex items-center gap-3"><button className="min-h-11 border px-3" disabled={!current} onClick={()=>setPage(current-1)}>Newer</button><span>Page {current+1} of {pages}</span><button className="min-h-11 border px-3" disabled={current+1===pages} onClick={()=>setPage(current+1)}>Older</button></nav>}
 </section>;
}
