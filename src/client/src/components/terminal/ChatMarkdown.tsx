// Direct node:tsx/server-rendered tests use the classic JSX transform.
import * as React from "react";
import { useMemo, useState } from "react";
import ChatCodeBlock from "./ChatCodeBlock";
import ChatTableBlock from "./ChatTableBlock";
import {
  parseChatMarkdown,
  resolveCitation,
  safeHref,
  type Block,
  type ChatCitationSource,
  type Inline,
} from "@/lib/chatMarkdown";

interface ChatMarkdownProps {
  /** Raw assistant text. Machine directives are stripped here; nothing is ever injected as HTML. */
  text: string;
  /** True while the answer is still streaming: partial markup is tolerated without flicker. */
  streaming?: boolean;
  /** Real sources of this answer's run. Citation markers only become affordances when they match one. */
  sources?: readonly ChatCitationSource[];
  /** Optional hook so the host can reveal the source (for example in a source pane). */
  onCitationSelect?: (source: ChatCitationSource) => void;
}

const LINK_CLASS = "text-cyan-200 underline decoration-cyan-200/40 underline-offset-2 hover:decoration-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 rounded-sm";
const CITE_CLASS = "mx-0.5 inline-flex min-h-8 items-center rounded border border-cyan-300/30 bg-cyan-300/[0.06] px-1 align-baseline font-terminal text-[12px] leading-none text-cyan-100 hover:bg-cyan-300/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60";
const HEADING_CLASS: Record<number, string> = {
  1: "mt-4 mb-2 text-[20px] font-semibold leading-7",
  2: "mt-4 mb-2 text-[17px] font-semibold leading-6",
  3: "mt-3 mb-1.5 text-[15px] font-semibold leading-6",
  4: "mt-3 mb-1 text-[14px] font-semibold leading-6",
  5: "mt-2 mb-1 text-[14px] font-semibold leading-6",
  6: "mt-2 mb-1 text-[14px] font-medium leading-6 text-muted-foreground",
};

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith("http");
  return (
    <a href={href} className={LINK_CLASS} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : { rel: "noopener noreferrer" })}>
      {children}
    </a>
  );
}

function CitationChip({ number, source, onSelect }: { number: number; source: ChatCitationSource; onSelect?: (source: ChatCitationSource) => void }) {
  const [open, setOpen] = useState(false);
  const label = `Source ${number}: ${source.label}`;
  const href = source.href ? safeHref(source.href) : null;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={CITE_CLASS} aria-label={label} title={label} data-citation={number}>
        [{number}]
      </a>
    );
  }
  return (
    <>
      <button
        type="button"
        className={CITE_CLASS}
        aria-label={label}
        aria-expanded={open}
        title={label}
        data-citation={number}
        onClick={() => {
          setOpen((current) => !current);
          onSelect?.(source);
        }}
      >
        [{number}]
      </button>
      {open && <span role="note" className="mx-1 rounded bg-white/[0.06] px-1.5 py-0.5 font-ui text-[12px] text-muted-foreground">{source.label}</span>}
    </>
  );
}

function renderInline(nodes: readonly Inline[], sources: readonly ChatCitationSource[], onSelect?: (source: ChatCitationSource) => void): React.ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.t) {
      case "text": return <React.Fragment key={index}>{node.v}</React.Fragment>;
      case "br": return <br key={index} />;
      case "strong": return <strong key={index} className="font-semibold">{renderInline(node.c, sources, onSelect)}</strong>;
      case "em": return <em key={index}>{renderInline(node.c, sources, onSelect)}</em>;
      case "del": return <del key={index}>{renderInline(node.c, sources, onSelect)}</del>;
      case "code": return <code key={index} className="rounded bg-white/[0.08] px-1 py-0.5 font-terminal text-[13px]">{node.v}</code>;
      case "link": return <ExternalLink key={index} href={node.href}>{renderInline(node.c, sources, onSelect)}</ExternalLink>;
      case "cite": {
        const resolved = resolveCitation(node, sources);
        if (!resolved) return <React.Fragment key={index}>{node.raw}</React.Fragment>;
        return (
          <React.Fragment key={index}>
            {resolved.map(({ number, source }) => <CitationChip key={number} number={number} source={source} onSelect={onSelect} />)}
          </React.Fragment>
        );
      }
    }
  });
}

function renderBlocks(blocks: readonly Block[], sources: readonly ChatCitationSource[], onSelect: ((source: ChatCitationSource) => void) | undefined, tight = false, streaming = false): React.ReactNode[] {
  return blocks.map((block, index) => {
    switch (block.t) {
      case "heading": {
        const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
        return <Tag key={index} className={`font-ui text-foreground ${HEADING_CLASS[block.level]}`}>{renderInline(block.c, sources, onSelect)}</Tag>;
      }
      case "p":
        return tight
          ? <span key={index} className="block">{renderInline(block.c, sources, onSelect)}</span>
          : <p key={index} className="my-2 first:mt-0 last:mb-0">{renderInline(block.c, sources, onSelect)}</p>;
      case "code":
        return <ChatCodeBlock key={index} code={block.v} language={block.lang} streaming={streaming} />;
      case "list": {
        const items = block.items.map((item, itemIndex) => <li key={itemIndex} className="pl-1">{renderBlocks(item, sources, onSelect, true, streaming)}</li>);
        return block.ordered
          ? <ol key={index} start={block.start} className="my-2 list-decimal space-y-1 pl-6">{items}</ol>
          : <ul key={index} className="my-2 list-disc space-y-1 pl-6">{items}</ul>;
      }
      case "quote":
        return <blockquote key={index} className="my-2 border-l-2 border-amber-300/40 pl-3 text-muted-foreground">{renderBlocks(block.c, sources, onSelect, false, streaming)}</blockquote>;
      case "table":
        return (
          <ChatTableBlock
            key={index}
            table={block}
            streaming={streaming}
            renderCell={cell => renderInline(cell, sources, onSelect)}
          />
        );
      case "hr":
        return <hr key={index} className="my-3 border-border/50" />;
    }
  });
}

const NO_SOURCES: readonly ChatCitationSource[] = [];

/**
 * Safe semantic Markdown for assistant chat text. Builds React elements only: no HTML passthrough, no images,
 * links limited to http(s)/mailto. The same path renders saved and streaming answers.
 */
export default function ChatMarkdown({ text, streaming = false, sources = NO_SOURCES, onCitationSelect }: ChatMarkdownProps) {
  const blocks = useMemo(() => parseChatMarkdown(text, { streaming }), [text, streaming]);
  if (!blocks.length) return null;
  return (
    <div className="lios-chat-markdown break-words font-ui text-[14px] leading-6 text-foreground" data-chat-markdown="true" aria-busy={streaming || undefined}>
      {renderBlocks(blocks, sources, onCitationSelect, false, streaming)}
    </div>
  );
}
