import { ChatTerminalControl, type ChatTerminalRenderer } from "./ChatTerminalSurface";
import TerminalScreenArtifact from "./TerminalScreenArtifact";
import { initialTerminalScreenState, readTerminalScreenState } from "@shared/terminalArtifact";
import { captureChatWorkbenchOrigin, returnChangesChatIdentity, type ChatWorkbenchOrigin } from "@/lib/chatWorkbenchHandoff";
import { useArtifact, createArtifactVersion, type ArtifactDetail } from "@/lib/useArtifacts";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import { apiRequest } from "@/lib/queryClient";
import { parseTerminalArtifactInstruction, applyTerminalArtifactOperations } from "@shared/terminalArtifactOperations";
import { parseChatTerminalRequest, chatTerminalCapabilities, type ChatTerminalContext } from "@/lib/chatTerminalContext";
import { useConversationArtifactView, rememberConversationArtifactView } from "@/lib/conversationArtifactView";
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
import { ProjectPersonalFinancePanel } from "./ProjectPersonalFinancePanel";
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
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { resolveScopedWorkbenchSymbol } from "@/lib/chatWorkbenchContext";
import type { LifecycleAction } from "@shared/objectLifecycle";
import { P6_PERSONAL_FINANCE_INPUT_ACTION, type P6PersonalFinanceRequest } from "@shared/p6FinanceContracts";
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
import { fillStarterPrompt, findStarterPlaceholder, starterPromptsForChatMode, resolveProjectConversationVisualIntensity } from "@/lib/projectExperienceVisualState";
import { savedChatAttachmentRefs, stageSavedAttachmentForFollowUp } from "@/lib/chatSavedAttachmentReuse";
import { activeObjectPromptForChatMode, selectionActionsForChatMode } from "@/lib/chatSelectionActions";
import { loadRecentAnalyticalContexts } from "@/lib/terminalPersonalization";
import { LIOS_FIRST_USE_CONTRACT, firstUseRecoveryDestination } from "@/lib/firstUseJourney";
import { voiceAvailability } from "@/lib/composerAvailability";
import { asyncSurfaceStatus } from "@/lib/asyncSurfaceState";
import { planAttachmentStage, stagedFileKey } from "@/lib/fileAttachmentStaging";
import { uploadRealChatAttachment, type UploadStage } from "@/lib/realFileAttachmentUpload";
import { ambiguousMentionTokens, eligibleProjectMentions, stageResourceMention } from "@shared/mentionContext";
import { stageUniversalChatQuestion, type UniversalChatHandoff } from "@/lib/universalChatHandoff";
import { hasObservedCompletion, stageSafeRunRetry } from "@/lib/observedRunPolicy";
import { clearSubmittedComposerDraft, mayClearComposerDraft, restoreFailedComposerDraft } from "@/lib/composerDraftSafety";
import ConversationRuntimeTrace from "./ConversationRuntimeTrace";
import ChatMarkdown from "./ChatMarkdown";
import { matchesSavedSearchChat } from "@/lib/workSearchNavigationPolicy";
import ChatMessageActions from "./ChatMessageActions";
import { quoteChatResponse } from "@/lib/chatMessageActions";
import SavedArtifactCards from "./SavedArtifactCards";
import ExecutionSessionPanel from "./ExecutionSessionPanel";
import SandboxOperationReviewCard from "./SandboxOperationReviewCard";
import { GATEWAY_METHODS } from "@shared/gatewayProtocol";
import { useGateway, useGatewayState } from "@/lib/gateway/GatewayProvider";
import { conversationSendAvailability, unconfirmedRunRecoveryNotice } from "@/lib/conversationConnectionRecovery";
import { attachConversationRun, cancelConversationRun, runConversation } from "@/lib/gateway/conversationRun";
import { useInterruptedAgentRun } from "@/lib/useInterruptedAgentRun";
import { useBoundedAgentComposer } from "@/lib/useBoundedAgentComposer";
import BoundedAgentComposerControl from "./BoundedAgentComposerControl";
import { loadSandboxSessionBookmark, saveSandboxSessionBookmark } from "@/lib/sandboxSessionBookmarkStore";
import { loadRuntimeReceipt, saveRuntimeReceipt } from "@/lib/runtimeReceiptStore";
import { canonicalRecentChats } from "@/lib/conversationSwitchPolicy";
import { contextForChatMode } from "@/lib/chatPersistenceBoundary";
import { appendConversationPresentationEvent, CHAT_RENDER_BATCH, selectConversationMessageWindow } from "@/lib/conversationRenderBudget";
import { contextChangeConfirmation, PROJECT_RESOURCE_CONTEXT_OPTIONS, type ProjectResourceContextMode } from "@/lib/projectHomeKnowledge";
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
  sourceScopeForChatMode,
  recordP1ShellEvent,
  resolveComposerPersistenceTarget,
  saveComposerSourceScope,
} from "@/lib/p1Shell";
import { recordP2ConversationEvent } from "@/lib/p2ConversationTelemetry";
import { recordP3TrustManifest } from "@/lib/p3TrustTelemetry";
import { artifactReplayDraft, buildArtifactDependencyRefs, type ArtifactReplayDraft } from "@/lib/p4ArtifactWorkspace";
import { resolveWorkSearchLibraryTarget } from "@/lib/terminalCommands";
type SandboxTerminalInput = z.output<(typeof GATEWAY_METHODS)["execution.session.input"]["params"]>["input"];
type SandboxTerminalProposal = z.output<(typeof GATEWAY_METHODS)["execution.operation.propose"]["result"]>;
const SANDBOX_TERMINAL_INPUTS: SandboxTerminalInput[] = ["help", "pwd", "id -u", "ls /tmp", "exit"];


interface Props {
  audience: WorkspaceAudience;
  activeView: ViewMode;
  activeSymbol?: string;
  workspaceAdapter: WorkspaceAdapter;
  onOpenWorkbench: (context?: ArtifactWorkbenchContext, chatOrigin?: ChatWorkbenchOrigin) => void;
  workbenchReturn?: { context: ArtifactWorkbenchContext; request: number; prompt?: string } | null;
  universalChatHandoff?: UniversalChatHandoff | null;
  renderTerminalPanel?: ChatTerminalRenderer;
  chatWorkbenchReturn?: { origin: ChatWorkbenchOrigin; request: number } | null;
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
  sourceRef?: string;
}

function savedMessageAttachments(message: ProjectChatMessage | LocalMessage): SavedMessageAttachment[] {
  if (!("metadata" in message) || !Array.isArray(message.metadata.attachments)) return [];
  return message.metadata.attachments.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.fileName !== "string" || typeof item.mimeType !== "string" || typeof item.byteLength !== "number") return [];
    return [{ id: item.id, fileName: item.fileName, mimeType: item.mimeType, byteLength: item.byteLength, ...(typeof item.sourceRef === "string" ? { sourceRef: item.sourceRef } : {}) }];
  });
}


