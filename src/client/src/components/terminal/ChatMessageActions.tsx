// Assistant and user message actions are deliberate; no implicit model calls or stored feedback.
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Copy, CornerDownLeft } from "lucide-react";
import { visibleChatMessageText, copyChatMessageText, type ChatMessageRole } from "@/lib/chatMessageActions";

interface Props {
  content: string;
  role: ChatMessageRole;
  messageId?: string | number;
  /** Composer-only action. The caller must not auto-send this message. */
  onQuote?: () => void;
}

type CopyState = "idle" | "copying" | "copied" | "failed";

export default function ChatMessageActions({ content, role, messageId, onQuote }: Props) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const identity = `${role}:${messageId ?? "unsaved"}:${content}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const copyInFlightRef = useRef<string | null>(null);
  useEffect(() => { setCopyState("idle"); }, [content, role, messageId]);

  const visible = visibleChatMessageText(content, role);
  if (!visible.trim()) return null;
  const copy = async () => {
    // Ref mutex acquires synchronously before React renders a disabled button.
    if (copyInFlightRef.current === identity) return;
    copyInFlightRef.current = identity;
    setCopyState("copying");
    const writeText = typeof navigator !== "undefined" && navigator.clipboard?.writeText
      ? (value: string) => navigator.clipboard.writeText(value)
      : undefined;
    const succeeded = await copyChatMessageText(writeText, visible);
    if (identityRef.current === identity) setCopyState(succeeded ? "copied" : "failed");
    if (copyInFlightRef.current === identity) copyInFlightRef.current = null;
  };
  const buttonClass = "inline-flex min-h-10 items-center gap-1.5 rounded-md border border-transparent px-2 py-1 font-ui text-[12px] text-muted-foreground hover:border-border/70 hover:bg-white/[0.045] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:cursor-wait disabled:opacity-55";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/30 pt-1.5" role="group" aria-label={role === "assistant" ? "LiOS answer actions" : "Your message actions"} data-testid="chat-message-actions">
      <button
        type="button"
        onClick={() => { void copy(); }}
        disabled={copyState === "copying"}
        aria-label={role === "assistant" ? "Copy LiOS answer" : "Copy your message"}
        className={buttonClass}
        data-testid="chat-message-copy"
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        {copyState === "copying" ? "Copying…" : copyState === "copied" ? "Copied" : "Copy"}
      </button>
      {role === "assistant" && onQuote && (
        <button
          type="button"
          onClick={onQuote}
          aria-label="Quote LiOS answer in your next message"
          className={buttonClass}
          data-testid="chat-message-quote"
        >
          <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Quote to follow up
        </button>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {copyState === "copied" ? "Message copied to clipboard" : ""}
      </span>
      {copyState === "failed" && (
        <span role="alert" className="font-ui text-[12px] text-amber-200">Clipboard unavailable. Select the message and copy manually.</span>
      )}
    </div>
  );
}
