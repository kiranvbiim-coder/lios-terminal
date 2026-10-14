import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  FolderKanban,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
} from "lucide-react";
import type { ExperienceShellSurface } from "@shared/waveCContracts";
import type { ViewMode } from "@/lib/terminalTypes";
import type { DomainSlug } from "@/lib/domains";
import { useAudience } from "@/lib/audience";
import {
  getProductNavigation,
  getProductSectionForView,
  PRIMARY_NAV_LABELS,
  type PrimaryNavKey,
  type ProductNavSection,
} from "@/lib/productNavigation";
import { openEnvironmentCenter } from "@/lib/appShellEvents";
import { openTerminalUxSurface } from "@/lib/terminalUxEvents";

interface Props {
  view: ViewMode;
  surface: ExperienceShellSurface;
  onNav: (v: ViewMode) => void;
  onSurface: (surface: ExperienceShellSurface) => void;
  domain: DomainSlug;
  lifecycleStage?: "trial" | "client" | "churned" | null;
}

type AdvancedNavKey = Extract<PrimaryNavKey, "projects" | "workbench" | "data" | "settings">;

const ADVANCED_NAV_ORDER: readonly AdvancedNavKey[] = [
  "projects",
  "workbench",
  "data",
  "settings",
] as const;

const ICONS: Record<AdvancedNavKey, typeof FolderKanban> = {
  projects: FolderKanban,
  workbench: LayoutDashboard,
  data: Database,
  settings: Settings2,
};

const ACTION_LABELS: Record<"data" | "settings", { label: string; description: string }> = {
  data: {
    label: "Data",
    description: "Connect, inspect, and manage user-owned data and providers.",
  },
  settings: {
    label: "Settings",
    description: "Configure terminal behavior, preferences, and intelligence settings.",
  },
};

