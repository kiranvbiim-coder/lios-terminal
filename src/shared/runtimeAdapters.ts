import type {
  ArtifactEnvelope,
  PluginManifest,
  AgentAdapter,
  BacktestEngineAdapter,
  FinanceEngineAdapter,
  PermissionPolicyAdapter,
  RuntimeAdapter,
  RuntimeExecutionContext,
  RuntimeHealthReport,
  RuntimeJob,
  ToolAdapter,
  WorkspaceSessionEnvelope,
} from "./runtimeContracts";

export interface AIProviderInvocation {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model?: string;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  tools?: Array<{ id: string; description?: string; inputSchema?: Record<string, unknown> }>;
}

export interface AIProviderInvocationResult {
  text: string;
  model: string;
  toolCalls?: Array<{ toolId: string; arguments: Record<string, unknown> }>;
  usage?: { inputTokens?: number; outputTokens?: number };
  providerReceiptRef?: string;
}

export interface AIProviderAdapter extends RuntimeAdapter {
  invokeAI: (
    request: AIProviderInvocation,
    context: RuntimeExecutionContext,
  ) => Promise<AIProviderInvocationResult>;
}

export interface CanonicalDataRequest {
  capability: string;
  entityRef?: string | null;
  datasetRef?: string | null;
  fields?: string[];
  startDate?: string | null;
  endDate?: string | null;
  asKnownOn?: string | null;
  frequency?: string | null;
  parameters?: Record<string, unknown>;
}

export interface CanonicalDataResult {
  capability: string;
  providerId: string;
  dataRef: string;
  asOf: string | null;
  retrievedAt: string;
  pointInTimeVerified: boolean;
  warnings: string[];
}

export interface DataProviderAdapter extends RuntimeAdapter {
  queryData: (
    request: CanonicalDataRequest,
    context: RuntimeExecutionContext,
  ) => Promise<CanonicalDataResult>;
}

export interface ConnectorResource {
  id: string;
  name: string;
  kind: string;
  metadata?: Record<string, unknown>;
}

export interface ConnectorQuery {
  resourceId?: string;
  operation: string;
  arguments?: Record<string, unknown>;
}

export interface ConnectorAdapter extends RuntimeAdapter {
  connect?: (context: RuntimeExecutionContext) => Promise<void>;
  disconnect?: (context: RuntimeExecutionContext) => Promise<void>;
  discover?: (context: RuntimeExecutionContext) => Promise<ConnectorResource[]>;
  query?: (request: ConnectorQuery, context: RuntimeExecutionContext) => Promise<unknown>;
  stream?: (
    request: ConnectorQuery,
    context: RuntimeExecutionContext,
  ) => AsyncIterable<unknown>;
}

export interface ArtifactRendererAdapter extends RuntimeAdapter {
  supports: (artifact: ArtifactEnvelope) => boolean;
}

export interface WorkspacePanelRequest {
  panelId: string;
  artifactId?: string | number | null;
  title?: string | null;
  symbol?: string | null;
  placement?: "primary" | "secondary" | "tab" | "floating";
  focus?: boolean;
}

export interface WorkspaceAdapter extends RuntimeAdapter {
  openPanel: (request: WorkspacePanelRequest, context: RuntimeExecutionContext) => Promise<void> | void;
  closePanel: (panelId: string, context: RuntimeExecutionContext) => Promise<void> | void;
  focusPanel: (panelId: string, context: RuntimeExecutionContext) => Promise<void> | void;
  snapshot: (
    context: RuntimeExecutionContext,
  ) => Promise<WorkspaceSessionEnvelope> | WorkspaceSessionEnvelope;
  restore: (
    state: WorkspaceSessionEnvelope,
    context: RuntimeExecutionContext,
  ) => Promise<void> | void;
}

export interface JobSubmission {
  kind: string;
  componentId: string;
  payload: Record<string, unknown>;
  cancellable?: boolean;
}

export interface JobRuntimeAdapter extends RuntimeAdapter {
  submit: (job: JobSubmission, context: RuntimeExecutionContext) => Promise<RuntimeJob>;
  status: (jobId: string, context: RuntimeExecutionContext) => Promise<RuntimeJob>;
  cancel: (jobId: string, context: RuntimeExecutionContext) => Promise<RuntimeJob>;
}

export interface PluginRuntimeAdapter extends RuntimeAdapter {
  manifest: PluginManifest;
  activate: (context: RuntimeExecutionContext) => Promise<void>;
  deactivate: (context: RuntimeExecutionContext) => Promise<void>;
  health?: () => Promise<RuntimeHealthReport> | RuntimeHealthReport;
}

/**
 * P0 deliberately keeps these adapters capability-oriented rather than tied
 * to any donor library. Later TradingAgents/Backtest Kit/LangAlpha/Dockview
 * adapters can implement them without leaking upstream internal types into
 * Project, Session, Artifact or Ledger persistence.
 */
export type LiOSReplaceableRuntimeAdapter =
  | AIProviderAdapter
  | DataProviderAdapter
  | ConnectorAdapter
  | ToolAdapter
  | AgentAdapter
  | ArtifactRendererAdapter
  | BacktestEngineAdapter
  | FinanceEngineAdapter
  | WorkspaceAdapter
  | JobRuntimeAdapter
  | PermissionPolicyAdapter
  | PluginRuntimeAdapter;
