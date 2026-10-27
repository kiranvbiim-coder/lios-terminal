import * as React from "react";
import type { CrossDomainNode, CrossDomainNodeDomain } from "@/lib/terminalCrossDomainGraph";

const DOMAIN: Record<CrossDomainNodeDomain, string> = {
  finance: "Finance", market: "Market", macro: "Macro", policy: "Policy",
  "supply-chain": "Supply chain", sustainability: "Sustainability",
  portfolio: "Portfolio", research: "Research",
};

/**
 * A keyboard-operable alternative to the wide visual canvas at narrow sizes.
 * This uses the same bounded, already-filtered recorded nodes, selection and
 * inspector; it does not infer links or load additional data.
 */
export function GraphExplorerCompactList({
  nodes, selectedId, onSelect, emptyMessage,
}: {
  nodes: readonly CrossDomainNode[];
  selectedId: string | null;
  onSelect: (objectId: string) => void;
  emptyMessage: string;
}) {
  return (
    <section className="space-y-3 p-3 md:hidden" aria-label="Compact Intelligence Graph">
      <p className="font-ui text-xs leading-5 text-muted-foreground">
        Select a recorded object to inspect its sources and direct links below. Domain labels group the display, not verified exposures.
      </p>
      {nodes.length ? (
        <ol className="grid gap-2" aria-label="Recorded graph objects">
          {nodes.map(node => (
            <li key={node.objectId}>
              <button type="button" aria-pressed={selectedId === node.objectId}
                aria-label={`Inspect ${node.label} in ${DOMAIN[node.domain]}`}
                onClick={() => onSelect(node.objectId)}
                className={`min-h-14 w-full rounded-xl border p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 ${
                  selectedId === node.objectId
                    ? "border-amber-300/60 bg-amber-300/[0.07]"
                    : "border-border/65 bg-card/70 hover:border-amber-300/35"
                }`}>
                <span className="block font-ui text-xs font-medium text-cyan-200">{DOMAIN[node.domain]}</span>
                <span className="mt-1 block break-words font-ui text-sm font-semibold text-foreground">{node.label}</span>
                {node.symbol && <span className="mt-1 block font-ui text-xs text-amber-200">{node.symbol}</span>}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p role="status" className="rounded-lg border border-dashed border-border/60 p-5 text-center font-ui text-sm text-muted-foreground">{emptyMessage}</p>
      )}
    </section>
  );
}
