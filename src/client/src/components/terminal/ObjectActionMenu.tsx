import { useRef } from "react";
import {
  Archive,
  ArrowRightLeft,
  Copy,
  ExternalLink,
  GitBranch,
  MoreHorizontal,
  Pencil,
  Pin,
  RotateCcw,
  Share2,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type LifecycleAction,
  type LifecycleObjectKind,
  type LifecycleStatus,
  type LifecycleScope,
} from "@shared/objectLifecycle";
import { getLifecycleMenuItems, type LifecycleMenuOptions } from "@/lib/objectLifecycleMenu";

interface ObjectActionMenuProps extends LifecycleMenuOptions {
  kind: LifecycleObjectKind;
  status: LifecycleStatus;
  pinned?: boolean;
  scope?: LifecycleScope;
  label?: string;
  onAction: (action: LifecycleAction, trigger?: HTMLButtonElement | null) => void;
}

const ACTION_ICONS: Record<LifecycleAction, typeof Archive> = {
  open: ExternalLink,
  rename: Pencil,
  pin: Pin,
  unpin: Pin,
  move: ArrowRightLeft,
  save_to_project: Copy,
  share: Share2,
  branch: GitBranch,
  fork: GitBranch,
  compare: ArrowRightLeft,
  export: ExternalLink,
  archive: Archive,
  restore: RotateCcw,
  delete: Trash2,
  delete_permanently: Trash2,
};

export function ObjectActionMenu({
  kind,
  status,
  pinned = false,
  scope,
  hidden,
  disabled,
  label = "Open object actions",
  onAction,
}: ObjectActionMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingAction = useRef<LifecycleAction | null>(null);
  const items = getLifecycleMenuItems({ kind, status, pinned, scope }, { hidden, disabled });
  if (!items.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          ref={triggerRef}
          aria-label={label}
          title={label}
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-muted-foreground transition-colors hover:border-border/70 hover:bg-white/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[190px] border-border/80 bg-[#0a0a0a] p-1"
        onCloseAutoFocus={(event) => {
          const action = pendingAction.current;
          pendingAction.current = null;
          if (action === null) return;
          // Release the menu's modal layer before an action opens another dialog.
          event.preventDefault();
          triggerRef.current?.focus();
          onAction(action, triggerRef.current);
        }}
      >
        <DropdownMenuLabel className="px-2 py-1 font-terminal text-[7px] uppercase tracking-[0.18em] text-muted-foreground">
          {kind} actions
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-border/70" />
        {items.map((item) => {
          const Icon = ACTION_ICONS[item.id];
          const isDisabled = Boolean(item.disabledReason);
          return (
            <DropdownMenuItem
              key={item.id}
              disabled={isDisabled}
              aria-label={item.disabledReason ? `${item.label}. ${item.disabledReason}` : item.label}
              title={item.disabledReason}
              onSelect={() => {
                if (!isDisabled) pendingAction.current = item.id;
              }}
              className={`font-ui text-[8px] ${item.danger ? "text-red-300 focus:text-red-200" : "text-foreground"}`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{item.label}</span>
              {isDisabled && <span className="ml-auto font-terminal text-[6px] text-muted-foreground">UNAVAILABLE</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
