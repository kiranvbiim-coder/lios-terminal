/**
 * Dependency Graph -- a multi-hop upgrade over the audit bar's existing
 * precedents/dependents lists, which only ever showed ONE hop from the
 * selected cell. This walks the precedent and dependent chains breadth-
 * first out to a fixed depth in each direction, grouping nodes by how many
 * hops they are from the center, and also collects every real edge among
 * the nodes that ended up in view -- including "skip" edges where a node
 * two hops back also feeds the center directly, not just through the
 * one-hop node -- so a caller can render an honest picture of the local
 * dependency structure, not just two disconnected node lists.
 */
import type { SpreadsheetGrid } from "./spreadsheetEngine";

export interface GraphNode {
  ref: string;
  hasError: boolean;
}

export interface GraphEdge {
  from: string; // precedent side -- "from feeds into to"
  to: string;
}

export interface DependencyGraphResult {
  center: string;
  precedentLayers: GraphNode[][]; // index 0 = one hop back, index 1 = two hops back, ...
  dependentLayers: GraphNode[][]; // index 0 = one hop forward, ...
  edges: GraphEdge[];
}

function bfsLayers(
  centerRef: string,
  depth: number,
  getNeighbors: (ref: string) => string[],
): { layers: string[][]; visited: Set<string> } {
  const layers: string[][] = [];
  const visited = new Set([centerRef]);
  let frontier = [centerRef];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const ref of frontier) {
      for (const n of getNeighbors(ref)) {
        if (!visited.has(n)) { visited.add(n); next.push(n); }
      }
    }
    if (next.length === 0) break;
    layers.push(next.sort());
    frontier = next;
  }
  return { layers, visited };
}

export function buildDependencyGraph(grid: SpreadsheetGrid, centerRef: string, depth = 2): DependencyGraphResult {
  const precedents = bfsLayers(centerRef, depth, (ref) => grid.getPrecedents(ref));
  const dependents = bfsLayers(centerRef, depth, (ref) => grid.getDependents(ref));

  const included = new Set<string>([centerRef, ...Array.from(precedents.visited), ...Array.from(dependents.visited)]);

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  included.forEach((ref) => {
    for (const dep of grid.getDependents(ref)) {
      if (included.has(dep)) {
        const key = `${ref}->${dep}`;
        if (!seen.has(key)) { seen.add(key); edges.push({ from: ref, to: dep }); }
      }
    }
  });

  const toNodes = (layers: string[][]): GraphNode[][] =>
    layers.map((layer) => layer.map((ref) => ({ ref, hasError: !!grid.getCell(ref).error })));

  return {
    center: centerRef,
    precedentLayers: toNodes(precedents.layers),
    dependentLayers: toNodes(dependents.layers),
    edges,
  };
}
