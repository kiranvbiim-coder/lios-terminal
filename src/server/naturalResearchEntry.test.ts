import assert from "node:assert/strict";
import test from "node:test";
import { naturalResearchEntry } from "./naturalResearchEntry";

test("WS-26 explicit research requests preserve the user-provided objective", () => {
  const expected = [
    ["Research battery recycling in India", "battery recycling in India"],
    ["Could you investigate wastewater recycling?", "wastewater recycling"],
    ["please look into lithium supply chains", "lithium supply chains"],
    ["Do a deep dive on energy storage safety.", "energy storage safety"],
    ["Prepare a research brief about rural solar uptake", "rural solar uptake"],
    ["Find primary sources on groundwater contamination", "groundwater contamination"],
    ["Research about  grid-scale    batteries", "grid-scale batteries"],
  ];
  for (const [message, objective] of expected) assert.deepEqual(naturalResearchEntry(message), { objective }, message);
});

test("WS-26 does not reclassify ordinary Chat, vague, slash or long requests", () => {
  const rejected = [
    "What is research methodology?",
    "Explain lithium batteries",
    "Compare solar power with nuclear power",
    "Research",
    "Research this",
    "Could you research it?",
    "Research the topic",
    "/research battery recycling",
    "I am researching batteries",
    "Research " + "x".repeat(601),
  ];
  for (const message of rejected) assert.equal(naturalResearchEntry(message), null, message);
});
