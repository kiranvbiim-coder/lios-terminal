import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { copyChatMessageText, visibleChatMessageText, type ChatMessageRole } from "@/lib/chatMessageActions";

/** #115 interaction composition; clipboard status is fenced to this visible message. */
export default function ChatMessageActions({content,role,onQuote}:{content:string;role:ChatMessageRole;onQuote?:()=>void}) {
  const [state,setState]=useState<"idle"|"copying"|"copied"|"failed">("idle");
  const inFlight=useRef(false);
  const epoch=useRef(0);
  // The copy request belongs to one rendered message. A slow clipboard write
  // for an earlier streamed/changed message must not block this new message or
  // release the lock held by a newer request.
  useEffect(()=>{
    epoch.current++;
    inFlight.current=false;
    setState("idle");
    return()=>{
      epoch.current++;
      inFlight.current=false;
    };
  },[content,role]);
  const visible=visibleChatMessageText(content,role);
  if(!visible.trim()) return null;
  const copy=async()=>{
    if(inFlight.current)return;
    inFlight.current=true;
    const generation=epoch.current;
    setState("copying");
    try {
      const write=typeof navigator!=="undefined"&&navigator.clipboard?.writeText?navigator.clipboard.writeText.bind(navigator.clipboard):undefined;
      const ok=await copyChatMessageText(write,visible);
      if(epoch.current===generation)setState(ok?"copied":"failed");
    } finally {
      if(epoch.current===generation)inFlight.current=false;
    }
  };
  return <div role="group" aria-label={role==="assistant"?"LiOS answer actions":"Your message actions"} className="mt-2 flex flex-wrap gap-2" data-testid="chat-message-actions">
    <button type="button" disabled={state==="copying"} aria-busy={state==="copying"} onClick={()=>void copy()} aria-label={role==="assistant"?"Copy LiOS answer":"Copy your message"} className="min-h-11 rounded-lg border border-border/60 px-3 py-2 text-sm text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:opacity-50">{state==="copied"?"Copied":state==="copying"?"Copying…":state==="failed"?"Try copy again":"Copy"}</button>
    {role==="assistant"&&onQuote&&<button type="button" onClick={onQuote} className="min-h-11 rounded-lg border border-border/60 px-3 py-2 text-sm text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">Quote to follow up</button>}
    <span role="status" aria-live="polite" className="sr-only">{state==="copied"?"Message copied to clipboard":""}</span>
    {state==="failed"&&<span role="alert" className="text-sm text-amber-200">Clipboard unavailable. Select the message and copy manually.</span>}
  </div>;
}
