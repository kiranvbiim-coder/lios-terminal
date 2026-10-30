import test from "node:test";
import assert from "node:assert/strict";
import { automaticContextSearchTerm, chooseAutomaticContextImage } from "./newsAutomaticContext";

const safe = {
  fileTitle: "File:Solar energy field.jpg",
  filePage: "https://commons.wikimedia.org/wiki/File:Solar_energy_field.jpg",
  previewUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/solar.jpg/640px-solar.jpg",
  license: "CC0 1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  creator: "Commons contributor",
  mime: "image/jpeg",
};

test("auto context searches only bounded public headline subjects", () => {
  assert.equal(automaticContextSearchTerm("Solar power stocks rise on report"), "solar power");
  assert.equal(automaticContextSearchTerm("Market news update today"), null);
  assert.equal(automaticContextSearchTerm("x".repeat(301)), null);
  assert.equal(automaticContextSearchTerm("Nvidia AI chips launch"), "nvidia chips");
});

test("no RSS unverified image or unrelated/unsafe Commons URL becomes automatic visual", () => {
  assert.deepEqual(chooseAutomaticContextImage({ status: "unreviewed", results: [safe] }, "solar power"), safe);
  assert.equal(chooseAutomaticContextImage({ status: "unreviewed", results: [safe] }, "hospital medicine"), null);
  assert.equal(chooseAutomaticContextImage({ status: "approved", results: [safe] }, "solar"), null);
  assert.equal(chooseAutomaticContextImage({ status: "unreviewed", results: [{ ...safe, license: "CC BY-SA 4.0" }] }, "solar"), null);
  assert.equal(chooseAutomaticContextImage({ status: "unreviewed", results: [{ ...safe, previewUrl: "https://tracker.example/pixel.jpg" }] }, "solar"), null);
  assert.equal(chooseAutomaticContextImage({ status: "unreviewed", results: [{ ...safe, filePage: "http://127.0.0.1/admin" }] }, "solar"), null);
  assert.equal(chooseAutomaticContextImage({ status: "unreviewed", results: [{ ...safe, licenseUrl: "https://wrong.example/0" }] }, "solar"), null);
  assert.equal(chooseAutomaticContextImage({ status: "unreviewed", results: [{ imageCandidate: safe }] }, "solar"), null);
});

