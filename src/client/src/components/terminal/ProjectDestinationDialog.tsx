import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createProject, type Project } from "@/lib/useProjects";

/** Ask for a destination before saved work gains access to Project context. */
export function ProjectDestinationDialog({ projects, description, onConfirm, onClose }: {
  projects: Project[];
  description: string;
  onConfirm: (project: Project) => Promise<void>;
  onClose: () => void;
}) {
  const [destination, setDestination] = useState("");
  const [name, setName] = useState("");
  const [created, setCreated] = useState<Project | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const submit = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      let project = destination === "new" ? created : projects.find((item) => String(item.id) === destination);
      if (!project && destination === "new" && name.trim()) {
        project = await createProject({ name: name.trim() });
        // Retain this destination if keeping/moving fails, so retry doesn't create another Project.
        setCreated(project);
      }
      if (!project) throw new Error("Choose a Project or enter a name for a new one.");
      await onConfirm(project);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your work is still here. Try saving again.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !pendingRef.current) onClose(); }}>
    <DialogContent>
      <DialogTitle>Choose a Project</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="space-y-4">
        <label className="block text-sm">Destination
          <select autoFocus value={destination} disabled={pending} onChange={(event) => { setDestination(event.target.value); setError(null); }} className="mt-2 w-full rounded border border-border bg-background p-3">
            <option value="" disabled>Choose a Project…</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            <option value="new">Create a new Project</option>
          </select>
        </label>
        {destination === "new" && <label className="block text-sm">Project name
          <input value={created?.name ?? name} disabled={pending || Boolean(created)} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded border border-border bg-background p-3" />
        </label>}
        <p className="text-sm text-muted-foreground">{destination === "new" ? "The new Project starts with its own isolated context." : "The selected Project keeps its own sources, permissions and memory."}</p>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" disabled={pending} onClick={onClose} className="lios-section-action">Cancel</button>
          <button type="submit" disabled={pending || !destination || (destination === "new" && !created && !name.trim())} aria-busy={pending} className="lios-section-action">{pending ? "Saving…" : "Confirm destination"}</button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
