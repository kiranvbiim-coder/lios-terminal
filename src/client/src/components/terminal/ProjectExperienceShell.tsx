import { useConversationArtifactView } from "@/lib/conversationArtifactView";
import ChatSourcesControl from "./ChatSourcesControl";
import ConversationArtifactSidecar from "./ConversationArtifactSidecar";
import type { z } from "zod";
import { ProjectDestinationDialog } from "./ProjectDestinationDialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import GovernedExtensionsPanel from "@/components/GovernedExtensionsPanel";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectLifecycleDialog, type LifecycleRequest } from "./ProjectLifecycleDialog";
import { resolveEntrySurface, resolveInitialChatMode } from "@/lib/projectEntry";
import { ProjectHome, relativeTime } from "./ProjectHome";
import { AuthenticatedNavigation, type NavigationSection } from "./AuthenticatedNavigation";
import WorkSearchDialog from "./WorkSearchDialog";
import type { WorkSearchResult } from "@shared/workSearch";
import "./project-conversation-shell.css";
import { LifecycleCenter } from "./LifecycleCenter";
import { ProjectArtifactsPanel } from "./ProjectArtifactsPanel";
import { ProjectAutomationPanel } from "./ProjectAutomationPanel";
import { SaveWorkflowDialog } from "./SaveWorkflowDialog";
import { useInvalidateP9Automation } from "@/lib/useP9Automation";
import { ObjectActionMenu } from "./ObjectActionMenu";
import { keepConversationDraft, keepConversationDraftVersion, useInvalidateArtifacts } from "@/lib/useArtifacts";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { speakText, useVoiceProviders, useVoiceRecorder } from "@/lib/useVoiceInput";
import {
  dispatchVisualContext,
  inferVisualSemanticContext,
  inferVisualSemanticContextFromText,
} from "@/lib/visualEnvironment";
import {
  Bot,
  GitBranch,
  FileText,
  FolderKanban,
  LayoutDashboard,
  MessageSquare,
  Mic,
  Paperclip,
  Plus,
  Plug,
  Search,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  Workflow,
  X,
} from "lucide-react";
import type { ArtifactWorkbenchContext, ViewMode } from "@/lib/terminalTypes";
import type { LifecycleAction } from "@shared/objectLifecycle";
import type { P6PersonalFinanceRequest } from "@shared/p6FinanceContracts";
import type { WorkspaceAudience } from "@/lib/featureRegistry";
import type { WorkspaceAdapter } from "@shared/runtimeAdapters";
import type { SafeWorkspaceAction } from "@shared/projectContracts";
import type { ArtifactRefreshSpec } from "@shared/artifactContracts";
import type { VoiceTranscript } from "@shared/multimodalContracts";
import {
  clearProjectChat,
  compareProjectSessions,
  createProject,
  createProjectChat,
  createProjectResource,
  createProjectSession,
  createQuickChat,
  forkProjectSession,
  getProjectDependencySummary,
  migrateLegacyWorkspaces,
  promoteQuickChat,
  trashProject,
  trashProjectChat,
  updateProject,
  updateProjectChat,
  updateProjectResource,
  useInvalidateProjects,
  useProjectChatMessages,
  useProjectChats,
  useProjectHome,
  useProjectSelection,
  useProjects,
  useQuickChats,
  useAllProjectChats,
  type Project,
  type ProjectChat,
  type ProjectChatMessage,
  type ProjectResource,
  type ProjectSession,
} from "@/lib/useProjects";
import { captureProjectWorkspaceSessionState } from "@/lib/projectWorkspaceSession";
import { requestSafeWorkspaceAction } from "@/lib/livingWorkspaceActions";
import {
  createWorkspaceRuntimeContext,
  workspaceSessionEnvelopeForProjectSession,
} from "@/lib/livingWorkspaceAdapter";
import { parseProjectWorkspaceDirectives } from "@/lib/projectWorkspaceDirectives";
import { collectCitationSources, savedMessageCitationSources } from "@/lib/chatMarkdown";
import { fillStarterPrompt, findStarterPlaceholder, PROJECT_STARTER_PROMPTS, resolveProjectConversationVisualIntensity } from "@/lib/projectExperienceVisualState";
import { loadRecentAnalyticalContexts } from "@/lib/terminalPersonalization";
import { LIOS_FIRST_USE_CONTRACT } from "@/lib/firstUseJourney";
import { canonicalRecentChats, hasUnsentConversationDraft, remainingChatMode } from "@/lib/conversationSwitchPolicy";
import { contextForChatMode, savedChatIdForMode, selectionForTemporaryChat, sourceScopeForChatMode } from "@/lib/chatPersistenceBoundary";
import ConversationRuntimeTrace from "./ConversationRuntimeTrace";
import ChatMarkdown from "./ChatMarkdown";
import SavedArtifactCards from "./SavedArtifactCards";
import ExecutionSessionPanel from "./ExecutionSessionPanel";
import SandboxOperationReviewCard from "./SandboxOperationReviewCard";
import { GATEWAY_METHODS } from "@shared/gatewayProtocol";
import { useGateway } from "@/lib/gateway/GatewayProvider";
import { attachConversationRun, cancelConversationRun, runConversation } from "@/lib/gateway/conversationRun";
import { useInterruptedAgentRun } from "@/lib/useInterruptedAgentRun";
import { useBoundedAgentComposer } from "@/lib/useBoundedAgentComposer";
import BoundedAgentComposerControl from "./BoundedAgentComposerControl";
import { loadSandboxSessionBookmark, saveSandboxSessionBookmark } from "@/lib/sandboxSessionBookmarkStore";
import { loadRuntimeReceipt, saveRuntimeReceipt } from "@/lib/runtimeReceiptStore";
import {
  createConversationRequestId,
  loadProjectAITransmissionPolicy,
  loadProjectApprovalGrants,
  recordApprovalOnServer,
  reviewGovernedToolOnServer,
  saveProjectAITransmissionPolicy,
  saveProjectApproval,
  syncProjectApprovalGrants,
} from "@/lib/conversationRuntimeClient";
import {
  DEFAULT_AI_TRANSMISSION_POLICY,
  type AITransmissionPolicy,
  type ApprovalGrant,
  type ConversationActionName,
  type ConversationAttachmentRef,
  type ConversationArtifactDraft,
  type ConversationExecutionMode,
  type ConversationRequest,
  type ConversationRuntimeEvent,
  type ConversationSourceScope,
  type GovernedToolReviewDecision,
  type WorkingContextSnapshot,
} from "@shared/conversationRuntime";
import {
  deriveP1ShellLoadState,
  loadComposerSourceScope,
  recordP1ShellEvent,
  resolveComposerPersistenceTarget,
  saveComposerSourceScope,
} from "@/lib/p1Shell";
import { recordP2ConversationEvent } from "@/lib/p2ConversationTelemetry";
import { recordP3TrustManifest } from "@/lib/p3TrustTelemetry";
import { artifactReplayDraft, buildArtifactDependencyRefs } from "@/lib/p4ArtifactWorkspace";
import { resolveWorkSearchLibraryTarget } from "@/lib/terminalCommands";
type SandboxTerminalInput = z.output<(typeof GATEWAY_METHODS)["execution.session.input"]["params"]>["input"];
type SandboxTerminalProposal = z.output<(typeof GATEWAY_METHODS)["execution.operation.propose"]["result"]>;
const SANDBOX_TERMINAL_INPUTS: SandboxTerminalInput[] = ["help", "pwd", "id -u", "ls /tmp", "exit"];


interface Props {
  audience: WorkspaceAudience;
  activeView: ViewMode;
  activeSymbol?: string;
  workspaceAdapter: WorkspaceAdapter;
  onOpenWorkbench: (context?: ArtifactWorkbenchContext) => void;
  workbenchReturn?: { context: ArtifactWorkbenchContext; request: number; prompt?: string } | null;
  onOpenEnvironment: () => void;
  account: { name: string; email?: string };
  onLogout: () => void;
  onOpenSettings: () => void;
  navigationRequest?: { id: number; section: NavigationSection | "search" } | null;
  onNavigationContext?: (context: string) => void;
  onOpenCommand?: () => void;
}

type ChatMode = "project" | "quick" | "temporary";


interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface SavedMessageAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  byteLength: number;
}

function savedMessageAttachments(message: ProjectChatMessage | LocalMessage): SavedMessageAttachment[] {
  if (!("metadata" in message) || !Array.isArray(message.metadata.attachments)) return [];
  return message.metadata.attachments.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.fileName !== "string" || typeof item.mimeType !== "string" || typeof item.byteLength !== "number") return [];
    return [{ id: item.id, fileName: item.fileName, mimeType: item.mimeType, byteLength: item.byteLength }];
  });
}

