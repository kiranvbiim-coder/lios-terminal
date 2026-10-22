// Fenced code is plain text: never execute or HTML-render code from a model answer.
import * as React from "react";
import { useEffect, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

interface Props {
  code: string;
  language?: string | null;
  /** Do not offer a misleading copy of code that has not finished streaming. */
  streaming?: boolean;
}

/** A failed/unsupported clipboard write must never be reported as a success. */
export async function copyChatCode(
  writeText: ((text: string) => Promise<void>) | undefined,
  code: string,
): Promise<boolean> {
  if (!writeText) return false;
  try {
    await writeText(code);
    return true;
  } catch {
    return false;
  }
}

export default function ChatCodeBlock({ code, language, streaming = false }: Props) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  useEffect(() => { setCopyState("idle"); }, [code, language, streaming]);

  const name = language?.trim() || "Code";
  const onCopy = async () => {
    if (streaming) return;
    const writeText = typeof navigator !== "undefined" && navigator.clipboard?.writeText
      ? (value: string) => navigator.clipboard.writeText(value)
      : undefined;
    setCopyState((await copyChatCode(writeText, code)) ? "copied" : "failed");
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border/60 bg-black/40" data-chat-code-block="true">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/50 bg-white/[0.035] px-3 py-1.5">
        <span className="font-terminal text-[12px] text-muted-foreground">{name}</span>
        <button
          type="button"
          disabled={streaming}
          aria-label={streaming ? "Copy code after the answer finishes" : `Copy ${name} code`}
          onClick={() => { void onCopy(); }}
          className="inline-flex min-h-8 items-center justify-center rounded-md border border-border/70 px-3 py-1 font-ui text-[12px] text-foreground hover:border-cyan-300/50 hover:bg-cyan-300/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="chat-code-copy"
        >
          {streaming ? "Generating…" : copyState === "copied" ? "Copied" : "Copy code"}
        </button>
      </div>
      <pre
        tabIndex={0}
        aria-label={language ? `${language} code` : "Code"}
        className="overflow-x-auto p-3 font-terminal text-[13px] leading-5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
      >
        <code data-language={language ?? undefined}>{code}</code>
      </pre>
      {copyState === "failed" && (
        <p role="alert" className="px-3 pb-2 font-ui text-[12px] text-amber-200">
          Clipboard unavailable. Select the code above and copy it manually.
        </p>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {copyState === "copied" ? "Code copied to clipboard" : ""}
      </span>
    </div>
  );
}
