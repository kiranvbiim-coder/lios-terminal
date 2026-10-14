/**
 * Durable Wave D user state.
 *
 * Wave D objects are intentionally kept under the existing tenant-scoped
 * persona-preference JSON document until their domain-specific tables are
 * introduced.  This gives Signals, theses, Event Rooms, reports and
 * communication connection metadata a real durable home now, while keeping
 * credentials out of the document and preserving the existing RLS boundary.
 */
import { eq } from "drizzle-orm";
import { userPersonaPreferences } from "@shared/schema";
import type {
  CommunicationConnectionRecord,
  LivingReportRecord,
  LivingThesisRecord,
  StoredEventRoom,
  StoredSignalRule,
  PulseCardDraft,
} from "@shared/waveDContracts";
import type {
  AnalyticalMemoryRecord,
  DecisionJournalEntry,
  NotificationEnvelope,
  ScheduledMonitor,
  ThesisImpactLink,
} from "@shared/waveDAdvancedContracts";
import type { PersonaPreferenceUser } from "./personaPreferenceService";
import { withUserTransaction } from "./tenantDb";

const MAX_STATE_BYTES = 48_000;

export interface WaveDStoredState {
  pulseCards: PulseCardDraft[];
  signalRules: StoredSignalRule[];
  theses: LivingThesisRecord[];
  eventRooms: StoredEventRoom[];
  reports: LivingReportRecord[];
  communications: CommunicationConnectionRecord[];
  scheduledMonitors: ScheduledMonitor[];
  impactLinks: ThesisImpactLink[];
  memory: AnalyticalMemoryRecord[];
  journal: DecisionJournalEntry[];
  notifications: NotificationEnvelope[];
  inboxStatuses: Record<string, "open" | "snoozed" | "resolved">;
  updatedAt: string | null;
}

const EMPTY_STATE: WaveDStoredState = {
  pulseCards: [],
  signalRules: [],
  theses: [],
  eventRooms: [],
  reports: [],
  communications: [],
  scheduledMonitors: [],
  impactLinks: [],
  memory: [],
  journal: [],
  notifications: [],
  inboxStatuses: {},
  updatedAt: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeState(value: unknown): WaveDStoredState {
  if (!isRecord(value)) return { ...EMPTY_STATE };
  const statuses = isRecord(value.inboxStatuses) ? Object.fromEntries(Object.entries(value.inboxStatuses).filter(([, status]) => status === "open" || status === "snoozed" || status === "resolved")) as WaveDStoredState["inboxStatuses"] : {};
  const state: WaveDStoredState = {
    pulseCards: Array.isArray(value.pulseCards) ? value.pulseCards.filter(isRecord) as unknown as PulseCardDraft[] : [],
    signalRules: Array.isArray(value.signalRules) ? value.signalRules.filter(isRecord) as unknown as StoredSignalRule[] : [],
    theses: Array.isArray(value.theses) ? value.theses.filter(isRecord) as unknown as LivingThesisRecord[] : [],
    eventRooms: Array.isArray(value.eventRooms) ? value.eventRooms.filter(isRecord) as unknown as StoredEventRoom[] : [],
    reports: Array.isArray(value.reports) ? value.reports.filter(isRecord) as unknown as LivingReportRecord[] : [],
    communications: Array.isArray(value.communications) ? value.communications.filter(isRecord) as unknown as CommunicationConnectionRecord[] : [],
    scheduledMonitors: Array.isArray(value.scheduledMonitors) ? value.scheduledMonitors.filter(isRecord) as unknown as ScheduledMonitor[] : [],
    impactLinks: Array.isArray(value.impactLinks) ? value.impactLinks.filter(isRecord) as unknown as ThesisImpactLink[] : [],
    memory: Array.isArray(value.memory) ? value.memory.filter(isRecord) as unknown as AnalyticalMemoryRecord[] : [],
    journal: Array.isArray(value.journal) ? value.journal.filter(isRecord) as unknown as DecisionJournalEntry[] : [],
    notifications: Array.isArray(value.notifications) ? value.notifications.filter(isRecord) as unknown as NotificationEnvelope[] : [],
    inboxStatuses: statuses,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
  return state;
}

function boundedState(state: WaveDStoredState): WaveDStoredState {
  const next = {
    ...state,
    pulseCards: state.pulseCards.slice(-200),
    signalRules: state.signalRules.slice(-100),
    theses: state.theses.slice(-50),
    eventRooms: state.eventRooms.slice(-100),
    reports: state.reports.slice(-50),
    communications: state.communications.slice(-20),
    scheduledMonitors: state.scheduledMonitors.slice(-100),
    impactLinks: state.impactLinks.slice(-100),
    memory: state.memory.slice(-100),
    journal: state.journal.slice(-100),
    notifications: state.notifications.slice(-100),
  } satisfies WaveDStoredState;
  if (Buffer.byteLength(JSON.stringify(next), "utf8") <= MAX_STATE_BYTES) return next;
  // Keep the newest user-authored objects when a caller attempts to exceed
  // the preference document's existing 64 KiB database constraint.
  return { ...next, pulseCards: next.pulseCards.slice(-100), eventRooms: next.eventRooms.slice(-20), reports: next.reports.slice(-15), theses: next.theses.slice(-15), signalRules: next.signalRules.slice(-35), memory: next.memory.slice(-50), journal: next.journal.slice(-50), notifications: next.notifications.slice(-50) };
}

export async function getWaveDState(user: PersonaPreferenceUser): Promise<WaveDStoredState> {
  return withUserTransaction({ userId: user.id, organizationId: user.organizationId, role: user.role }, async (tx) => {
    const [row] = await tx.select({ preferences: userPersonaPreferences.preferences })
      .from(userPersonaPreferences)
      .where(eq(userPersonaPreferences.userId, user.id))
      .limit(1);
    const preferences = isRecord(row?.preferences) ? row.preferences : {};
    return normalizeState(preferences.waveD);
  });
}

export async function updateWaveDState(user: PersonaPreferenceUser, update: (current: WaveDStoredState) => WaveDStoredState): Promise<WaveDStoredState> {
  return withUserTransaction({ userId: user.id, organizationId: user.organizationId, role: user.role }, async (tx) => {
    const [row] = await tx.select().from(userPersonaPreferences)
      .where(eq(userPersonaPreferences.userId, user.id))
      .limit(1);
    const currentPreferences = isRecord(row?.preferences) ? row.preferences : {};
    const current = normalizeState(currentPreferences.waveD);
    const next = boundedState({ ...update(current), updatedAt: new Date().toISOString() });
    const preferences = { ...currentPreferences, waveD: next };
    if (row) {
      await tx.update(userPersonaPreferences).set({ preferences, updatedAt: new Date() }).where(eq(userPersonaPreferences.userId, user.id));
    } else {
      await tx.insert(userPersonaPreferences).values({ userId: user.id, organizationId: user.organizationId, preferences });
    }
    return next;
  });
}

export function personaPreferenceUser(reqUser: { id: number; email: string; role: PersonaPreferenceUser["role"]; organizationId: number | null }): PersonaPreferenceUser {
  return { id: reqUser.id, email: reqUser.email, role: reqUser.role, organizationId: reqUser.organizationId };
}