async function uploadProjectChatAttachment(projectId: number, chatId: number, file: File): Promise<ConversationAttachmentRef> {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch(`/api/projects/${projectId}/chats/${chatId}/attachments`, { method: "POST", body: form });
  const payload = await response.json().catch(() => null) as { error?: string; attachment?: ConversationAttachmentRef } | null;
  if (!response.ok || !payload?.attachment) {
    const detail = payload?.error || `Attachment upload failed (${response.status}).`;
    const retry = response.status >= 500
      ? " Your staged file is still here—restore attachment storage and send again."
      : "";
    throw new Error(detail + retry);
  }
  return payload.attachment;
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SELECTION_AI_ACTIONS = [
  { id: "explain", label: "Explain", prompt: (text: string) => `Explain this selection in the current Project context:\n\n“${text}”` },
  { id: "compare", label: "Compare", prompt: (text: string) => `Compare this selection with the most relevant peer, prior period, benchmark or scenario:\n\n“${text}”` },
  { id: "model", label: "Model", prompt: (text: string) => `Model the financial implications of this selection using governed Project data and show assumptions:\n\n“${text}”` },
  { id: "source", label: "Show source", prompt: (text: string) => `Show the source, provenance, observation/as-of dates and calculation path for this selection:\n\n“${text}”` },
  { id: "alert", label: "Create alert", prompt: (text: string) => `Create a monitor or alert for the condition implied by this selection. Ask before any external action:\n\n“${text}”` },
  { id: "report", label: "Add to report", prompt: (text: string) => `Add this selection and the relevant analysis to the current Project report or memo:\n\n“${text}”` },
  { id: "ask", label: "Ask about this", prompt: (text: string) => `What should I know about this selection in the current Project context?\n\n“${text}”` },
] as const;

const QUICK_COMMANDS: Array<{ command: string; label: string; view?: ViewMode }> = [
  { command: "/chart", label: "Open Chart", view: "chart" },
  { command: "/model", label: "Open Valuation Model", view: "valuation" },
  { command: "/valuation", label: "Open Valuation", view: "valuation" },
  { command: "/portfolio", label: "Open Portfolio", view: "portfolio" },
  { command: "/risk", label: "Open Risk Analysis", view: "advancedrisk" },
  { command: "/research", label: "Open Research", view: "research" },
  { command: "/screen", label: "Open Screener", view: "screener" },
  { command: "/compare", label: "Open Peer Comparison", view: "peercomp" },
  { command: "/backtest", label: "Open Backtesting", view: "backtesting" },
  { command: "/options", label: "Open Options", view: "options" },
  { command: "/fixedincome", label: "Open Fixed Income", view: "fixedincome" },
  { command: "/statistics", label: "Open Statistics", view: "datastats" },
  { command: "/montecarlo", label: "Open Monte Carlo", view: "montecarlo" },
  { command: "/monitor", label: "Open Monitoring", view: "alerts" },
  { command: "/sandbox", label: "Advanced: open restricted sandbox Terminal" },
  { command: "/session", label: "Save Session" },
];


function NavItem({
  label,
  active,
  muted,
  badge,
  trailing,
  onClick,
}: {
  label: string;
  active?: boolean;
  muted?: boolean;
  badge?: string;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <div className={`flex w-full items-center rounded-md transition-colors ${
      active ? "bg-white/[0.07] text-foreground" : "text-muted-foreground"
                      }`}>
      <button
        type="button"
        data-navigation-action="true"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left outline-none hover:bg-white/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-cyan-300/70"
      >
        <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${muted ? "opacity-45" : ""}`} />
        <span className="min-w-0 flex-1 truncate font-ui text-[13px]">{label}</span>
        {badge && <span className="font-terminal text-[11px] text-muted-foreground/70">{badge}</span>}
      </button>
      {trailing}
    </div>
  );
}

export default function ProjectExperienceShell({
  audience,
  activeView,
  activeSymbol,
  workspaceAdapter,
  onOpenWorkbench: navigateWorkbench, workbenchReturn,
  onOpenEnvironment,
  account, onLogout, onOpenSettings,
  navigationRequest, onNavigationContext,
  onOpenCommand,
}: Props) {
  const [lifecycleRequest, setLifecycleRequest] = useState<LifecycleRequest | null>(null);
  const lifecycleTrigger = useRef<HTMLElement | null>(null);
  const lifecycleResolver = useRef<((value: string | null) => void) | null>(null);
  useEffect(() => () => { lifecycleResolver.current?.(null); }, []);
  const requestLifecycle = (options: Omit<LifecycleRequest, "resolve" | "returnFocus">) => new Promise<string | null>((resolve) => {
    lifecycleResolver.current?.(null);
    lifecycleResolver.current = resolve;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menuId = active?.closest('[role="menu"]')?.id;
    const trigger = menuId ? Array.from(document.querySelectorAll<HTMLElement>('[aria-controls]')).find((element) => element.getAttribute("aria-controls") === menuId) : null;
    setLifecycleRequest({ ...options, returnFocus: lifecycleTrigger.current ?? trigger ?? active, resolve });
    lifecycleTrigger.current = null;
  });
  const [section, setSection] = useState<NavigationSection>("conversation");
  const handledNavigation = useRef<number | null>(null);
  useEffect(() => {
    if (!navigationRequest || handledNavigation.current === navigationRequest.id) return;
    handledNavigation.current = navigationRequest.id;
    if (navigationRequest.section === "search") setWorkSearchOpen(true);
    else setSection(navigationRequest.section);
    setShowLifecycleCenter(false);
    setContextOpen(false);
  }, [navigationRequest]);
  const [librarySelection, setLibrarySelection] = useState<{ projectId: number; artifactId: string | null; resourceId: string | null; version?: number | null; request: number } | null>(null);
  const [workSearchOpen, setWorkSearchOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [chatLimit, setChatLimit] = useState(50);
  const contextCloseRef = useRef<HTMLButtonElement>(null);
  const contextTriggerRef = useRef<HTMLElement | null>(null);
  const toggleContext = () => {
    if (!contextOpen) contextTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setContextOpen((value) => !value);
  };
  const closeContext = () => { setContextOpen(false); requestAnimationFrame(() => contextTriggerRef.current?.focus()); };
  useEffect(() => { if (contextOpen) contextCloseRef.current?.focus(); }, [contextOpen]);
  const allChatsQuery = useAllProjectChats("active", true);
  const invalidate = useInvalidateProjects();
  const invalidateArtifacts = useInvalidateArtifacts();
  const invalidateAutomation = useInvalidateP9Automation();
  const selection = useProjectSelection();
  const projectsQuery = useProjects();
  const archivedProjectsQuery = useProjects("archived");
  const quickChatsQuery = useQuickChats();
  const archivedQuickChatsQuery = useQuickChats("archived");
  const archivedProjectChatsQuery = useProjectChats(selection.projectId, "archived");
  const projectHomeQuery = useProjectHome(selection.projectId);
  const [chatMode, setChatMode] = useState<ChatMode>(() => (selection.chatId && !selection.projectId ? "quick" : resolveInitialChatMode(selection)));
  const messagesQuery = useProjectChatMessages(savedChatIdForMode(chatMode, selection.chatId));
  const [projectHomeRequested, setProjectHomeRequested] = useState(false);
  const [temporaryMessages, setTemporaryMessages] = useState<LocalMessage[]>([]);
  const temporaryWorkingContextRef = useRef<WorkingContextSnapshot | null>(null);
  const [input, setInput] = useState("");
  const [voiceTranscripts, setVoiceTranscripts] = useState<VoiceTranscript[]>([]);
  const [voiceTranscriptReviewed, setVoiceTranscriptReviewed] = useState(false);
  const [pendingAttachmentFiles, setPendingAttachmentFiles] = useState<File[]>([]);
  const [pendingAttachmentRefs, setPendingAttachmentRefs] = useState<ConversationAttachmentRef[]>([]);
  const [speakRepliesEnabled, setSpeakRepliesEnabled] = useState(() => {
    try {
      return window.localStorage.getItem("lios.voice.speakReplies") === "1";
    } catch {
      return false;
    }
  });
  const voiceProvidersQuery = useVoiceProviders();
  const voiceRuntimeStatus = voiceProvidersQuery.data?.runtime;
  const hasNonWhisperTranscription = Boolean(voiceProvidersQuery.data?.transcription.some((provider) => provider.id !== "lios.voice.whisper-cpp"));
  const hasLocalWhisper = Boolean(voiceProvidersQuery.data?.transcription.some((provider) => provider.id === "lios.voice.whisper-cpp"));
  const voiceInputAvailable = hasNonWhisperTranscription || (hasLocalWhisper && Boolean(voiceRuntimeStatus?.browserRecordingReady));
  const voiceOutputAvailable = Boolean(voiceProvidersQuery.data?.speech.some((provider) => provider.id));
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const chatCreationInFlightRef = useRef(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const [runtimeEvents, setRuntimeEvents] = useState<ConversationRuntimeEvent[]>([]);
  const [runtimeRequestId, setRuntimeRequestId] = useState<string | null>(null);
  const [executionTerminalOpen, setExecutionTerminalOpen] = useState(false);
  const [sandboxProposal, setSandboxProposal] = useState<SandboxTerminalProposal | null>(null);
  const [sandboxSessionId, setSandboxSessionId] = useState<string | null>(null);
  const [sandboxSessionInputs, setSandboxSessionInputs] = useState<SandboxTerminalInput[]>([]);
  const [sandboxOpening, setSandboxOpening] = useState(false);
  const [sandboxReviewBusy, setSandboxReviewBusy] = useState(false);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const sandboxSelectionRef = useRef({ projectId: selection.projectId, chatId: selection.chatId });
  sandboxSelectionRef.current = { projectId: selection.projectId, chatId: selection.chatId };
  const [lastSubmittedMessage, setLastSubmittedMessage] = useState("");
  const [lastWorkflowRequest, setLastWorkflowRequest] = useState<Omit<ConversationRequest, "requestId" | "continuationOf"> | null>(null);
  const [pendingPersonalFinance, setPendingPersonalFinance] = useState<P6PersonalFinanceRequest | null>(null);
  const [showSaveWorkflow, setShowSaveWorkflow] = useState(false);
  const [lifecycleNotice, setLifecycleNotice] = useState<string | null>(null);
  const [executionMode, setExecutionMode] = useState<ConversationExecutionMode>("ai_assisted");
  const agentComposer = useBoundedAgentComposer(chatMode, executionMode);
  const [sourceScope, setSourceScope] = useState<ConversationSourceScope>(() => loadComposerSourceScope(selection.projectId));
  const [transmissionPolicy, setTransmissionPolicy] = useState<AITransmissionPolicy>(() => loadProjectAITransmissionPolicy(selection.projectId));
  const [providerAllowDraft, setProviderAllowDraft] = useState(() => loadProjectAITransmissionPolicy(selection.projectId).providerAllow.join(", "));
  const [providerDenyDraft, setProviderDenyDraft] = useState(() => loadProjectAITransmissionPolicy(selection.projectId).providerDeny.join(", "));
  const [showResourceForm, setShowResourceForm] = useState(false);
  const [resourceLabel, setResourceLabel] = useState("");
  const [resourceRef, setResourceRef] = useState("");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectCreateError, setProjectCreateError] = useState<string | null>(null);
  const [showLifecycleCenter, setShowLifecycleCenter] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [compareBaseSessionId, setCompareBaseSessionId] = useState<string | null>(null);
  const [sessionComparison, setSessionComparison] = useState<string | null>(null);
  const openedChatOwnerRef = useRef<{ chatId: number; ownerUserId: number } | null>(null);
  const artifactOwnerId = chatMode === "temporary" ? undefined : selection.projectId ? projectsQuery.data?.find(project => project.id === selection.projectId)?.ownerUserId : [...(quickChatsQuery.data ?? []), ...(archivedQuickChatsQuery.data ?? [])].find(chat => chat.id === selection.chatId)?.ownerUserId ?? (openedChatOwnerRef.current?.chatId === selection.chatId ? openedChatOwnerRef.current.ownerUserId : undefined);
  const [conversationArtifactRef, setConversationArtifactRef, artifactFocusMode, setArtifactFocusMode, restoredArtifactView, artifactViewVersion, setArtifactViewVersion] = useConversationArtifactView(artifactOwnerId, selection.projectId, chatMode === "temporary" ? null : selection.chatId);
  const artifactDraftDirtyRef = useRef(false);
  const displayedArtifactRef = useRef<{ artifactId: string; requestedVersion: number | null; version: number } | null>(null);
  const handledWorkbenchReturn = useRef<number | null>(null);
  const onOpenWorkbench = () => {
    if (artifactDraftDirtyRef.current) { setLifecycleNotice("Save or reset unsaved Artifact edits before opening Workbench. Your draft remains in Chat."); return; }
    if (conversationArtifactRef && chatMode !== "temporary" && selection.chatId) {
      const displayed = displayedArtifactRef.current;
      if (displayed?.artifactId !== conversationArtifactRef || displayed.requestedVersion !== artifactViewVersion || (artifactViewVersion !== null && displayed.version !== artifactViewVersion)) { setLifecycleNotice("Wait for the saved Artifact revision to load before opening Workbench."); return; }
      navigateWorkbench({ projectId: selection.projectId, chatId: selection.chatId, artifactId: conversationArtifactRef, version: displayed.version });
    } else navigateWorkbench();
  };
  useEffect(() => {
    if (!workbenchReturn || handledWorkbenchReturn.current === workbenchReturn.request) return;
    const { context, prompt } = workbenchReturn;
    if (selection.projectId !== context.projectId || selection.chatId !== context.chatId) {
      selection.setProjectId(context.projectId); selection.setChatId(context.chatId); return;
    }
    handledWorkbenchReturn.current = workbenchReturn.request;
    setChatMode(context.projectId === null ? "quick" : "project"); setSection("conversation"); setProjectHomeRequested(false);
    setConversationArtifactRef(context.artifactId); setArtifactViewVersion(context.version);
    if (prompt) setInput(current => current ? `${current}\n\n${prompt}` : prompt);
  }, [workbenchReturn, selection.projectId, selection.chatId, setConversationArtifactRef, setArtifactViewVersion]);
  useEffect(() => {
    if (!conversationArtifactRef) { setArtifactFocusMode(false); return; }
    const width = shellRef.current?.querySelector(".lios-project-chat-surface")?.clientWidth ?? 0;
    if (width > 0 && width < 900 && !restoredArtifactView) setArtifactFocusMode(true);
  }, [conversationArtifactRef, restoredArtifactView]);
  const [selectedTextContext, setSelectedTextContext] = useState("");
  const pendingArtifactOpenRef = useRef<string | null>(null);
  const pendingArtifactFocusRef = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const conversationScrollRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const keepingArtifactRef = useRef(false);
  const [projectDestination, setProjectDestination] = useState<{ description: string; save: (project: Project) => Promise<void> } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // The user's own most recent ticker fills the starter slot so an example is ready to send.
  const recentStarterSymbol = useMemo(() => loadRecentAnalyticalContexts().find((context) => context.symbol)?.symbol ?? null, []);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const voiceRecorder = useVoiceRecorder((result) => {
    if (voiceTranscripts.length >= 5) {
      setLifecycleNotice("A single message can include at most five voice clips. Send this message before recording another.");
      return;
    }
    setVoiceTranscripts((current) => [...current, result]);
    setVoiceTranscriptReviewed(false);
    setInput((current) => (current.trim() ? `${current.trim()} ${result.text}` : result.text));
    requestAnimationFrame(() => composerRef.current?.focus());
  });
  const voiceInputHint = voiceProvidersQuery.isLoading
    ? "Checking voice readiness…"
    : voiceInputAvailable
      ? (voiceRecorder.isRecording ? "Stop recording" : "Speak to LiOS")
      : voiceRuntimeStatus?.guidance ?? "Set up a transcription runtime to use voice input.";
  const voiceActionLabel = voiceProvidersQuery.isLoading
    ? "Checking…"
    : voiceInputAvailable
      ? (voiceRecorder.isRecording ? "Stop" : "Voice")
      : "Set up voice";
  const projects = projectsQuery.data ?? [];
  const archivedProjects = archivedProjectsQuery.data ?? [];
  const quickChats = quickChatsQuery.data ?? [];
  const archivedQuickChats = archivedQuickChatsQuery.data ?? [];
  const archivedProjectChats = archivedProjectChatsQuery.data ?? [];
  const home = projectHomeQuery.data;
  const persistedMessages = messagesQuery.data ?? [];
  const shellLoadState = deriveP1ShellLoadState({
    projectsLoading: projectsQuery.isLoading || quickChatsQuery.isLoading,
    projectsError: projectsQuery.isError || quickChatsQuery.isError,
    projectHomeLoading: projectHomeQuery.isLoading,
    projectHomeError: projectHomeQuery.isError,
    messagesLoading: messagesQuery.isLoading,
    messagesError: messagesQuery.isError,
    projectCount: projects.length,
    projectSelected: chatMode === "project" && Boolean(selection.projectId),
    chatSelected: chatMode !== "temporary" && Boolean(selection.chatId),
  });
  const shellError = projectsQuery.error ?? projectHomeQuery.error ?? messagesQuery.error ?? quickChatsQuery.error;
  // Quiet entry: no chat selected means the composer, never a forced Project Home. Home opens only from the Projects rail.
  const entrySurface = resolveEntrySurface({ chatMode, chatId: selection.chatId, projectHomeRequested, projectHomeAvailable: Boolean(home) });
  useEffect(() => {
    if (entrySurface === "conversation" && !selection.chatId && section === "conversation" && shellLoadState !== "loading" && shellLoadState !== "error") requestAnimationFrame(() => composerRef.current?.focus());
  }, [entrySurface, selection.chatId, section, shellLoadState]);
  useEffect(() => {
    const preservedArtifactRef = pendingArtifactOpenRef.current;
    const preservedFocusMode = pendingArtifactFocusRef.current;
    pendingArtifactOpenRef.current = null;
    pendingArtifactFocusRef.current = false;
    followLatestRef.current = true;
    setAwayFromLatest(false);
    setLastSubmittedMessage("");
    setLastWorkflowRequest(null);
    setVoiceTranscripts([]);
    setVoiceTranscriptReviewed(false);
    setPendingAttachmentFiles([]);
    setPendingAttachmentRefs([]);
    setShowSaveWorkflow(false);
    if (preservedArtifactRef) { setConversationArtifactRef(preservedArtifactRef); setArtifactFocusMode(Boolean(preservedFocusMode)); }
    setSelectedTextContext("");
    window.getSelection()?.removeAllRanges();
  }, [selection.chatId, selection.projectId]);

  useEffect(() => {
    if (chatMode === "temporary") return;
    const selectedChat = [...(home?.chats ?? []), ...quickChats, ...archivedQuickChats, ...archivedProjectChats].find((chat) => chat.id === selection.chatId);
    if (!selectedChat) return;
    setChatMode(selectedChat.scope === "quick" ? "quick" : "project");
  }, [chatMode, home?.chats, quickChats, archivedQuickChats, archivedProjectChats, selection.chatId]);

  useEffect(() => {
    setPendingPersonalFinance(null);
  }, [selection.projectId]);

  const resetSandboxForSelection = () => {
    setSandboxProposal(null); setSandboxError(null);
    const restored = selection.projectId && selection.chatId ? loadSandboxSessionBookmark(selection.projectId, selection.chatId) : null;
    setSandboxSessionId(restored);
    setSandboxSessionInputs(restored ? [...SANDBOX_TERMINAL_INPUTS] : []);
  };
  useEffect(() => {
    const policy = loadProjectAITransmissionPolicy(selection.projectId);
    setTransmissionPolicy(policy);
    setProviderAllowDraft(policy.providerAllow.join(", "));
    setProviderDenyDraft(policy.providerDeny.join(", "));
    setRuntimeEvents([]);
    setRuntimeRequestId(null);
    setExecutionTerminalOpen(false);
    resetSandboxForSelection();
    if (selection.projectId) void syncProjectApprovalGrants(selection.projectId);
  }, [selection.projectId]);

  // Execution traces belong to one chat. Quick Chats all share projectId null, so the Project-scoped
  // reset above never fires for them; clear the trace when a different chat is selected. A run that
  // is still in flight keeps its trace (its chat may be created mid-send).
  const traceChatIdRef = useRef<number | null>(selection.chatId);
  // The chat the events in view belong to; a run may create its chat mid-send, so this is not always the selection.
  const traceOwnerChatRef = useRef<number | null>(selection.chatId);
  useEffect(() => {
    if (traceChatIdRef.current === selection.chatId) return;
    traceChatIdRef.current = selection.chatId;
    if (busyRef.current) return;
    traceOwnerChatRef.current = selection.chatId;
    setRuntimeEvents(selection.chatId ? loadRuntimeReceipt(selection.chatId) : []);
    setRuntimeRequestId(null);
    setExecutionTerminalOpen(false);
    resetSandboxForSelection();
    setStreaming("");
  }, [selection.chatId]);

  // Restore the last finished run's receipt when the app opens on a chat, and keep it saved as runs finish.
  const receiptRestoredRef = useRef(false);
  useEffect(() => {
    if (receiptRestoredRef.current || !selection.chatId || busyRef.current) return;
    receiptRestoredRef.current = true;
    traceOwnerChatRef.current = selection.chatId;
    setRuntimeEvents((current) => (current.length ? current : loadRuntimeReceipt(selection.chatId!)));
  }, [selection.chatId]);
  useEffect(() => {
    const owner = traceOwnerChatRef.current;
    if (busy || !owner || chatMode === "temporary") return;
    saveRuntimeReceipt(owner, runtimeEvents);
  }, [busy, runtimeEvents, chatMode]);

  useEffect(() => {
    const scopedProjectId = chatMode === "project" ? selection.projectId : null;
    setSourceScope(loadComposerSourceScope(scopedProjectId));
  }, [chatMode, selection.projectId]);

  useEffect(() => {
    if (followLatestRef.current) {
      const viewport = conversationScrollRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }
  }, [persistedMessages, temporaryMessages, streaming]);

  useEffect(() => {
    const openSearch = () => setWorkSearchOpen(true);
    window.addEventListener("lios:open-work-search", openSearch);
    return () => window.removeEventListener("lios:open-work-search", openSearch);
  }, []);

  useEffect(() => {
    const updateSelectionContext = () => {
      const domSelection = window.getSelection();
      const text = domSelection?.toString().replace(/\s+/g, " ").trim() ?? "";
      if (!text || text.length < 2) {
        setSelectedTextContext("");
        return;
      }
      const anchor = domSelection?.anchorNode;
      const focus = domSelection?.focusNode;
      const root = shellRef.current;
      if (!root || !anchor || !focus || !root.contains(anchor) || !root.contains(focus)) {
        setSelectedTextContext("");
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) {
        setSelectedTextContext("");
        return;
      }
      setSelectedTextContext(text.slice(0, 1_500));
    };
    document.addEventListener("selectionchange", updateSelectionContext);
    return () => document.removeEventListener("selectionchange", updateSelectionContext);
  }, []);

  const recentChats = useMemo(
    () => canonicalRecentChats(allChatsQuery.data ?? [], quickChats),
    [allChatsQuery.data, quickChats],
  );

  const activeChat = useMemo(
    () => [...(home?.chats ?? []), ...quickChats, ...archivedQuickChats, ...archivedProjectChats].find((chat) => chat.id === selection.chatId) ?? null,
    [home?.chats, quickChats, archivedQuickChats, archivedProjectChats, selection.chatId],
  );
  useEffect(() => {
    onNavigationContext?.(`${home?.project.name ?? (selection.projectId ? "Project unavailable or loading" : "No Project selected")} · ${activeChat?.title ?? (selection.chatId ? "Chat unavailable or loading" : "no saved Chat selected")}`);
  }, [home?.project.name, selection.projectId, selection.chatId, activeChat?.title, onNavigationContext]);

  const resources = home?.resources ?? [];
  const mentionCandidates = useMemo(() => {
    const match = input.match(/@([^\s@]*)$/);
    if (!match) return [];
    const q = match[1].toLowerCase();
    return resources.filter((resource) => resource.label.toLowerCase().includes(q)).slice(0, 6);
  }, [input, resources]);

  const commandCandidates = useMemo(() => {
    if (!input.startsWith("/")) return [];
    const q = input.toLowerCase();
    return QUICK_COMMANDS.filter((item) => item.command.startsWith(q)).slice(0, 6);
  }, [input]);

  const discardConversationDraft = () => {
    setInput("");
    setPendingAttachmentFiles([]);
    setPendingAttachmentRefs([]);
    setVoiceTranscripts([]);
    setVoiceTranscriptReviewed(false);
  };
  // Mutations that can fail must ask for consent *before* the request but
  // discard only after server acknowledgement and successful navigation.
  const confirmConversationSwitch = async (deferDiscard = false, allowPendingCreation = false) => {
    if (chatCreationInFlightRef.current && !allowPendingCreation) { setLifecycleNotice("Finish creating the new Chat before switching saved work."); return false; }
    if (busy) { setLifecycleNotice("Stop the current response before switching conversations."); return false; }
    if (artifactDraftDirtyRef.current) { setLifecycleNotice("Save or reset unsaved Artifact edits before switching conversations. Your draft remains in this Chat."); return false; }
    if (!hasUnsentConversationDraft({ text: input, attachmentFiles: pendingAttachmentFiles.length, attachmentRefs: pendingAttachmentRefs.length, voiceTranscripts: voiceTranscripts.length })) return true;
    const answer = await requestLifecycle({ title: "Leave this draft?", detail: "Switching conversations will discard the unsent text, staged attachments and voice transcript only after the destination opens successfully. Saved messages are kept.", confirmLabel: "Discard on switch" });
    if (!answer) return false;
    if (!deferDiscard) discardConversationDraft();
    return true;
  };

  const openProject = async (project: Project, confirmed = false, showHome = false) => {
    if (!confirmed && (selection.projectId !== project.id || selection.chatId) && !(await confirmConversationSwitch())) return;
    if (busy) { setLifecycleNotice("Stop the current response before switching Projects."); return; }
    setSection("conversation"); setContextOpen(false); setShowLifecycleCenter(false); setProjectHomeRequested(showHome);
    selection.setProjectId(project.id);
    selection.setChatId(null);
    setChatMode("project");
    return true;
  };

  const openChat = async (chat: ProjectChat, confirmed = false) => {
    if (!confirmed && selection.chatId !== chat.id && !(await confirmConversationSwitch())) return;
    if (busy && !confirmed) { setLifecycleNotice("Stop the current response before switching chats."); return; }
    openedChatOwnerRef.current = { chatId: chat.id, ownerUserId: chat.ownerUserId };
    setSection("conversation"); setContextOpen(false); setShowLifecycleCenter(false); setProjectHomeRequested(false);
    selection.setProjectId(chat.projectId);
    selection.setChatId(chat.id);
    setChatMode(chat.scope === "quick" ? "quick" : "project");
    setTemporaryMessages([]);
    temporaryWorkingContextRef.current = null;
  };
  const openWorkSearchResult = async (result: WorkSearchResult) => {
    if (result.kind === "artifact" && result.projectId === null && result.chatId && result.artifactId) {
      if (busy || !(await confirmConversationSwitch())) return;
      const response = await fetch(`/api/project-chats/${result.chatId}`);
      if (!response.ok) throw new Error("This owning Chat is no longer available.");
      const chat = await response.json() as ProjectChat;
      const exact = await fetch(`/api/artifacts/${encodeURIComponent(result.artifactId)}`);
      if (!exact.ok) throw new Error("This exact Artifact is no longer available.");
      const detail = await exact.json();
      if (chat.scope !== "quick" || detail.artifact.projectId !== null || detail.artifact.owningChatId !== chat.id) throw new Error("Artifact ownership no longer matches this Chat.");
      pendingArtifactOpenRef.current = result.artifactId;
      pendingArtifactFocusRef.current = false;
      await openChat(chat, true);
      return;
    }
    if (result.kind === "chat" && result.chatId) {
      let chat = [...(allChatsQuery.data ?? []), ...quickChats].find((item) => item.id === result.chatId) ?? null;
      if (!chat) {
        const response = await fetch(`/api/project-chats/${result.chatId}`);
        if (!response.ok) throw new Error("This conversation is no longer available.");
        chat = await response.json() as ProjectChat;
      }
      await openChat(chat);
      return;
    }

    if (result.projectId) {
      let project = projects.find((item) => item.id === result.projectId) ?? null;
      if (!project) {
        const response = await fetch(`/api/projects/${result.projectId}`);
        if (!response.ok) throw new Error("This Project is no longer available.");
        project = await response.json() as Project;
      }
      if (selection.projectId !== project.id && !(await openProject(project))) return;
      if (result.kind === "artifact" || result.kind === "file") {
        const exactTarget = resolveWorkSearchLibraryTarget(result);
        if (!exactTarget) throw new Error("This search result has no exact available object identity.");
        if (busy) { setLifecycleNotice("Stop the current response before opening a search result."); return; }
        setLibrarySelection((current) => ({ ...exactTarget, request: (current?.request ?? 0) + 1 }));
        setSection("library");
        setShowLifecycleCenter(false);
        setContextOpen(false);
      } else if (selection.projectId === project.id) setSection("conversation");
    }
  };
  const handleChatLifecycleAction = async (chat: ProjectChat, action: LifecycleAction) => {
    if (busy) { setLifecycleNotice("Stop the current response before changing saved chats."); return; }
    setLifecycleNotice(null);
    try {
      if (action === "rename") {
        const nextTitle = (await requestLifecycle({ title: "Rename chat", name: chat.title, detail: "Change the name of this saved conversation." }))?.trim();
        if (nextTitle && nextTitle !== chat.title) {
          await updateProjectChat(chat.id, { title: nextTitle });
          invalidate(chat.projectId, chat.id);
        }
        return;
      }
      if (action === "pin" || action === "unpin") {
        await updateProjectChat(chat.id, { pinned: action === "pin" });
        invalidate(chat.projectId, chat.id);
        return;
      }
      if (action === "archive" || action === "restore") {
        const leavingActiveChat = action === "archive" && selection.chatId === chat.id;
        if (leavingActiveChat && !(await confirmConversationSwitch(true))) return;
        await updateProjectChat(chat.id, { status: action === "archive" ? "archived" : "active" });
        if (leavingActiveChat) {
          discardConversationDraft();
          selection.setChatId(null);
          setChatMode(remainingChatMode(chat.projectId));
        }
        invalidate(chat.projectId, chat.id);
        return;
      }
      if (action === "delete") {
        const leavingActiveChat = selection.chatId === chat.id;
        if (leavingActiveChat && !(await confirmConversationSwitch(true))) return;
        if (!(await requestLifecycle({ title: "Move chat to Trash?", detail: `“${chat.title}” can be restored from Trash & archive.`, confirmLabel: "Move to Trash" }))) return;
        await trashProjectChat(chat.id);
        if (leavingActiveChat) {
          discardConversationDraft();
          selection.setChatId(null);
          setChatMode(remainingChatMode(chat.projectId));
        }
        invalidate(chat.projectId, chat.id);
        return;
      }
      if (action === "save_to_project") {
        chooseChatDestination(chat);
        return;
      }
    } catch (error) {
      setLifecycleNotice(error instanceof Error ? error.message : "Unable to update this chat.");
    }
  };
  const handleProjectLifecycleAction = async (project: Project, action: LifecycleAction) => {
    if (busy) { setLifecycleNotice("Stop the current response before changing Projects."); return; }
    setLifecycleNotice(null);
    try {
      if (action === "rename") {
        const nextName = (await requestLifecycle({ title: "Rename Project", name: project.name, detail: "Change the Project name. Its conversations and saved work stay together." }))?.trim();
        if (nextName && nextName !== project.name) {
          await updateProject(project.id, { name: nextName });
          invalidate(project.id);
        }
        return;
      }
      if (action === "pin" || action === "unpin") {
        await updateProject(project.id, { pinned: action === "pin" });
        invalidate(project.id);
        return;
      }
      if (action === "archive" || action === "restore") {
        const leavingActiveProject = action === "archive" && selection.projectId === project.id;
        if (leavingActiveProject && !(await confirmConversationSwitch(true))) return;
        await updateProject(project.id, { status: action === "archive" ? "archived" : "active" });
        if (leavingActiveProject) {
          discardConversationDraft();
          selection.setChatId(null);
          selection.setProjectId(null);
          setChatMode("quick");
        }
        invalidate();
        return;
      }
      if (action === "delete") {
        const dependencies = await getProjectDependencySummary(project.id);
        const detail = dependencies.total ? ` This moves ${dependencies.total} dependent object${dependencies.total === 1 ? "" : "s"} to Trash.` : "";
        const leavingActiveProject = selection.projectId === project.id;
        if (leavingActiveProject && !(await confirmConversationSwitch(true))) return;
        if (!(await requestLifecycle({ title: "Move Project to Trash?", detail: `“${project.name}” can be restored from Trash & archive.${detail}`, confirmLabel: "Move to Trash" }))) return;
        await trashProject(project.id);
        if (leavingActiveProject) {
          discardConversationDraft();
          selection.setChatId(null);
          selection.setProjectId(null);
          setChatMode("quick");
        }
        invalidate();
      }
    } catch (error) {
      setLifecycleNotice(error instanceof Error ? error.message : "Unable to update this Project.");
    }
  };

  const newProjectChat = async (starterPrompt?: string) => {
    if (busy || !selection.projectId || chatCreationInFlightRef.current) return;
    chatCreationInFlightRef.current = true;
    setCreatingChat(true);
    try {
      if (!(await confirmConversationSwitch(true, true))) {
        pendingArtifactOpenRef.current = null; pendingArtifactFocusRef.current = false; setPendingPersonalFinance(null);
        return;
      }
      const projectId = selection.projectId;
      const chat = await createProjectChat(projectId);
      discardConversationDraft();
      invalidate(projectId, chat.id);
      await openChat(chat, true);
      if (starterPrompt?.trim()) {
        setInput(starterPrompt.trim());
        requestAnimationFrame(() => composerRef.current?.focus());
      }
    } catch (error) {
      pendingArtifactOpenRef.current = null; pendingArtifactFocusRef.current = false;
      setLifecycleNotice(error instanceof Error ? error.message : "Unable to create a Project chat. The previous draft is still here.");
    } finally {
      chatCreationInFlightRef.current = false;
      setCreatingChat(false);
    }
  };

  const newQuickChat = async () => {
    if (busy || chatCreationInFlightRef.current) return;
    chatCreationInFlightRef.current = true;
    setCreatingChat(true);
    try {
      if (!(await confirmConversationSwitch(true, true))) return;
      const chat = await createQuickChat();
      discardConversationDraft();
      invalidate(null, chat.id);
      await openChat(chat, true);
    } catch (error) {
      setLifecycleNotice(error instanceof Error ? error.message : "Unable to create a chat. The previous draft is still here.");
    } finally {
      chatCreationInFlightRef.current = false;
      setCreatingChat(false);
    }
  };

  const startTemporary = async () => {
    // WS-16 handles draft consent. Never carry a selected Project/Chat bookmark,
    // saved Artifact, source scope or previous Temporary history into a new one.
    if (!(await confirmConversationSwitch(true))) return;
    const ephemeral = selectionForTemporaryChat();
    discardConversationDraft();
    setSection("conversation"); setContextOpen(false); setShowLifecycleCenter(false);
    selection.setChatId(ephemeral.chatId);
    selection.setProjectId(ephemeral.projectId);
    setProjectHomeRequested(false);
    setChatMode("temporary");
    setSourceScope("auto");
    setTemporaryMessages([]);
    temporaryWorkingContextRef.current = null;
    setLastWorkflowRequest(null);
    setLastSubmittedMessage("");
    setStreaming("");
    setRuntimeEvents([]);
    setRuntimeRequestId(null);
  };

  const currentWorkspaceRuntimeContext = (input: {
    projectId?: number | null;
    sessionId?: string | null;
    conversationId?: number | string | null;
  } = {}) => createWorkspaceRuntimeContext({
    projectId: input.projectId ?? selection.projectId,
    sessionId: input.sessionId ?? null,
    conversationId: input.conversationId ?? selection.chatId,
    activeObjectId: conversationArtifactRef ?? (activeSymbol ? `security:${activeSymbol}` : `panel:${activeView}`),
  });

  const applyWorkspaceAction = async (
    action: SafeWorkspaceAction,
    source: "assistant" | "user" | "system" = "assistant",
  ): Promise<void> => {
    const context = currentWorkspaceRuntimeContext();
    if (action.type === "open-panel") {
      await workspaceAdapter.openPanel({
        panelId: action.view,
        symbol: action.symbol ?? null,
        placement: action.placement,
        focus: true,
      }, context);
      return;
    }
    if (action.type === "focus-panel") {
      await workspaceAdapter.focusPanel(action.paneId, context);
      return;
    }
    if (action.type === "close-panel") {
      await workspaceAdapter.closePanel(action.paneId, context);
      return;
    }
    const requested = requestSafeWorkspaceAction(action, source);
    if (!requested) throw new Error("Workspace layout proposal is unavailable outside the active LiOS renderer.");
  };

  const saveCurrentSession = async (name?: string) => {
    if (!selection.projectId) return;
    const workspaceState = captureProjectWorkspaceSessionState(audience, "dockview");
    if (!workspaceState) throw new Error("Current analytical workspace is unavailable.");
    const created = await createProjectSession(selection.projectId, {
      chatId: activeChat?.scope === "project" ? activeChat.id : null,
      name: name || `${activeChat?.title ?? home?.project.name ?? "Project"} — ${new Date().toLocaleString()}`,
      workspaceState,
    });
    await workspaceAdapter.snapshot(currentWorkspaceRuntimeContext({
      projectId: created.projectId,
      sessionId: created.id,
      conversationId: created.chatId,
    }));
    invalidate(selection.projectId);
  };

  const restoreSession = async (session: ProjectSession) => {
    if (!(await confirmConversationSwitch())) return;
    await workspaceAdapter.restore(
      workspaceSessionEnvelopeForProjectSession(session),
      currentWorkspaceRuntimeContext({
        projectId: session.projectId,
        sessionId: session.id,
        conversationId: session.chatId,
      }),
    );
    onOpenWorkbench();
  };

  const forkSession = async (session: ProjectSession) => {
    await forkProjectSession(session.id);
    invalidate(session.projectId);
  };

  const compareSession = async (session: ProjectSession) => {
    if (!compareBaseSessionId) {
      setCompareBaseSessionId(session.id);
      setSessionComparison(`Baseline selected: ${session.name}`);
      return;
    }
    if (compareBaseSessionId === session.id) {
      setCompareBaseSessionId(null);
      setSessionComparison(null);
      return;
    }
    const result = await compareProjectSessions(compareBaseSessionId, session.id);
    const changes = [
      result.analyticalStateChanged ? "analysis" : null,
      result.linkedContextChanged ? "linked context" : null,
      result.focusedObjectChanged ? "focus" : null,
      result.savedViewChanged ? "saved view" : null,
      result.workspaceEngineChanged ? "workspace engine" : null,
    ].filter(Boolean);
    setSessionComparison(changes.length ? `Changed: ${changes.join(", ")}` : "No tracked workspace-state differences.");
  };

  const runCommand = async (command: string): Promise<boolean> => {
    const [token, ...args] = command.trim().split(/\s+/);
    const exact = QUICK_COMMANDS.find((item) => item.command === token.toLowerCase());
    if (!exact) return false;
    if (exact.view) {
      const firstArg = args[0]?.replace(/^\$/, "") ?? "";
      const commandSymbol = /^[A-Za-z][A-Za-z0-9.\-]{0,15}$/.test(firstArg) ? firstArg.toUpperCase() : activeSymbol;
      recordP1ShellEvent("living_workspace_action");
      await applyWorkspaceAction({
        type: "open-panel",
        view: exact.view,
        symbol: commandSymbol,
        placement: "secondary",
        reason: `Requested from Project chat: ${exact.label}`,
      }, "user");
    } else if (exact.command === "/session") {
      await saveCurrentSession();
    } else if (exact.command === "/sandbox") {
      await proposeSandboxTerminal();
    }
    setInput("");
    return true;
  };

  const gateway = useGateway();
  const requireGateway = () => {
    if (!gateway) throw new Error("LiOS is not connected to your Home yet. Please retry in a moment.");
    return gateway;
  };
  const applyRuntimeEvent = (runtimeEvent: ConversationRuntimeEvent) => {
    recordP2ConversationEvent(runtimeEvent);
    if (runtimeEvent.type === "trust") recordP3TrustManifest(runtimeEvent.manifest);
    if (runtimeEvent.type === "artifact" && runtimeEvent.persistedArtifact && chatMode !== "temporary") {
      invalidateArtifacts(runtimeEvent.artifact.projectId, runtimeEvent.persistedArtifact.id);
      if (!artifactDraftDirtyRef.current) { setConversationArtifactRef(runtimeEvent.persistedArtifact.id); setArtifactViewVersion(runtimeEvent.persistedArtifact.version); }
    }
    setRuntimeEvents((current) => [...current, runtimeEvent]);
    if (runtimeEvent.type === "text") setStreaming(runtimeEvent.text);
  };

  // A run keeps executing on the Home when the UI reloads or its connection drops. Re-attach to the run of the open
  // chat (its buffered events are replayed) instead of showing an idle chat while the answer is still being produced.
  const messagesRef = useRef(messagesQuery.data);
  messagesRef.current = messagesQuery.data;
  const resumeChatId = chatMode === "temporary" ? null : selection.chatId;
  useEffect(() => {
    if (!gateway || !resumeChatId) return;
    let abandoned = false;
    const attach = async () => {
      if (busyRef.current) return;
      const { runs } = await gateway.request("conversation.active", undefined, { timeoutMs: 15_000 });
      const run = runs.find((candidate) => candidate.chatId === resumeChatId);
      if (!run || abandoned || busyRef.current) return;
      busyRef.current = true;
      traceOwnerChatRef.current = resumeChatId;
      setBusy(true);
      setStreaming("");
      setRuntimeEvents([]);
      setRuntimeRequestId(run.requestId);
      const persisted = (messagesRef.current ?? []).find((message) => "metadata" in message && message.metadata.runtimeRequestId === run.requestId);
      if (persisted) setLastSubmittedMessage(persisted.content);
      try {
        const result = await attachConversationRun(gateway, run.requestId, applyRuntimeEvent);
        if (result.text) {
          const parsed = parseProjectWorkspaceDirectives(result.text);
          for (const action of parsed.actions) {
            recordP1ShellEvent("living_workspace_action");
            await applyWorkspaceAction(action, "assistant");
          }
        }
        invalidate(selection.projectId, resumeChatId);
      } finally {
        busyRef.current = false; setStreaming(""); setBusy(false);
      }
    };
    const attachQuietly = () => { void attach().catch(() => {}); };
    const stopListening = gateway.onReady(attachQuietly);
    if (gateway.state === "ready") attachQuietly();
    return () => {
      abandoned = true;
      stopListening();
    };
    // Re-evaluated when the open chat or the Gateway changes; the run's own events drive everything after attach.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway, resumeChatId]);

  const send = async (override?: {
    message?: string;
    approval?: ApprovalGrant;
    continuationOf?: string | null;
    attachments?: ConversationAttachmentRef[];
  }) => {
    const hasStagedAttachments = Boolean(override?.attachments?.length || pendingAttachmentRefs.length || pendingAttachmentFiles.length);
    const message = (override?.message ?? input).trim()
      || (hasStagedAttachments ? "Analyze the attached Project file(s). Cite each file by name and clearly identify any missing or unreadable content." : "");
    if (!message || busy) return;
    followLatestRef.current = true;
    setAwayFromLatest(false);
    setLifecycleNotice(null);
    if (sourceScope === "files" && !hasStagedAttachments) {
      setLifecycleNotice("Files scope requires at least one explicitly attached Project file.");
      return;
    }
    if (sourceScope === "web" && hasStagedAttachments) {
      setLifecycleNotice("Web scope excludes Project file contents. Switch to Auto, My Data or Files to analyze the staged attachment(s).");
      return;
    }
    if (hasStagedAttachments && (chatMode !== "project" || !selection.projectId)) {
      setLifecycleNotice("Attachments are saved to a Project. Open or create a Project chat before sending them.");
      return;
    }
    if (!override?.approval && !override?.continuationOf && await runCommand(message)) return;
    if (agentComposer.enabled && !agentComposer.ready) {
      setLifecycleNotice(agentComposer.guidance);
      return;
    }

    if (chatMode === "project" && selection.projectId) {
      dispatchVisualContext({
        projectId: String(selection.projectId),
        projectName: home?.project.name ?? null,
        intensity: "contextual",
        semanticContext: inferVisualSemanticContextFromText(
          message,
          inferVisualSemanticContext(activeView),
        ),
      });
    }

    const requestId = createConversationRequestId();
    const projectApprovals = chatMode === "project" ? loadProjectApprovalGrants(selection.projectId) : [];
    const approvals = override?.approval
      ? [...projectApprovals.filter((grant) => grant.action !== override.approval!.action), override.approval]
      : projectApprovals;
    const policy = chatMode === "project" ? transmissionPolicy : DEFAULT_AI_TRANSMISSION_POLICY;
    const context = {
      symbol: activeSymbol,
      view: activeView,
      activeObjectRefs: conversationArtifactRef ? [conversationArtifactRef] : [activeSymbol ? `security:${activeSymbol}` : `panel:${activeView}`],
      personalFinance: chatMode === "project" && pendingPersonalFinance ? pendingPersonalFinance : undefined,
      selection: selectedTextContext && policy.allowSelection
        ? {
            kind: "text" as const,
            id: "active-text-selection",
            label: "Selected text",
            text: selectedTextContext,
            view: activeView,
            symbol: activeSymbol ?? null,
          }
        : {
            kind: activeSymbol ? "security" as const : "panel" as const,
            id: activeSymbol ?? activeView,
            label: activeSymbol ?? activeView,
            text: null,
            view: activeView,
            symbol: activeSymbol ?? null,
          },
    };
    const aiDirectApproved = executionMode === "ai_direct" && approvals.some((grant) => grant.action === "AIDirectEstimate");
    let attachmentsForRequest = override?.attachments ? [...override.attachments] : [...pendingAttachmentRefs];
    const payload: ConversationRequest = {
      requestId,
      continuationOf: override?.continuationOf ?? null,
      message,
      sourceScope: sourceScopeForChatMode(chatMode, sourceScope),
      executionMode,
      aiDirectApproved,
      approvals,
      transmissionPolicy: policy,
      attachments: attachmentsForRequest,
      context: contextForChatMode(chatMode, context),
    };
    const voiceReview = voiceTranscripts.length
      ? { transcripts: voiceTranscripts, transcriptReviewed: voiceTranscriptReviewed }
      : undefined;
    if (!override?.continuationOf && pendingPersonalFinance) setPendingPersonalFinance(null);
    if (!override?.continuationOf && chatMode === "project") {
      const projectApprovals = approvals.filter((grant) => grant.scope === "project");
      setLastWorkflowRequest({
        message,
        sourceScope,
        executionMode,
        aiDirectApproved: executionMode === "ai_direct" && projectApprovals.some((grant) => grant.action === "AIDirectEstimate"),
        approvals: projectApprovals,
        transmissionPolicy: policy,
        attachments: attachmentsForRequest,
        context,
      });
    }

    recordP1ShellEvent("composer_submit");
    setBusy(true);
    setStreaming("");
    setRuntimeEvents([]);
    setRuntimeRequestId(requestId);
    setLastSubmittedMessage(message);
    try {
      if (chatMode === "temporary") {
        const retrying = Boolean(override?.continuationOf);
        const userMessage: LocalMessage = { id: `u-${Date.now()}`, role: "user", content: message };
        if (!retrying) setTemporaryMessages((current) => [...current, userMessage]);
        if (!override?.continuationOf) setInput("");
        const result = await runConversation(requireGateway(), {
          chatId: null,
          body: {
            ...payload,
            ...(voiceReview ? { voiceReview } : {}),
            history: temporaryMessages.map(({ role, content }) => ({ role, content })),
            ...(temporaryWorkingContextRef.current ? { workingContext: temporaryWorkingContextRef.current } : {}),
          },
          onEvent: (runtimeEvent) => {
            // TC-02: a Temporary chat's hidden context lives only in this ref (memory), never in storage or on screen.
            if (runtimeEvent.type === "done" && runtimeEvent.workingContext !== undefined) temporaryWorkingContextRef.current = runtimeEvent.workingContext;
            applyRuntimeEvent(runtimeEvent);
          },
        });
        if (!result.ok && result.errorCode === "working_context_invalid") temporaryWorkingContextRef.current = null;
        if (result.status === 428) {
          if (!retrying) {
            setTemporaryMessages((current) => current.filter((item) => item.id !== userMessage.id));
          }
          setInput(message);
          setVoiceTranscriptReviewed(false);
          setLifecycleNotice(result.error ?? "Review the spoken transcript before this high-impact action.");
          return;
        }
        if (!result.ok) setInput(message);
        else {
          setVoiceTranscripts([]);
          setVoiceTranscriptReviewed(false);
        }
        const final = result.error || result.text;
        if (final) {
          const parsed = parseProjectWorkspaceDirectives(final);
          for (const action of parsed.actions) {
            recordP1ShellEvent("living_workspace_action");
            await applyWorkspaceAction(action, "assistant");
          }
          const visible = parsed.visibleText || final;
          setTemporaryMessages((current) => [...current, { id: `a-${Date.now()}`, role: "assistant", content: visible }]);
          if (speakRepliesEnabled && voiceOutputAvailable) void speakText(visible).catch(() => {});
        }
      } else {
        let chatId = selection.chatId;
        if (!chatId) {
          const persistenceTarget = resolveComposerPersistenceTarget({
            chatMode,
            projectId: selection.projectId,
            chatId,
          });
          const created = persistenceTarget === "project" && selection.projectId
            ? await createProjectChat(selection.projectId)
            : await createQuickChat();
          chatId = created.id;
          void openChat(created, true);
        }
        traceOwnerChatRef.current = chatId;

        if (chatMode === "project" && selection.projectId && pendingAttachmentFiles.length && !override?.continuationOf) {
          for (const file of [...pendingAttachmentFiles]) {
            const attachment = await uploadProjectChatAttachment(selection.projectId, chatId, file);
            attachmentsForRequest = [...attachmentsForRequest, attachment];
            payload.attachments = attachmentsForRequest;
            setPendingAttachmentRefs(attachmentsForRequest);
            const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
            setPendingAttachmentFiles((current) => current.filter((item) => `${item.name}:${item.size}:${item.lastModified}` !== fileKey));
            setLastWorkflowRequest((current) => current ? { ...current, attachments: attachmentsForRequest } : current);
          }
        }
        if (!override?.continuationOf) setInput("");

        const result = await runConversation(requireGateway(), {
          chatId,
          body: { ...payload, agent: agentComposer.enabled, ...(voiceReview ? { voiceReview } : {}) },
          onEvent: applyRuntimeEvent,
        });
        if (result.status === 428) {
          setInput(message);
          setVoiceTranscriptReviewed(false);
          setLifecycleNotice(result.error ?? "Review the spoken transcript before this high-impact action.");
          return;
        }
        if (!result.ok) setInput(message);
        else {
          setVoiceTranscripts([]);
          setVoiceTranscriptReviewed(false);
        }
        if (result.ok) setPendingAttachmentRefs([]);
        if (result.error && !result.events.some((runtimeEvent) => runtimeEvent.type === "error")) {
          const at = new Date().toISOString();
          const syntheticError: ConversationRuntimeEvent = { type: "error", requestId, at, message: result.error!, code: "request_failed" };
          const syntheticDone: ConversationRuntimeEvent = { type: "done", requestId, at, status: "failed" };
          recordP2ConversationEvent(syntheticDone);
          setRuntimeEvents((current) => [
            ...current,
            syntheticError,
            syntheticDone,
          ]);
        }
        if (result.text) {
          const parsed = parseProjectWorkspaceDirectives(result.text);
          for (const action of parsed.actions) {
            recordP1ShellEvent("living_workspace_action");
            await applyWorkspaceAction(action, "assistant");
          }
          if (speakRepliesEnabled && voiceOutputAvailable) void speakText(parsed.visibleText || result.text).catch(() => {});
        }
        invalidate(selection.projectId, chatId);
      }
    } catch (error) {
      if (!override?.continuationOf) setInput(message);
      setLifecycleNotice(error instanceof Error ? error.message : "Unable to send this conversation request.");
    } finally {
      setStreaming("");
      setBusy(false);
    }
  };

  const approveRuntimeAction = async (action: ConversationActionName, scope: ApprovalGrant["scope"]) => {
    if (!lastSubmittedMessage || !runtimeRequestId) return;
    if (scope === "project" && (chatMode !== "project" || !selection.projectId)) return;
    // The server decides what this run may do: record the approval there first. The request body never carries it.
    try {
      await recordApprovalOnServer({ action, scope, requestId: runtimeRequestId, projectId: selection.projectId });
    } catch (error) {
      setLifecycleNotice(error instanceof Error ? error.message : "The approval could not be saved. Try again.");
      return;
    }
    if (scope === "project" && selection.projectId) {
      const projectApprovals = saveProjectApproval(selection.projectId, action);
      setLastWorkflowRequest((current) => current ? {
        ...current,
        approvals: projectApprovals,
        aiDirectApproved: current.executionMode === "ai_direct" && projectApprovals.some((grant) => grant.action === "AIDirectEstimate"),
      } : current);
    }
    await send({
      message: lastSubmittedMessage,
      approval: { action, scope },
      continuationOf: runtimeRequestId,
      attachments: lastWorkflowRequest?.attachments ?? [],
    });
  };

  const reviewGovernedTool = async (
    reviewId: string,
    decision: GovernedToolReviewDecision,
  ) => {
    if (!runtimeRequestId) return false;
    try {
      await reviewGovernedToolOnServer({ requestId: runtimeRequestId, reviewId, decision });
      return true;
    } catch (error) {
      setLifecycleNotice(error instanceof Error ? error.message : "The governed tool review could not be applied. Try again.");
      return false;
    }
  };

  const denyRuntimeAction = (action: ConversationActionName) => {
    setRuntimeEvents((current) => {
      const retained = current.filter((runtimeEvent) => {
        if (runtimeEvent.type === "approval_required" && runtimeEvent.action === action) return false;
        if (runtimeEvent.type === "mutation_review" && runtimeEvent.proposal.action === action) return false;
        if (runtimeEvent.type === "done") return false;
        return true;
      });
      return runtimeRequestId
        ? [...retained, { type: "done" as const, requestId: runtimeRequestId, at: new Date().toISOString(), status: "cancelled" as const }]
        : retained;
    });
  };

  const cancelRuntime = async () => {
    if (!runtimeRequestId) return;
    recordP1ShellEvent("composer_cancel"); await cancelConversationRun(requireGateway(), runtimeRequestId);
  };
  const interruptedRun = useInterruptedAgentRun({ gateway, chatId: resumeChatId, busy, onEvent: applyRuntimeEvent, shell: { busyRef, traceOwnerChatRef, setBusy, setStreaming, setRuntimeEvents, setRuntimeRequestId, setLifecycleNotice, onSettled: () => invalidate(selection.projectId, resumeChatId) } });
  const proposeSandboxTerminal = async () => {
    if (chatMode !== "project" || !selection.projectId || !selection.chatId || sandboxOpening) return;
    const { projectId, chatId } = selection;
    const stillSelected = () => sandboxSelectionRef.current.projectId === projectId
      && sandboxSelectionRef.current.chatId === chatId;
    setSandboxOpening(true);
    setSandboxError(null);
    try {
      const proposal = await requireGateway().request("execution.operation.propose", { projectId, chatId });
      if (stillSelected()) setSandboxProposal(proposal);
    } catch (error) {
      if (stillSelected()) setSandboxError(error instanceof Error ? error.message : "LiOS could not prepare the reviewed sandbox operation.");
    } finally {
      setSandboxOpening(false);
    }
  };

  const reviewSandboxTerminal = async (allow: boolean) => {
    const proposal = sandboxProposal;
    if (!proposal || !selection.projectId || !selection.chatId || sandboxReviewBusy) return;
    const { projectId, chatId } = selection;
    const stillSelected = () => sandboxSelectionRef.current.projectId === projectId
      && sandboxSelectionRef.current.chatId === chatId;
    setSandboxReviewBusy(true);
    setSandboxError(null);
    try {
      const result = await requireGateway().request("execution.operation.review", {
        projectId,
        chatId,
        requestId: proposal.requestId,
        operationDigest: proposal.operationDigest,
        approvalDigest: proposal.approvalDigest,
        allow,
      });
      saveSandboxSessionBookmark(projectId, chatId, result.sessionId);
      if (!stillSelected()) return;
      setSandboxProposal(null);
      setSandboxSessionId(result.sessionId);
      setSandboxSessionInputs(proposal.allowedInteractiveInputs);
      setExecutionTerminalOpen(true);
      if (result.status === "denied") setLifecycleNotice("The sandbox terminal operation was denied and recorded without execution.");
    } catch (error) {
      if (stillSelected()) setSandboxError(error instanceof Error ? error.message : "LiOS could not record this review.");
    } finally {
      setSandboxReviewBusy(false);
    }
  };

  const updateSourceScope = (next: ConversationSourceScope) => {
    setSourceScope(next);
    saveComposerSourceScope(chatMode === "project" ? selection.projectId : null, next);
    recordP1ShellEvent("source_scope_change", next);
  };

  const retryShell = async () => {
    recordP1ShellEvent("shell_retry");
    await Promise.all([
      projectsQuery.refetch(),
      quickChatsQuery.refetch(),
      chatMode === "project" && selection.projectId ? projectHomeQuery.refetch() : Promise.resolve(),
      chatMode !== "temporary" && selection.chatId ? messagesQuery.refetch() : Promise.resolve(),
    ]);
    recordP1ShellEvent("shell_recovered");
  };

  const updateTransmissionPolicy = (patch: Partial<AITransmissionPolicy>) => {
    const next = { ...transmissionPolicy, ...patch };
    setTransmissionPolicy(next);
    if (selection.projectId) saveProjectAITransmissionPolicy(selection.projectId, next);
  };

  const parseProviderList = (value: string) => Array.from(new Set(
    value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
  ));

  const stageAttachmentFiles = (fileList: FileList | File[]) => {
    if (chatMode !== "project" || !selection.projectId) {
      setLifecycleNotice("Attachments are saved to a Project. Open or create a Project chat first.");
      return;
    }
    const incoming = Array.from(fileList);
    if (pendingAttachmentFiles.length + pendingAttachmentRefs.length + incoming.length > 5) {
      setLifecycleNotice("A message can include up to five files. Remove one before adding more.");
      return;
    }
    const accepted = new Set(["pdf", "docx", "pptx", "xlsx", "txt", "md", "csv", "tsv", "json", "png", "jpg", "jpeg", "webp"]);
    for (const file of incoming) {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!accepted.has(extension)) {
        setLifecycleNotice(`${file.name}: use PDF, DOCX, PPTX, XLSX, TXT, Markdown, CSV, TSV, JSON, PNG, JPEG or WebP.`);
        return;
      }
      if (file.size <= 0 || file.size > 20 * 1024 * 1024) {
        setLifecycleNotice(`${file.name}: each file must be between 1 byte and 20 MiB.`);
        return;
      }
      if (["png", "jpg", "jpeg", "webp"].includes(extension) && file.size > 6 * 1024 * 1024) {
        setLifecycleNotice(`${file.name}: images must be 6 MiB or smaller.`);
        return;
      }
    }
    setLifecycleNotice(null);
    setPendingAttachmentFiles((current) => [...current, ...incoming]);
  };

  const removePendingAttachment = (id: string) => {
    setPendingAttachmentRefs((current) => current.filter((attachment) => attachment.id !== id));
    setPendingAttachmentFiles((current) => current.filter((file) => `${file.name}:${file.size}:${file.lastModified}` !== id));
  };

  const applySelectionAiAction = (prompt: string) => {
    setInput(prompt);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const askActiveObject = () => {
    if (selectedTextContext) {
      applySelectionAiAction(`Analyze this selection in the current Project context:\n\n“${selectedTextContext}”`);
      return;
    }
    const target = activeSymbol ? `security ${activeSymbol}` : `active ${activeView} view`;
    applySelectionAiAction(`Analyze this ${target}. Use the current Project context and any focused analytical object.`);
  };

  const selectMention = (resource: ProjectResource) => {
    setInput((current) => current.replace(/@[^\s@]*$/, `@${resource.label.replace(/\s+/g, "_")} `));
  };

  const createResource = async () => {
    if (!selection.projectId || !resourceLabel.trim()) return;
    await createProjectResource(selection.projectId, {
      kind: resourceRef.trim() ? "reference" : "note",
      label: resourceLabel.trim(),
      resourceRef: resourceRef.trim() || null,
      contextMode: "project",
    });
    setResourceLabel("");
    setResourceRef("");
    setShowResourceForm(false);
    invalidate(selection.projectId);
  };

  const createNewProject = async () => {
    if (creatingProject || busy) return;
    if (!newProjectName.trim()) { setProjectCreateError("Enter a Project name."); return; }
    if (!(await confirmConversationSwitch(true))) return;
    setCreatingProject(true); setProjectCreateError(null);
    try {
      const project = await createProject({ name: newProjectName.trim() });
      discardConversationDraft();
      setNewProjectName(""); setNewProjectOpen(false);
      invalidate(project.id); void openProject(project, true);
    } catch (error) { setProjectCreateError(error instanceof Error ? error.message : "Unable to create a Project. Your name is still here; try again."); }
    finally { setCreatingProject(false); }
  };

  const chooseChatDestination = (chat: ProjectChat) => {
    setProjectDestination({
      description: `Move “${chat.title}” and its saved messages into a Project. Future requests can use that Project's context.`,
      save: async (project) => {
        if (selection.chatId === chat.id && !(await confirmConversationSwitch(true))) throw new Error("Save or reset the current draft before moving this Chat.");
        const moved = await promoteQuickChat(chat.id, project.id);
        if (selection.chatId === chat.id) discardConversationDraft();
        invalidate(project.id, moved.id);
        if (selection.chatId === chat.id) await openChat(moved, true);
      },
    });
  };
  const keepArtifact = (artifact: ConversationArtifactDraft) => {
    if (chatMode === "temporary" || artifact.persistence === "ephemeral") return;
    const existingArtifactRef = conversationArtifactRef;
    const save = async (targetProject: Project | null) => {
      if (keepingArtifactRef.current) throw new Error("This work is already being saved. Wait for it to finish.");
      keepingArtifactRef.current = true;
      try {
        const trustEvent = [...runtimeEvents].reverse().find((event) => event.type === "trust");
        const planEvent = [...runtimeEvents].reverse().find((event) => event.type === "plan");
        const workflowRequest = lastWorkflowRequest;
        const refreshSpec: ArtifactRefreshSpec | null = workflowRequest ? {
          kind: "conversation",
          sourceScope: workflowRequest.sourceScope ?? sourceScope,
          executionMode: workflowRequest.executionMode ?? executionMode,
          capabilityIds: planEvent?.type === "plan" ? planEvent.plan.capabilities.map((capability) => capability.id) : [],
          message: workflowRequest.message,
          selection: workflowRequest.context?.selection ? {
            kind: workflowRequest.context.selection.kind,
            id: workflowRequest.context.selection.id,
            label: workflowRequest.context.selection.label,
            view: workflowRequest.context.selection.view,
            symbol: workflowRequest.context.selection.symbol,
          } : null,
          engineRef: null,
        } : null;
        const trustManifest = trustEvent?.type === "trust" ? trustEvent.manifest : null;
        const dependencyRefs = buildArtifactDependencyRefs({
          sourceRefs: artifact.sourceRefs,
          trustManifest,
          capabilityIds: planEvent?.type === "plan" ? planEvent.plan.capabilities.map((capability) => capability.id) : [],
        });
        const persist = existingArtifactRef
          ? keepConversationDraftVersion(existingArtifactRef, artifact, {
              requestId: runtimeRequestId,
              trustManifest,
              dependencyRefs,
              refreshSpec,
            })
          : keepConversationDraft(targetProject ? targetProject.id : { chatId: selection.chatId! }, artifact, {
              requestId: runtimeRequestId,
              trustManifest,
              dependencyRefs,
              refreshSpec,
            });
        const created = await persist;
          invalidateArtifacts(created.artifact.projectId, created.artifact.id);
          if (!artifactDraftDirtyRef.current) { setConversationArtifactRef(created.artifact.id); setArtifactViewVersion(created.version.version); }
          setLifecycleNotice(existingArtifactRef
            ? `Saved refreshed work as ${created.artifact.id} v${created.version.version}.`
            : `Kept "${created.artifact.title}" in ${targetProject ? `"${targetProject.name}"` : "this Chat"}.`);
      } finally { keepingArtifactRef.current = false; }
    };
    if (chatMode === "project" && home) {
      void save(home.project).catch((error) => setLifecycleNotice(error instanceof Error ? error.message : "Unable to keep this work. Try again."));
    } else if (chatMode === "quick" && selection.chatId) {
      void save(null).catch((error) => setLifecycleNotice(error instanceof Error ? error.message : "Unable to keep this work in Chat."));
    } else {
      setLifecycleNotice("Wait for this saved Chat to finish loading before keeping its work.");
    }
  };

  const displayMessages: Array<ProjectChatMessage | LocalMessage> = chatMode === "temporary" ? temporaryMessages : persistedMessages;
  const citationSources = useMemo(() => collectCitationSources(runtimeEvents), [runtimeEvents]);
  const visibleExecutionSessionId = sandboxSessionId ?? runtimeRequestId ?? runtimeEvents.at(-1)?.requestId ?? null;
  const visibleExecutionSessionProjectId = sandboxSessionId ? selection.projectId : (chatMode === "project" ? selection.projectId : null);
  const visibleExecutionSessionChatId = sandboxSessionId
    ? selection.chatId
    : (chatMode === "temporary" ? null : (traceOwnerChatRef.current ?? selection.chatId));
  const conversationVisualIntensity = resolveProjectConversationVisualIntensity({
    messageCount: displayMessages.length,
    streaming: Boolean(streaming),
    busy,
  });

  useEffect(() => {
    const projectId = chatMode === "project" && selection.projectId ? String(selection.projectId) : null;
    dispatchVisualContext({
      projectId,
      projectName: chatMode === "project" ? home?.project.name ?? null : null,
      intensity: conversationVisualIntensity,
      semanticContext: conversationVisualIntensity === "contextual" ? inferVisualSemanticContext(activeView) : "general",
    });
  }, [activeView, busy, chatMode, conversationVisualIntensity, home?.project.name, selection.projectId, streaming, displayMessages.length]);

  return (
    <div ref={shellRef} data-context-open={contextOpen && section === "conversation" && !!home && chatMode === "project" && !conversationArtifactRef} className="lios-project-experience-shell flex h-full min-h-0 bg-transparent text-foreground">
      <Dialog open={newProjectOpen} onOpenChange={(open) => { if (!creatingProject) { setNewProjectOpen(open); setProjectCreateError(null); } }}>
        <DialogContent><DialogTitle>New Project</DialogTitle><DialogDescription>Keep your conversations, sources and saved analytical work together.</DialogDescription>
          <form noValidate onSubmit={(event) => { event.preventDefault(); void createNewProject(); }}>
            <label htmlFor="lios-new-project-name" className="block text-sm">Project name</label>
            <input id="lios-new-project-name" autoFocus value={newProjectName} disabled={creatingProject} onChange={(event) => { setNewProjectName(event.target.value); setProjectCreateError(null); }} aria-invalid={!!projectCreateError} aria-describedby={projectCreateError ? "lios-project-create-error" : undefined} className="mt-2 w-full rounded border border-border bg-background p-3 text-sm" />
            {projectCreateError && <p id="lios-project-create-error" role="alert" className="mt-2 text-sm text-red-300">{projectCreateError}</p>}
            <div className="mt-6 flex justify-end gap-3"><button type="button" disabled={creatingProject} onClick={() => setNewProjectOpen(false)} className="lios-section-action">Cancel</button><button type="submit" disabled={creatingProject || busy} aria-busy={creatingProject} className="lios-section-action">{creatingProject ? "Creating…" : "Create Project"}</button></div>
          </form>
        </DialogContent>
      </Dialog>
      {projectDestination && <ProjectDestinationDialog projects={projects} description={projectDestination.description} onConfirm={projectDestination.save} onClose={() => { invalidate(); setProjectDestination(null); }} />}
      <ProjectLifecycleDialog request={lifecycleRequest} onClose={() => { lifecycleResolver.current = null; setLifecycleRequest(null); }} />
      <WorkSearchDialog
        open={workSearchOpen}
        onClose={() => setWorkSearchOpen(false)}
        onSelect={openWorkSearchResult}
      />
      <AuthenticatedNavigation section={section} account={account} busy={busy || creatingChat}
        onSection={(next) => { setSection(next); setShowLifecycleCenter(false); setContextOpen(false); }}
        onNewChat={() => void newQuickChat()}
        onTemporary={() => void startTemporary()}
        onSearch={onOpenCommand ?? (() => setWorkSearchOpen(true))}
        onWorkbench={onOpenWorkbench}
        onConnectors={onOpenEnvironment}
        onSettings={onOpenSettings} onLogout={onLogout}
        onTrash={() => { setSection("conversation"); setShowLifecycleCenter(true); setContextOpen(false); }}
        onMigrate={() => void migrateLegacyWorkspaces().then(() => invalidate()).catch((error) => setLifecycleNotice(error instanceof Error ? error.message : "Unable to import workspaces."))}>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <section className="mb-5" aria-label="Projects">
            <div className="mb-1 flex items-center px-2">
              <span className="font-ui text-[12px] font-semibold text-muted-foreground">Projects</span>
              <button
                data-navigation-action="true"
                type="button"
                onClick={() => setNewProjectOpen(true)}
                className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
                title="New Project"
                aria-label="New Project"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-0.5">
              {projects.slice(0, 8).map((project) => (
                <div key={project.id} className="group flex items-center rounded-md">
                  <button
                    data-navigation-action="true"
                    type="button"
                    onClick={() => openProject(project, false, true)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left ${selection.projectId === project.id && chatMode === "project" ? "bg-white/[0.05] text-foreground" : "text-muted-foreground hover:bg-white/[0.035] hover:text-foreground"}`}
                  >
                    <FolderKanban className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-ui text-[13px]">{project.name}</span>
                  </button>
                  <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <ObjectActionMenu
                      kind="project"
                      status={project.status}
                      pinned={project.pinned}
                      hidden={["share"]}
                      label={`Actions for ${project.name}`}
                      onAction={(action, trigger) => { lifecycleTrigger.current = trigger ?? null; void handleProjectLifecycleAction(project, action); }}
                    />
                  </div>
                </div>
              ))}
              {projects.length > 8 && (
                <button data-navigation-action="true" type="button" onClick={() => setSection("projects")} className="w-full rounded-md px-2.5 py-2 text-left font-ui text-[12px] text-muted-foreground hover:bg-white/[0.035] hover:text-foreground">
                  View all Projects
                </button>
              )}
              {!projects.length && !projectsQuery.isLoading && (
                <button data-navigation-action="true" type="button" onClick={() => setNewProjectOpen(true)} className="w-full rounded-md px-2.5 py-2 text-left font-ui text-[12px] text-muted-foreground hover:bg-white/[0.035] hover:text-foreground">
                  Create your first Project
                </button>
              )}
            </div>
          </section>

          <section aria-label="Recent chats">
            <div className="mb-1 px-2 font-ui text-[12px] font-semibold text-muted-foreground">Recent</div>
            <div className="space-y-0.5">
              {recentChats.map((chat) => (
                <div key={chat.id} className="group">
                  <NavItem
                    label={chat.title}
                    active={selection.chatId === chat.id}
                    badge={relativeTime(chat.lastActivityAt)}
                    trailing={
                      <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <ObjectActionMenu
                          kind="chat"
                          scope={chat.scope}
                          status={chat.status}
                          pinned={chat.pinned}
                          hidden={["branch"]}
                          label={`Actions for ${chat.title}`}
                          onAction={(action, trigger) => { lifecycleTrigger.current = trigger ?? null; void handleChatLifecycleAction(chat, action); }}
                        />
                      </div>
                    }
                    onClick={() => openChat(chat)}
                  />
                </div>
              ))}
              {(allChatsQuery.isError || quickChatsQuery.isError) && (
                <div role="alert" className="px-2.5 py-3 font-ui text-xs text-amber-200">
                  Could not refresh all recent conversations. Saved chats are unchanged.
                  <button type="button" className="ml-2 underline focus-visible:outline focus-visible:outline-2" onClick={() => { void allChatsQuery.refetch(); void quickChatsQuery.refetch(); }}>Retry</button>
                </div>
              )}
              {(allChatsQuery.isLoading || quickChatsQuery.isLoading) && !recentChats.length && (
                <p role="status" className="px-2.5 py-3 font-ui text-xs text-muted-foreground">Loading recent chats…</p>
              )}
              {!recentChats.length && !allChatsQuery.isLoading && !quickChatsQuery.isLoading && !allChatsQuery.isError && !quickChatsQuery.isError && (
                <div className="px-2.5 py-3 font-ui text-[12px] text-muted-foreground">Your recent chats will appear here.</div>
              )}
            </div>
          </section>
        </div>
      </AuthenticatedNavigation>

      <main className="min-w-0 flex-1">
        {lifecycleNotice && (
          <div role="alert" className="border-b border-red-300/20 bg-red-300/[0.04] px-4 py-2 font-ui text-[13px] text-red-200">
            {lifecycleNotice}
          </div>
        )}
        {section !== "conversation" ? (
          <section className="lios-section-surface" aria-label={section}>
            <header><div><h1>{({ projects: "Projects", chats: "Chats", library: "Library", automations: "Automations", plugins: "Plugins" } as const)[section]}</h1>
              <p>{section === "projects" ? "Keep sources, conversations and analytical work together." : section === "chats" ? "Continue a saved conversation." : section === "library" ? "Live artifacts and sources in the selected Project." : section === "automations" ? "Saved workflows and monitors in the selected Project." : "Extend LiOS through governed connections and capabilities."}</p></div>
              <button className="lios-section-action" onClick={() => setSection("conversation")}>Back to conversation</button></header>
            {section === "projects" && <>
              <button className="lios-section-action" onClick={() => { setSection("conversation"); setNewProjectOpen(true); }}>New Project</button>
              {projectsQuery.isLoading ? <p role="status">Loading Projects…</p> : projectsQuery.isError ? <p role="alert">Unable to load Projects. <button onClick={() => void projectsQuery.refetch()}>Retry</button></p> : <div className="lios-directory-list">{projects.map((project) => <button key={project.id} onClick={() => openProject(project, false, true)}><strong>{project.name}</strong><small>{project.instructions || "Open Project"}</small></button>)}{!projects.length && <p>Create a Project to organize your research.</p>}</div>}
            </>}
            {section === "chats" && <>
              <div className="mb-4 font-ui text-[12px] text-muted-foreground">Use Search to find words inside conversations, Projects, files and Artifacts.</div>
              {allChatsQuery.isLoading || quickChatsQuery.isLoading ? <p role="status">Loading chats…</p> : allChatsQuery.isError || quickChatsQuery.isError ? <p role="alert">Unable to load chats. <button onClick={() => { void allChatsQuery.refetch(); void quickChatsQuery.refetch(); }}>Retry</button></p> : (() => {
                const chats = [...(allChatsQuery.data ?? []), ...quickChats].sort((left, right) => new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime());
                return <div className="lios-directory-list">{chats.slice(0, chatLimit).map((chat) => <button key={chat.id} onClick={() => openChat(chat)}><strong>{chat.title}</strong><small>{chat.projectId ? projects.find((project) => project.id === chat.projectId)?.name || "Project chat" : "Quick chat"} · {relativeTime(chat.updatedAt)}</small></button>)}{chats.length > chatLimit && <button className="lios-section-action" onClick={() => setChatLimit((limit) => limit + 50)}>Load more chats</button>}{!chats.length && <p>Your saved conversations will appear here.</p>}</div>;
              })()}
            </>}
            {(section === "library" || section === "automations") && <>
              <label htmlFor="lios-tools-project" className="mr-3 text-sm">Project</label><select id="lios-tools-project" value={selection.projectId ?? ""} disabled={busy} onChange={async (e) => { const nextId = Number(e.target.value) || null; if (nextId === selection.projectId || !(await confirmConversationSwitch())) return; selection.setChatId(null); selection.setProjectId(nextId); setChatMode("project"); }} className="rounded border border-border bg-background p-2"><option value="">Choose a Project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
              {projectsQuery.isError ? <p role="alert">Unable to load Projects. <button onClick={() => void projectsQuery.refetch()}>Retry</button></p> : !selection.projectId ? <p className="mt-6">Choose a Project to keep this work isolated.</p> : projectHomeQuery.isLoading ? <p role="status">Loading Project…</p> : projectHomeQuery.isError ? <p role="alert">Unable to load this Project. <button onClick={() => void projectHomeQuery.refetch()}>Retry</button></p> : home && <div className="lios-project-tools">
                {section === "library" ? <ProjectArtifactsPanel key={`${home.project.id}:${librarySelection?.projectId === home.project.id ? librarySelection.request : 0}`} projectId={home.project.id} sessions={home.sessions}
                  initialArtifactId={librarySelection?.projectId === home.project.id ? librarySelection.artifactId : null}
                  initialVersion={librarySelection?.projectId === home.project.id ? librarySelection.version ?? null : null}
                  selectedResourceId={librarySelection?.projectId === home.project.id ? librarySelection.resourceId : null}
                  resources={home.resources}
                  onAskArtifact={(id, title, prompt) => { pendingArtifactOpenRef.current = id; pendingArtifactFocusRef.current = false; void newProjectChat(prompt ?? `Work on Artifact "${title}". Use ${id} as the active object and propose changes for review.`); }}
                  onFocusArtifact={(id) => { pendingArtifactOpenRef.current = id; pendingArtifactFocusRef.current = false; void newProjectChat(); }} /> : <ProjectAutomationPanel key={home.project.id} projectId={home.project.id} />}
              </div>}
            </>}
            {section === "plugins" && <GovernedExtensionsPanel />}
          </section>
        ) : showLifecycleCenter ? (
          <LifecycleCenter
            onClose={() => setShowLifecycleCenter(false)}
            onNotice={setLifecycleNotice}
            onInvalidate={() => {
              invalidate();
              invalidateArtifacts(selection.projectId);
              invalidateAutomation(selection.projectId);
            }}
          />
        ) : shellLoadState === "loading" ? (
          <div className="flex h-full min-h-[320px] items-center justify-center px-6" role="status" aria-live="polite">
            <div className="max-w-md rounded-xl border border-border/60 bg-[#080808]/90 p-6 text-center">
              <div className="mx-auto h-2 w-2 animate-pulse rounded-full bg-amber-300" />
              <div className="mt-4 font-ui text-[15px] font-semibold text-foreground">Restoring your LiOS workspace</div>
              <div className="mt-2 font-ui text-[12px] leading-5 text-muted-foreground">Loading Projects, conversation state and the authenticated workspace boundary. Setup is not required.</div>
            </div>
          </div>
        ) : shellLoadState === "error" ? (
          <div className="flex h-full min-h-[320px] items-center justify-center px-6" role="alert">
            <div className="max-w-lg rounded-xl border border-red-300/20 bg-red-300/[0.035] p-6 text-center">
              <div className="font-terminal text-[11px] uppercase tracking-[0.18em] text-red-200">Workspace recovery</div>
              <div className="mt-3 font-ui text-[16px] font-semibold text-foreground">LiOS could not restore part of this workspace.</div>
              <div className="mt-2 font-ui text-[12px] leading-5 text-muted-foreground">
                {shellError instanceof Error ? shellError.message : "The Project or conversation state is temporarily unavailable."}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <button type="button" onClick={() => void retryShell()} className="rounded-md bg-amber-400 px-3 py-2 font-ui text-[12px] font-semibold text-black hover:bg-amber-300">Retry restore</button>
                <button type="button" onClick={() => void startTemporary()} className="rounded-md border border-border/60 px-3 py-2 font-ui text-[12px] text-muted-foreground hover:text-foreground">Open Temporary Chat</button>
              </div>
              <div className="mt-3 font-terminal text-[10px] uppercase tracking-wider text-muted-foreground/70">No connector setup or data reset is required to retry.</div>
            </div>
          </div>
        ) : entrySurface === "project-home" && home ? (
          <ProjectHome
            project={home.project}
            chats={home.chats}
            resources={home.resources}
            sessions={home.sessions}
            onOpenChat={openChat}
            onNewChat={(starterPrompt) => void newProjectChat(starterPrompt)}
            onOpenSession={(session) => void restoreSession(session)}
            onOpenContext={toggleContext}
            onOpenWorkbench={onOpenWorkbench}
            onRenameProject={(name) => void updateProject(home.project.id, { name }).then(() => invalidate(home.project.id)).catch((error) => setLifecycleNotice(error instanceof Error ? error.message : "Unable to rename this Project."))}
            onTogglePin={() => void handleProjectLifecycleAction(home.project, home.project.pinned ? "unpin" : "pin")}
            onArchiveProject={() => void handleProjectLifecycleAction(home.project, "archive")}
            onRestoreProject={() => void handleProjectLifecycleAction(home.project, "restore")}
            onTrashProject={() => void handleProjectLifecycleAction(home.project, "delete")}
            onAskArtifact={(id, title, prompt) => {
              pendingArtifactOpenRef.current = id;
              pendingArtifactFocusRef.current = false;
              void newProjectChat(prompt ?? `Work on Artifact "${title}". Use ${id} as the active object and propose changes for review before mutating it.`);
            }}
            onFocusArtifact={(id, title) => {
              pendingArtifactOpenRef.current = id;
              pendingArtifactFocusRef.current = false;
              setLifecycleNotice(`Focused Artifact "${title}" as the active professional work object.`);
              void newProjectChat();
            }}
            onRerunArtifact={(id, title, spec) => {
              pendingArtifactOpenRef.current = id;
              pendingArtifactFocusRef.current = false;
              const replay = artifactReplayDraft(title, spec);
              updateSourceScope(replay.sourceScope);
              setExecutionMode(replay.executionMode);
              setLifecycleNotice(`Restored the saved replay posture for "${title}". Review or send the staged request.`);
              void newProjectChat(replay.message);
            }}
            onAnalyzePersonalFinance={(profile) => {
              setPendingPersonalFinance(profile);
              void newProjectChat("Analyze my Personal Finance profile with the deterministic LiOS engine. Show net worth, trailing cash flow, debt payoff, goal funding and retirement gaps. Keep every assumption explicit and do not invent missing observations.");
            }}
          />
        ) : (
          <div className="lios-project-chat-surface flex h-full min-h-0 min-w-0">
            <div className={artifactFocusMode && conversationArtifactRef ? "hidden" : "flex min-w-0 flex-1 flex-col"}>
            <header className="lios-conversation-header flex h-11 shrink-0 items-center gap-2 border-b border-border/55 px-4">
              <div className="min-w-0 flex-1 truncate font-ui text-[14px] font-semibold text-foreground">
                {chatMode === "temporary" ? "Temporary chat" : activeChat?.title ?? "New conversation"}
              </div>
              {chatMode === "temporary" && <span className="font-ui text-[11px] text-muted-foreground">Not saved</span>}
              {chatMode === "project" && home && (
                <button type="button" onClick={toggleContext} aria-expanded={contextOpen} className="rounded-md px-2 py-1.5 font-ui text-[12px] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground">
                  {home.project.name}
                </button>
              )}
              {chatMode === "quick" && activeChat && (
                <button type="button" disabled={busy} onClick={() => chooseChatDestination(activeChat)} className="rounded-md px-2 py-1.5 font-ui text-[12px] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground">
                  Move to Project
                </button>
              )}
              {conversationArtifactRef && (
                <button type="button" onClick={() => setArtifactFocusMode(true)} className="rounded-md px-2 py-1.5 font-ui text-[12px] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground">
                  Open artifact
                </button>
              )}
            </header>
            <div ref={conversationScrollRef} onScroll={(event) => {
              const viewport = event.currentTarget;
              const following = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
              followLatestRef.current = following;
              setAwayFromLatest(!following);
            }} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-10">
              <div className="lios-project-chat-content mx-auto max-w-4xl space-y-5">
                {!displayMessages.length && !streaming && (
                  <section className="lios-conversation-empty-state lios-chat-empty-state flex min-h-[45vh] flex-col items-center justify-center px-2 py-8 text-center" aria-labelledby="lios-chat-empty-title">
                    <div className="lios-chat-empty-state__mark flex h-12 w-12 items-center justify-center rounded-xl border border-amber-300/25 bg-amber-300/[0.06]">
                      <Sparkles className="h-5 w-5 text-amber-300" />
                    </div>
                    <div className="lios-chat-empty-state__eyebrow mt-5 font-terminal text-[12px] uppercase tracking-[0.2em] text-amber-200/80">LiOS · Financial intelligence</div>
                    <h1 id="lios-chat-empty-title" className="mt-2 font-display text-[30px] font-semibold tracking-[-0.04em] text-white">What do you want to understand, test or build?</h1>
                    <p className="mt-3 max-w-2xl font-ui text-[15px] leading-6 text-muted-foreground">
                      Start with the question. LiOS will use the sources and tools you allow, show what is missing, and expand into professional analysis only when it helps.
                    </p>
                    <div className="lios-chat-starters mt-7 grid w-full max-w-4xl grid-cols-1 gap-3 sm:grid-cols-3" role="group" aria-label="Example prompts">
                      {PROJECT_STARTER_PROMPTS.map((starter) => (
                        <button
                          key={starter.id}
                          type="button"
                          className="lios-chat-starter rounded-lg border border-border/70 bg-[#080808]/90 p-3.5 text-left transition-colors hover:border-amber-300/35 hover:bg-[#0b0b0b]"
                          aria-label={`Use example: ${starter.label}`}
                          onClick={() => {
                            const prompt = fillStarterPrompt(starter.prompt, recentStarterSymbol);
                            setInput(prompt);
                            requestAnimationFrame(() => {
                              const composer = composerRef.current;
                              composer?.focus();
                              const placeholder = findStarterPlaceholder(prompt);
                              if (composer && placeholder) composer.setSelectionRange(placeholder.start, placeholder.end);
                            });
                          }}
                        >
                          <span className="block font-ui text-[13px] font-semibold text-foreground">{starter.label}</span>
                          <span className="mt-1 block font-ui text-[12px] leading-4 text-muted-foreground">{starter.description}</span>
                        </button>
                      ))}
                    </div>
                    <div className="lios-chat-empty-state__project-cta mt-5 flex flex-wrap items-center justify-center gap-2">
                      <button type="button" onClick={() => setNewProjectOpen(true)} className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-amber-400 px-3.5 py-2 font-ui text-[12px] font-semibold text-black transition-colors hover:bg-amber-300">
                        <Plus className="h-3.5 w-3.5" /> Create a Project
                      </button>
                      <button
                        type="button"
                        data-first-use-connect="optional"
                        onClick={onOpenEnvironment}
                        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border/70 bg-black/20 px-3.5 py-2 font-ui text-[12px] font-medium text-muted-foreground transition-colors hover:border-cyan-300/30 hover:text-cyan-100"
                      >
                        <Plug className="h-3.5 w-3.5" /> {LIOS_FIRST_USE_CONTRACT.optionalConnectionAction}
                      </button>
                    </div>
                    <div data-first-use-entry="ask-first" className="mt-3 font-ui text-[12px] text-muted-foreground">
                      {LIOS_FIRST_USE_CONTRACT.shellHint}
                    </div>
                  </section>
                )}
                {displayMessages.map((message) => (
                  <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                    <div className={`max-w-[85%] rounded-xl border px-4 py-3 ${
                      message.role === "user"
                        ? "border-amber-300/20 bg-amber-300/[0.05]"
                        : "border-border/60 bg-white/[0.018]"
                    }`}>
                      <div className="mb-1.5 flex items-center gap-1.5">
                        {message.role === "assistant" ? <Bot className="h-3 w-3 text-amber-300" /> : null}
                        <span className="font-terminal text-[12px] uppercase tracking-wider text-muted-foreground">{message.role === "user" ? "YOU" : "LIOS"}</span>
                      </div>
                      {message.role === "assistant"
                        ? <ChatMarkdown text={message.content} sources={"metadata" in message ? savedMessageCitationSources(message.metadata) : undefined} />
                        : <div className="whitespace-pre-wrap font-ui text-[14px] leading-6 text-foreground">{message.content}</div>}
                      {message.role === "assistant" && chatMode !== "temporary" && "metadata" in message && <SavedArtifactCards metadata={message.metadata} projectId={selection.projectId} chatId={selection.chatId} activeId={conversationArtifactRef} onOpen={async (id, version) => { if (id === conversationArtifactRef && version === artifactViewVersion) return; if (artifactDraftDirtyRef.current && !(await requestLifecycle({ title: "Leave unsaved Artifact edits?", detail: "Opening this saved revision discards the current local Artifact draft. Saved revisions are unchanged.", confirmLabel: "Discard local edits" }))) return; artifactDraftDirtyRef.current = false; setArtifactFocusMode(false); setConversationArtifactRef(id); setArtifactViewVersion(version); }} />}
                      {message.role === "user" && selection.projectId && savedMessageAttachments(message).length > 0 && (
                        <div className="mt-3 space-y-1.5 border-t border-border/50 pt-2" aria-label="Attached files">
                          {savedMessageAttachments(message).map((attachment) => (
                            <a
                              key={attachment.id}
                              href={`/api/projects/${selection.projectId}/attachments/${attachment.id}/download`}
                              download={attachment.fileName}
                              className="flex min-w-0 items-center gap-2 rounded-md border border-border/50 bg-black/20 px-2.5 py-2 text-left transition-colors hover:border-amber-300/25 hover:bg-white/[0.03]"
                              title={`Download ${attachment.fileName}`}
                            >
                              <FileText className="h-3.5 w-3.5 shrink-0 text-cyan-200" />
                              <span className="min-w-0 flex-1 truncate font-ui text-[12px] text-foreground">{attachment.fileName}</span>
                              <span className="shrink-0 font-terminal text-[11px] text-muted-foreground">{formatAttachmentSize(attachment.byteLength)}</span>
                              <span className="shrink-0 font-terminal text-[11px] text-amber-200/80">DOWNLOAD</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {streaming && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-xl border border-border/60 bg-white/[0.018] px-4 py-3">
                      <div className="mb-1.5 flex items-center gap-1.5"><Bot className="h-3 w-3 text-amber-300" /><span className="font-terminal text-[12px] uppercase tracking-wider text-muted-foreground">LIOS</span></div>
                      <ChatMarkdown text={streaming} streaming sources={citationSources} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {awayFromLatest && <div className="flex justify-center py-2"><button type="button" onClick={() => {
              followLatestRef.current = true;
              setAwayFromLatest(false);
              const viewport = conversationScrollRef.current;
              if (viewport) viewport.scrollTop = viewport.scrollHeight;
            }} className="lios-section-action">Jump to latest</button></div>}
            <div className="shrink-0 px-4 pb-4 md:px-10">
              {chatMode === "project" && selection.projectId && selection.chatId && ((sandboxSessionId && !executionTerminalOpen) || (sandboxError && !sandboxProposal)) && (
                <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 pb-2">
                  {sandboxSessionId && !executionTerminalOpen && (
                    <button
                      type="button"
                      onClick={() => setExecutionTerminalOpen(true)}
                      className="rounded-lg border border-border/70 px-3 py-2 font-ui text-[12px] text-muted-foreground hover:text-cyan-100"
                      data-testid="sandbox-session-reopen"
                    >
                      Reopen last sandbox session
                    </button>
                  )}
                  {sandboxError && !sandboxProposal && <p role="alert" className="font-ui text-[12px] text-red-200">{sandboxError}</p>}
                </div>
              )}
              {sandboxProposal && (
                <SandboxOperationReviewCard
                  proposal={sandboxProposal}
                  busy={sandboxReviewBusy}
                  error={sandboxError}
                  onReview={(allow) => void reviewSandboxTerminal(allow)}
                />
              )}
              <ConversationRuntimeTrace
                events={runtimeEvents}
                requestId={runtimeRequestId ?? runtimeEvents.at(-1)?.requestId ?? null}
                busy={busy}
                onCancel={() => void cancelRuntime()}
                onApprove={(action, scope) => void approveRuntimeAction(action, scope)}
                onDeny={denyRuntimeAction}
                onGovernedToolReview={reviewGovernedTool}
                allowProjectApproval={chatMode === "project" && Boolean(selection.projectId)}
                onMutationApply={(action) => void approveRuntimeAction(action, "once")}
                onMutationCancel={(action) => denyRuntimeAction(action)}
                onRecoveryAction={(action) => {
                  if (/^(connect\b|open connection center$)/i.test(action)) {
                    if (lastSubmittedMessage.trim()) {
                      setInput(lastSubmittedMessage);
                      setLifecycleNotice("Connection Center opened for the missing source. Your original request is preserved here so you return to the same task.");
                    }
                    onOpenEnvironment();
                    return;
                  }
                  if (action.startsWith("/")) {
                    void runCommand(action);
                    return;
                  }
                  setInput(action);
                  requestAnimationFrame(() => composerRef.current?.focus());
                }}
                onRetry={() => { if (lastSubmittedMessage.trim() && !busy) void send({ message: lastSubmittedMessage }); }}
                onOpenTerminal={visibleExecutionSessionId ? () => setExecutionTerminalOpen(true) : undefined}
                {...interruptedRun.traceProps}
                onFollowUp={(prompt) => { setInput(prompt); requestAnimationFrame(() => composerRef.current?.focus()); }}
                onKeepArtifact={chatMode === "temporary" ? undefined : keepArtifact}
                onSubmitAssumptions={(message) => void send({ message })}
              />
              {executionTerminalOpen && visibleExecutionSessionId && (
                <ExecutionSessionPanel
                  sessionId={visibleExecutionSessionId}
                  projectId={visibleExecutionSessionProjectId}
                  chatId={visibleExecutionSessionChatId}
                  interactiveInputs={sandboxSessionInputs}
                  onClose={() => setExecutionTerminalOpen(false)}
                />
              )}
              <div
                className="lios-conversation-composer relative mx-auto max-w-4xl rounded-xl border border-border/70 bg-[#090909] shadow-2xl"
                onDragOver={(event) => { if (chatMode === "project" && selection.projectId) event.preventDefault(); }}
                onDrop={(event) => {
                  if (chatMode !== "project" || !selection.projectId) return;
                  event.preventDefault();
                  stageAttachmentFiles(event.dataTransfer.files);
                }}
              >
                {(mentionCandidates.length > 0 || commandCandidates.length > 0) && (
                  <div className="absolute bottom-full left-0 right-0 mb-2 rounded-lg border border-border/70 bg-[#090909] p-1 shadow-xl">
                    {commandCandidates.map((item) => (
                      <button key={item.command} onClick={() => setInput(item.command)} className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-white/[0.05]">
                        <span className="font-terminal text-[13px] text-amber-300">{item.command}</span>
                        <span className="font-ui text-[13px] text-muted-foreground">{item.label}</span>
                      </button>
                    ))}
                    {mentionCandidates.map((resource) => (
                      <button key={resource.id} onClick={() => selectMention(resource)} className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-white/[0.05]">
                        <FileText className="h-3 w-3 text-cyan-300" />
                        <span className="min-w-0 flex-1 truncate font-ui text-[13px] text-foreground">{resource.label}</span>
                        <span className="font-terminal text-[11px] text-muted-foreground">{resource.kind}</span>
                      </button>
                    ))}
                  </div>
                )}
                {pendingPersonalFinance && (
                  <div className="border-b border-amber-300/15 bg-amber-300/[0.035] px-3 py-2" role="status">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 font-ui text-[13px] text-amber-100">
                        Personal Finance profile staged for this one request · {pendingPersonalFinance.accounts.length} accounts · {pendingPersonalFinance.transactions.length} recent transactions
                      </span>
                      <button type="button" onClick={() => setPendingPersonalFinance(null)} className="font-ui text-[13px] text-muted-foreground hover:text-foreground">Remove</button>
                    </div>
                  </div>
                )}
                {selectedTextContext && (
                  <div
                    className="border-b border-cyan-300/10 bg-cyan-300/[0.025] px-3 py-2"
                    data-selection-aware-ai="true"
                    aria-label="Selection-aware LiOS actions"
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-ui text-[12px] text-cyan-100/80" title={selectedTextContext}>
                        Selected · {selectedTextContext}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          window.getSelection()?.removeAllRanges();
                          setSelectedTextContext("");
                        }}
                        className="font-ui text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {SELECTION_AI_ACTIONS.map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() => applySelectionAiAction(action.prompt(selectedTextContext))}
                          className="rounded-full border border-border/55 bg-black/20 px-2.5 py-1 font-ui text-[11px] text-muted-foreground transition-colors hover:border-cyan-300/25 hover:text-cyan-100"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-1.5 font-terminal text-[10px] uppercase tracking-wider text-muted-foreground/70">
                      Context is staged locally in the composer · nothing is sent until you submit
                    </div>
                  </div>
                )}
                {(pendingAttachmentFiles.length > 0 || pendingAttachmentRefs.length > 0) && (
                  <div className="border-b border-cyan-300/10 bg-cyan-300/[0.025] px-3 py-2" aria-label="Files staged for this message">
                    <div className="flex flex-wrap gap-1.5">
                      {pendingAttachmentFiles.map((file) => {
                        const key = `${file.name}:${file.size}:${file.lastModified}`;
                        return (
                          <span key={key} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-cyan-300/15 bg-cyan-300/[0.035] px-2.5 py-1 font-ui text-[11px] text-cyan-100">
                            <FileText className="h-3 w-3 shrink-0" />
                            <span className="max-w-[220px] truncate">{file.name}</span>
                            <span className="shrink-0 font-terminal text-muted-foreground">{formatAttachmentSize(file.size)}</span>
                            <button type="button" onClick={() => removePendingAttachment(key)} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground" aria-label={`Remove ${file.name}`}><X className="h-3 w-3" /></button>
                          </span>
                        );
                      })}
                      {pendingAttachmentRefs.map((attachment) => (
                        <span key={attachment.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-300/15 bg-amber-300/[0.035] px-2.5 py-1 font-ui text-[11px] text-amber-100">
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="max-w-[220px] truncate">{attachment.fileName}</span>
                          <span className="shrink-0 font-terminal text-muted-foreground">{formatAttachmentSize(attachment.byteLength)} · saved</span>
                          <button type="button" onClick={() => removePendingAttachment(attachment.id)} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground" aria-label={`Remove ${attachment.fileName}`}><X className="h-3 w-3" /></button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-1.5 font-terminal text-[10px] uppercase tracking-wider text-muted-foreground/80">
                      {sourceScope === "web"
                        ? "Stored in this Project · Web scope excludes these file contents until you switch source scope"
                        : !transmissionPolicy.allowResourceReferences
                          ? "Stored in this Project · current policy prevents sending file contents to AI"
                          : sourceScope === "files"
                            ? "Files scope · only explicitly attached files are staged as Project source material"
                            : "Stored in this Project · file contents may be sent under the selected AI transmission policy"}
                    </div>
                  </div>
                )}
                {voiceTranscripts.length > 0 && (
                  <div className="border-b border-violet-300/15 bg-violet-300/[0.035] px-3 py-2" aria-label="Voice transcript review">
                    <div className="flex flex-wrap items-center gap-2">
                      <Mic className="h-3.5 w-3.5 shrink-0 text-violet-200" />
                      <span className="font-ui text-[12px] text-violet-100">
                        {voiceTranscripts.length} spoken clip{voiceTranscripts.length === 1 ? "" : "s"} · editable transcript · raw audio is not retained
                      </span>
                      <button
                        type="button"
                        onClick={() => setVoiceTranscriptReviewed((value) => !value)}
                        aria-pressed={voiceTranscriptReviewed}
                        className={"ml-auto rounded border px-2 py-1 font-ui text-[12px] " + (voiceTranscriptReviewed ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100" : "border-violet-200/25 text-violet-100 hover:bg-violet-300/10")}
                      >
                        {voiceTranscriptReviewed ? "Transcript reviewed" : "I reviewed this transcript"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVoiceTranscripts([]);
                          setVoiceTranscriptReviewed(false);
                        }}
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                        aria-label="Remove voice transcript provenance"
                        title="Treat the current composer text as typed input"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="mt-1 font-terminal text-[10px] uppercase tracking-wider text-violet-100/65">
                      Actions requiring governed confirmation stay blocked until you review this transcript.
                    </div>
                  </div>
                )}
                <textarea
                  ref={composerRef}
                  value={input}
                  onChange={(e) => {
                    const next = e.target.value;
                    setInput(next);
                    if (!next.trim()) {
                      setVoiceTranscripts([]);
                      setVoiceTranscriptReviewed(false);
                    } else if (voiceTranscripts.length) {
                      setVoiceTranscriptReviewed(false);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === "Escape" && busy) {
                      e.preventDefault();
                      void cancelRuntime();
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  aria-label="Ask LiOS"
                  placeholder={chatMode === "temporary" ? "Message LiOS privately…" : "Message LiOS…"}
                  disabled={busy || creatingChat}
                  className="max-h-40 min-h-12 w-full resize-none bg-transparent px-4 pb-2 pt-3 font-ui text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/55 disabled:opacity-50"
                />
                <input
                  ref={attachmentInputRef}
                  disabled={creatingChat}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.tsv,.json,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/markdown,text/csv,application/json,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files?.length) stageAttachmentFiles(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
                {executionMode === "ai_direct" && <div role="status" className="px-4 py-1 text-xs text-muted-foreground">AI DIRECT · APPROVAL — AI estimates require approval and are labelled.</div>}
                <BoundedAgentComposerControl agent={agentComposer} busy={busy} onConfigureAI={onOpenEnvironment} />
                <div className="lios-conversation-composer-actions flex items-center gap-1.5 px-2.5 pb-2 pt-1">
                  <ChatSourcesControl scope={sourceScope} onScopeChange={updateSourceScope} onOpenConnections={onOpenEnvironment} disabled={busy || creatingChat} projectAvailable={chatMode === "project" && Boolean(selection.projectId)} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" disabled={creatingChat} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.06] hover:text-foreground disabled:opacity-40" aria-label="Tools">
                        <Plus className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top" className="w-64">
                      <DropdownMenuItem
                        onSelect={() => {
                          if (chatMode === "project" && selection.projectId) attachmentInputRef.current?.click();
                          else setLifecycleNotice("Files are saved with a Project. Move this chat into a Project before attaching files.");
                        }}
                        disabled={busy || pendingAttachmentFiles.length + pendingAttachmentRefs.length >= 5 || chatMode === "temporary"}
                      >
                        <Paperclip className="h-4 w-4" /> Attach files
                      </DropdownMenuItem>
                      {chatMode === "project" && selection.projectId && (
                        <DropdownMenuItem onSelect={() => setShowResourceForm(true)}>
                          <FileText className="h-4 w-4" /> Add Project resource
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={askActiveObject}>Ask this</DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Advanced</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-56">
                          <DropdownMenuItem onSelect={onOpenWorkbench}>Open workspace</DropdownMenuItem>
                          <DropdownMenuLabel className="text-xs text-muted-foreground">Response mode</DropdownMenuLabel>
                          <DropdownMenuRadioGroup value={executionMode} onValueChange={(value) => setExecutionMode(value as ConversationExecutionMode)}>
                            <DropdownMenuRadioItem value="ai_assisted">AUTO · AI ASSISTED</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="deterministic_first">DETERMINISTIC ONLY</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="ai_direct">AI DIRECT · APPROVAL</DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                          {selection.projectId && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem title="Save Session" onSelect={() => void saveCurrentSession()}>Save session</DropdownMenuItem>
                            </>
                          )}
                          {chatMode === "project" && selection.projectId && activeChat?.scope === "project" && lastWorkflowRequest && runtimeRequestId && runtimeEvents.some(event => event.type === "done" && event.requestId === runtimeRequestId && event.status === "completed") && (
                            <DropdownMenuItem onSelect={() => setShowSaveWorkflow(true)}>Save workflow</DropdownMenuItem>
                          )}
                          {voiceOutputAvailable && (
                            <DropdownMenuCheckboxItem
                              checked={speakRepliesEnabled}
                              onCheckedChange={(checked) => {
                                const next = checked === true;
                                setSpeakRepliesEnabled(next);
                                try { window.localStorage.setItem("lios.voice.speakReplies", next ? "1" : "0"); } catch {}
                              }}
                            >
                              Speak replies
                            </DropdownMenuCheckboxItem>
                          )}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={onOpenWorkbench}>
                        <LayoutDashboard className="h-4 w-4" /> Open workspace
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <div className="flex-1" />

                  <button
                    type="button"
                    onClick={() => voiceInputAvailable ? void voiceRecorder.toggle() : onOpenEnvironment()}
                    disabled={voiceProvidersQuery.isLoading || voiceRecorder.isTranscribing || busy || creatingChat}
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${voiceRecorder.isRecording ? "bg-red-400/10 text-red-200" : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"}`}
                    title={voiceInputHint}
                    aria-label={voiceInputAvailable ? (voiceRecorder.isRecording ? "Stop voice recording" : "Speak to LiOS") : "Set up voice input"}
                    aria-pressed={voiceRecorder.isRecording}
                  >
                    <Mic className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={busy || creatingChat || (agentComposer.enabled && !agentComposer.ready) || (!input.trim() && pendingAttachmentFiles.length + pendingAttachmentRefs.length === 0)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-black transition-opacity disabled:opacity-30"
                    aria-label="Send"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </div>
                {voiceRecorder.error && (
                  <div className="border-t border-red-500/20 bg-red-500/[0.04] px-3 py-1.5 font-ui text-[12px] text-red-300">
                    {voiceRecorder.error}
                  </div>
                )}
                {showResourceForm && (
                  <div className="border-t border-border/50 p-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      <input value={resourceLabel} onChange={(e) => setResourceLabel(e.target.value)} placeholder="Resource label" className="rounded border border-border/60 bg-black/20 px-2.5 py-2 font-ui text-[13px] outline-none" />
                      <input value={resourceRef} onChange={(e) => setResourceRef(e.target.value)} placeholder="File/API/document reference (optional)" className="rounded border border-border/60 bg-black/20 px-2.5 py-2 font-ui text-[13px] outline-none" />
                    </div>
                    <div className="mt-2 flex justify-end gap-2">
                      <button onClick={() => setShowResourceForm(false)} className="px-2 py-1 font-ui text-[12px] text-muted-foreground">Cancel</button>
                      <button onClick={() => void createResource()} className="rounded border border-cyan-300/25 px-2 py-1 font-ui text-[12px] text-cyan-200">Add to Project</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            </div>
            {conversationArtifactRef && chatMode !== "temporary" && selection.chatId && (
              <ConversationArtifactSidecar focus={artifactFocusMode} onExitFocus={() => setArtifactFocusMode(false)}
                    onExpand={(version) => { displayedArtifactRef.current = { artifactId: conversationArtifactRef, requestedVersion: artifactViewVersion, version }; onOpenWorkbench(); }}
                    onDisplayedVersionChange={(version, artifactId) => { if (artifactId === conversationArtifactRef) displayedArtifactRef.current = { artifactId, requestedVersion: artifactViewVersion, version }; }}
                    artifactId={conversationArtifactRef}
                    version={artifactViewVersion} onVersionChange={setArtifactViewVersion} onDirtyChange={(dirty) => { artifactDraftDirtyRef.current = dirty; }}
                    projectId={selection.projectId} owningChatId={selection.chatId}
                    sessions={selection.projectId ? home?.sessions ?? [] : []}
                    onClose={() => {
                      if (artifactDraftDirtyRef.current) { setLifecycleNotice("Save or reset unsaved Artifact edits before closing. Your draft remains in Chat."); return; }
                      setConversationArtifactRef(null);
                      setArtifactFocusMode(false);
                    }}
                    onAsk={(id, title, prompt) => {
                      if (id !== conversationArtifactRef) setConversationArtifactRef(id);
                      setArtifactFocusMode(false);
                      setInput(prompt ?? `Work on Artifact "${title}". Use ${id} as the active object and propose changes for review before mutating it.`);
                      requestAnimationFrame(() => composerRef.current?.focus());
                    }}
                    onRerun={(id, title, spec) => {
                      if (id !== conversationArtifactRef) setConversationArtifactRef(id);
                      setArtifactFocusMode(false);
                      const replay = artifactReplayDraft(title, spec);
                      updateSourceScope(replay.sourceScope);
                      setExecutionMode(replay.executionMode);
                      setInput(replay.message);
                      setLifecycleNotice(`Restored the saved replay posture for "${title}". Review or send the staged request.`);
                      requestAnimationFrame(() => composerRef.current?.focus());
                    }}
              />
            )}
          </div>
        )}
      </main>

      {showSaveWorkflow && chatMode === "project" && selection.projectId && activeChat?.scope === "project" && lastWorkflowRequest && runtimeRequestId && (
        <SaveWorkflowDialog
          projectId={selection.projectId}
          chatId={activeChat.id}
          sourceRequestId={runtimeRequestId}
          activeArtifactRef={conversationArtifactRef}
          request={lastWorkflowRequest}
          onClose={() => setShowSaveWorkflow(false)}
          onSaved={() => invalidateAutomation(selection.projectId)}
        />
      )}

      {contextOpen && section === "conversation" && home && chatMode === "project" && !conversationArtifactRef && (
        <aside className="lios-project-context" aria-label="Project context" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closeContext(); } }}>
          <div className="border-b border-border/70 p-3">
            <div className="font-terminal text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Project context <button className="float-right" ref={contextCloseRef} onClick={closeContext} aria-label="Close Project context"><X size={16} /></button></div>
            <textarea
              key={home.project.id}
              aria-label="Project instructions"
              defaultValue={home.project.instructions ?? ""}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next !== (home.project.instructions ?? "")) void updateProject(home.project.id, { instructions: next || null }).then(() => invalidate(home.project.id)).catch((error) => setLifecycleNotice(error instanceof Error ? error.message : "Unable to save Project instructions."));
              }}
              placeholder="Instructions for this Project…"
              rows={4}
              className="mt-2 w-full resize-none rounded-md border border-border/50 bg-black/20 p-2 font-ui text-[13px] leading-4 outline-none"
            />
          </div>
          <div className="border-b border-border/70 p-3">
            <div className="font-terminal text-[11px] uppercase tracking-[0.18em] text-muted-foreground">AI transmission</div>
            <select
              aria-label="AI transmission mode"
              value={transmissionPolicy.mode}
              onChange={(event) => updateTransmissionPolicy({ mode: event.target.value as AITransmissionPolicy["mode"] })}
              className="mt-2 w-full rounded border border-border/50 bg-black/25 px-2 py-1.5 font-ui text-[12px] text-foreground outline-none"
            >
              <option value="configured">Configured provider</option>
              <option value="local_only">Local only</option>
              <option value="any_configured">Any configured provider</option>
            </select>
            <label className="mt-2 block font-ui text-[11px] uppercase tracking-wider text-muted-foreground">Provider allow list</label>
            <input
              aria-label="Provider allow list"
              value={providerAllowDraft}
              onChange={(event) => setProviderAllowDraft(event.target.value)}
              onBlur={() => {
                const providerAllow = parseProviderList(providerAllowDraft);
                updateTransmissionPolicy({
                  providerAllow,
                  providerDeny: transmissionPolicy.providerDeny.filter((provider) => !providerAllow.includes(provider.toLowerCase())),
                });
              }}
              placeholder="openai, ollama"
              className="mt-1 w-full rounded border border-border/50 bg-black/25 px-2 py-1.5 font-ui text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40"
            />
            <label className="mt-2 block font-ui text-[11px] uppercase tracking-wider text-muted-foreground">Provider deny list</label>
            <input
              aria-label="Provider deny list"
              value={providerDenyDraft}
              onChange={(event) => setProviderDenyDraft(event.target.value)}
              onBlur={() => {
                const providerDeny = parseProviderList(providerDenyDraft);
                updateTransmissionPolicy({
                  providerDeny,
                  providerAllow: transmissionPolicy.providerAllow.filter((provider) => !providerDeny.includes(provider.toLowerCase())),
                });
              }}
              placeholder="openai, anthropic"
              className="mt-1 w-full rounded border border-border/50 bg-black/25 px-2 py-1.5 font-ui text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40"
            />
            <label className="mt-2 block text-xs text-muted-foreground">Provider attempts per AI call
              <select aria-label="Provider attempts per AI call" value={transmissionPolicy.maxProviderAttempts ?? 2} onChange={event => updateTransmissionPolicy({ maxProviderAttempts: Number(event.target.value) })} className="ml-2 rounded border border-border/50 bg-black px-2 py-1"><option value={1}>1 · no fallback</option><option value={2}>2 · bounded fallback</option><option value={3}>3 · wider fallback</option></select>
            </label>
            <label className="mt-2 block text-xs text-muted-foreground">Maximum output tokens per AI call
              <select aria-label="Maximum AI output tokens" value={transmissionPolicy.maxAiOutputTokens ?? 1800} onChange={event => updateTransmissionPolicy({ maxAiOutputTokens: Number(event.target.value) })} className="ml-2 rounded border border-border/50 bg-black px-2 py-1">{[512, 1024, 1800, 4096, 8192].map(tokens => <option key={tokens} value={tokens}>{tokens}</option>)}</select>
            </label>
            <p className="mt-1 text-xs text-muted-foreground">Hard call/output ceilings, not a currency quote. Agent steps have separate run limits. Private files and financial inputs never cross-provider fallback.</p>
            <label className="mt-2 flex items-center justify-between gap-2 font-ui text-[12px] text-muted-foreground">
              Share Project instructions
              <input type="checkbox" checked={transmissionPolicy.allowProjectInstructions} onChange={(event) => updateTransmissionPolicy({ allowProjectInstructions: event.target.checked })} />
            </label>
            <label className="mt-1.5 flex items-center justify-between gap-2 font-ui text-[12px] text-muted-foreground">
              Share Project references
              <input type="checkbox" checked={transmissionPolicy.allowResourceReferences} onChange={(event) => updateTransmissionPolicy({ allowResourceReferences: event.target.checked })} />
            </label>
            <label className="mt-1.5 flex items-center justify-between gap-2 font-ui text-[12px] text-muted-foreground">
              Share active selection
              <input type="checkbox" checked={transmissionPolicy.allowSelection} onChange={(event) => updateTransmissionPolicy({ allowSelection: event.target.checked })} />
            </label>
            <label className="mt-1.5 flex items-center justify-between gap-2 font-ui text-[12px] text-muted-foreground">
              Permit AI tool calls
              <input type="checkbox" checked={transmissionPolicy.allowToolCalling} onChange={(event) => updateTransmissionPolicy({ allowToolCalling: event.target.checked })} />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="flex items-center justify-between">
              <span className="font-ui text-[13px] font-semibold">Resources</span>
              <span className="font-terminal text-[11px] text-muted-foreground">{home.resources.length}</span>
            </div>
            <div className="mt-2 space-y-1.5">
              {home.resources.map((resource) => (
                <div key={resource.id} className="rounded-md border border-border/45 p-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-3 w-3 text-cyan-300" />
                    <span className="min-w-0 flex-1 truncate font-ui text-[13px]">{resource.label}</span>
                    <button onClick={() => void updateProjectResource(home.project.id, resource.id, { contextMode: resource.contextMode === "project" ? "on_demand" : "project" }).then(() => invalidate(home.project.id))} className="font-terminal text-[10px] text-muted-foreground hover:text-foreground">
                      {resource.contextMode === "project" ? "AUTO" : "ASK"}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between">
              <span className="font-ui text-[13px] font-semibold">Session Vault</span>
              <button onClick={() => void saveCurrentSession()} className="rounded p-1 text-muted-foreground hover:bg-white/5 hover:text-foreground" title="Save current Session"><Plus className="h-3 w-3" /></button>
            </div>
            <div className="mt-2 space-y-1.5">
              {home.sessions.map((session) => (
                <div key={session.id} className="rounded-md border border-border/45 p-2">
                  <button onClick={() => void restoreSession(session)} className="w-full text-left">
                    <div className="truncate font-ui text-[13px] text-foreground">{session.name}</div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="font-terminal text-[10px] text-muted-foreground">{session.parentSessionId ? "FORK" : "BASE"}</span>
                      <span className="font-terminal text-[10px] text-muted-foreground">{relativeTime(session.updatedAt)}</span>
                    </div>
                  </button>
                  <div className="mt-2 flex items-center gap-3">
                    <button onClick={() => void forkSession(session)} className="flex items-center gap-1 font-ui text-[11px] text-fuchsia-300/80 hover:text-fuchsia-200">
                      <GitBranch className="h-2.5 w-2.5" /> Fork
                    </button>
                    <button onClick={() => void compareSession(session)} className={`font-ui text-[11px] ${compareBaseSessionId === session.id ? "text-amber-300" : "text-cyan-300/80 hover:text-cyan-200"}`}>
                      {compareBaseSessionId === session.id ? "Baseline" : "Compare"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {sessionComparison && (
              <div className="mt-2 rounded-md border border-cyan-300/15 bg-cyan-300/[0.03] p-2 font-ui text-[12px] leading-4 text-muted-foreground">
                {sessionComparison}
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
