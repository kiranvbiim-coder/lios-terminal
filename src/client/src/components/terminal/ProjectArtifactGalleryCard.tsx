/**
 * Visual Artifact Library card, adapted from Watermelon UI's motion-led Bento1
 * composition: https://github.com/WatermelonCorp/watermellon-registry/blob/86052b8fd12bc19bf3bac07625a7f93736c42b17/src/components/watermelon-ui/bento-1.tsx
 * MIT © 2025-present Watermelon Contributors.
 * Full upstream notice: third_party/licenses/watermellon-registry-MIT.txt
 *
 * The decorative cover represents a *kind*, never unpublished Artifact contents.
 * No demo metrics/images, external media, package or storage layer are imported.
 */
import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  BarChart3, BookOpenText, Boxes, Calculator, Database, FileSpreadsheet,
  FileText, GitBranch, LayoutDashboard, LineChart, ListChecks, Network,
  Table2, type LucideIcon,
} from "lucide-react";
import type { ProjectArtifactRecord } from "@/lib/useArtifacts";

type ArtifactCardRecord = Pick<
  ProjectArtifactRecord,
  "id" | "title" | "kind" | "headVersion" | "origin" | "status"
>;

const VISUALS: Record<ArtifactCardRecord["kind"], { icon: LucideIcon; name: string; tint: string; wash: string }> = {
  chart: { icon: LineChart, name: "Chart", tint: "text-cyan-200", wash: "from-cyan-400/15" },
  table: { icon: Table2, name: "Table", tint: "text-sky-200", wash: "from-sky-400/15" },
  screen: { icon: LayoutDashboard, name: "Workspace", tint: "text-violet-200", wash: "from-violet-400/15" },
  valuation: { icon: Calculator, name: "Valuation", tint: "text-amber-200", wash: "from-amber-400/15" },
  portfolio: { icon: BarChart3, name: "Portfolio", tint: "text-emerald-200", wash: "from-emerald-400/15" },
  research: { icon: BookOpenText, name: "Research", tint: "text-fuchsia-200", wash: "from-fuchsia-400/15" },
  report: { icon: FileText, name: "Report", tint: "text-amber-200", wash: "from-amber-400/15" },
  spreadsheet: { icon: FileSpreadsheet, name: "Spreadsheet", tint: "text-green-200", wash: "from-green-400/15" },
  data: { icon: Database, name: "Dataset", tint: "text-cyan-200", wash: "from-cyan-400/15" },
  backtest: { icon: LineChart, name: "Backtest", tint: "text-teal-200", wash: "from-teal-400/15" },
  strategy: { icon: GitBranch, name: "Strategy", tint: "text-violet-200", wash: "from-violet-400/15" },
  decision: { icon: ListChecks, name: "Decision", tint: "text-orange-200", wash: "from-orange-400/15" },
  timeline: { icon: Network, name: "Timeline", tint: "text-sky-200", wash: "from-sky-400/15" },
  thesis: { icon: Boxes, name: "Thesis", tint: "text-rose-200", wash: "from-rose-400/15" },
};

const ORIGIN: Record<ArtifactCardRecord["origin"], string> = {
  direct: "Created here", conversation: "From Chat", import: "Imported",
  fork: "Forked", engine: "From analysis",
};

export interface ProjectArtifactGalleryCardProps {
  artifact: ArtifactCardRecord;
  onOpen: () => void;
  onPreview: () => void;
  previewOpen: boolean;
  actions?: React.ReactNode;
}

export function ProjectArtifactGalleryCard({
  artifact, onOpen, onPreview, previewOpen, actions,
}: ProjectArtifactGalleryCardProps) {
  const reduceMotion = useReducedMotion();
  const visual = VISUALS[artifact.kind];
  const Icon = visual.icon;
  const archived = artifact.status === "archived";
  return (
    <motion.article
      initial={false}
      whileHover={reduceMotion ? undefined : { y: -2 }}
      transition={{ type: "spring", stiffness: 350, damping: 31 }}
      data-testid="project-artifact-gallery-card"
      data-artifact-kind={artifact.kind}
      className={`group relative min-w-0 overflow-hidden rounded-2xl border bg-card/70 shadow-sm transition-colors ${archived
        ? "border-border/40 opacity-75"
        : "border-border/60 hover:border-amber-300/30 hover:bg-card"}`}
    >
      <div
        className={`relative flex h-28 items-center justify-center overflow-hidden border-b border-border/40 bg-gradient-to-br ${visual.wash} via-background to-background`}
        aria-hidden="true"
      >
        <div className="absolute -right-6 -top-12 h-40 w-40 rounded-full border border-current opacity-[0.06]" />
        <div className="absolute -bottom-20 -left-12 h-36 w-36 rounded-full border border-current opacity-[0.06]" />
        <div className="absolute top-4 h-20 w-28 -rotate-6 rounded-xl border border-border/40 bg-background/50 shadow-xl transition-transform duration-300 motion-reduce:transition-none group-hover:-translate-x-1" />
        <div className="absolute top-4 h-20 w-28 rotate-3 rounded-xl border border-border/60 bg-background/85 shadow-xl transition-transform duration-300 motion-reduce:transition-none group-hover:translate-x-1" />
        <div className={`relative flex h-14 w-14 items-center justify-center rounded-xl border border-border/50 bg-background/90 shadow-sm ${visual.tint}`}>
          <Icon className="h-7 w-7" strokeWidth={1.5} />
        </div>
        <span className="absolute bottom-2 right-3 font-ui text-[10px] uppercase tracking-widest text-muted-foreground/85">
          {visual.name}
        </span>
      </div>
      <div className="space-y-2.5 p-4">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 min-h-[2.75rem] font-ui text-[14px] font-semibold leading-5 text-foreground">{artifact.title}</h3>
            <p className="mt-1 font-ui text-xs text-muted-foreground">
              {archived ? "Archived" : ORIGIN[artifact.origin]} · Saved v{artifact.headVersion}
            </p>
          </div>
          {actions}
        </div>
        <div className="flex items-center gap-2 border-t border-border/40 pt-3">
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Open ${artifact.title}, version ${artifact.headVersion}`}
            className="min-h-10 flex-1 rounded-lg border border-amber-300/25 bg-amber-300/[0.065] px-3 font-ui text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-300/[0.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
          >
            Open work
          </button>
          <button
            type="button"
            onClick={onPreview}
            aria-label={`${previewOpen ? "Hide" : "Preview"} saved content for ${artifact.title}, version ${artifact.headVersion}`}
            aria-expanded={previewOpen}
            className="min-h-10 rounded-lg border border-border/70 px-3 font-ui text-xs font-medium text-foreground transition-colors hover:border-amber-300/30 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
          >
            {previewOpen ? "Hide preview" : "Preview"}
          </button>
        </div>
      </div>
    </motion.article>
  );
}