function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


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
        aria-current={active ? "page" : undefined}
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
  activeView: workbenchView,
  activeSymbol: workbenchSymbol,
  workspaceAdapter,
  onOpenWorkbench: navigateWorkbench, workbenchReturn, universalChatHandoff,
  onOpenEnvironment,
  account, onLogout, onOpenSettings,
  navigationRequest, onNavigationContext,
  renderTerminalPanel, chatWorkbenchReturn,
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
    // Host shortcuts/deep links use the same safety rules as sidebar navigation.
    // Never hide Stop or an unsaved Artifact draft just because navigation was external.
    if (navigationRequest.section === "search") {
      requestWorkSearch();
      return;
    }
    if (navigationRequest.section !== "conversation" && (busyRef.current || sendInFlightRef.current)) {
      setLifecycleNotice("Stop the current response before opening another section.");
      return;
    }
    if (navigationRequest.section !== "conversation" && artifactDraftDirtyRef.current) {
      setLifecycleNotice("Save or reset unsaved Artifact edits before leaving Chat.");
      return;
    }
    setSection(navigationRequest.section);
    if (navigationRequest.section === "conversation") setProjectHomeRequested(false);
    setShowLifecycleCenter(false);
    setContextOpen(false);
  }, [navigationRequest]);
  const [librarySelection, setLibrarySelection] = useState<{ projectId: number; artifactId: string | null; resourceId: string | null; version?: number | null; request: number } | null>(null);
  const [workSearchOpen, setWorkSearchOpen] = useState(false);
  const workSearchOpener = useRef<HTMLElement | null>(null);
  const requestWorkSearch = () => {
    workSearchOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setWorkSearchOpen(true);
  };
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
  const messagesQuery = useProjectChatMessages(selection.chatId);
  const [chatMode, setChatMode] = useState<ChatMode>(() => (selection.chatId && !selection.projectId ? "quick" : resolveInitialChatMode(selection)));
  const [projectHomeRequested, setProjectHomeRequested] = useState(false);
  const [temporaryMessages, setTemporaryMessages] = useState<LocalMessage[]>([]);
  const temporaryWorkingContextRef = useRef<WorkingContextSnapshot | null>(null);
  const [input, setInput] = useState("");
  const [visibleMessageCount, setVisibleMessageCount] = useState(CHAT_RENDER_BATCH);
  const [voiceTranscripts, setVoiceTranscripts] = useState<VoiceTranscript[]>([]);
  const [voiceTranscriptReviewed, setVoiceTranscriptReviewed] = useState(false);
  const [pendingAttachmentFiles, setPendingAttachmentFiles] = useState<File[]>([]);
  const [pendingAttachmentRefs, setPendingAttachmentRefs] = useState<ConversationAttachmentRef[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState<{ key: string; fileName: string; index: number; total: number; progress: UploadStage } | null>(null);
  const [speakRepliesEnabled, setSpeakRepliesEnabled] = useState(() => {
    try {
      return window.localStorage.getItem("lios.voice.speakReplies") === "1";
    } catch {
      return false;
    }
  });
  const voiceProvidersQuery = useVoiceProviders();
  const voiceRuntimeStatus = voiceProvidersQuery.data?.runtime;
  const voiceStatus = voiceAvailability({ loading: voiceProvidersQuery.isLoading, error: voiceProvidersQuery.isError, transcription: voiceProvidersQuery.data?.transcription, speech: voiceProvidersQuery.data?.speech, browserRecordingReady: voiceRuntimeStatus?.browserRecordingReady, ffmpegFound: voiceRuntimeStatus?.ffmpegFound });
  const voiceInputAvailable = voiceStatus.transcriptionReady;
  const voiceOutputAvailable = voiceStatus.speechReady;
  const chatCreationInFlightRef = useRef(false);
  const projectCreationInFlightRef = useRef(false);
  const [pendingPersonalFinance, setPendingPersonalFinance] = useState<P6PersonalFinanceRequest | null>(null);
  const [financeInputOwner, setFinanceInputOwner] = useState<string | null>(null);
  const financeOwner = `${chatMode}:${selection.projectId ?? "none"}:${selection.chatId ?? "none"}`;
  const draftSnapshot = { input, files: pendingAttachmentFiles, attachments: pendingAttachmentRefs, voice: voiceTranscripts, personalFinance: pendingPersonalFinance, chatId: selection.chatId, projectId: selection.projectId };
  const currentDraftRef = useRef(draftSnapshot);
  currentDraftRef.current = draftSnapshot;
  const [streaming, setStreaming] = useState("");
  const pendingTextEventRef = useRef<ConversationRuntimeEvent | null>(null);
  const pendingTextFrameRef = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const sendInFlightRef = useRef(false);
  const cancelInFlightRef = useRef(false);
  const cancelAcknowledgedRunRef = useRef<string | null>(null);
  const [cancelAcknowledgedRunId, setCancelAcknowledgedRunId] = useState<string | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [runtimeEvents, setRuntimeEvents] = useState<ConversationRuntimeEvent[]>([]);
  const [runtimeRequestId, setRuntimeRequestId] = useState<string | null>(null);
  const [declinedRunAction, setDeclinedRunAction] = useState<{ requestId: string; action: ConversationActionName } | null>(null);
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
  const [showSaveWorkflow, setShowSaveWorkflow] = useState(false);
  const composerToolsTrigger = useRef<HTMLButtonElement>(null);
  const pendingComposerDialog = useRef<"workflow" | "resource" | null>(null);
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
  const terminalSelectionRef = useRef({ chatId: selection.chatId, setArtifact: setConversationArtifactRef, setVersion: setArtifactViewVersion });
  terminalSelectionRef.current = { chatId: selection.chatId, setArtifact: setConversationArtifactRef, setVersion: setArtifactViewVersion };
  const artifactDraftDirtyRef = useRef(false);
  const reopenArtifactFocusRef = useRef<HTMLButtonElement>(null);
  const displayedArtifactRef = useRef<{ artifactId: string; requestedVersion: number | null; version: number } | null>(null);
  const handledWorkbenchReturn = useRef<number | null>(null);
  const reviewingArtifactReturn = useRef<number | null>(null);
  const terminalDetail = useArtifact(chatMode === "temporary" ? null : conversationArtifactRef, artifactViewVersion);
  const retainedScreen = terminalDetail.data?.version.content.kind === "screen" && readTerminalScreenState(terminalDetail.data.version.content.state) ? terminalDetail.data.version.content : null;
  const selectedTerminalScope = retainedScreen ? readTerminalScreenState(retainedScreen.state)?.sourceScope : undefined;
  const [temporaryTerminal, setTemporaryTerminal] = useState<Extract<import("@shared/artifactContracts").ArtifactContent, {kind:"screen"}> | null>(null);
  const focusComposerAfterTerminalCloseRef = useRef(false);
  useEffect(() => {
    // After commit the covered Chat is visible again, so focus can land.
    if (temporaryTerminal || !focusComposerAfterTerminalCloseRef.current) return;
    focusComposerAfterTerminalCloseRef.current = false;
    composerRef.current?.focus();
  }, [temporaryTerminal]);
  const terminalContext: ChatTerminalContext | null = chatMode === "temporary"
    ? temporaryTerminal ? { view: temporaryTerminal.view as ViewMode, symbol: temporaryTerminal.symbol } : null
    : retainedScreen ? { view: retainedScreen.view as ViewMode, symbol: retainedScreen.symbol } : null;
  const activeView = terminalContext?.view ?? workbenchView;
  const activeSymbol = terminalContext ? terminalContext.symbol ?? undefined : workbenchSymbol;
  const terminalOpeningRef = useRef(false);
  const openTerminalPanel = async (context: ChatTerminalContext, message?: string) => {
    if (artifactDraftDirtyRef.current || terminalOpeningRef.current) { setLifecycleNotice("Wait for analytical state to finish saving before switching terminal tools."); return false; }
    const capability = chatTerminalCapabilities(audience).find(item => item.view === context.view);
    if (!capability) { setLifecycleNotice("This terminal tool is not available for this account."); return false; }
    const selectedSymbol = capability.symbolAware ? context.symbol : null;
    const state = { ...initialTerminalScreenState(selectedSymbol, sourceScope), stockTape: context.stockTape ?? false, macroTape: context.macroTape ?? false };
    const screen = { kind: "screen" as const, view: context.view, symbol: selectedSymbol, state: { terminal: state } };
    if (chatMode === "temporary") { setTemporaryTerminal(screen); setArtifactFocusMode(false); return true; }
    terminalOpeningRef.current = true; setBusy(true);
    try {
      let chatId = selection.chatId;
      let createdHere = false;
      if (!chatId) {
        const created = chatMode === "project" && selection.projectId ? await createProjectChat(selection.projectId) : await createQuickChat();
        chatId = created.id; openedChatOwnerRef.current = { chatId, ownerUserId: created.ownerUserId };
        createdHere = true;
        await openChat(created, true);
      }
      const title = `${getTerminalCapability(context.view).label}${selectedSymbol ? ` · ${selectedSymbol}` : ""}`;
      const result = await (await apiRequest("POST", `/api/chats/${chatId}/artifacts/open-terminal`, { requestId: crypto.randomUUID(), view: context.view, symbol: selectedSymbol, title, state, message })).json() as ArtifactDetail;
      if (terminalSelectionRef.current.chatId !== chatId && !(createdHere && terminalSelectionRef.current.chatId === null)) { setLifecycleNotice("The terminal view was saved in its originating Chat. Reopen that Chat to continue."); return false; }
      rememberConversationArtifactView(result.artifact.ownerUserId, result.artifact.projectId, chatId, { artifactId: result.artifact.id, revision: result.version.version, focus: false });
      if (terminalSelectionRef.current.chatId === chatId) { terminalSelectionRef.current.setArtifact(result.artifact.id); terminalSelectionRef.current.setVersion(result.version.version); }
      setArtifactFocusMode(false);
      invalidate(result.artifact.projectId, chatId); invalidateArtifacts(result.artifact.projectId, result.artifact.id);
      setSection("conversation"); setProjectHomeRequested(false);
      return true;
    } catch (cause) { setLifecycleNotice(cause instanceof Error ? cause.message : "Terminal view could not be retained. Your prompt remains available."); return false; }
    finally { terminalOpeningRef.current = false; setBusy(false); }
  };
  const handledChatReturn = useRef<number | null>(null);
  const reviewingChatReturn = useRef<number | null>(null);
  useEffect(() => {
    if (!chatWorkbenchReturn || handledChatReturn.current === chatWorkbenchReturn.request) return;
    const { origin, request } = chatWorkbenchReturn;
    // The return target, including Temporary's null scope, is authoritative.
    // Returning to a different Chat must never silently clear an unsent draft.
    if (returnChangesChatIdentity({ mode: chatMode, projectId: selection.projectId, chatId: selection.chatId }, origin)) {
      if (reviewingChatReturn.current === request) return;
      reviewingChatReturn.current = request;
      void (async () => {
        if (!(await confirmConversationSwitch())) {
          handledChatReturn.current = request;
          setLifecycleNotice("Your unsent work remains in this Chat. Return to Work to try switching again.");
          return;
        }
        // Change the owning selection first; the existing selected-Chat sync
        // resolves its mode after IDs settle. A mode-only change has no ID update.
        if (selection.projectId !== origin.projectId || selection.chatId !== origin.chatId) {
          selection.setProjectId(origin.projectId);
          selection.setChatId(origin.chatId);
        } else {
          setChatMode(origin.mode);
        }
      })().finally(() => {
        if (reviewingChatReturn.current === request) reviewingChatReturn.current = null;
      });
      return;
    }
    handledChatReturn.current = request;
    setChatMode(origin.mode); setSection("conversation"); setProjectHomeRequested(false);
  }, [chatWorkbenchReturn, chatMode, selection.projectId, selection.chatId]);
  const onOpenWorkbench = () => {
    if (busy || busyRef.current || sendInFlightRef.current) {
      setLifecycleNotice("Stop the current response before opening Work.");
      return;
    }
    if (artifactDraftDirtyRef.current) { setLifecycleNotice("Save or reset unsaved Artifact edits before opening Workbench. Your draft remains in Chat."); return; }
    if (conversationArtifactRef && chatMode !== "temporary" && selection.chatId) {
      const displayed = displayedArtifactRef.current;
      if (displayed?.artifactId !== conversationArtifactRef || displayed.requestedVersion !== artifactViewVersion || (artifactViewVersion !== null && displayed.version !== artifactViewVersion)) { setLifecycleNotice("Wait for the saved Artifact revision to load before opening Workbench."); return; }
      navigateWorkbench({ projectId: selection.projectId, chatId: selection.chatId, artifactId: conversationArtifactRef, version: displayed.version });
    } else {
      const symbol = resolveScopedWorkbenchSymbol({
        mode: chatMode,
        projectId: selection.projectId,
        chatId: selection.chatId,
        messages: messagesQuery.data ?? [],
        temporaryContext: temporaryWorkingContextRef.current,
      });
      navigateWorkbench(undefined, captureChatWorkbenchOrigin(chatMode, selection.projectId, selection.chatId, symbol));
    }
  };
  useEffect(() => {
    if (!workbenchReturn || handledWorkbenchReturn.current === workbenchReturn.request) return;
    const { context, prompt, request } = workbenchReturn;
    if (returnChangesChatIdentity({ mode: chatMode, projectId: selection.projectId, chatId: selection.chatId }, { mode: context.projectId === null ? "quick" : "project", projectId: context.projectId, chatId: context.chatId })) {
      if (reviewingArtifactReturn.current === request) return;
      reviewingArtifactReturn.current = request;
      void (async () => {
        if (!(await confirmConversationSwitch())) {
          handledWorkbenchReturn.current = request;
          setLifecycleNotice("Your unsent work remains in this Chat. Return to Work to open that Artifact later.");
          return;
        }
        if (selection.projectId !== context.projectId || selection.chatId !== context.chatId) {
          selection.setProjectId(context.projectId);
          selection.setChatId(context.chatId);
        } else {
          setChatMode(context.projectId === null ? "quick" : "project");
        }
      })().finally(() => {
        if (reviewingArtifactReturn.current === request) reviewingArtifactReturn.current = null;
      });
      return;
    }
    handledWorkbenchReturn.current = request;
    setChatMode(context.projectId === null ? "quick" : "project"); setSection("conversation"); setProjectHomeRequested(false);
    setConversationArtifactRef(context.artifactId); setArtifactViewVersion(context.version);
    if (prompt) setInput(current => stageUniversalChatQuestion(current, prompt));
  }, [workbenchReturn, chatMode, selection.projectId, selection.chatId, setConversationArtifactRef, setArtifactViewVersion]);
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
  const historyScrollAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  useLayoutEffect(() => {
    const anchor = historyScrollAnchorRef.current;
    if (!anchor) return;
    historyScrollAnchorRef.current = null;
    const viewport = conversationScrollRef.current;
    if (viewport) viewport.scrollTop = anchor.scrollTop + (viewport.scrollHeight - anchor.scrollHeight);
  }, [visibleMessageCount]);
  const keepingArtifactRef = useRef(false);
  const [projectDestination, setProjectDestination] = useState<{ description: string; save: (project: Project) => Promise<void> } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const handledUniversalChatHandoff = useRef<number | null>(null);
  useEffect(() => {
    if (!universalChatHandoff || handledUniversalChatHandoff.current === universalChatHandoff.request) return;
    handledUniversalChatHandoff.current = universalChatHandoff.request;
    setSection("conversation"); setShowLifecycleCenter(false); setProjectHomeRequested(false);
    setInput(current => stageUniversalChatQuestion(current, universalChatHandoff.prompt));
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [universalChatHandoff]);
  // The user's own most recent ticker fills the starter slot so an example is ready to send.
  const recentStarterSymbol = useMemo(() => loadRecentAnalyticalContexts().find((context) => context.symbol)?.symbol ?? null, []);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const firstSendChatRef = useRef<number | null>(null);
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
  const voiceInputHint = voiceRecorder.isRecording ? "Stop recording to upload this clip to LiOS Home for transcription. Review the transcript before Send."
    : voiceInputAvailable ? "Record speech; stopping uploads it to LiOS Home for transcription, never automatically to Chat."
    : voiceStatus.label;
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
  const shellErrorStatus = asyncSurfaceStatus(shellError);
  // Quiet entry: no chat selected means the composer, never a forced Project Home. Home opens only from the Projects rail.
  const entrySurface = resolveEntrySurface({ chatMode, chatId: selection.chatId, projectHomeRequested, projectHomeAvailable: Boolean(home) });
  useEffect(() => {
    if (entrySurface === "conversation" && !selection.chatId && section === "conversation" && shellLoadState !== "loading" && shellLoadState !== "error") requestAnimationFrame(() => composerRef.current?.focus());
  }, [entrySurface, selection.chatId, section, shellLoadState]);
  useEffect(() => {
    // Creating the first regular Chat is part of Send, not an intent to discard its staged files or transcript.
    if (firstSendChatRef.current !== null && firstSendChatRef.current === selection.chatId) {
      firstSendChatRef.current = null;
      return;
    }
    const preservedArtifactRef = pendingArtifactOpenRef.current;
    const preservedFocusMode = pendingArtifactFocusRef.current;
    pendingArtifactOpenRef.current = null;
    pendingArtifactFocusRef.current = false;
    followLatestRef.current = true;
    setAwayFromLatest(false);
    historyScrollAnchorRef.current = null;
    if (pendingTextFrameRef.current !== null) cancelAnimationFrame(pendingTextFrameRef.current);
    pendingTextFrameRef.current = null;
    pendingTextEventRef.current = null;
    setVisibleMessageCount(CHAT_RENDER_BATCH);
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
    setSourceScope(sourceScopeForChatMode(chatMode, selectedTerminalScope ?? loadComposerSourceScope(scopedProjectId)));
  }, [chatMode, selection.projectId, conversationArtifactRef, selectedTerminalScope]);

  useEffect(() => {
    if (followLatestRef.current) {
      const viewport = conversationScrollRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }
  }, [persistedMessages, temporaryMessages, streaming]);

  useEffect(() => {
    const openSearch = () => requestWorkSearch();
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
  const latestResourceContext = useRef({ projectId: selection.projectId, resources });
  latestResourceContext.current = { projectId: selection.projectId, resources };
  const contextUpdateInFlight = useRef(false);
  const [contextUpdateBusy, setContextUpdateBusy] = useState(false);
  const reviewResourceContext = async (resource: ProjectResource, next: ProjectResourceContextMode) => {
    if (contextUpdateInFlight.current || resource.contextMode === next || resource.projectId !== selection.projectId) return;
    contextUpdateInFlight.current = true;
    setContextUpdateBusy(true);
    try {
      const answer = await requestLifecycle({
        title: "Review Project resource inclusion",
        detail: contextChangeConfirmation(resource.label, resource.contextMode, next),
        confirmLabel: "Save context mode",
      });
      if (!answer) return;
      const latest = latestResourceContext.current;
      const reviewed = latest.resources.find(row => row.id === resource.id && row.projectId === resource.projectId);
      if (latest.projectId !== resource.projectId || !reviewed || reviewed.status !== "active"
        || reviewed.contextMode !== resource.contextMode || reviewed.updatedAt !== resource.updatedAt) {
        throw new Error("Resource changed since review. Reopen this Project's context before saving.");
      }
      const saved = await updateProjectResource(resource.projectId, resource.id, { contextMode: next, expectedUpdatedAt: resource.updatedAt });
      invalidate(resource.projectId);
      if (saved.id !== resource.id || saved.projectId !== resource.projectId || saved.contextMode !== next) {
        throw new Error("The server did not confirm the reviewed resource and mode. Refresh before relying on the change.");
      }
    } catch (cause) {
      if (sandboxSelectionRef.current.projectId === resource.projectId) {
        setLifecycleNotice(cause instanceof Error ? cause.message : "Project context update was not confirmed.");
      }
    } finally {
      contextUpdateInFlight.current = false;
      setContextUpdateBusy(false);
    }
  };
  const mentionCandidates = useMemo(
    () => eligibleProjectMentions(resources, input, selection.projectId, chatMode, sourceScope, transmissionPolicy.allowResourceReferences),
    [resources, input, selection.projectId, chatMode, sourceScope, transmissionPolicy.allowResourceReferences],
  );

  const commandCandidates = useMemo(() => {
    if (!input.startsWith("/")) return [];
    const q = input.toLowerCase();
    return QUICK_COMMANDS.filter((item) => item.command.startsWith(q)).slice(0, 6);
  }, [input]);

  const discardConversationDraft = (expected = currentDraftRef.current) => {
    const current = currentDraftRef.current;
    if (current.input !== expected.input || current.files !== expected.files || current.attachments !== expected.attachments || current.voice !== expected.voice || current.personalFinance !== expected.personalFinance || current.chatId !== expected.chatId || current.projectId !== expected.projectId) {
      setLifecycleNotice("Your draft or conversation changed while that action was pending. It has been kept; open the saved destination when ready.");
      return false;
    }
    setInput(""); setPendingAttachmentFiles([]); setPendingAttachmentRefs([]); setVoiceTranscripts([]); setVoiceTranscriptReviewed(false);
    setPendingPersonalFinance(null);
    return true;
  };
  const confirmConversationSwitch = async (deferDiscard = false, allowCreation = false) => {
    if (sendInFlightRef.current || ((chatCreationInFlightRef.current || projectCreationInFlightRef.current) && !allowCreation)) { setLifecycleNotice("Finish the pending request before switching conversations."); return false; }
    if (busy || busyRef.current) { setLifecycleNotice("Stop the current response before switching conversations."); return false; }
    if (artifactDraftDirtyRef.current) { setLifecycleNotice("Save or reset unsaved Artifact edits before switching conversations. Your draft remains in this Chat."); return false; }
    const expected = currentDraftRef.current;
    if (!input.trim() && !pendingAttachmentFiles.length && !pendingAttachmentRefs.length && !voiceTranscripts.length && !pendingPersonalFinance) return true;
    const answer = await requestLifecycle({ title: "Leave this draft?", detail: "Switching conversations clears the unsent draft, staged attachments, personal-finance inputs and voice transcript. Saved messages are kept.", confirmLabel: "Discard draft" });
    if (!answer) return false;
    if (!deferDiscard && !discardConversationDraft(expected)) return false;
    return true;
  };

  const openProject = async (project: Project, confirmed = false, showHome = false) => {
    if (!confirmed && (selection.projectId !== project.id || selection.chatId) && !(await confirmConversationSwitch())) return false;
    if (busy) { setLifecycleNotice("Stop the current response before switching Projects."); return false; }
    setSection("conversation"); setContextOpen(false); setShowLifecycleCenter(false); setProjectHomeRequested(showHome);
    selection.setProjectId(project.id);
    selection.setChatId(null);
    setChatMode("project");
    return true;
  };

  const openChat = async (chat: ProjectChat, confirmed = false) => {
    if (!confirmed && selection.chatId !== chat.id && !(await confirmConversationSwitch())) return false;
    if (busy && !confirmed) { setLifecycleNotice("Stop the current response before switching chats."); return false; }
    openedChatOwnerRef.current = { chatId: chat.id, ownerUserId: chat.ownerUserId };
    setSection("conversation"); setContextOpen(false); setShowLifecycleCenter(false); setProjectHomeRequested(false);
    selection.setProjectId(chat.projectId);
    selection.setChatId(chat.id);
    setChatMode(chat.scope === "quick" ? "quick" : "project");
    setTemporaryMessages([]);
    temporaryWorkingContextRef.current = null;
    return true;
  };
  const openWorkSearchResult = async (result: WorkSearchResult): Promise<boolean> => {
    if (busy || busyRef.current || sendInFlightRef.current || chatCreationInFlightRef.current) return false;
    const before = currentDraftRef.current;
    if (result.kind === "artifact" && result.projectId === null && result.chatId && result.artifactId) {
      const response = await fetch(`/api/project-chats/${result.chatId}`);
      if (!response.ok) throw new Error("This owning Chat is no longer available.");
      const chat = await response.json() as ProjectChat;
      const exact = await fetch(`/api/artifacts/${encodeURIComponent(result.artifactId)}`);
      if (!exact.ok) throw new Error("This exact Artifact is no longer available.");
      const detail = await exact.json() as ArtifactDetail;
      if (!matchesSavedSearchChat(result, chat) || detail.artifact.id !== result.artifactId || detail.artifact.projectId !== null || detail.artifact.owningChatId !== chat.id) throw new Error("Artifact ownership no longer matches this Chat.");
      if (busyRef.current || sendInFlightRef.current || artifactDraftDirtyRef.current) return false;
      if (selection.chatId !== chat.id && (!(await confirmConversationSwitch(true)) || !discardConversationDraft(before))) return false;
      if (selection.chatId === chat.id && chatMode === "quick") {
        pendingArtifactOpenRef.current = null; pendingArtifactFocusRef.current = false;
        setConversationArtifactRef(result.artifactId); setArtifactFocusMode(false);
        setArtifactViewVersion(detail.version.version);
      } else {
        // The destination Chat owns this bookmark. Never write its selected
        // Artifact/revision into the *currently mounted* Chat's local state.
        // The canonical P4 load still verifies exact ownership and access.
        rememberConversationArtifactView(chat.ownerUserId, null, chat.id, {
          artifactId: result.artifactId,
          revision: detail.version.version,
          focus: false,
        });
        pendingArtifactOpenRef.current = null;
        pendingArtifactFocusRef.current = false;
      }
      return await openChat(chat, true);
    }
    if (result.kind === "chat" && result.chatId) {
      const response = await fetch(`/api/project-chats/${result.chatId}`);
      if (!response.ok) throw new Error("This conversation is no longer available.");
      const chat = await response.json() as ProjectChat;
      if (!matchesSavedSearchChat(result, chat)) throw new Error("This conversation moved or is no longer active.");
      if (busyRef.current || sendInFlightRef.current) return false;
      if (selection.chatId !== chat.id && (!(await confirmConversationSwitch(true)) || !discardConversationDraft(before))) return false;
      return await openChat(chat, true);
    }

    if (result.projectId) {
      const response = await fetch(`/api/projects/${result.projectId}`);
      if (!response.ok) throw new Error("This Project is no longer available.");
      const project = await response.json() as Project;
      if (project.id !== result.projectId || project.status !== "active" || project.trashedAt) throw new Error("This Project is no longer active.");
      if (busyRef.current || sendInFlightRef.current) return false;
      if (result.kind === "project") {
        if (!(await confirmConversationSwitch(true)) || !discardConversationDraft(before)) return false;
        return await openProject(project, true, true);
      }
      if (result.kind === "artifact" || result.kind === "file") {
        const exactTarget = resolveWorkSearchLibraryTarget(result);
        if (!exactTarget) throw new Error("This search result has no exact available object identity.");
        if (selection.projectId !== project.id) {
          if (!(await confirmConversationSwitch(true)) || !discardConversationDraft(before)) return false;
          if (!(await openProject(project, true))) return false;
        }
        if (busyRef.current || artifactDraftDirtyRef.current) return false;
        setLibrarySelection((current) => ({ ...exactTarget, request: (current?.request ?? 0) + 1 }));
        setSection("library");
        setShowLifecycleCenter(false);
        setContextOpen(false);
        return true;
      }
    }
    return false;
  };
  const handleChatLifecycleAction = async (chat: ProjectChat, action: LifecycleAction) => {
    if (busy || busyRef.current || sendInFlightRef.current || chatCreationInFlightRef.current) { setLifecycleNotice("Finish the current request before changing saved chats."); return; }
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
        const before = currentDraftRef.current;
        const leaving = action === "archive" && selection.chatId === chat.id;
        if (leaving && !(await confirmConversationSwitch(true))) return;
        await updateProjectChat(chat.id, { status: action === "archive" ? "archived" : "active" });
        if (leaving && discardConversationDraft(before)) {
          selection.setChatId(null);
          setChatMode(chat.projectId === null ? "quick" : "project");
        }
        invalidate(chat.projectId, chat.id);
        return;
      }
      if (action === "delete") {
        const before = currentDraftRef.current;
        const leaving = selection.chatId === chat.id;
        if (leaving && !(await confirmConversationSwitch(true))) return;
        if (!(await requestLifecycle({ title: "Move chat to Trash?", detail: `“${chat.title}” can be restored from Trash & archive.`, confirmLabel: "Move to Trash" }))) return;
        await trashProjectChat(chat.id);
        if (leaving && discardConversationDraft(before)) {
          selection.setChatId(null);
          setChatMode(chat.projectId === null ? "quick" : "project");
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
    if (busy || busyRef.current || sendInFlightRef.current || projectCreationInFlightRef.current) { setLifecycleNotice("Finish the current request before changing Projects."); return; }
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
        const before = currentDraftRef.current;
        const leaving = action === "archive" && selection.projectId === project.id;
        if (leaving && !(await confirmConversationSwitch(true))) return;
        await updateProject(project.id, { status: action === "archive" ? "archived" : "active" });
        if (leaving && discardConversationDraft(before)) {
          selection.setChatId(null);
          selection.setProjectId(null);
          setChatMode("quick");
        }
        invalidate();
        return;
      }
      if (action === "delete") {
        const before = currentDraftRef.current;
        const leaving = selection.projectId === project.id;
        if (leaving && !(await confirmConversationSwitch(true))) return;
        const dependencies = await getProjectDependencySummary(project.id);
        const detail = dependencies.total ? ` This moves ${dependencies.total} dependent object${dependencies.total === 1 ? "" : "s"} to Trash.` : "";
        if (!(await requestLifecycle({ title: "Move Project to Trash?", detail: `“${project.name}” can be restored from Trash & archive.${detail}`, confirmLabel: "Move to Trash" }))) return;
        await trashProject(project.id);
        if (leaving && discardConversationDraft(before)) {
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

  const newProjectChat = async (starterPrompt?: string, intent?: {
    artifactId?: string;
    personalFinance?: P6PersonalFinanceRequest;
    replay?: ArtifactReplayDraft;
  }) => {
    if (busy || busyRef.current || sendInFlightRef.current || chatCreationInFlightRef.current || !selection.projectId) return;
    chatCreationInFlightRef.current = true;
    const before = currentDraftRef.current;
    try {
      if (!(await confirmConversationSwitch(true, true))) return;
      const chat = await createProjectChat(selection.projectId);
      invalidate(chat.projectId, chat.id);
      if (!discardConversationDraft(before)) return;
      // Keep operation intent local until creation and the draft fence succeed.
      // Cancelled/failed creation cannot contaminate a later unrelated Chat.
      pendingArtifactOpenRef.current = intent?.artifactId ?? null;
      pendingArtifactFocusRef.current = false;
      setPendingPersonalFinance(intent?.personalFinance ?? null);
      if (intent?.replay) {
        updateSourceScope(intent.replay.sourceScope);
        setExecutionMode(intent.replay.executionMode);
      }
      await openChat(chat, true);
      if (starterPrompt?.trim()) {
        setInput(starterPrompt.trim());
        requestAnimationFrame(() => composerRef.current?.focus());
      }
    } catch (error) {
      setLifecycleNotice(error instanceof Error ? error.message : "Unable to create a Project Chat. Your draft remains here.");
    } finally { chatCreationInFlightRef.current = false; }
  };

  const newQuickChat = async () => {
    if (busy || busyRef.current || sendInFlightRef.current || chatCreationInFlightRef.current) return;
    chatCreationInFlightRef.current = true;
    const before = currentDraftRef.current;
    try {
      if (!(await confirmConversationSwitch(true, true))) return;
      const chat = await createQuickChat();
      invalidate(null, chat.id);
      if (!discardConversationDraft(before)) return;
      await openChat(chat, true);
    } catch (error) { setLifecycleNotice(error instanceof Error ? error.message : "Unable to create a Chat. Your draft remains here."); }
    finally { chatCreationInFlightRef.current = false; }
  };

  const startTemporary = async () => {
    if (!(await confirmConversationSwitch())) return;
    setTemporaryTerminal(null);
    setSection("conversation"); setContextOpen(false); setShowLifecycleCenter(false);
    selection.setChatId(null);
    selection.setProjectId(null);
    setChatMode("temporary");
    setFinanceInputOwner(null);
    updateSourceScope("auto");
    setTemporaryMessages([]);
    temporaryWorkingContextRef.current = null;
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
    activeObjectId: !terminalContext && conversationArtifactRef ? conversationArtifactRef : (activeSymbol ? `security:${activeSymbol}` : `panel:${activeView}`),
  });

  const applyWorkspaceAction = async (
    action: SafeWorkspaceAction,
    source: "assistant" | "user" | "system" = "assistant",
  ): Promise<void> => {
    const context = currentWorkspaceRuntimeContext();
    if (action.type === "open-panel") {
      const terminalCapability = renderTerminalPanel && chatTerminalCapabilities(audience).find(item => item.view === action.view);
      if (terminalCapability) {
        await openTerminalPanel({ view: terminalCapability.view, symbol: action.symbol ?? terminalContext?.symbol ?? null });
        return;
      }
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

  const saveCurrentSession = async (name?: string): Promise<boolean> => {
    if (!selection.projectId) return false;
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
    return true;
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

  /** Commands clear the draft only after the requested outcome is confirmed. */
  const runCommand = async (command: string, clearDraft: () => void): Promise<boolean> => {
    const [token, ...args] = command.trim().split(/\s+/);
    const exact = QUICK_COMMANDS.find((item) => item.command === token.toLowerCase());
    if (!exact) return false;
    let applied = true;
    try {
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
        applied = await saveCurrentSession();
        if (!applied) setLifecycleNotice("Sessions are saved inside a Project. Open a Project Chat, then run /session again. Your command is kept.");
      } else if (exact.command === "/sandbox") {
        const outcome = await proposeSandboxTerminal();
        applied = outcome === "proposed";
        if (outcome === "unavailable") setLifecycleNotice("The reviewed sandbox opens from a saved Project Chat when no other sandbox request is pending. Your command is kept.");
      }
    } catch (cause) {
      applied = false;
      setLifecycleNotice(`${cause instanceof Error ? cause.message : `${exact.label} was not completed.`} Your command is kept.`);
    }
    if (applied) clearDraft();
    return true;
  };

  const gateway = useGateway();
  const gatewayState = useGatewayState();
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const observe = () => setBrowserOnline(navigator.onLine);
    window.addEventListener("online", observe);
    window.addEventListener("offline", observe);
    return () => { window.removeEventListener("online", observe); window.removeEventListener("offline", observe); };
  }, []);
  const sendAvailability = conversationSendAvailability(browserOnline, gatewayState);
  const requireGateway = () => {
    if (!gateway) throw new Error("LiOS is not connected to your Home yet. Please retry in a moment.");
    return gateway;
  };
  const flushPendingText = () => {
    if (pendingTextFrameRef.current !== null) cancelAnimationFrame(pendingTextFrameRef.current);
    pendingTextFrameRef.current = null;
    const textEvent = pendingTextEventRef.current;
    pendingTextEventRef.current = null;
    if (textEvent?.type === "text") {
      setRuntimeEvents(current => appendConversationPresentationEvent(current, textEvent));
      setStreaming(textEvent.text);
    }
  };
  useEffect(() => () => {
    if (pendingTextFrameRef.current !== null) cancelAnimationFrame(pendingTextFrameRef.current);
    pendingTextFrameRef.current = null;
    pendingTextEventRef.current = null;
  }, []);
  const applyRuntimeEvent = (runtimeEvent: ConversationRuntimeEvent) => {
    recordP2ConversationEvent(runtimeEvent);
    if (runtimeEvent.type === "text") {
      pendingTextEventRef.current = runtimeEvent;
      if (pendingTextFrameRef.current === null) pendingTextFrameRef.current = requestAnimationFrame(flushPendingText);
      return;
    }
    flushPendingText();
    if (runtimeEvent.type === "trust") recordP3TrustManifest(runtimeEvent.manifest);
    if (runtimeEvent.type === "artifact" && runtimeEvent.persistedArtifact && chatMode !== "temporary") {
      invalidateArtifacts(runtimeEvent.artifact.projectId, runtimeEvent.persistedArtifact.id);
      if (!artifactDraftDirtyRef.current) { setConversationArtifactRef(runtimeEvent.persistedArtifact.id); setArtifactViewVersion(runtimeEvent.persistedArtifact.version); }
    }
    setRuntimeEvents(current => appendConversationPresentationEvent(current, runtimeEvent));
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
      if (busyRef.current || sendInFlightRef.current) return;
      const { runs } = await gateway.request("conversation.active", undefined, { timeoutMs: 15_000 });
      const run = runs.find((candidate) => candidate.chatId === resumeChatId);
      if (!run || abandoned || busyRef.current || sendInFlightRef.current) return;
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
        // Reattachment observes buffered output; it must never replay workspace mutations.
        if (!hasObservedCompletion(result.events, run.requestId)) {
          setLifecycleNotice("The previous run has no observed completion. Inspect its status before retrying; no workspace action was replayed.");
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
      || (hasStagedAttachments ? "Analyze the attached file(s). Cite each file by name and clearly identify any missing or unreadable content." : "");
    if (!message || busy || busyRef.current || sendInFlightRef.current || chatCreationInFlightRef.current || projectCreationInFlightRef.current) return;
    if (chatMode === "project" && selection.projectId && transmissionPolicy.allowResourceReferences && (sourceScope === "auto" || sourceScope === "my_data")) {
      const owned = resources.filter(resource => resource.projectId === selection.projectId && resource.status === "active" && !resource.trashedAt);
      if (ambiguousMentionTokens(owned, message).length) {
        setLifecycleNotice("That Project reference matches multiple resource names. Rename duplicates or remove the mention; your draft is unchanged.");
        return;
      }
    }
    sendInFlightRef.current = true;
    const originalComposerDraft = input;
    const canClearDraft = mayClearComposerDraft(originalComposerDraft, message, Boolean(override?.continuationOf));
    try {
    followLatestRef.current = true;
    setAwayFromLatest(false);
    setLifecycleNotice(null);
    if (artifactDraftDirtyRef.current) { setLifecycleNotice("Wait for the current analytical state to save, or reset its local edits before sending another instruction."); return; }
    const terminalOperations = parseTerminalArtifactInstruction(message);
    if (terminalOperations && terminalContext) {
      if (artifactDraftDirtyRef.current) { setLifecycleNotice("Wait for analytical state to finish saving, then apply this instruction."); return; }
      try {
        if (chatMode === "temporary" && temporaryTerminal) {
          const state = readTerminalScreenState(temporaryTerminal.state);
          if (!state) throw new Error("Temporary terminal state is unavailable.");
          setTemporaryTerminal({ ...temporaryTerminal, state: { ...temporaryTerminal.state, terminal: applyTerminalArtifactOperations(temporaryTerminal.view, state, terminalOperations) } });
        } else {
          if (!selection.chatId || !terminalDetail.data) throw new Error("Load the selected saved terminal revision first.");
          const detail = terminalDetail.data;
          const result = await (await apiRequest("POST", `/api/chats/${selection.chatId}/artifacts/terminal-operation`, { instruction: message, update: { artifactId: detail.artifact.id, baseVersion: detail.version.version, baseHash: detail.version.contentHash, operations: terminalOperations } })).json() as { version: number };
          setArtifactViewVersion(result.version);
          invalidate(detail.artifact.projectId, selection.chatId); invalidateArtifacts(detail.artifact.projectId, detail.artifact.id);
        }
        if (canClearDraft) setInput(current => clearSubmittedComposerDraft(current, originalComposerDraft, message));
      } catch (cause) { setLifecycleNotice(cause instanceof Error ? cause.message : "Terminal operation was not applied."); }
      return;
    }
    const terminalRequest = !hasStagedAttachments && !override?.approval && !override?.continuationOf && renderTerminalPanel ? parseChatTerminalRequest(message, terminalContext?.symbol ?? null, audience) : null;
    if (terminalRequest) { if (await openTerminalPanel(terminalRequest, message) && canClearDraft) setInput(current => clearSubmittedComposerDraft(current, originalComposerDraft, message)); return; }
    if (sourceScope === "files" && !hasStagedAttachments) {
      setLifecycleNotice("Files scope requires at least one explicitly attached file.");
      return;
    }
    if (sourceScope === "web" && hasStagedAttachments) {
      setLifecycleNotice("Web scope excludes attached file contents. Switch to Auto, My Data or Files to analyze them.");
      return;
    }
    if (hasStagedAttachments && chatMode === "temporary") {
      setLifecycleNotice("Temporary Chat does not save files. Use a regular Quick Chat or a Project Chat.");
      return;
    }
    if (!override?.approval && !override?.continuationOf && await runCommand(message, () => {
      if (canClearDraft) setInput(current => clearSubmittedComposerDraft(current, originalComposerDraft, message));
    })) return;
    if (agentComposer.enabled && !agentComposer.ready) {
      setLifecycleNotice(agentComposer.guidance);
      return;
    }
    const availability = conversationSendAvailability(navigator.onLine, gateway?.state ?? "stopped");
    if (!availability.canSubmit) {
      setLifecycleNotice(`Send was blocked because the Home connection was not confirmed. ${availability.detail}`);
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
      activeObjectRefs: conversationArtifactRef && chatMode !== "temporary" ? [conversationArtifactRef] : [activeSymbol ? `security:${activeSymbol}` : `panel:${activeView}`],
      ...(retainedScreen && terminalDetail.data ? { terminalArtifact: { artifactId: terminalDetail.data.artifact.id, version: terminalDetail.data.version.version, contentHash: terminalDetail.data.version.contentHash } } : {}),
      personalFinance: pendingPersonalFinance ?? undefined,
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
      context: chatMode === "temporary"
        ? (pendingPersonalFinance ? { personalFinance: pendingPersonalFinance } : undefined)
        : contextForChatMode(chatMode, context),
    };
    const voiceReview = voiceTranscripts.length
      ? { transcripts: voiceTranscripts, transcriptReviewed: voiceTranscriptReviewed }
      : undefined;
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
    busyRef.current = true;
    cancelAcknowledgedRunRef.current = null;
    setCancelAcknowledgedRunId(null);
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
        if (canClearDraft) setInput(current => clearSubmittedComposerDraft(current, originalComposerDraft, message));
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
          setInput(current => restoreFailedComposerDraft(current, originalComposerDraft, message));
          setVoiceTranscriptReviewed(false);
          setLifecycleNotice(result.error ?? "Review the spoken transcript before this high-impact action.");
          return;
        }
        if (hasObservedCompletion(result.events, requestId)) setPendingPersonalFinance(current => current === pendingPersonalFinance ? null : current);
        if (!result.ok) setInput(current => restoreFailedComposerDraft(current, originalComposerDraft, message));
        else {
          setVoiceTranscripts([]);
          setVoiceTranscriptReviewed(false);
        }
        const final = result.text;
        if (result.error && !hasObservedCompletion(result.events, requestId)) {
          setLifecycleNotice(result.error);
        }
        if (hasObservedCompletion(result.events, requestId) && final) {
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
          firstSendChatRef.current = created.id;
          void openChat(created, true);
        }
        traceOwnerChatRef.current = chatId;

        if (pendingAttachmentFiles.length && !override?.continuationOf) {
          for (const file of [...pendingAttachmentFiles]) {
            const key = stagedFileKey(file);
            setUploadingAttachment({ key, fileName: file.name, index: pendingAttachmentFiles.findIndex(item => stagedFileKey(item) === key) + 1, total: pendingAttachmentFiles.length, progress: { state: "transferring", percent: null } });
            const attachment = await uploadRealChatAttachment(chatMode === "project" ? selection.projectId : null, chatId, file, progress => {
              setUploadingAttachment(current => current?.key === key ? { ...current, progress } : current);
            });
            attachmentsForRequest = [...attachmentsForRequest, attachment];
            payload.attachments = attachmentsForRequest;
            setPendingAttachmentRefs(attachmentsForRequest);
            const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
            setPendingAttachmentFiles((current) => current.filter((item) => `${item.name}:${item.size}:${item.lastModified}` !== fileKey));
            setLastWorkflowRequest((current) => current ? { ...current, attachments: attachmentsForRequest } : current);
          }
        }
        if (canClearDraft) setInput(current => clearSubmittedComposerDraft(current, originalComposerDraft, message));

        const result = await runConversation(requireGateway(), {
          chatId,
          body: { ...payload, agent: agentComposer.enabled, ...(voiceReview ? { voiceReview } : {}) },
          onEvent: applyRuntimeEvent,
        });
        if (result.status === 428) {
          setInput(current => restoreFailedComposerDraft(current, originalComposerDraft, message));
          setVoiceTranscriptReviewed(false);
          setLifecycleNotice(result.error ?? "Review the spoken transcript before this high-impact action.");
          return;
        }
        if (hasObservedCompletion(result.events, requestId)) setPendingPersonalFinance(current => current === pendingPersonalFinance ? null : current);
        if (!result.ok) setInput(current => restoreFailedComposerDraft(current, originalComposerDraft, message));
        else {
          setVoiceTranscripts([]);
          setVoiceTranscriptReviewed(false);
        }
        if (result.ok) setPendingAttachmentRefs([]);
        if (result.error && !result.events.some((runtimeEvent) => runtimeEvent.type === "error")) {
          setLifecycleNotice(result.error);
        }
        if (hasObservedCompletion(result.events, requestId) && result.text) {
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
      if (!override?.continuationOf) setInput(current => restoreFailedComposerDraft(current, originalComposerDraft, message));
      setLifecycleNotice(error instanceof Error ? error.message : "Unable to send this conversation request.");
    } finally {
      setUploadingAttachment(null);
      setStreaming("");
      busyRef.current = false;
      setBusy(false);
    }
    } catch {
      setLifecycleNotice(unconfirmedRunRecoveryNotice());
    } finally {
      sendInFlightRef.current = false;
    }
  };

  const approveRuntimeAction = async (action: ConversationActionName, scope: ApprovalGrant["scope"]) => {
    if (!lastSubmittedMessage || !runtimeRequestId) return;
    if (declinedRunAction?.requestId === runtimeRequestId && declinedRunAction.action === action) return;
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

  const cancelRuntime = async () => {
    if (!runtimeRequestId || cancelInFlightRef.current || cancelAcknowledgedRunRef.current === runtimeRequestId) return;
    const targetRun = runtimeRequestId;
    cancelInFlightRef.current = true;
    setCancelPending(true);
    try {
      const acknowledged = await cancelConversationRun(requireGateway(), targetRun);
      if (acknowledged) {
        cancelAcknowledgedRunRef.current = targetRun;
        setCancelAcknowledgedRunId(targetRun);
        recordP1ShellEvent("composer_cancel");
      } else {
        setLifecycleNotice("Home did not acknowledge Stop. The original run may still be active.");
      }
    } catch {
      setLifecycleNotice("Could not confirm Stop with Home. Inspect the original run after reconnecting.");
    } finally {
      cancelInFlightRef.current = false;
      setCancelPending(false);
    }
  };
  const denyRuntimeAction = (action: ConversationActionName) => {
    if (!runtimeRequestId) return;
    const latestDone = [...runtimeEvents].reverse().find(event => event.requestId === runtimeRequestId && event.type === "done");
    const agent = runtimeEvents.some(event => event.requestId === runtimeRequestId && (
      event.type === "governed_tool_approval_required" || (event.type === "plan" && event.plan.steps.some(step => step.kind === "agent"))
    ));
    if (!agent && latestDone?.type === "done" && latestDone.status === "waiting_approval") {
      // This legacy attempt already ended at its approval boundary. Declining
      // dismisses only the proposal; it is not a new server execution outcome.
      setDeclinedRunAction({ requestId: runtimeRequestId, action });
      setLifecycleNotice("You declined this proposed action. No approval or retry was submitted.");
      return;
    }
    setLifecycleNotice(`Declined ${action}; requesting cancellation of the original run.`);
    void cancelRuntime();
  };
  const interruptedRun = useInterruptedAgentRun({ gateway, chatId: resumeChatId, busy, onEvent: applyRuntimeEvent, shell: { busyRef, traceOwnerChatRef, setBusy, setStreaming, setRuntimeEvents, setRuntimeRequestId, setLifecycleNotice, onSettled: () => invalidate(selection.projectId, resumeChatId) } });
  const proposeSandboxTerminal = async (): Promise<"proposed" | "failed" | "unavailable"> => {
    if (chatMode !== "project" || !selection.projectId || !selection.chatId || sandboxOpening) return "unavailable";
    const { projectId, chatId } = selection;
    const stillSelected = () => sandboxSelectionRef.current.projectId === projectId
      && sandboxSelectionRef.current.chatId === chatId;
    setSandboxOpening(true);
    setSandboxError(null);
    try {
      const proposal = await requireGateway().request("execution.operation.propose", { projectId, chatId });
      if (!stillSelected()) return "unavailable";
      setSandboxProposal(proposal);
      return "proposed";
    } catch (error) {
      if (stillSelected()) setSandboxError(error instanceof Error ? error.message : "LiOS could not prepare the reviewed sandbox operation.");
      return "failed";
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

  const updateSourceScope = async (next: ConversationSourceScope) => {
    next = sourceScopeForChatMode(chatMode, next);
    if (artifactDraftDirtyRef.current) { setLifecycleNotice("Wait for analytical state to save before changing its source posture."); return; }
    if (retainedScreen && terminalDetail.data) {
      const state = readTerminalScreenState(retainedScreen.state);
      if (!state) return;
      setBusy(true);
      try {
        const version = await createArtifactVersion(terminalDetail.data.artifact.id, { baseVersion: terminalDetail.data.version.version, content: { ...retainedScreen, state: { ...retainedScreen.state, terminal: { ...state, sourceScope: next } } } });
        setArtifactViewVersion(version.version); invalidateArtifacts(terminalDetail.data.artifact.projectId, terminalDetail.data.artifact.id);
      } catch (cause) { setLifecycleNotice(cause instanceof Error ? cause.message : "Source posture was not changed."); return; }
      finally { setBusy(false); }
    }
    if (chatMode === "temporary" && temporaryTerminal) {
      const state = readTerminalScreenState(temporaryTerminal.state);
      if (state) setTemporaryTerminal({ ...temporaryTerminal, state: { ...temporaryTerminal.state, terminal: { ...state, sourceScope: next } } });
    }
    setSourceScope(next);
    if (chatMode !== "temporary") saveComposerSourceScope(chatMode === "project" ? selection.projectId : null, next);
    recordP1ShellEvent("source_scope_change", next);
  };

  const retryShell = async () => {
    recordP1ShellEvent("shell_retry");
    const results = await Promise.all([
      projectsQuery.refetch(),
      quickChatsQuery.refetch(),
      chatMode === "project" && selection.projectId ? projectHomeQuery.refetch() : Promise.resolve(),
      chatMode !== "temporary" && selection.chatId ? messagesQuery.refetch() : Promise.resolve(),
    ]);
    if (results.some(result => result?.isError)) return;
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
    if (chatMode === "temporary") {
      setLifecycleNotice("Temporary Chat does not retain files. Start a regular Quick Chat or Project Chat.");
      return;
    }
    if (busyRef.current || sendInFlightRef.current) { setLifecycleNotice("Finish the pending request before changing staged files."); return; }
    const staged = planAttachmentStage(currentDraftRef.current.files, Array.from(fileList), currentDraftRef.current.attachments.length);
    if (staged.error) { setLifecycleNotice(staged.error); return; }
    setLifecycleNotice(staged.files.length === currentDraftRef.current.files.length ? "Those files are already staged." : null);
    currentDraftRef.current = { ...currentDraftRef.current, files: staged.files };
    setPendingAttachmentFiles(staged.files);
  };

  const removePendingAttachment = (id: string) => {
    if (busyRef.current || sendInFlightRef.current) return;
    setPendingAttachmentRefs((current) => current.filter((attachment) => attachment.id !== id));
    setPendingAttachmentFiles((current) => current.filter((file) => `${file.name}:${file.size}:${file.lastModified}` !== id));
  };

  const applySelectionAiAction = (prompt: string) => {
    setInput(prompt);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const askActiveObject = () => {
    applySelectionAiAction(activeObjectPromptForChatMode(chatMode, selectedTextContext, activeSymbol, activeView));
  };

  const selectMention = (resource: ProjectResource) => {
    if (!mentionCandidates.some(candidate => candidate.id === resource.id)) return;
    setInput(current => stageResourceMention(current, resource.label));
    requestAnimationFrame(() => composerRef.current?.focus());
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
    if (creatingProject || busy || busyRef.current || sendInFlightRef.current || projectCreationInFlightRef.current) return;
    if (!newProjectName.trim()) { setProjectCreateError("Enter a Project name."); return; }
    projectCreationInFlightRef.current = true;
    const before = currentDraftRef.current;
    setCreatingProject(true); setProjectCreateError(null);
    try {
      if (!(await confirmConversationSwitch(true, true))) return;
      const project = await createProject({ name: newProjectName.trim() });
      invalidate(project.id);
      if (!discardConversationDraft(before)) return;
      setNewProjectName(""); setNewProjectOpen(false);
      await openProject(project, true);
    } catch (error) { setProjectCreateError(error instanceof Error ? error.message : "Unable to create a Project. Your name is still here; try again."); }
    finally { projectCreationInFlightRef.current = false; setCreatingProject(false); }
  };

  const chooseChatDestination = (chat: ProjectChat) => {
    setProjectDestination({
      description: `Move “${chat.title}” and its saved messages into a Project. Future requests can use that Project's context.`,
      save: async (project) => {
        const before = currentDraftRef.current;
        const selectedHere = selection.chatId === chat.id;
        if (selectedHere && !(await confirmConversationSwitch(true))) throw new Error("Save or reset the current draft before moving this Chat.");
        const moved = await promoteQuickChat(chat.id, project.id);
        invalidate(project.id, moved.id);
        if (selectedHere && discardConversationDraft(before)) await openChat(moved, true);
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
  const { messages: visibleMessages, hiddenCount: hiddenMessageCount, nextBatchCount } =
    selectConversationMessageWindow(displayMessages, visibleMessageCount);
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
      <Dialog open={financeInputOwner === financeOwner} onOpenChange={(open) => { if (!open) setFinanceInputOwner(null); }}>
        <DialogContent className="max-w-3xl" onCloseAutoFocus={(event) => { event.preventDefault(); composerRef.current?.focus(); }}>
          <DialogTitle>Personal-finance inputs</DialogTitle>
          <DialogDescription>
            Stage your inputs in this conversation, then review and choose Send. Closing this editor discards unstaged changes.
            {chatMode === "temporary" ? " Temporary Chat keeps them in memory only." : " Sending retains the calculation in this saved Chat."}
          </DialogDescription>
          {financeInputOwner === financeOwner && <ProjectPersonalFinancePanel
            key={financeOwner}
            projectId={null}
            stageOnly
            initialProfile={pendingPersonalFinance}
            onAnalyze={(profile) => {
              setPendingPersonalFinance(profile);
              setFinanceInputOwner(null);
              setInput(current => stageSafeRunRetry(current, lastSubmittedMessage || "Analyze my personal finances using the supplied inputs."));
              setExecutionMode("deterministic_first");
              setLifecycleNotice("Personal-finance inputs staged in this Chat. Review the request and choose Send to calculate; nothing has run yet.");
            }}
          />}
        </DialogContent>
      </Dialog>
      {projectDestination && <ProjectDestinationDialog projects={projects} description={projectDestination.description} onConfirm={projectDestination.save} onClose={() => { invalidate(); setProjectDestination(null); }} />}
      <ProjectLifecycleDialog request={lifecycleRequest} onClose={() => { lifecycleResolver.current = null; setLifecycleRequest(null); }} />
      <WorkSearchDialog
        open={workSearchOpen}
        opener={workSearchOpener.current}
        onClose={() => setWorkSearchOpen(false)}
        onSelect={openWorkSearchResult}
      />
      <AuthenticatedNavigation section={section} activeSection={section === "conversation" && entrySurface === "project-home" ? "projects" : section} account={account} busy={busy}
        onSection={(next) => {
          if (next !== "conversation" && (busy || sendInFlightRef.current)) {
            setLifecycleNotice("Stop the current response before opening another section.");
            return;
          }
          if (next !== "conversation" && artifactDraftDirtyRef.current) {
            setLifecycleNotice("Save or reset unsaved Artifact edits before leaving Chat.");
            return;
          }
          setSection(next);
          if (next === "conversation") setProjectHomeRequested(false);
          setShowLifecycleCenter(false);
          setContextOpen(false);
        }}
        onNewChat={() => void newQuickChat()}
        onTemporary={() => void startTemporary()}
        onSearch={requestWorkSearch}
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
                    aria-current={selection.projectId === project.id && chatMode === "project" ? "page" : undefined}
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
              {!recentChats.length && (
                <div className="px-2.5 py-3 font-ui text-[12px] text-muted-foreground">Your recent chats will appear here.</div>
              )}
            </div>
          </section>
        </div>
      </AuthenticatedNavigation>

      <main className="min-w-0 flex-1">
        {!sendAvailability.canSubmit && <div role="status" className="border-b border-amber-300/20 px-4 py-2 text-sm text-amber-100">
          <strong>{sendAvailability.title}.</strong> {sendAvailability.detail}
        </div>}
        {lifecycleNotice && (
          <div role="alert" className="border-b border-red-300/20 bg-red-300/[0.04] px-4 py-2 font-ui text-[13px] text-red-200">
            {lifecycleNotice}
          </div>
        )}
        {section !== "conversation" ? (
          <section className="lios-section-surface" aria-label={section}>
            <header><h1>{({ projects: "Projects", chats: "History", library: "Artifacts", automations: "Automations", plugins: "Plugins" } as const)[section]}</h1>
              <button className="lios-section-action" onClick={() => setSection("conversation")}>Back to chat</button></header>
            {section === "projects" && <>
              <button className="lios-section-action" onClick={() => { setSection("conversation"); setNewProjectOpen(true); }}>New Project</button>
              {projectsQuery.isLoading ? <p role="status">Loading Projects…</p> : projectsQuery.isError ? <p role="alert">Unable to load Projects. <button onClick={() => void projectsQuery.refetch()}>Retry</button></p> : <div className="lios-directory-list">{projects.map((project) => <button key={project.id} onClick={() => openProject(project, false, true)}><strong>{project.name}</strong><small>{project.instructions || "Open Project"}</small></button>)}{!projects.length && <p>Create a Project to organize your research.</p>}</div>}
            </>}
            {section === "chats" && <>
              {allChatsQuery.isLoading || quickChatsQuery.isLoading ? <p role="status">Loading chats…</p> : allChatsQuery.isError || quickChatsQuery.isError ? <p role="alert">Unable to load chats. <button onClick={() => { void allChatsQuery.refetch(); void quickChatsQuery.refetch(); }}>Retry</button></p> : (() => {
                const chats = [...(allChatsQuery.data ?? []), ...quickChats].sort((left, right) => new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime());
                return <div className="lios-directory-list">{chats.slice(0, chatLimit).map((chat) => <button key={chat.id} onClick={() => openChat(chat)}><strong>{chat.title}</strong><small>{chat.projectId ? projects.find((project) => project.id === chat.projectId)?.name || "Project chat" : "Quick chat"} · {relativeTime(chat.updatedAt)}</small></button>)}{chats.length > chatLimit && <button className="lios-section-action" onClick={() => setChatLimit((limit) => limit + 50)}>Load more chats</button>}{!chats.length && <p>Your saved conversations will appear here.</p>}</div>;
              })()}
            </>}
            {(section === "library" || section === "automations") && <>
              <label htmlFor="lios-tools-project" className="mr-3 text-sm">Project</label><select id="lios-tools-project" value={selection.projectId ?? ""} disabled={busy} onChange={async (e) => { const nextId = Number(e.target.value) || null; if (nextId === selection.projectId || !(await confirmConversationSwitch())) return; selection.setChatId(null); selection.setProjectId(nextId); setChatMode("project"); }} className="rounded border border-border bg-background p-2"><option value="">Choose a Project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
              {section === "library" && <button type="button" className="lios-section-action ml-3" onClick={requestWorkSearch}>Search saved work</button>}
              {projectsQuery.isError ? <p role="alert">Unable to load Projects. <button onClick={() => void projectsQuery.refetch()}>Retry</button></p> : !selection.projectId ? <p className="mt-6">{section === "library" ? "Saved Artifacts from regular Chats are available through Search. Choose a Project to browse its library." : "Choose a Project to manage its automations."}</p> : projectHomeQuery.isLoading ? <p role="status">Loading Project…</p> : projectHomeQuery.isError ? <p role="alert">Unable to load this Project. <button onClick={() => void projectHomeQuery.refetch()}>Retry</button></p> : home && <div className="lios-project-tools">
                {section === "library" ? <ProjectArtifactsPanel key={`${home.project.id}:${librarySelection?.projectId === home.project.id ? librarySelection.request : 0}`} projectId={home.project.id} sessions={home.sessions}
                  initialArtifactId={librarySelection?.projectId === home.project.id ? librarySelection.artifactId : null}
                  initialVersion={librarySelection?.projectId === home.project.id ? librarySelection.version ?? null : null}
                  selectedResourceId={librarySelection?.projectId === home.project.id ? librarySelection.resourceId : null}
                  resources={home.resources}
                  onAskArtifact={(id, title, prompt) => { void newProjectChat(prompt ?? `Work on Artifact "${title}". Use ${id} as the active object and propose changes for review.`, { artifactId: id }); }}
                  onFocusArtifact={(id) => { void newProjectChat(undefined, { artifactId: id }); }} /> : <ProjectAutomationPanel key={home.project.id} projectId={home.project.id} />}
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
              <div className="mt-4 font-ui text-[15px] font-semibold text-foreground">Opening workspace…</div>
            </div>
          </div>
        ) : shellLoadState === "error" ? (
          <div className="flex h-full min-h-[320px] items-center justify-center px-6" role="alert">
            <div className="max-w-lg rounded-xl border border-red-300/20 bg-red-300/[0.035] p-6 text-center">
              <div className="font-terminal text-[11px] uppercase tracking-[0.18em] text-red-200">Workspace recovery</div>
              <div className="mt-3 font-ui text-[16px] font-semibold text-foreground">LiOS could not restore part of this workspace.</div>
              <div className="mt-2 font-ui text-[12px] leading-5 text-muted-foreground">
                {shellErrorStatus === 401 ? "Your session cannot read this saved work. Sign in again." : shellErrorStatus === 403 ? "Your current account cannot access this workspace. No permissions were changed." : shellErrorStatus === 404 ? "This saved Project or Chat is no longer available." : "The Project or Chat could not be restored. Retry without resetting your work."}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <button type="button" onClick={() => void retryShell()} className="rounded-md bg-amber-400 px-3 py-2 font-ui text-[12px] font-semibold text-black hover:bg-amber-300">Retry restore</button>
                {shellErrorStatus === 401 || shellErrorStatus === 403 ? <button type="button" onClick={onLogout} className="min-h-10 rounded border px-3 text-sm">Sign out</button> : <button type="button" onClick={() => void startTemporary()} className="min-h-10 rounded border px-3 text-sm">Open Temporary Chat</button>}
              </div>
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
            onRenameProject={async name => {
              const saved = await updateProject(home.project.id, { name });
              if (saved.id !== home.project.id || saved.name !== name) throw new Error("The server did not confirm this Project name. Your draft is retained.");
              invalidate(home.project.id);
            }}
            onTogglePin={() => void handleProjectLifecycleAction(home.project, home.project.pinned ? "unpin" : "pin")}
            onArchiveProject={() => void handleProjectLifecycleAction(home.project, "archive")}
            onRestoreProject={() => void handleProjectLifecycleAction(home.project, "restore")}
            onTrashProject={() => void handleProjectLifecycleAction(home.project, "delete")}
            onAskArtifact={(id, title, prompt) => {
              void newProjectChat(prompt ?? `Work on Artifact "${title}". Use ${id} as the active object and propose changes for review before mutating it.`, { artifactId: id });
            }}
            onFocusArtifact={(id) => {
              void newProjectChat(undefined, { artifactId: id });
            }}
            onRerunArtifact={(id, title, spec) => {
              const replay = artifactReplayDraft(title, spec);
              void newProjectChat(replay.message, { artifactId: id, replay });
            }}
            onAnalyzePersonalFinance={(profile) => {
              void newProjectChat("Analyze my Personal Finance profile with the deterministic LiOS engine. Show net worth, trailing cash flow, debt payoff, goal funding and retirement gaps. Keep every assumption explicit and do not invent missing observations.", { personalFinance: profile });
            }}
          />
        ) : (
          <div className="lios-project-chat-surface relative flex h-full min-h-0 min-w-0">
            <div className={artifactFocusMode && conversationArtifactRef ? "hidden" : `flex min-w-0 flex-1 flex-col${chatMode === "temporary" && temporaryTerminal ? " lios-covered-by-temporary-terminal" : ""}`}>
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
                <button type="button" disabled={busy} onClick={event => { event.currentTarget.focus(); chooseChatDestination(activeChat); }} className="rounded-md px-2 py-1.5 font-ui text-[12px] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground">
                  Move to Project
                </button>
              )}
              {conversationArtifactRef && (
                <button ref={reopenArtifactFocusRef} type="button" onClick={() => setArtifactFocusMode(true)} className="rounded-md px-2 py-1.5 font-ui text-[12px] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground">
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
                    <h1 id="lios-chat-empty-title" className="mt-2 font-display text-[30px] font-semibold tracking-[-0.04em] text-foreground">How can I help?</h1>
                    <div className="lios-chat-starters mt-6 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="Example prompts">
                      {starterPromptsForChatMode(chatMode).map((starter) => (
                        <button
                          key={starter.id}
                          type="button"
                          className="lios-chat-starter rounded-lg border border-border/70 bg-card px-3.5 py-3 text-left transition-colors hover:border-border hover:bg-accent"
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
                        </button>
                      ))}
                    </div>
                    <div className="lios-chat-empty-state__project-cta mt-5 flex flex-wrap items-center justify-center gap-2">
                      <button type="button" data-first-use-primary="ask" onClick={() => composerRef.current?.focus()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-amber-400 px-3.5 py-2 font-ui text-sm font-semibold text-black focus-visible:outline focus-visible:outline-2">
                        Ask LiOS
                      </button>
                      <details className="lios-first-use-options text-left">
                        <summary className="cursor-pointer rounded-md px-3 py-2 font-ui text-[13px] text-muted-foreground hover:text-foreground">More options</summary>
                        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                          <button type="button" onClick={() => setNewProjectOpen(true)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border/70 px-3.5 py-2 font-ui text-sm text-muted-foreground hover:text-foreground">
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
                        <div data-first-use-entry="ask-first" className="mt-2 max-w-md font-ui text-[12px] leading-5 text-muted-foreground">
                          {LIOS_FIRST_USE_CONTRACT.shellHint}
                        </div>
                      </details>
                    </div>
                  </section>
                )}
                {hiddenMessageCount > 0 && (
                  <div className="flex justify-center" role="group" aria-label="Earlier messages">
                    <button type="button" data-testid="chat-load-earlier" className="lios-section-action" onClick={() => {
                      const viewport = conversationScrollRef.current;
                      if (viewport) historyScrollAnchorRef.current = { scrollHeight: viewport.scrollHeight, scrollTop: viewport.scrollTop };
                      followLatestRef.current = false;
                      setVisibleMessageCount(count => count + CHAT_RENDER_BATCH);
                    }}>Show {nextBatchCount} earlier message{nextBatchCount === 1 ? "" : "s"} · {hiddenMessageCount} hidden</button>
                  </div>
                )}
                {visibleMessages.map((message) => (
                  <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                    <div data-lios-message={message.role}
                    role="group"
                    aria-label={message.role === "assistant" ? "LiOS response" : message.role === "user" ? "Your message" : "System message"}
                    className={`lios-conversation-message max-w-[85%] rounded-xl border px-4 py-3 ${
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
                      {message.role !== "system" && <ChatMessageActions content={message.content} role={message.role}
                        onQuote={message.role === "assistant" ? () => {
                          setInput(draft => quoteChatResponse(draft, message.content));
                          requestAnimationFrame(() => composerRef.current?.focus());
                        } : undefined} />}
                      {message.role === "assistant" && chatMode !== "temporary" && "metadata" in message && <SavedArtifactCards metadata={message.metadata} projectId={selection.projectId} chatId={selection.chatId} activeId={conversationArtifactRef} onOpen={async (id, version) => { if (id === conversationArtifactRef && version === artifactViewVersion) return; if (artifactDraftDirtyRef.current && !(await requestLifecycle({ title: "Leave unsaved Artifact edits?", detail: "Opening this saved revision discards the current local Artifact draft. Saved revisions are unchanged.", confirmLabel: "Discard local edits" }))) return; artifactDraftDirtyRef.current = false; setArtifactFocusMode(false); setConversationArtifactRef(id); setArtifactViewVersion(version); }} />}
                      {message.role === "user" && chatMode !== "temporary" && selection.chatId && savedMessageAttachments(message).length > 0 && (
                        <div className="mt-3 space-y-1.5 border-t border-border/50 pt-2" aria-label="Attached files">
                          {savedMessageAttachments(message).map((attachment) => (
                            <a
                              key={attachment.id}
                              href={attachment.sourceRef?.startsWith("quick-attachment:")
                                ? `/api/quick-chats/${selection.chatId}/attachments/${attachment.id}/download`
                                : `/api/projects/${selection.projectId}/attachments/${attachment.id}/download`}
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
                          {"metadata" in message && savedChatAttachmentRefs(message.metadata).map(attachment => (
                            <button key={`reuse-${attachment.id}`} type="button"
                              disabled={busy || sourceScope === "web"}
                              onClick={() => {
                                const staged = stageSavedAttachmentForFollowUp(pendingAttachmentRefs, attachment, pendingAttachmentFiles.length);
                                if (staged.status === "added") {
                                  setPendingAttachmentRefs(staged.refs);
                                  setLifecycleNotice(`${attachment.fileName} staged for your next message. Nothing has been sent.`);
                                  requestAnimationFrame(() => composerRef.current?.focus());
                                } else setLifecycleNotice(staged.status === "already_staged" ? "This file is already staged." : staged.status === "limit_reached" ? "A message can include at most five files." : "This saved file reference cannot be reused.");
                              }}
                              className="min-h-8 rounded-md border border-border/60 px-3 py-1.5 font-ui text-[12px] disabled:opacity-40">
                              Use {attachment.fileName} in next message
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {streaming && (
                  <div className="flex justify-start">
                    <div className="lios-conversation-message lios-conversation-stream max-w-[85%] rounded-xl border border-border/60 bg-white/[0.018] px-4 py-3" data-lios-message="assistant" role="group" aria-label="LiOS response in progress">
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
                events={runtimeEvents.filter(event => !(declinedRunAction?.requestId === event.requestId && (
                  (event.type === "approval_required" && event.action === declinedRunAction.action)
                  || (event.type === "mutation_review" && event.proposal.action === declinedRunAction.action)
                )))}
                requestId={runtimeRequestId ?? runtimeEvents.at(-1)?.requestId ?? null}
                busy={busy}
                cancelPending={cancelPending}
                stopRequested={cancelAcknowledgedRunId !== null && cancelAcknowledgedRunId === runtimeRequestId}
                onCancel={() => void cancelRuntime()}
                onApprove={(action, scope) => void approveRuntimeAction(action, scope)}
                onDeny={denyRuntimeAction}
                onGovernedToolReview={reviewGovernedTool}
                allowProjectApproval={chatMode === "project" && Boolean(selection.projectId)}
                onMutationApply={(action) => void approveRuntimeAction(action, "once")}
                onMutationCancel={(action) => denyRuntimeAction(action)}
                onRecoveryAction={(action) => {
                  if (action === P6_PERSONAL_FINANCE_INPUT_ACTION
                    || runtimeEvents.some(event => event.type === "data_gap" && event.requestId === runtimeRequestId
                      && event.gap.field === "personal_finance_inputs" && event.gap.nextActions.includes(action))) {
                    if (!busy && !sendInFlightRef.current) setFinanceInputOwner(financeOwner);
                    return;
                  }
                  if (firstUseRecoveryDestination(action) === "connections") {
                    if (lastSubmittedMessage.trim()) {
                      setInput(current => stageSafeRunRetry(current, lastSubmittedMessage));
                      setLifecycleNotice("Connection Center opened for the missing source. Your original request is preserved here so you return to the same task.");
                    }
                    onOpenEnvironment();
                    return;
                  }
                  setInput(current => stageSafeRunRetry(current, action));
                  requestAnimationFrame(() => composerRef.current?.focus());
                }}
                onRetry={() => {
                  if (busy || !lastSubmittedMessage.trim()) return;
                  setInput(current => stageSafeRunRetry(current, lastSubmittedMessage));
                  setLifecycleNotice("Review the previous request and run status before choosing Send. Nothing was automatically retried.");
                  requestAnimationFrame(() => composerRef.current?.focus());
                }}
                onOpenTerminal={visibleExecutionSessionId ? () => setExecutionTerminalOpen(true) : undefined}
                {...interruptedRun.traceProps}
                onResume={() => {
                  if (sendInFlightRef.current || cancelInFlightRef.current) return;
                  cancelAcknowledgedRunRef.current = null;
                  setCancelAcknowledgedRunId(null);
                  interruptedRun.resume();
                }}
                onFollowUp={(prompt) => { setInput(current => stageSafeRunRetry(current, prompt)); requestAnimationFrame(() => composerRef.current?.focus()); }}
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
                onDragOver={(event) => { if (chatMode !== "temporary") event.preventDefault(); }}
                onDrop={(event) => {
                  if (chatMode === "temporary") return;
                  event.preventDefault();
                  stageAttachmentFiles(event.dataTransfer.files);
                }}
              >
                {(mentionCandidates.length > 0 || commandCandidates.length > 0) && (
                  <div className="lios-chat-suggestion-menu absolute bottom-full left-0 right-0 mb-2 rounded-lg border border-border/70 bg-[#090909] p-1 shadow-xl">
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
                      <button type="button" disabled={busy} onClick={() => setFinanceInputOwner(financeOwner)} className="min-h-9 rounded border border-border/60 px-2 font-ui text-sm">Edit inputs</button>
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
                      {selectionActionsForChatMode(chatMode).map((action) => (
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
                {uploadingAttachment && <div role="status" aria-live="polite" className="border-b border-cyan-300/20 px-3 py-2 font-ui text-sm">
                  <p>{uploadingAttachment.progress.state === "verifying" ? "Verifying saved file" : "Uploading file"} {uploadingAttachment.index} of {uploadingAttachment.total}: {uploadingAttachment.fileName}</p>
                  <progress max={100} value={uploadingAttachment.progress.percent ?? undefined} aria-label="Attachment transfer progress" className="my-2 w-full" />
                  <p>Transfer progress is not confirmation of storage. The local file remains staged until the server confirms it.</p>
                </div>}
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
                            <button type="button" disabled={busy} onClick={() => removePendingAttachment(key)} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground" aria-label={`Remove ${file.name}`}><X className="h-3 w-3" /></button>
                          </span>
                        );
                      })}
                      {pendingAttachmentRefs.map((attachment) => (
                        <span key={attachment.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-300/15 bg-amber-300/[0.035] px-2.5 py-1 font-ui text-[11px] text-amber-100">
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="max-w-[220px] truncate">{attachment.fileName}</span>
                          <span className="shrink-0 font-terminal text-muted-foreground">{formatAttachmentSize(attachment.byteLength)} · saved</span>
                          <button type="button" disabled={busy} onClick={() => removePendingAttachment(attachment.id)} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground" aria-label={`Remove ${attachment.fileName}`}><X className="h-3 w-3" /></button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-1.5 font-terminal text-[10px] uppercase tracking-wider text-muted-foreground/80">
                      {pendingAttachmentFiles.length > 0
                        ? "Local files staged · not yet confirmed saved. Send uploads them to this Chat."
                        : "Server-confirmed attachment references staged for this Chat."}
                      {" "}{sourceScope === "web" ? "Web scope excludes file contents."
                        : !transmissionPolicy.allowResourceReferences ? "Current policy prevents sending file contents to AI."
                        : sourceScope === "files" ? "Files scope uses only explicitly attached files."
                        : "File contents may be sent only under the selected AI transmission policy."}
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
                  disabled={busy}
                  className="max-h-40 min-h-12 w-full resize-none bg-transparent px-4 pb-2 pt-3 font-ui text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/55 disabled:opacity-50"
                />
                <input
                  ref={attachmentInputRef}
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
                  <ChatSourcesControl scope={sourceScope} onScopeChange={updateSourceScope} onOpenConnections={onOpenEnvironment} disabled={busy} projectAvailable={chatMode !== "temporary"} />
                  {renderTerminalPanel && <ChatTerminalControl audience={audience} selected={terminalContext} onSelect={openTerminalPanel}/>}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button ref={composerToolsTrigger} type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.06] hover:text-foreground" aria-label="Tools">
                        <Plus className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top" className="w-64" onCloseAutoFocus={event => {
                      const dialog = pendingComposerDialog.current;
                      pendingComposerDialog.current = null;
                      if (!dialog) return;
                      // Match ObjectActionMenu: release its modal layer before opening another.
                      event.preventDefault();
                      composerToolsTrigger.current?.focus();
                      if (dialog === "workflow") setShowSaveWorkflow(true);
                      else setShowResourceForm(true);
                    }}>
                      <DropdownMenuItem
                        onSelect={() => {
                          attachmentInputRef.current?.click();
                        }}
                        disabled={busy || pendingAttachmentFiles.length + pendingAttachmentRefs.length >= 5 || chatMode === "temporary"}
                      >
                        <Paperclip className="h-4 w-4" /> Attach files
                      </DropdownMenuItem>
                      {chatMode === "project" && selection.projectId && (
                        <DropdownMenuItem onSelect={() => { pendingComposerDialog.current = "resource"; }}>
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
                            <DropdownMenuItem onSelect={() => { pendingComposerDialog.current = "workflow"; }}>Save workflow</DropdownMenuItem>
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
                    disabled={voiceProvidersQuery.isLoading || voiceRecorder.isTranscribing || busy}
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${voiceRecorder.isRecording ? "bg-red-400/10 text-red-200" : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"}`}
                    title={voiceInputHint}
                    aria-label={voiceInputAvailable ? (voiceRecorder.isRecording ? "Stop voice recording" : "Speak to LiOS") : "Set up voice input"}
                    aria-pressed={voiceRecorder.isRecording}
                  >
                    <Mic className="h-4 w-4" />
                  </button>
                  {busy && runtimeRequestId ? (
                    <button type="button" onClick={() => void cancelRuntime()}
                      disabled={cancelPending || cancelAcknowledgedRunId === runtimeRequestId}
                      className="inline-flex min-h-10 items-center rounded-full border border-amber-300/45 px-3 font-ui text-sm focus-visible:outline focus-visible:outline-2 disabled:opacity-45"
                      aria-label={cancelAcknowledgedRunId === runtimeRequestId ? "Stop requested" : cancelPending ? "Requesting Stop" : "Stop response"}>
                      {cancelAcknowledgedRunId === runtimeRequestId ? "Stop requested" : cancelPending ? "Requesting Stop…" : "Stop"}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void send()}
                      disabled={busy || (agentComposer.enabled && !agentComposer.ready) || (!input.trim() && pendingAttachmentFiles.length + pendingAttachmentRefs.length === 0)}
                      className="flex min-h-10 min-w-10 items-center justify-center rounded-full bg-amber-400 text-black focus-visible:outline focus-visible:outline-2 disabled:opacity-30"
                      aria-label="Send"><Send className="h-4 w-4" /></button>
                  )}
                </div>
                {(voiceRecorder.isRecording || voiceRecorder.isTranscribing) && <p role="status" className="px-4 pb-2 font-ui text-sm text-muted-foreground">{voiceRecorder.isRecording ? "Recording locally. Stop uploads the clip to LiOS Home for transcription." : "Transcribing the recorded clip in LiOS Home."} Review and edit the transcript before Send; provider pricing and quotas are not verified here.</p>}
                {voiceProvidersQuery.isError && <button type="button" onClick={() => void voiceProvidersQuery.refetch()} className="mx-4 mb-2 min-h-10 text-sm underline">Retry voice provider status</button>}
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
            {chatMode === "temporary" && temporaryTerminal && <aside aria-label="Temporary terminal Artifact" className="lios-artifact-sidecar lios-temporary-terminal-sidecar w-[48%] overflow-auto border-l p-3"><button type="button" className="min-h-10" onClick={() => { focusComposerAfterTerminalCloseRef.current = true; setTemporaryTerminal(null); }}>Close terminal Artifact</button><TerminalScreenArtifact key={temporaryTerminal.view} content={temporaryTerminal} revision={1} onSave={async content => { if (content.kind === "screen") setTemporaryTerminal(content); }} ephemeral/></aside>}
            {conversationArtifactRef && chatMode !== "temporary" && selection.chatId && (
              <ConversationArtifactSidecar focus={artifactFocusMode}
                    onEnterFocus={() => setArtifactFocusMode(true)}
                    onExitFocus={() => { setArtifactFocusMode(false); requestAnimationFrame(() => reopenArtifactFocusRef.current?.focus()); }}
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
                    <label className="min-w-0 text-xs text-muted-foreground">
                      <span className="sr-only">Context mode for {resource.label}</span>
                      <select value={resource.contextMode} disabled={contextUpdateBusy} onChange={event => void reviewResourceContext(resource, event.target.value as ProjectResourceContextMode)} className="min-h-10 max-w-full rounded border border-border bg-background px-2 py-1">
                        {PROJECT_RESOURCE_CONTEXT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
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
