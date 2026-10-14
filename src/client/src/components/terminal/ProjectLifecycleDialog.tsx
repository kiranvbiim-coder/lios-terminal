import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
export interface LifecycleRequest {
  title: string;
  name?: string;
  detail: string;
  confirmLabel?: string;
  returnFocus: HTMLElement | null;
  resolve: (value: string | null) => void;
}
export function ProjectLifecycleDialog({ request, onClose }: { request: LifecycleRequest | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const focus = useRef<HTMLElement | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (request) { setName(request.name ?? ""); focus.current = request.returnFocus; } }, [request]);
  const done = (value: string | null) => { request?.resolve(value); onClose(); };
  return <Dialog open={!!request} onOpenChange={(open) => { if (!open) done(null); }}>
    <DialogContent onOpenAutoFocus={(event) => { if (request?.name === undefined) { event.preventDefault(); cancel.current?.focus(); } }} onCloseAutoFocus={(event) => { if (focus.current?.isConnected) { event.preventDefault(); const target = focus.current; requestAnimationFrame(() => { if (target.isConnected) target.focus(); }); } }}>
      <DialogTitle>{request?.title}</DialogTitle><DialogDescription>{request?.detail}</DialogDescription>
      <form noValidate onSubmit={(event) => { event.preventDefault(); if (request?.name !== undefined && !name.trim()) return; done(request?.name !== undefined ? name.trim() : "confirm"); }}>
        {request?.name !== undefined && <label className="block text-sm">Name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded border border-border bg-background px-3 py-2" /></label>}
        <div className="mt-6 flex justify-end gap-3"><button type="button" ref={cancel} onClick={() => done(null)} className="rounded border border-border px-3 py-2 text-sm">Cancel</button><button type="submit" disabled={request?.name !== undefined && !name.trim()} className="rounded border border-amber-400/40 px-3 py-2 text-sm text-amber-200 disabled:opacity-40">{request?.confirmLabel || "Save name"}</button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
