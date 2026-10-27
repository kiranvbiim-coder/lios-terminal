import test from "node:test";
import assert from "node:assert/strict";
import type { RecordedGeographicPoint } from "./offlineWorldMapPresentation";
import { projectOfflineWorldPoints, worldPointCoordinates, recordedWorldMapDays } from "./offlineWorldMapPresentation";

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


test("B01 time slider uses recorded UTC event days only and inclusive date boundaries", () => {
  const newer = { ...locations[0], id:"later", occurredAt:"2026-10-28T01:00:00+05:30" };
  const invalid = { ...locations[0], id:"fake", occurredAt:"2026-02-30T12:00:00Z" };
  const input=[...locations,newer,invalid];
  assert.deepEqual(recordedWorldMapDays(input), ["2026-10-27"]);
  assert.deepEqual(projectOfflineWorldPoints(input,{fromDate:"2026-10-27",throughDate:"2026-10-27"}).points.map(x=>x.id),
    ["west","north","later"]);
  assert.equal(projectOfflineWorldPoints(input,{fromDate:"2026-10-28",throughDate:"2026-10-28"}).points.length,0);
  for (const range of [{fromDate:"2026-02-30"}, {fromDate:"bad"}, {fromDate:"2026-10-28",throughDate:"2026-10-27"}]) {
    assert.equal(projectOfflineWorldPoints(input,range).points.length,0);
  }
});
test("B01 explicit time-window never reintroduces source-free or undated points",()=>{
  const x=projectOfflineWorldPoints(locations,{sourceOnly:true,fromDate:"2026-10-27",throughDate:"2026-10-27"});
  assert.deepEqual(x.points.map(item=>item.id),["west"]);
});
