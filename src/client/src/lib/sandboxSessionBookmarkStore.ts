type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PREFIX = "lios.sandbox-session.v1.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function key(projectId: number, chatId: number): string {
  if (!Number.isSafeInteger(projectId) || projectId < 1 || !Number.isSafeInteger(chatId) || chatId < 1) {
    throw new Error("Sandbox session bookmarks require a Project and Chat.");
  }
  return `${PREFIX}${projectId}.${chatId}`;
}

/** Stores only the server-issued UUID; ownership and history remain server-authoritative. */
export function saveSandboxSessionBookmark(
  projectId: number,
  chatId: number,
  sessionId: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage || !UUID.test(sessionId)) return;
  try {
    storage.setItem(key(projectId, chatId), sessionId);
  } catch {
    // Local storage is only a convenience; the encrypted server journal remains authoritative.
  }
}

/** Returns an untrusted bookmark for an owner-scoped server read; malformed values are discarded. */
export function loadSandboxSessionBookmark(
  projectId: number,
  chatId: number,
  storage: StorageLike | null = defaultStorage(),
): string | null {
  if (!storage) return null;
  let storageKey: string;
  try {
    storageKey = key(projectId, chatId);
  } catch {
    return null;
  }
  try {
    const value = storage.getItem(storageKey);
    if (!value) return null;
    if (!UUID.test(value)) {
      storage.removeItem(storageKey);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}
