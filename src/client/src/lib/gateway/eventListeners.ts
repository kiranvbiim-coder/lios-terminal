// Adapted from OpenClaw packages/gateway-client/src/event-listeners.ts (MIT, commit c074824a27c96d3983043f9eeb33823cd1772d8c), Copyright (c) 2026 OpenClaw Foundation.

interface ListenerEntry<T> {
  fn: (payload: T) => void;
  active: boolean;
}

/** Listener set whose disposers are bound to one registration, so a stale disposer cannot affect a later one. */
export class ListenerSet<T> {
  private entries: ListenerEntry<T>[] = [];

  constructor(private readonly onError?: (error: unknown) => void) {}

  get size(): number {
    return this.entries.length;
  }

  add(fn: (payload: T) => void): () => void {
    const entry: ListenerEntry<T> = { fn, active: true };
    this.entries = [...this.entries, entry];
    return () => {
      if (!entry.active) return;
      entry.active = false;
      this.entries = this.entries.filter((candidate) => candidate !== entry);
    };
  }

  emit(payload: T): void {
    for (const entry of this.entries) {
      if (!entry.active) continue;
      try {
        entry.fn(payload);
      } catch (error) {
        this.onError?.(error);
      }
    }
  }
}

/** Listener sets keyed by event name. */
export class EventListeners<T> {
  private readonly sets = new Map<string, ListenerSet<T>>();

  constructor(private readonly onError?: (error: unknown) => void) {}

  add(event: string, fn: (payload: T) => void): () => void {
    let set = this.sets.get(event);
    if (!set) {
      set = new ListenerSet<T>(this.onError);
      this.sets.set(event, set);
    }
    return set.add(fn);
  }

  emit(event: string, payload: T): void {
    this.sets.get(event)?.emit(payload);
  }
}
