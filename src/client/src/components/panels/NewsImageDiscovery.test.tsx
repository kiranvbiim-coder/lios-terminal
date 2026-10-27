import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NewsImageDiscovery, CommonsContextIllustration } from "./NewsImageDiscovery";
import NewsEditorialStoryCard from "./NewsEditorialStoryCard";
import type { CommonsCandidate } from "@shared/commonsMedia";

const candidate: CommonsCandidate = {
  fileTitle: "File:Illustrative solar field.jpg",
  previewUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/solar.jpg/640px-solar.jpg",
  filePage: "https://commons.wikimedia.org/wiki/File:Illustrative_solar_field.jpg",
  creator: "Commons contributor",
  license: "CC0 1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  mime: "image/jpeg",
};
const render = (value: React.ReactElement) => renderToStaticMarkup(value);

test("closed image discovery renders no third-party images or network-side effects", () => {
  const html = render(React.createElement(NewsImageDiscovery, {
    articleTitle: "Solar innovation", selected: null, onSelect: () => undefined, onClear: () => undefined,
  }));
  assert.match(html, /Find context image/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /<img\b|upload\.wikimedia\.org|commons-context-illustration/);
});

test("user-selected context image visibly denies event-photo status and exposes no fake license grant", () => {
  const html = render(React.createElement(CommonsContextIllustration, { candidate }));
  assert.match(html, /Illustration only/);
  assert.match(html, /not a photograph of the news event/);
  assert.match(html, /referrerPolicy="no-referrer"|referrerpolicy="no-referrer"/i);
  assert.match(html, /src="https:\/\/upload\.wikimedia\.org\/wikipedia\/commons/);
  const denied = render(React.createElement(CommonsContextIllustration, {
    candidate: { ...candidate, previewUrl: "https://evil.example.org/track.png" },
  }));
  assert.doesNotMatch(denied, /<img\b/);
});

test("existing news card may preview selected context without persisting it as licensed editorial media", () => {
  const props = {
    title: "Reported market development", summary: "Sourced news from the publisher",
    source: "Original publisher", publishedAt: "2026-10-27T06:00:00Z", ageLabel: "Today",
    statusBadge: React.createElement("span", null, "Feed"), active: true, lead: true,
    sourceEvidenceId: "https://news.example.org/exact-article", onSelect: () => undefined,
  };
  const withPreview = render(React.createElement(NewsEditorialStoryCard, { ...props, contextIllustration: candidate }));
  assert.match(withPreview, /commons-context-illustration/);
  assert.match(withPreview, /not a photograph of the news event/);
  assert.match(withPreview, /aria-pressed="true"/);
  const without = render(React.createElement(NewsEditorialStoryCard, props));
  assert.doesNotMatch(without, /commons-context-illustration|upload\.wikimedia\.org|<img\b/);
});


test("chosen session illustration retains its authentic Commons source link after the search closes", () => {
  const html = render(React.createElement(CommonsContextIllustration, { candidate, showSource: true }));
  assert.match(html, /Review Commons image and license/);
  assert.match(html, /href="https:\/\/commons\.wikimedia\.org\/wiki\/File:Illustrative_solar_field\.jpg"/);
  assert.match(html, /rel="noopener noreferrer"/);
  const cardHtml = render(React.createElement(NewsEditorialStoryCard, {
    title: "Solar story", summary: "Source-backed update", source: "Publisher",
    publishedAt: "2026-10-27T06:00:00Z", ageLabel: "Today",
    statusBadge: React.createElement("span", null, "Feed"), active: true, lead: true,
    onSelect: () => undefined, contextIllustration: candidate,
  }));
  assert.doesNotMatch(cardHtml, /href="https:\/\/commons\.wikimedia\.org/);
});


test("saved references show a recheck control without loading any image on reopening", () => {
  const saved = {
    storyUrl: "https://news.example.org/exact-article",
    candidate, savedAt: "2026-10-27T09:00:00.000Z",
  };
  const html = render(React.createElement(NewsImageDiscovery, {
    articleTitle: "News about solar", selected: null, saved, canRemember: true,
    onSelect: () => undefined, onClear: () => undefined,
    onRemember: () => undefined, onForget: () => undefined,
    onReopenSaved: async () => true,
  }));
  assert.match(html, /Recheck &amp; show saved/);
  assert.match(html, /Saved in this Workbench artifact/);
  assert.match(html, /Forget saved/);
  assert.doesNotMatch(html, /<img\b|src="https:\/\/upload\.wikimedia\.org/);
});

test("a current illustration can be explicitly remembered or updated, but not saved in read-only mode", () => {
  const basic = { articleTitle: "Solar markets", selected: candidate, onSelect: () => undefined, onClear: () => undefined };
  const writable = render(React.createElement(NewsImageDiscovery, {
    ...basic, canRemember: true, onRemember: () => undefined,
  }));
  assert.match(writable, /Remember illustration/);
  const saved = { storyUrl: "https://news.example.org/exact-article", savedAt: "2026-10-27T09:00:00.000Z",
    candidate: { ...candidate, filePage: "https://commons.wikimedia.org/wiki/File:Previous.jpg" } };
  const update = render(React.createElement(NewsImageDiscovery, {
    ...basic, canRemember: true, saved, onRemember: () => undefined,
  }));
  assert.match(update, /Update saved illustration/);
  const readonly = render(React.createElement(NewsImageDiscovery, { ...basic, canRemember: false }));
  assert.doesNotMatch(readonly, /Remember illustration|Update saved illustration|Forget saved/);
});
