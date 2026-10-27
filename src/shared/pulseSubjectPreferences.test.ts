import test from "node:test";
import assert from "node:assert/strict";
import type { IntelligenceCard } from "./waveDContracts";
import {
  filterPreferredPulseCards, normalizePulseSubject, normalizePulseSubjectPreferences,
  setPulseSubjectChoice, pulseSubjectChoice, MAX_PULSE_SUBJECT_PREFERENCES,
} from "./pulseSubjectPreferences";

function card(id: string, subjectKey?: string, kind: IntelligenceCard["kind"] = "research"): IntelligenceCard {
  return {
    id, kind, title: "Recorded item " + id, whatHappened: "Attributable observation", whyItMatters: "Evidence review",
    whyItMattersToUser: "Review the source", nextActions: ["analyse"], createdAt: "2026-10-27T08:00:00Z",
    subjectKey, evidence: [{ id: "source:" + id, source: "Public filing" }],
    score: 73, priority: "important", status: "unread",
  };
}

test("canonical case-insensitive subjects are bounded, normalized and never guessed from a title", () => {
  assert.equal(normalizePulseSubject(" solar:energy "), "SOLAR:ENERGY");
  for (const invalid of ["", "   ", "A".repeat(241), "SOLAR\nX", "CONTROL\u0000CODE"]) assert.equal(normalizePulseSubject(invalid), null);
  assert.equal(normalizePulseSubject(null), null);
  assert.deepEqual(normalizePulseSubjectPreferences({
    followed: ["solar", "SOLAR", " WIND ", "", null, "\u0001bad", "oil"],
    muted: ["solar", " OIL "],
  }), { followed: ["WIND"], muted: ["SOLAR", "OIL"] });
});

test("Follow, Mute and Clear persist as exclusive explicit choices", () => {
  let preferences=normalizePulseSubjectPreferences(null);
  assert.deepEqual(preferences, {followed:[],muted:[]});
  preferences=setPulseSubjectChoice(preferences,"wind:energy","follow");
  assert.deepEqual(preferences,{followed:["WIND:ENERGY"],muted:[]});
  assert.equal(pulseSubjectChoice(preferences,"wind:energy"),"follow");
  preferences=setPulseSubjectChoice(preferences," WIND:ENERGY ","mute");
  assert.deepEqual(preferences,{followed:[],muted:["WIND:ENERGY"]});
  assert.equal(pulseSubjectChoice(preferences,"wind:energy"),"mute");
  preferences=setPulseSubjectChoice(preferences,"wind:energy","clear");
  assert.deepEqual(preferences,{followed:[],muted:[]});
  assert.equal(pulseSubjectChoice(preferences,"unknown"),"clear");
  assert.equal(pulseSubjectChoice(preferences,undefined),null);
  assert.throws(()=>setPulseSubjectChoice(preferences,"\n","follow"));
  assert.throws(()=>setPulseSubjectChoice(preferences,"wind","delete" as never));
});

test("Following uses only saved own follows and watchlist, ignoring injected client subject keys", () => {
  const cards=[card("a","SOLAR"),card("b","WIND"),card("c","OIL"),card("d",undefined)];
  const prefs={followed:["SOLAR"],muted:[]};
  const filter={channel:"following" as const,subjectKeys:["OIL"]};
  assert.deepEqual(filterPreferredPulseCards(cards,filter,prefs).map(x=>x.id),["a"]);
  assert.deepEqual(filterPreferredPulseCards(cards,{channel:"following"},prefs,["wind"]).map(x=>x.id),["a","b"]);
  const symbolOnly = {...card("legacy","IGNORED"),subjectKey:undefined,symbol:"SOLAR"};
  assert.deepEqual(filterPreferredPulseCards([symbolOnly],{channel:"following"},prefs).map(x=>x.id),["legacy"]);
  assert.deepEqual(filterPreferredPulseCards(cards,{channel:"following"}, {followed:[],muted:[]}).map(x=>x.id),[]);
});

test("Mute suppresses discovery even against watchlist and never mutates the original evidence", () => {
  const cards=[card("alert","SOLAR","alert"),card("solar","SOLAR"),card("wind","WIND"),card("free",undefined)];
  const prefs={followed:["SOLAR","WIND"],muted:["SOLAR"]};
  const original=JSON.stringify(cards);
  for (const channel of ["for_you","following","markets","research"] as const) {
    const filtered=filterPreferredPulseCards(cards,{channel},prefs,["SOLAR"]);
    assert.ok(filtered.every(item=>item.subjectKey!=="SOLAR"));
  }
  assert.deepEqual(filterPreferredPulseCards(cards,{channel:"following"},prefs,["SOLAR"]).map(c=>c.id),["wind"]);
  assert.equal(JSON.stringify(cards),original);
  assert.deepEqual(filterPreferredPulseCards([card("no-topic",undefined)],{channel:"for_you"},prefs).map(x=>x.id),["no-topic"]);
});

test("bounds prevent unbounded cross-user preference payloads", () => {
  const many=Array.from({length:200},(_,i)=>"TOPIC:"+i);
  const prefs=normalizePulseSubjectPreferences({followed:many,muted:[]});
  assert.equal(prefs.followed.length,MAX_PULSE_SUBJECT_PREFERENCES);
  assert.throws(()=>setPulseSubjectChoice(prefs,"EXTRA","follow"),/Maximum/);
  assert.doesNotThrow(()=>setPulseSubjectChoice(prefs,"TOPIC:0","follow"));
  assert.equal(normalizePulseSubjectPreferences({followed:many,muted:many}).followed.length,0);
});
