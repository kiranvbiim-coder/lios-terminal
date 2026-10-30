import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GraphExplorerCompactList } from "../components/terminal/GraphExplorerCompactList";
import { safePublicSourceUrl } from "@shared/publicSourceUrl";

test("B09 source navigation rejects credentials and authentication tokens", () => {
  assert.equal(safePublicSourceUrl("https://example.org/file?access_token=secret"),null);
  assert.equal(safePublicSourceUrl("https://user:secret@example.org/file"),null);
  assert.equal(safePublicSourceUrl("https://example.org/source"),"https://example.org/source");
});
test("B09 fallback remains keyboard selectable with semantic graph objects",()=>{
  const html=renderToStaticMarkup(React.createElement(GraphExplorerCompactList,{
    nodes:[{objectId:"source-1",label:"Recorded policy filing",domain:"policy",strength:.5}],
    selectedId:"source-1",onSelect:()=>{},emptyMessage:"No records",
  }));
  assert.match(html,/Compact Intelligence Graph/);
  assert.match(html,/Recorded policy filing/);
  assert.match(html,/aria-pressed="true"/);
  assert.match(html,/<button/);
  assert.doesNotMatch(html,/No records/);
});