function PrimaryButton({
  navKey,
  label,
  description,
  active,
  expanded,
  expandable,
  collapsed,
  onClick,
}: {
  navKey: AdvancedNavKey;
  label: string;
  description: string;
  active: boolean;
  expanded: boolean;
  expandable: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const Icon = ICONS[navKey];
  return (
    <button
      type="button"
      data-testid={`product-nav-${navKey}`}
      aria-current={active ? "page" : undefined}
      aria-expanded={expandable ? expanded : undefined}
      onClick={onClick}
      title={collapsed ? label : description}
      className={`group flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left transition-colors ${
        active
          ? "border-[hsl(38,95%,55%)] bg-[hsl(38,95%,55%)]/10 text-[hsl(38,95%,60%)]"
          : "border-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 font-terminal text-[9px] font-bold uppercase tracking-[0.14em]">
            {label}
          </span>
          {expandable && (
            expanded
              ? <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
              : <ChevronRight className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
          )}
        </>
      )}
    </button>
  );
}

function SectionChildren({
  section,
  view,
  onNav,
  expanded,
  onToggle,
}: {
  section: ProductNavSection;
  view: ViewMode;
  onNav: (v: ViewMode) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (section.items.length === 0) return null;

  return (
    <div className="mb-1 ml-4 border-l border-border/60 pl-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-muted-foreground transition-colors hover:bg-white/[0.035] hover:text-foreground"
      >
        {expanded ? <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate font-terminal text-[8px] font-semibold uppercase tracking-[0.12em]">{section.label}</span>
        <span className="font-terminal text-[7px] tabular-nums text-muted-foreground/70">{section.items.length}</span>
      </button>
      {expanded && section.items.map((item) => (
          <button
            key={item.view}
            type="button"
            data-testid={`sidebar-${item.view}`}
            onClick={() => onNav(item.view)}
            title={item.description}
            className={`flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors ${
              item.view === view
                ? "border-l border-[hsl(38,95%,55%)] bg-white/5 text-[hsl(38,95%,60%)]"
                : "text-muted-foreground hover:bg-white/[0.035] hover:text-foreground"
            }`}
          >
            <span className="w-1 shrink-0 text-[7px] text-[hsl(38,95%,55%)]/70">›</span>
            <span className="min-w-0 truncate font-terminal text-[8px] uppercase tracking-wider">
              {item.label}
            </span>
          </button>
        ))}
    </div>
  );
}

export default function Sidebar({ view, surface, onNav, onSurface, domain, lifecycleStage }: Props) {
  const isInternal = useAudience() === "internal";
  const isClient = useAudience() === "client";
  const onWorkbench = surface === "workbench";
  const [collapsed, setCollapsed] = useState(onWorkbench);
  const context = useMemo(() => ({
    domain,
    isInternal: isInternal,
    isClientBuild: isClient,
    isTrial: lifecycleStage === "trial",
  }), [domain, lifecycleStage]);
  const sections = useMemo(() => getProductNavigation(context).filter((section) => section.key !== "home"), [context]);
  const activeSection = useMemo(() => getProductSectionForView(view, context), [context, view]);
  const [expandedSection, setExpandedSection] = useState<string | null>(activeSection);

  useEffect(() => {
    setCollapsed(onWorkbench);
  }, [onWorkbench]);

  useEffect(() => {
    if (activeSection) setExpandedSection(activeSection);
  }, [activeSection]);

  const toggleWorkbench = () => {
    onSurface("workbench");
  };

  const runAction = (key: "data" | "settings") => {
    if (key === "data") openEnvironmentCenter();
    else openTerminalUxSurface("settings");
  };

  return (
    <aside
      aria-label="LIOS advanced workspace navigation"
      data-operational={onWorkbench ? "true" : "false"}
      data-collapsed={collapsed ? "true" : "false"}
      className={`${collapsed ? "w-14" : "w-60"} flex h-full shrink-0 flex-col border-r border-border bg-[#070707] transition-[width] duration-150`}
    >
      <div className={`${onWorkbench ? "px-1 py-1" : "px-3 py-3"} border-b border-border`}>
        <div className="flex items-center justify-between gap-2">
          {!collapsed && !onWorkbench && (
            <div className="min-w-0">
              <div className="font-terminal text-[9px] font-bold uppercase tracking-[0.18em] text-foreground">LIOS</div>
              <div className="mt-1 font-terminal text-[7px] uppercase tracking-[0.12em] text-muted-foreground">
                See → Ask → Analyze → Compute → Decide
              </div>
            </div>
          )}
          {!collapsed && onWorkbench && (
            <div className="min-w-0 flex-1 px-2 font-terminal text-[8px] font-bold uppercase tracking-[0.16em] text-foreground">
              Workbench
            </div>
          )}
          <button
            type="button"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={() => setCollapsed((value) => !value)}
            className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            {collapsed
              ? <PanelLeftOpen className="h-3.5 w-3.5" aria-hidden="true" />
              : <PanelLeftClose className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto py-2 scrollbar-thin">
        {ADVANCED_NAV_ORDER.map((navKey) => {
          if (navKey === "data" || navKey === "settings") {
            const action = ACTION_LABELS[navKey];
            return (
              <PrimaryButton
                key={navKey}
                navKey={navKey}
                label={action.label}
                description={action.description}
                active={false}
                expanded={false}
                expandable={false}
                collapsed={collapsed}
                onClick={() => runAction(navKey)}
              />
            );
          }

          if (navKey === "workbench") {
            const meta = PRIMARY_NAV_LABELS.workbench;
            const isExpanded = !collapsed && onWorkbench;
            return (
              <div key={navKey}>
                <PrimaryButton
                  navKey={navKey}
                  label={meta.label}
                  description={meta.description}
                  active={onWorkbench}
                  expanded={isExpanded}
                  expandable
                  collapsed={collapsed}
                  onClick={toggleWorkbench}
                />
                {isExpanded && sections.map((section) => (
                  <SectionChildren
                    key={section.key}
                    section={section}
                    view={view}
                    expanded={expandedSection === section.key}
                    onToggle={() => setExpandedSection((current) => current === section.key ? null : section.key)}
                    onNav={(next) => { onSurface("workbench"); onNav(next); }}
                  />
                ))}
              </div>
            );
          }

          const meta = PRIMARY_NAV_LABELS[navKey];
          return (
            <PrimaryButton
              key={navKey}
              navKey={navKey}
              label={meta.label}
              description={meta.description}
              active={surface === navKey}
              expanded={false}
              expandable={false}
              collapsed={collapsed}
              onClick={() => onSurface(navKey)}
            />
          );
        })}
      </nav>

      {!collapsed && !onWorkbench && (
        <div className="border-t border-border px-3 py-2 font-terminal text-[7px] uppercase tracking-wider text-muted-foreground/70">
          Advanced tools stay here. Return to Projects for conversations, artifacts and saved work.
        </div>
      )}
    </aside>
  );
}
