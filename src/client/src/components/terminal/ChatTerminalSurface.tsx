import * as React from "react";
import type { ReactNode } from "react";
import { chatTerminalCapabilities, type ChatTerminalContext, type ChatTerminalControls } from "@/lib/chatTerminalContext";
import type { WorkspaceAudience } from "@/lib/featureRegistry";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
export type ChatTerminalRenderer = (context: ChatTerminalContext, controls: ChatTerminalControls) => ReactNode;
export function ChatTerminalControl({ audience, selected, onSelect }: { audience: WorkspaceAudience; selected: ChatTerminalContext | null; onSelect: (context: ChatTerminalContext) => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><button type="button" className="rounded px-2 py-1 text-xs text-muted-foreground">Finance terminal</button></DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" aria-label="Existing finance terminal tools" className="max-h-80 w-64 overflow-auto">
      {chatTerminalCapabilities(audience).map(item => <DropdownMenuItem key={item.view} onSelect={() => onSelect({ view: item.view, symbol: selected?.symbol ?? null })}>{item.label}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
