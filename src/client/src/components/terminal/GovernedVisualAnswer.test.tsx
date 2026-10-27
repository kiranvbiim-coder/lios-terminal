import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GovernedVisualAnswer } from "./GovernedVisualAnswer";

const request={
  artifactId:"artifact:00000000-0000-4000-8000-000000000025",
  version:3,projectId:42,kind:"chart" as const,sourceRefs:["official:filing"],
};
test("Chat saved-visual control stays collapsed, with no invented points, network or auto execution during SSR",()=>{
  const markup=renderToStaticMarkup(React.createElement(GovernedVisualAnswer,{request}));
  assert.match(markup,/data-testid="governed-chat-visual-answer"/);
  assert.match(markup,/Saved chart · version 3/);
  assert.match(markup,/exact saved version and source references are rechecked/i);
  assert.match(markup,/View visual/);
  assert.match(markup,/aria-expanded="false"/);
  assert.doesNotMatch(markup,/governed-chat-visual-content|<svg|<canvas|<iframe|<script|official:filing/);
});
test("table and unsourced visuals are never fabricated in collapsed presentation",()=>{
  const table={...request,kind:"table" as const};
  const markup=renderToStaticMarkup(React.createElement(GovernedVisualAnswer,{request:table}));
  assert.match(markup,/Saved table · version 3/);
  assert.doesNotMatch(markup,/\bRevenue\b|filing data|generated table/);
});

test("C01 reopened Chat visuals require explicit exact-source reauthorization and clear stale display during retry", () => {
  const source = readFileSync(new URL("./GovernedVisualAnswer.tsx", import.meta.url), "utf8");
  assert.match(source, /setReadRevision\(value => value \+ 1\)/);
  assert.match(source, /\[expanded, signature, readRevision\]/);
  assert.match(source, /setState\(\{ phase: "loading", signature \}\)/);
  assert.match(source, /setMapOpen\(false\)/);
  assert.match(source, /Recheck current source permissions/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /activeReadRef\.current\?\.abort\(\)/);
  assert.match(source, /const decision = current\.decision\?\.status === "ready" \? current\.decision : null/);
  assert.doesNotMatch(source, /eval\(|dangerouslySetInnerHTML|localStorage|window\.open/);
});
