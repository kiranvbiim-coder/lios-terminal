import * as React from "react";
import { useRef, useState } from "react";
import { formatLiosAddress } from "@shared/liosAddress";
import type { PulseStoryView } from "@/lib/pulseStoryPresentation";
import { useProjects } from "@/lib/useProjects";
import { createP9Workflow, useInvalidateP9Automation } from "@/lib/useP9Automation";
import { pulseProjectMonitorDraft } from "@/lib/pulseProjectMonitorDraft";
import { quickMonitorDraft } from "@/lib/workflowReviewTruth";

/**
 * Explicit review over the existing P9 Project action. Loading this component
 * (and opening the parent card) never creates, schedules, runs or enables work.
 * Only the confirmed user click issues a create request for a PAUSED workflow.
 */
export function PulseProjectMonitorReview({ card, projectReview, onClose }: {
  onClose: () => void;
} & ({ card: PulseStoryView; projectReview?: never } | { card?: never; projectReview: { projectId: number; graphHash: string } })) {
  const projects = useProjects();
  const invalidate = useInvalidateP9Automation();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [minutes, setMinutes] = useState(60);
  const [saving, setSaving] = useState(false);
  const requestInFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [savedProjectId, setSavedProjectId] = useState<number | null>(null);
  const eligible = (projects.data ?? []).filter(project =>
    project.status === "active" && !project.trashedAt && Number.isSafeInteger(project.id) && project.id > 0 &&
    (!projectReview || project.id === projectReview.projectId),
  );
  const selected = eligible.find(project => project.id === projectId);
  const validMinutes = Number.isInteger(minutes) && minutes >= 5 && minutes <= 10080;
  const preview = selected && validMinutes
    ? (() => { try { return projectReview ? quickMonitorDraft("changes", false, minutes) : pulseProjectMonitorDraft(card!, minutes); } catch { return null; } })()
    : null;

  const save = async () => {
    if (requestInFlight.current || saving || savedProjectId !== null || !selected || !preview) return;
    requestInFlight.current = true;
    const originalProjectId = selected.id;
    setError(null);
    setSaving(true);
    try {
      const saved = await createP9Workflow(originalProjectId, preview);
      // The server is the authority for the workflow ID, Project and enabled
      // state. Do not claim a successful paused workflow from an HTTP 2xx alone.
      if (!saved.id || saved.projectId !== originalProjectId ||
        saved.enabled !== false || saved.action.kind !== "project_what_changed") {
        throw new Error("The server did not confirm this exact paused Project workflow.");
      }
      invalidate(originalProjectId);
      setSavedProjectId(originalProjectId);
    } catch {
      setError("Saving was not confirmed. Check this Project's existing workflows before retrying to avoid duplicates.");
    } finally {
      requestInFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <section data-testid="pulse-project-monitor-review" aria-label="Review Project change monitor"
      className="space-y-3 rounded-lg border border-amber-300/30 bg-amber-300/[0.03] p-3 font-ui text-sm">
      <h4 className="font-ui text-base font-semibold text-foreground">Review a Project change monitor</h4>
      <p className="leading-6 text-muted-foreground">
        This existing LIOS P9 monitor compares <strong className="text-foreground">the whole selected Project</strong>,
        not a particular insight, subject or publisher. Opening this review grants no source access.
        It will save paused and requires a running Home plus explicit enablement to execute later.
      </p>
      {savedProjectId !== null ? (
        <div role="status" className="space-y-2 rounded-lg border border-emerald-300/35 p-3">
          <p className="font-semibold text-emerald-200">A paused Project workflow was confirmed by the server.</p>
          <p className="text-muted-foreground">No run was triggered. Open this Project’s Watchrooms to inspect the saved workflow and explicitly review any later enablement.</p>
          <a href={formatLiosAddress({ kind: "project", projectId: savedProjectId })}
            className="inline-flex min-h-10 items-center rounded-lg border border-border px-3 py-2 font-medium text-amber-200 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-amber-300">
            Open saved Project
          </a>
        </div>
      ) : (
        <>
          {projects.isPending && <p role="status" className="text-muted-foreground">Loading authorized Projects…</p>}
          {projects.isError && <div role="alert" className="space-y-2">
            <p>Projects are unavailable. Nothing has been saved or scheduled.</p>
            <button type="button" onClick={() => void projects.refetch()}
              className="min-h-10 rounded-lg border border-border px-3 py-2 text-foreground">Retry Projects</button>
          </div>}
          {projects.isSuccess && !eligible.length && <p role="status" className="text-muted-foreground">
            No active Projects are available. Create or reopen a Project before setting up monitoring.
          </p>}
          {eligible.length > 0 && (
            <label className="block font-medium text-foreground">
              Choose a Project explicitly
              <select value={projectId ?? ""} disabled={saving}
                onChange={event => { setProjectId(event.target.value ? Number(event.target.value) : null); setError(null); }}
                className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 font-ui text-sm text-foreground focus-visible:outline-2 focus-visible:outline-amber-300">
                <option value="">Choose a Project…</option>
                {eligible.slice(0, 80).map(project => <option value={project.id} key={project.id}>{project.name}</option>)}
              </select>
            </label>
          )}
          {selected && <label className="block font-medium text-foreground">
            Future interval, if explicitly enabled later (minutes)
            <input type="number" value={minutes} min={5} max={10080} step={1} disabled={saving}
              onChange={event => setMinutes(event.target.value === "" ? NaN : Number(event.target.value))}
              className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 font-ui text-sm text-foreground focus-visible:outline-2 focus-visible:outline-amber-300" />
          </label>}
          {selected && <div aria-label="Workflow preview" className="space-y-1 rounded-lg border border-border/60 p-3 text-muted-foreground">
            <p><strong className="text-foreground">Project:</strong> {selected.name}</p>
            <p><strong className="text-foreground">Action:</strong> Compare Project-wide recorded changes</p>
            <p><strong className="text-foreground">Subject:</strong> Context only — not an event filter</p>
            <p><strong className="text-foreground">State:</strong> Paused; no automatic execution</p>
            <p><strong className="text-foreground">Notifications:</strong> In-app only, subject to future explicit enablement, permissions and source availability</p>
          </div>}
          {error && <p role="alert" className="rounded-lg border border-rose-300/40 p-3 text-rose-200">{error}</p>}
          <button type="button" disabled={saving || !preview || !selected || projects.isError || projects.isPending}
            onClick={() => void save()}
            className="min-h-11 rounded-lg border border-amber-300/55 bg-amber-300/[0.08] px-3 py-2 font-medium text-foreground disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-amber-300">
            {saving ? "Saving paused workflow…" : "Save paused Project-wide workflow"}
          </button>
        </>
      )}
      <button type="button" onClick={onClose} disabled={saving}
        className="ml-2 min-h-11 rounded-lg border border-border px-3 py-2 text-foreground disabled:opacity-40">
        {savedProjectId !== null ? "Close" : "Cancel"}
      </button>
    </section>
  );
}
