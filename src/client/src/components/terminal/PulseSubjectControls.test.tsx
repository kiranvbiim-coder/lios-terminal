import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PulseSubjectActions } from "./PulseSubjectActions";
import type { PulseStoryView } from "@/lib/pulseStoryPresentation";
import { readFileSync } from "node:fs";

const sourceCard:PulseStoryView = {
  id:"source:saved",kind:"research",title:"Verified recorded research",whatHappened:"An authorized item.",
  priority:"important",score:75,subjectKey:"ENERGY:POWER",createdAt:"2026-10-27T06:00:00Z",
  evidence:[{id:"evidence:1",source:"Primary record",url:"https://example.org/filing"}],
};
const render=(card:PulseStoryView,choice:"follow"|"mute"|"clear"|null = "clear") =>
  renderToStaticMarkup(React.createElement(PulseSubjectActions,{
    subjectKey:card.subjectKey ?? card.symbol,choice,onChange:()=>undefined,
  }));

test("Follow and Mute affordances require a recorded subject and display saved intent",()=>{
  const base=render(sourceCard);
  assert.match(base,/Follow ENERGY:POWER/);
  assert.match(base,/Mute ENERGY:POWER/);
  assert.match(base,/aria-pressed="false"/);
  const followed=render(sourceCard,"follow");
  assert.match(followed,/Unfollow ENERGY:POWER/);
  const muted=render(sourceCard,"mute");
  assert.match(muted,/Unmute ENERGY:POWER/);
  assert.doesNotMatch(render({...sourceCard,subjectKey:undefined,symbol:undefined}),/Unfollow|Unmute|Follow ENERGY|Mute ENERGY/);
});

test("Follow/Mute actions are explicit, use existing story surface, and do not create automations",()=>{
  const story=readFileSync(new URL("./LiosPulseStoryCard.tsx",import.meta.url),"utf8");
  const actions=readFileSync(new URL("./PulseSubjectActions.tsx",import.meta.url),"utf8");
  const board=readFileSync(new URL("./FusionPulseBoard.tsx",import.meta.url),"utf8");
  const shell=readFileSync(new URL("./WaveCExperienceShell.tsx",import.meta.url),"utf8");
  assert.match(story,/PulseSubjectActions/);
  assert.match(actions,/onChange\(subject, choice === "follow" \? "clear" : "follow"\)/);
  assert.match(actions,/onChange\(subject, choice === "mute" \? "clear" : "mute"\)/);
  assert.match(board,/setManagingSubjects/);
  assert.match(board,/pulsePreferences\.muted/);
  assert.match(board,/clusterRecordedPulseStories\(pulseCards, 24\)/);
  assert.doesNotMatch(board,/derivedPulseCards|market-move-\$\{quote\.symbol\}/);
  assert.match(shell,/apiRequest\("PUT", "\/api\/wave-d\/pulse\/preferences"/);
  assert.match(shell,/payload\.persisted !== true/);
  assert.doesNotMatch(story,/createP9Workflow|sendNotification|fetch\(/);
});

test("busy controls cannot imply success before authenticated persistence",()=>{
  const html=renderToStaticMarkup(React.createElement(PulseSubjectActions,{
    subjectKey:sourceCard.subjectKey,choice:"clear",busy:true,onChange:()=>undefined,
  }));
  // Buttons exist with safe, disabled state; no optimistic 'Following' badge.
  assert.match(html,/Follow ENERGY:POWER/);
  assert.match(html,/disabled=""/);
  assert.doesNotMatch(html,/Unfollow ENERGY:POWER/);
});
