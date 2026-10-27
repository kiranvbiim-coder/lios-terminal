import test from "node:test";
import assert from "node:assert/strict";
import type { RecordedGeographicPoint } from "./offlineWorldMapPresentation";
import { projectOfflineWorldPoints, worldPointCoordinates, worldMapCenterPreservingPan } from "./offlineWorldMapPresentation";

const at = "2026-10-27T12:00:00Z";
const locations: RecordedGeographicPoint[] = [
  { id: "west", label: "Western test coordinate", latitude: 0, longitude: -180, sourceRef: "source:west", occurredAt: at },
  { id: "east", label: "Eastern test coordinate", latitude: 0, longitude: 180, sourceRef: "source:east", occurredAt: null },
  { id: "north", label: "Northern test coordinate", latitude: 90, longitude: 0, sourceRef: null, occurredAt: at },
  { id: "south", label: "Southern test coordinate", latitude: -90, longitude: 0, sourceRef: null, occurredAt: null },
];

test("equirectangular pin positions match exact numeric P7 coordinates including world edges", () => {
  assert.deepEqual(worldPointCoordinates(-180,0), {x:0,y:50});
  assert.deepEqual(worldPointCoordinates(180,0), {x:100,y:50});
  assert.deepEqual(worldPointCoordinates(0,90), {x:50,y:0});
  assert.deepEqual(worldPointCoordinates(0,-90), {x:50,y:100});
  assert.deepEqual(worldPointCoordinates(78.12,9.92), {
    x:(78.12+180)/360*100,y:(90-9.92)/180*100,
  });
  const plotted = projectOfflineWorldPoints(locations);
  assert.equal(plotted.eligibleCount,4);
  assert.deepEqual(plotted.points.map(x=>[x.id,x.x,x.y]), [
    ["west",0,50],["east",100,50],["north",50,0],["south",50,100],
  ]);
});

test("never infer positions from strings, overflow, NaN, infinity, duplicates or missing graph records", () => {
  for(const pair of [[181,0],[-181,0],[0,91],[0,-91],[NaN,0],[Infinity,0],[0,NaN]]){
    assert.equal(worldPointCoordinates(pair[0],pair[1]),null);
  }
  const bad = [
    {...locations[0],id:"duplicate",latitude:Infinity},
    {...locations[0],id:"duplicate-2",longitude:181},
    {...locations[0],id:"duplicate-3",latitude:"0" as unknown as number},
    {...locations[0],id:"west"},
  ];
  const result=projectOfflineWorldPoints([...locations,...bad]);
  assert.equal(result.points.length,4);
  assert.equal(result.omittedCount,0);
});

test("source/date layer filters use only recorded sourceRef and timestamps",()=>{
  assert.deepEqual(projectOfflineWorldPoints(locations,{sourceOnly:true}).points.map(x=>x.id),["west","east"]);
  assert.deepEqual(projectOfflineWorldPoints(locations,{withEventDate:true}).points.map(x=>x.id),["west","north"]);
  assert.deepEqual(projectOfflineWorldPoints(locations,{withEventDate:true,sourceOnly:true}).points.map(x=>x.id),["west"]);
  assert.equal(projectOfflineWorldPoints(locations,{sourceOnly:true}).points[0].hasSourceId,true);
  assert.equal(projectOfflineWorldPoints(locations).points[2].hasSourceId,false);
});

test("show at most 60 points but report actual omissions; do not mutate source records",()=>{
  const many=Array.from({length:120},(_,i)=>({...locations[0],id:"pin-"+i,longitude:-120+i}));
  const original=many[0].longitude;
  const result=projectOfflineWorldPoints(many);
  assert.equal(result.points.length,60);
  assert.equal(result.eligibleCount,120);
  assert.equal(result.omittedCount,60);
  assert.equal(many[0].longitude,original);
  assert.equal(projectOfflineWorldPoints([]).points.length,0);
});


test("B01 map search finds later authorized records before the 60-pin cap", () => {
  const large = Array.from({ length: 115 }, (_, index) => ({
    ...locations[0],
    id: "p7-node-" + index,
    label: index === 110 ? "Target Station 110" : "Recorded Station " + index,
    sourceRef: index === 110 ? "source:unique-110" : "source:common",
    longitude: -170 + index,
  }));
  const result = projectOfflineWorldPoints(large, { query: "target station" });
  assert.deepEqual(result.points.map(point => point.id), ["p7-node-110"]);
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.filteredOutCount, 114);
  assert.equal(result.omittedCount, 0);
  assert.deepEqual(projectOfflineWorldPoints(large, { query: "SOURCE:UNIQUE-110" }).points.map(point => point.id), ["p7-node-110"]);
  assert.deepEqual(projectOfflineWorldPoints(large, { query: "p7-node-110" }).points.map(point => point.id), ["p7-node-110"]);
  assert.deepEqual(projectOfflineWorldPoints(large, { query: "not-existing" }).points, []);
  assert.equal(projectOfflineWorldPoints(large).omittedCount, 55);
  assert.equal(large[110].label, "Target Station 110");
});

test("B01 recorded date layer rejects guessed, local-only and rolled-over date values", () => {
  const base = locations[0];
  const bad = ["1", "2026-02-30T10:00:00Z", "2026-10-27", "2026-10-27T12:00:00", "invalid", "2026-10-27T24:00:00Z"];
  const input = [
    { ...base, id: "valid", occurredAt: "2026-10-27T12:00:00+05:30" },
    ...bad.map((occurredAt, i) => ({ ...base, id: "invalid-" + i, occurredAt })),
  ];
  assert.deepEqual(projectOfflineWorldPoints(input, { withEventDate: true }).points.map(row => row.id), ["valid"]);
  assert.equal(projectOfflineWorldPoints(input).points.length, 7);
});

test("B01 geography search respects source and date layers without inventing location evidence", () => {
  const filtered = projectOfflineWorldPoints(locations, { sourceOnly: true, query: "Northern" });
  assert.equal(filtered.eligibleCount, 0);
  assert.equal(filtered.points.length, 0);
  assert.equal(filtered.filteredOutCount, 2);
  assert.deepEqual(projectOfflineWorldPoints(locations, { withEventDate: true, query: "Western" })
    .points.map(row => row.id), ["west"]);
  assert.deepEqual(projectOfflineWorldPoints(locations, { query: "  WESTERN  " }).points.map(row => row.id), ["west"]);
});


test("B01 centre-preserving pan keeps the identical saved map coordinate while zooming", () => {
  const viewport = { width: 600, height: 400 };
  const old = { x: -170, y: 20 };
  const next = worldMapCenterPreservingPan(old, viewport, 0.5, 1);
  const oldWorldCentre = { x: (300 - old.x) / 0.5, y: (200 - old.y) / 0.5 };
  assert.deepEqual({ x: (300 - next.x) / 1, y: (200 - next.y) / 1 }, oldWorldCentre);
  const back = worldMapCenterPreservingPan(next, viewport, 1, 0.5);
  assert.deepEqual(back, old);
  for (const invalid of [0, NaN, Infinity, -1]) {
    assert.deepEqual(worldMapCenterPreservingPan(old, viewport, 0.5, invalid), old);
  }
  assert.deepEqual(worldMapCenterPreservingPan(old, { width: 0, height: 300 }, 0.5, 1), old);
});
