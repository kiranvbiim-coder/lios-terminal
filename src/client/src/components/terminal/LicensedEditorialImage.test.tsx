import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LicensedEditorialImage } from "./LicensedEditorialImage";
import LiosPulseStoryCard from "./LiosPulseStoryCard";
import NewsEditorialStoryCard from "../panels/NewsEditorialStoryCard";
import type { EditorialMedia } from "@shared/editorialMedia";
import type { PulseStoryView } from "@/lib/pulseStoryPresentation";

const checksum="a".repeat(64);
const media: EditorialMedia = {
  kind:"image",
  assetPath:"/editorial-media/"+checksum+".webp",
  sha256:checksum,
  alt:"Sunlight over permitted original solar installation photograph",
  caption:"Licensed original editorial image",
  owner:"Limuria Intelligence LLP",
  attribution:"Original image supplied by source owner",
  licenseName:"Owner-approved commercial reuse",
  licenseEvidenceRef:"internal:documented-license:77",
  sourceEvidenceId:"evidence:solar:1",
  verifiedBy:"authorized-editor",
  verifiedAt:"2026-09-01T00:00:00Z",
  permission:"commercial_redistribution_and_display",
  offlineBundlingPermitted:true,
  state:"approved",
};
const fallback = React.createElement("div",{"data-testid":"text-hero"},"Original text-first hero");
const render = (value:React.ReactElement) => renderToStaticMarkup(value);

test("approved editorial image is a same-origin, locally bundled URL with attribution and alt", () => {
  const html=render(React.createElement(LicensedEditorialImage,{media,sourceIds:["evidence:solar:1"]}));
  assert.match(html, /src="\/editorial-media\/a{64}\.webp"/);
  assert.match(html, /Sunlight over permitted original solar installation photograph/);
  assert.match(html, /Owner-approved commercial reuse/);
  assert.match(html, /no-referrer/);
  assert.doesNotMatch(html,/src="https?:\/\//);
});
test("unapproved, revoked, unattached and off-origin images never enter an img tag", () => {
  for (const input of [
    { ...media, state:"revoked" },
    { ...media, assetPath:"https://publisher.test/photo.webp" },
    { ...media, permission:"publisher_preview_only" },
    undefined,
  ]) {
    const html=render(React.createElement(LicensedEditorialImage,{media:input,sourceIds:["evidence:solar:1"],fallback}));
    assert.match(html,/Original text-first hero/);
    assert.doesNotMatch(html,/<img\b/);
  }
  const html=render(React.createElement(LicensedEditorialImage,{media,sourceIds:["unrelated"],fallback}));
  assert.match(html,/Original text-first hero/);
  assert.doesNotMatch(html,/<img\b/);
});
test("Pulse keeps source-grounded Watermelon disclosure while optionally rendering permitted media", () => {
  const card:PulseStoryView={ id:"solar:news", kind:"news", title:"Source-reported installation", whatHappened:"Pending verification",
    priority:"important",score:58,createdAt:"2026-10-27T03:00:00Z",media,
    evidence:[{id:"evidence:solar:1",source:"Original source",url:"https://example.org/news"}],
  };
  const html=render(React.createElement(LiosPulseStoryCard,{card,featured:true,onAsk:()=>undefined}));
  assert.match(html,/licensed-editorial-image/);
  assert.match(html, /Original image supplied by source owner/);
  assert.match(html,/recorded source/i);
  assert.match(html,/Source-reported installation/);
  const unsafe=render(React.createElement(LiosPulseStoryCard,{card:{...card,evidence:[]},featured:true,onAsk:()=>undefined}));
  assert.doesNotMatch(unsafe,/<img\b/);
  assert.match(unsafe,/LIOS INTELLIGENCE/);
});
test("News readthrough preserves keyboard selection, and never reuses a different article's image grant", () => {
  const base={
    title:"Recorded solar coverage",summary:"Source-backed report",source:"Original publisher",
    publishedAt:"2026-10-27T03:00:00Z",ageLabel:"Today",statusBadge:React.createElement("span",null,"Recorded"),
    active:false,lead:true,onSelect:()=>undefined,media,
  };
  const allowed=render(React.createElement(NewsEditorialStoryCard,{...base,sourceEvidenceId:"evidence:solar:1"}));
  assert.match(allowed,/<img\b/);
  assert.match(allowed,/aria-pressed="false"/);
  const denied=render(React.createElement(NewsEditorialStoryCard,{...base,sourceEvidenceId:"other-story"}));
  assert.match(denied,/Story overview/);
  assert.doesNotMatch(denied,/<img\b/);
});

test("a nonfeatured news card shows verified image thumbnail instead of an empty decorative placeholder", () => {
  const html = render(React.createElement(NewsEditorialStoryCard, {
    title:"Recorded solar coverage",summary:"Source-backed report",source:"Original publisher",
    publishedAt:"2026-10-27T03:00:00Z",ageLabel:"Today",statusBadge:React.createElement("span",null,"Recorded"),
    active:false,lead:false,onSelect:()=>undefined,media,sourceEvidenceId:"evidence:solar:1",
  }));
  assert.match(html, /licensed-editorial-image/);
  assert.match(html, /h-20/);
  const noGrant = render(React.createElement(NewsEditorialStoryCard, {
    title:"Other story",summary:"No image permission",source:"Another publisher",
    publishedAt:"2026-10-27T03:00:00Z",ageLabel:"Today",statusBadge:React.createElement("span",null,"Recorded"),
    active:false,lead:false,onSelect:()=>undefined,media,sourceEvidenceId:"other",
  }));
  assert.doesNotMatch(noGrant, /<img\b/);
});

test("Pulse renders a rights-verified RSS image when the article URL is present even if existing evidence ID differs", () => {
  const articleUrl = "https://example.org/source-reported-solar";
  const linked = { ...media, sourceEvidenceId: articleUrl };
  const card: PulseStoryView = {
    id: "article:recorded:1", kind: "news", title: "Source-reported installation",
    whatHappened: "Original source information", createdAt: "2026-10-27T03:00:00Z",
    score: 74, priority: "important", media: linked,
    evidence: [{ id: "news-evidence:historic", source: "Original source", url: articleUrl }],
  };
  const html = render(React.createElement(LiosPulseStoryCard, { card, featured: true, onAsk: () => undefined }));
  assert.match(html, /licensed-editorial-image/);
  const unrelated = render(React.createElement(LiosPulseStoryCard, {
    card: { ...card, evidence: [{ id: "news-evidence:other", source: "Other", url: "https://example.org/unrelated" }] },
    featured: true, onAsk: () => undefined,
  }));
  assert.doesNotMatch(unrelated, /<img\b/);
});


test("CC0 context image is explicitly illustrative with an attributable Commons file link", () => {
  const labeled: EditorialMedia = {
    ...media,
    mediaSourcePage: "https://commons.wikimedia.org/wiki/File:Generic_context_photo.jpg",
    usageContext: "illustrative",
    caption: "Context photograph, not a record of the reported news event.",
  };
  const html = render(React.createElement(LicensedEditorialImage, {
    media: labeled, sourceIds: ["evidence:solar:1"], variant: "compact",
  }));
  assert.match(html, /Context illustration/);
  assert.match(html, /not a photograph of this news event/);
  assert.match(html, /Image source and license/);
  assert.match(html, /href="https:\/\/commons\.wikimedia\.org\/wiki\/File:Generic_context_photo\.jpg"/);
  assert.match(html, /rel="noopener noreferrer"/);
});
