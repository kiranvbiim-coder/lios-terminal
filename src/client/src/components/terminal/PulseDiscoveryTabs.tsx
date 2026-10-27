/**
 * Adapted from beUI's accessible spring-indicator Tabs family:
 * starc007/ui-components@41a330ba66684696c445d58ca5d77c0133d4059a
 * components/motion/tabs.tsx (blob ed65ffad1ea648850ce29a874ea6eee28d032896).
 * MIT © 2026 Saurabh Chauhan. Complete grant:
 * third_party/licenses/beui-MIT.txt.
 *
 * Retains beUI's keyboard-selection, controlled ownership and restrained
 * shared-layout indicator patterns. Uses LiOS's existing React 18, Framer
 * Motion, Tailwind 3 and channel callback. No alternate feed/router/store.
 */
import * as React from "react";
import { useId, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";

export type PulseChannel = "for_you" | "following" | "markets" | "research";

export const PULSE_DISCOVERY_CHANNELS: ReadonlyArray<{ id: PulseChannel; label: string; description: string }> = [
  { id: "for_you", label: "For You", description: "Recommended intelligence" },
  { id: "following", label: "Following", description: "Your followed subjects" },
  { id: "markets", label: "Markets", description: "Recorded market changes" },
  { id: "research", label: "Research", description: "Research developments" },
];

export function nextPulseChannel(current: PulseChannel, key: string, rtl = false): PulseChannel | null {
  const order = PULSE_DISCOVERY_CHANNELS.map(channel => channel.id);
  const index = order.indexOf(current);
  if (index < 0) return null;
  const forward = rtl ? "ArrowLeft" : "ArrowRight";
  const backward = rtl ? "ArrowRight" : "ArrowLeft";
  if (key === "Home") return order[0];
  if (key === "End") return order[order.length - 1];
  if (key === forward) return order[(index + 1) % order.length];
  if (key === backward) return order[(index + order.length - 1) % order.length];
  return null;
}

/** Accessible segmented control: content remains in its existing LIOS section. */
export function PulseDiscoveryTabs({ channel, onChange }: {
  channel: PulseChannel;
  onChange: (channel: PulseChannel) => void;
}) {
  const id = useId();
  const reduceMotion = useReducedMotion();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    const origin = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-pulse-channel]');
    if (!origin || !event.currentTarget.contains(origin)) return;
    const value = origin.dataset.pulseChannel as PulseChannel;
    const rtl = typeof window !== "undefined" && window.getComputedStyle(event.currentTarget).direction === "rtl";
    const next = nextPulseChannel(value, event.key, rtl);
    if (!next) return;
    event.preventDefault();
    onChange(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`button[data-pulse-channel="${next}"]`)?.focus();
  };
  return (
    <div className="min-w-0 max-w-full overflow-x-auto pb-1 [scrollbar-width:thin]">
      <div role="group" aria-label="Pulse discovery channels" onKeyDown={onKeyDown}
        className="flex w-max min-w-full items-center gap-1 rounded-xl border border-border/60 bg-card/50 p-1 sm:w-fit">
        {PULSE_DISCOVERY_CHANNELS.map(item => {
          const active = item.id === channel;
          return (
            <button key={item.id} type="button" data-pulse-channel={item.id}
              aria-pressed={active} aria-label={`${item.label}: ${item.description}`}
              onClick={() => onChange(item.id)}
              className={`relative isolate inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 sm:px-4 ${
                active ? "text-amber-100" : "text-muted-foreground hover:text-foreground"
              }`}>
              {active && <motion.span layoutId={id + "-indicator"} initial={false}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 245, damping: 36, mass: 1.2 }}
                aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 rounded-lg border border-amber-300/40 bg-amber-300/[0.085]" />}
              <span className="relative">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
