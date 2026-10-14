import { Check, Copy, ShieldCheck, ShieldX, X } from "lucide-react";
import { useState } from "react";
import type { WorkspaceState } from "@/lib/terminalTypes";
import { buildWorkspaceShareUrl, getWorkspacePanes } from "@/lib/terminalWorkspace";
import { getTerminalCapability } from "@/lib/terminalCatalog";

export default function WorkspaceSharePreview({ workspace, onClose }: { workspace: WorkspaceState; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const panes = getWorkspacePanes(workspace);
  const includesPrivateSurface = panes.some(({ pane }) => pane.view === "clientdata" || pane.view === "uide" || pane.view === "spreadsheet");

  const copy = async () => {
    const url = buildWorkspaceShareUrl(workspace);
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-3" onMouseDown={onClose}>
      <section className="w-full max-w-2xl border border-border bg-[#080808] shadow-2xl" onMouseDown={(event) => event.stopPropagation()} aria-label="Workspace sharing preview">
        <header className="flex items-center gap-2 border-b border-border p-4"><ShieldCheck className="h-4 w-4 text-emerald-300" /><div className="min-w-0 flex-1"><div className="font-terminal text-[10px] font-bold tracking-widest text-foreground">SHARE WORKSPACE PREVIEW</div><div className="mt-1 font-terminal text-[8px] text-muted-foreground">See exactly what travels before copying a workspace link.</div></div><button onClick={onClose} className="border border-border p-1.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button></header>
        <div className="space-y-4 p-4">
          <section className="border border-emerald-500/30 bg-emerald-500/[0.03] p-3"><div className="flex items-center gap-2 font-terminal text-[8px] font-bold tracking-widest text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" /> INCLUDED</div><div className="mt-2 space-y-1 font-terminal text-[8px] text-muted-foreground"><div>• Layout: up to four pane identities, focused pane, and safe shell arrangement.</div><div>• Public analytical context: view identifiers and ticker/entity symbols.</div><div>• No raw panel data is serialized by the workspace-link format.</div></div></section>
          <section className="border border-red-500/30 bg-red-500/[0.02] p-3"><div className="flex items-center gap-2 font-terminal text-[8px] font-bold tracking-widest text-red-300"><ShieldX className="h-3.5 w-3.5" /> NEVER INCLUDED</div><div className="mt-2 space-y-1 font-terminal text-[8px] text-muted-foreground"><div>• API keys, provider credentials, cookies, or authentication state.</div><div>• Uploaded file contents or private client datasets.</div><div>• Notes, model-input payloads, or locally cached provider responses.</div><div>• Licensed data not already represented by safe public context.</div></div></section>
          <section><div className="mb-2 font-terminal text-[8px] font-bold tracking-widest text-muted-foreground">WORKSPACE SURFACES</div><div className="divide-y divide-border/60 border border-border">{panes.map(({ id, pane }) => <div key={id} className="flex items-center justify-between gap-3 px-3 py-2"><div><div className="font-terminal text-[9px] text-foreground">{getTerminalCapability(pane.view).label}</div><div className="mt-1 font-terminal text-[7px] text-muted-foreground">{pane.symbol || "GLOBAL"}</div></div><span className="font-terminal text-[7px] uppercase text-cyan-300">{id}</span></div>)}</div></section>
          {includesPrivateSurface && <div className="border border-amber-500/30 bg-amber-500/[0.04] p-3 font-terminal text-[8px] leading-relaxed text-amber-200">This workspace references a local/private-capable surface. The link carries only the surface identity and safe context; its local data does not travel and recipients may see an empty/unconnected surface.</div>}
          <button onClick={copy} className="flex w-full items-center justify-center gap-2 border border-amber-500/50 bg-amber-500/10 px-3 py-2.5 font-terminal text-[8px] font-bold tracking-wider text-amber-200">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "WORKSPACE LINK COPIED" : "COPY SAFE WORKSPACE LINK"}</button>
        </div>
      </section>
    </div>
  );
}
