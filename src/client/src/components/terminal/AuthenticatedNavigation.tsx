import { useState, type ReactNode } from "react";
import { Plus, Search, FolderKanban, MessageSquare, Library, Workflow, Blocks, Plug, Settings2, Palette, Menu, LogOut, ChevronUp, ChevronLeft, ChevronRight, Trash2, Upload } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";

import { LIOS_PRODUCT_PALETTES, readLiosProductPalette, resolveLiosProductPalette, setLiosProductPalette } from "@/lib/liosProductPalette";

export type NavigationSection = "conversation" | "projects" | "chats" | "library" | "automations" | "plugins";

interface Props {
  section: NavigationSection;
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
  ["projects", "Projects", FolderKanban], ["chats", "Chats", MessageSquare],
  ["library", "Artifacts", Library], ["automations", "Automations", Workflow],
  ["plugins", "Plugins", Blocks],
] as const;

export function AuthenticatedNavigation(props: Props) {
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(readLiosProductPalette);
  const [collapsed, setCollapsed] = useState(false);
  const act = (action: () => void) => { action(); setOpen(false); };
  const content = (drawer = false) => <>
    <header className="lios-reference-navigation-brand"><span className="font-terminal">{props.section === "conversation" ? "LiOS" : props.section.toUpperCase()}</span>{!drawer && <button type="button" aria-label="Collapse project sidebar" onClick={() => setCollapsed(true)}><ChevronLeft size={14} /></button>}</header>
    <nav className="lios-primary-navigation" aria-label="LiOS navigation">
      <button className="lios-new-chat" disabled={props.busy} onClick={() => act(props.onNewChat)}><Plus size={16} />New Chat</button>
      <button onClick={() => act(props.onSearch)}><Search size={16} />Search<span className="lios-shortcut" aria-hidden="true">⌘ K</span></button>
      {drawer && sections.map(([id, label, Icon]) => <button key={id} aria-current={props.section === id ? "page" : undefined} onClick={() => act(() => props.onSection(id))}><Icon size={16} />{label}</button>)}
      {drawer && <button onClick={() => act(props.onConnectors)}><Plug size={16} />Connections</button>}
      {drawer && <button onClick={() => act(props.onSettings)}><Settings2 size={16} />Settings</button>}
    </nav>
    <div className="lios-navigation-history" onClick={(event) => { if ((event.target as HTMLElement).closest("button[data-navigation-action]")) setOpen(false); }}>{props.children}</div>
    <DropdownMenu>
      <DropdownMenuTrigger className="lios-account-trigger" aria-label={`Account: ${props.account.name}`}><span className="lios-account-avatar" aria-hidden="true">{props.account.name.slice(0, 1).toUpperCase()}</span><span><strong>{props.account.name}</strong><small>{props.account.email || "Local workspace"}</small></span><ChevronUp size={14} /></DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
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
              {LIOS_PRODUCT_PALETTES.map(({ id, label }) => <DropdownMenuRadioItem key={id} value={id}>{label}</DropdownMenuRadioItem>)}
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
  </>;
  return <>
    <aside className="lios-authenticated-navigation" data-sidebar-collapsed={collapsed}>
      <nav className="lios-reference-navigation-rail" aria-label="Workspace sections">
        {sections.map(([id, label, Icon]) => <button key={id} type="button" title={label} aria-label={label} aria-current={props.section === id ? "page" : undefined} onClick={() => props.onSection(id)}><Icon size={17} /></button>)}
        <button type="button" title="Connections" aria-label="Connections" onClick={props.onConnectors}><Plug size={17} /></button>
        <button type="button" className="lios-reference-rail-settings" title="Settings" aria-label="Settings" onClick={props.onSettings}><Settings2 size={17} /></button>
      </nav>
      <div className="lios-reference-navigation-projects" hidden={collapsed}>{content()}</div>
      {collapsed && <button type="button" className="lios-reference-expand-sidebar" aria-label="Expand project sidebar" onClick={() => setCollapsed(false)}><ChevronRight size={12} /></button>}
    </aside>
    <div className="lios-mobile-navigation"><Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger aria-label="Open navigation"><Menu size={18} /></SheetTrigger><span>LiOS</span>
      <SheetContent side="left" className="lios-navigation-sheet"><SheetTitle className="sr-only">LiOS navigation</SheetTitle><SheetDescription className="sr-only">Projects, conversations and account controls</SheetDescription>{content(true)}</SheetContent>
    </Sheet></div>
  </>;
}

