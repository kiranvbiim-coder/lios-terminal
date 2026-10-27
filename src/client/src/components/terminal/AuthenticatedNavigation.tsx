import { useState, type ReactNode } from "react";
import { Plus, Search, FolderKanban, MessageSquare, Clock3, LayoutDashboard, Library, Workflow, Blocks, Plug, Settings2, Palette, Menu, LogOut, ChevronUp, ChevronLeft, PanelLeftOpen, Trash2, Upload } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";

import { LIOS_PRODUCT_PALETTES, readLiosProductPalette, resolveLiosProductPalette, setLiosProductPalette } from "@/lib/liosProductPalette";

export type NavigationSection = "conversation" | "projects" | "chats" | "library" | "automations" | "plugins";

interface Props {
  section: NavigationSection;
  activeSection?: NavigationSection;
  account: { name: string; email?: string };
  busy: boolean;
  children: ReactNode;
  onSection: (section: NavigationSection) => void;
  onNewChat: () => void;
  onTemporary: () => void;
  onSearch: () => void;
  onWorkbench: () => void;
  onConnectors: () => void;
  onSettings: () => void;
  onLogout: () => void;
  onTrash: () => void;
  onMigrate: () => void;
}
const sections = [
  ["conversation", "Chat", MessageSquare],
  ["projects", "Projects", FolderKanban],
  ["chats", "History", Clock3],
  ["library", "Artifacts", Library],
  ["automations", "Automations", Workflow],
  ["plugins", "Plugins", Blocks],
] as const;

export function AuthenticatedNavigation(props: Props) {
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(readLiosProductPalette);
  const [collapsed, setCollapsed] = useState(false);
  const act = (action: () => void) => { action(); setOpen(false); };
  // The expanded sidebar, compact rail and mobile sheet share the same
  // account menu; collapsing never hides Settings, Temporary chat or Sign out.
  const accountMenu = (compact = false) => (
    <DropdownMenu>
      <DropdownMenuTrigger className={compact ? "lios-compact-account-trigger" : "lios-account-trigger"} title={compact ? "Account" : undefined} aria-label={`Account: ${props.account.name}`}><span className="lios-account-avatar" aria-hidden="true">{props.account.name.slice(0, 1).toUpperCase()}</span>{!compact && <><span><strong>{props.account.name}</strong><small>{props.account.email || "Local workspace"}</small></span><ChevronUp size={14} /></>}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={compact ? "right" : "top"} className="w-60">
        <DropdownMenuItem onSelect={() => act(props.onTemporary)}>Temporary chat</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => act(props.onWorkbench)}>Open workspace</DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onSettings}><Settings2 className="mr-2 h-4 w-4" />Settings</DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onConnectors}><Plug className="mr-2 h-4 w-4" />Connections & AI</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger><Palette className="mr-2 h-4 w-4" />Appearance</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-72">
            <DropdownMenuRadioGroup value={palette} onValueChange={(value) => {
              const next = resolveLiosProductPalette(value);
              setPalette(next);
              setLiosProductPalette(next);
            }}>
              {LIOS_PRODUCT_PALETTES.map(({ id, label }) => <DropdownMenuRadioItem key={id} value={id}><span className="lios-palette-swatch" data-lios-preview={id} aria-hidden="true"><i /><i /><i /></span>{label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => act(props.onTrash)}><Trash2 className="mr-2 h-4 w-4" />Trash & archive</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => act(props.onMigrate)}><Upload className="mr-2 h-4 w-4" />Import legacy workspaces</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={props.onLogout}><LogOut className="mr-2 h-4 w-4" />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const content = (drawer = false) => <>
    <header className="lios-reference-navigation-brand">
      <span className="font-ui font-semibold">LiOS</span>
      {!drawer && <button type="button" aria-label="Collapse navigation" title="Collapse navigation" onClick={() => setCollapsed(true)}><ChevronLeft size={16} aria-hidden="true" /></button>}
    </header>
    <nav className="lios-primary-navigation" aria-label="Main navigation">
      <button type="button" className="lios-new-chat" disabled={props.busy} onClick={() => act(props.onNewChat)}><Plus size={16} aria-hidden="true" />New chat</button>
      <button type="button" onClick={() => act(props.onSearch)}><Search size={16} aria-hidden="true" />Search</button>
      <button type="button" className="lios-open-work" onClick={() => act(props.onWorkbench)}><LayoutDashboard size={16} aria-hidden="true" />Work</button>
      <div className="lios-navigation-section-links">
        {sections.map(([id, label, Icon]) => (
          <button key={id} type="button" aria-current={(props.activeSection ?? props.section) === id ? "page" : undefined} onClick={() => act(() => props.onSection(id))}>
            <Icon size={16} aria-hidden="true" />{label}
          </button>
        ))}
        <button type="button" onClick={() => act(props.onConnectors)}><Plug size={16} aria-hidden="true" />Connections</button>
        <button type="button" onClick={() => act(props.onSettings)}><Settings2 size={16} aria-hidden="true" />Settings</button>
      </div>
    </nav>
    <div className="lios-navigation-history" onClick={(event) => { if ((event.target as HTMLElement).closest("button[data-navigation-action]")) setOpen(false); }}>{props.children}</div>
    {accountMenu()}

  </>;
  return <>
    <aside className="lios-authenticated-navigation" data-sidebar-collapsed={collapsed}>
      <nav className="lios-reference-navigation-rail" aria-label="Compact navigation" hidden={!collapsed}>
        <button type="button" title="Expand navigation" aria-label="Expand navigation" onClick={() => setCollapsed(false)}><PanelLeftOpen size={17} aria-hidden="true" /></button>
        <button type="button" title="New chat" aria-label="New chat" disabled={props.busy} onClick={props.onNewChat}><Plus size={17} aria-hidden="true" /></button>
        <button type="button" title="Search" aria-label="Search" onClick={props.onSearch}><Search size={17} aria-hidden="true" /></button>
        <button type="button" title="Work" aria-label="Work" onClick={props.onWorkbench}><LayoutDashboard size={17} aria-hidden="true" /></button>
        {sections.map(([id, label, Icon]) => <button key={id} type="button" title={label} aria-label={label} aria-current={(props.activeSection ?? props.section) === id ? "page" : undefined} onClick={() => props.onSection(id)}><Icon size={17} aria-hidden="true" /></button>)}
        <button type="button" title="Connections" aria-label="Connections" onClick={props.onConnectors}><Plug size={17} aria-hidden="true" /></button>
        <button type="button" className="lios-reference-rail-settings" title="Settings" aria-label="Settings" onClick={props.onSettings}><Settings2 size={17} aria-hidden="true" /></button>
        {accountMenu(true)}
      </nav>
      <div className="lios-reference-navigation-projects" hidden={collapsed}>{content()}</div>
    </aside>
    <div className="lios-mobile-navigation"><Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger aria-label="Open navigation"><Menu size={18} /></SheetTrigger><span>LiOS</span>
      <SheetContent side="left" className="lios-navigation-sheet"><SheetTitle className="sr-only">LiOS navigation</SheetTitle><SheetDescription className="sr-only">Projects, conversations and account controls</SheetDescription>{content(true)}</SheetContent>
    </Sheet></div>
  </>;
}

