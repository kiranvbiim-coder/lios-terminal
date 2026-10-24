import * as React from "react";
import { useEffect, useRef, useState } from "react";

/** Adapted from #113's inert fenced-code composition; no code is executed. */
export default function ChatCodeBlock({ code, language, streaming = false }: { code: string; language?: string | null; streaming?: boolean }) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const inFlight = useRef(false);
  const lifetime = useRef(0);
  useEffect(() => {
    lifetime.current += 1;
    setState("idle");
    return () => { lifetime.current += 1; };
  }, [code, language, streaming]);
  const name = language?.trim() || "Code";
  const copy = async () => {
    if (streaming || inFlight.current) return;
    inFlight.current = true;
    const epoch = lifetime.current;
    setState("copying");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(code);
      if (lifetime.current === epoch) setState("copied");
    } catch {
      if (lifetime.current === epoch) setState("failed");
    } finally { inFlight.current = false; }
  };
  return <div className="my-2 overflow-hidden rounded-lg border border-border/60 bg-black/40" data-chat-code-block="true">
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-border/50 px-3 py-1">
      <span className="font-terminal text-sm text-muted-foreground">{name}</span>
      <button type="button" disabled={streaming || state === "copying"} aria-label={streaming ? "Copy code after the answer finishes" : `Copy ${name} code`}
        onClick={() => void copy()} data-testid="chat-code-copy"
        className="min-h-10 rounded border border-border/70 px-3 font-ui text-sm focus-visible:outline focus-visible:outline-2 disabled:opacity-50">
        {streaming ? "Generating…" : state === "copying" ? "Copying…" : state === "copied" ? "Copied" : "Copy code"}
      </button>
    </div>
    <pre tabIndex={0} aria-label={language ? `${language} code` : "Code"} className="overflow-x-auto p-3 font-terminal text-[13px] leading-5 text-foreground focus-visible:outline focus-visible:outline-2">
      <code data-language={language ?? undefined}>{code}</code>
    </pre>
    {state === "failed" && <p role="alert" className="px-3 pb-2 font-ui text-sm text-amber-200">Clipboard unavailable. Select the code above and copy it manually.</p>}
    <span role="status" aria-live="polite" className="sr-only">{state === "copied" ? "Code copied to clipboard" : ""}</span>
  </div>;
}
