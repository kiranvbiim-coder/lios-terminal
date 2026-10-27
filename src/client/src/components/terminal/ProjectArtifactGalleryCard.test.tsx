import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectArtifactGalleryCard } from "./ProjectArtifactGalleryCard";

const saved = {
  id: "artifact-1",
  title: "Q3 portfolio research",
  kind: "research" as const,
  headVersion: 4,
  origin: "conversation" as const,
  status: "active" as const,
};

test("gallery card is an actual saved record, not invented chart or demo", () => {
  const html = renderToStaticMarkup(React.createElement(ProjectArtifactGalleryCard, {
    artifact: saved, onOpen: () => {}, onPreview: () => {}, previewOpen: false,
  }));
  assert.match(html, /Q3 portfolio research/);
  assert.match(html, /From Chat/);
  assert.match(html, /Saved v4/);
  assert.match(html, /data-artifact-kind="research"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Open work/);
  assert.match(html, /Preview/);
  assert.doesNotMatch(html, /<img\b|<canvas\b|https:\/\/assets\.watermelon/);
});

test("gallery card uses explicit archived and previewed states", () => {
  const html = renderToStaticMarkup(React.createElement(ProjectArtifactGalleryCard, {
    artifact: { ...saved, status: "archived" as const }, onOpen: () => {}, onPreview: () => {}, previewOpen: true,
  }));
  assert.match(html, /Archived/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /Hide preview/);
});

test("gallery titles and source labels cannot inject markup", () => {
  const html = renderToStaticMarkup(React.createElement(ProjectArtifactGalleryCard, {
    artifact: { ...saved, title: '<script>alert("x")</script>' }, onOpen: () => {}, onPreview: () => {}, previewOpen: false,
  }));
  assert.doesNotMatch(html, /<script\b/);
  assert.match(html, /&lt;script&gt;/);
});
