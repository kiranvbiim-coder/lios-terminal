import { Check, Copy, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { WorkspaceState } from "@/lib/terminalTypes";
import { buildWorkspaceShareUrl, getWorkspacePanes, workspaceForShare } from "@/lib/terminalWorkspace";
import { getTerminalCapability } from "@/lib/terminalCatalog";

export default function WorkspaceSharePreview({ workspace, onClose }: { workspace: WorkspaceState; onClose: () => void }) {
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [disclosureConfirmed, setDisclosureConfirmed] = useState(false);
  const originalPanes = getWorkspacePanes(workspace);
  const panes = getWorkspacePanes(workspaceForShare(workspace));
  const includesPrivateSurface = originalPanes.some(({ pane }) =>
    pane.view === "clientdata" || pane.view === "uide" || pane.view === "spreadsheet");
  const containsArtifact = originalPanes.some(({ pane }) => pane.view === "artifact");

  const copy = async () => {
    if (copyState === "copying" || !disclosureConfirmed) return;
    setCopyState("copying");
    try {
      const url = buildWorkspaceShareUrl(workspace);
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      // Permissions, secure-context policies or native clipboard bridges may
      // reject clipboard writes. Never present a success state unless copied.
      setCopyState("error");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="lios-v4-overlay flex h-auto max-h-[min(90dvh,780px)] w-[calc(100vw-24px)] max-w-2xl flex-col gap-0 overflow-hidden rounded-xl border-border bg-[#080808] p-0 text-foreground shadow-2xl">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-14 text-left sm:px-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-300" aria-hidden="true" />
            <div>
              <DialogTitle className="font-ui text-lg font-semibold tracking-tight">Share workspace layout</DialogTitle>
              <DialogDescription className="mt-1 font-ui text-sm leading-6 text-muted-foreground">
                Review the public layout details that will be placed in the link. This does not share your data or grant access to your account.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4 font-ui sm:p-5">
          <section aria-labelledby="share-included-heading" className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.035] p-4">
            <h3 id="share-included-heading" className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Included in the link
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Up to four pane types, their positions, the selected pane and the displayed ticker or entity symbols below.
              Anyone you give the link to can read these layout details and symbols.
            </p>
          </section>

          <section aria-labelledby="share-excluded-heading" className="rounded-lg border border-border bg-[#0d0d0d] p-4">
            <h3 id="share-excluded-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldX className="h-4 w-4 text-rose-300" aria-hidden="true" /> Not included
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Files, uploaded datasets, private notes, calculations, provider responses, credentials, account identity,
              project or conversation IDs, and Artifact revision identifiers are not copied into this link.
            </p>
          </section>

          <section aria-labelledby="share-panes-heading">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="share-panes-heading" className="text-sm font-semibold text-foreground">Shared workspace preview</h3>
              <span className="text-xs text-muted-foreground">{panes.length} pane{panes.length === 1 ? "" : "s"} · focused: {workspace.focusedPane}</span>
            </div>
            <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border">
              {panes.map(({ id, pane }) => (
                <div key={id} className="flex items-center justify-between gap-3 px-3 py-3">
                  <div className="min-w-0">
                    <h4 className="font-ui text-sm font-semibold text-foreground">{getTerminalCapability(pane.view).label}</h4>
                    <p className="mt-1 break-all font-ui text-xs text-muted-foreground">{pane.symbol || "No symbol"}</p>
                  </div>
                  <span className="shrink-0 font-ui text-xs capitalize text-cyan-200">{id}</span>
                </div>
              ))}
            </div>
          </section>

          {containsArtifact && (
            <p role="note" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.035] p-3 text-sm leading-6 text-amber-200">
              <ShieldAlert className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
              An Artifact pane is shown as a Market pane in the shared link. Artifact revisions stay private; recipients do not receive or reopen them from this link.
            </p>
          )}
          {includesPrivateSurface && (
            <p role="note" className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.035] p-3 text-sm leading-6 text-amber-200">
              <ShieldAlert className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
              The layout references a local or private-capable tool. The recipient may see an empty or unavailable pane; its local contents are not transferred.
            </p>
          )}

          <label className="flex items-start gap-3 rounded-lg border border-amber-300/30 bg-amber-300/[0.035] p-3 text-sm leading-6 text-amber-100">
            <input type="checkbox" data-testid="share-public-symbol-consent" checked={disclosureConfirmed}
              onChange={(event) => { setDisclosureConfirmed(event.target.checked); setCopyState("idle"); }}
              className="mt-1 h-4 w-4 shrink-0 accent-amber-300" />
            <span>I understand this link reveals the listed pane types and symbols to anyone who receives it. I have reviewed them and choose to copy this public layout link.</span>
          </label>
          <p className="text-xs leading-5 text-muted-foreground">
            A copied link can be forwarded and cannot revoke access to its public layout details. It does not grant access to private sources or Artifacts.
          </p>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-[#080808] p-4 sm:px-5">
          <p role={copyState === "error" ? "alert" : "status"} className={copyState === "error" ? "min-w-0 flex-1 text-sm text-rose-200" : "min-w-0 flex-1 text-sm text-muted-foreground"}>
            {copyState === "copied" ? "Link copied. You control where it is shared."
              : copyState === "error" ? "Could not copy the link. Check clipboard permissions and try again."
                : disclosureConfirmed ? "Only the layout details shown above will be copied." : "Review and acknowledge the public symbols before copying."}
          </p>
          <button type="button" onClick={() => void copy()} disabled={copyState === "copying" || !disclosureConfirmed}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-primary/50 bg-primary/10 px-4 py-2 font-ui text-sm font-semibold text-primary hover:bg-primary/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50">
            {copyState === "copied" ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            {copyState === "copying" ? "Copying…" : copyState === "copied" ? "Copied" : "Copy layout link"}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
