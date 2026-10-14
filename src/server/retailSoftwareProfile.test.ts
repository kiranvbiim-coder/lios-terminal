import assert from "node:assert/strict";
import test from "node:test";
import { isRetailSoftwareProfile } from "./retailSoftwareProfile";

test("isRetailSoftwareProfile is true for the retail/client profile flags and the client desktop channel", () => {
  assert.equal(isRetailSoftwareProfile({ LIOS_SOFTWARE_PROFILE: "retail" }), true);
  assert.equal(isRetailSoftwareProfile({ LIOS_SOFTWARE_PROFILE: "client" }), true);
  assert.equal(isRetailSoftwareProfile({ LIOS_DESKTOP_CHANNEL: "client" }), true);
});

test("isRetailSoftwareProfile is false for internal engineering defaults", () => {
  assert.equal(isRetailSoftwareProfile({ LIOS_SOFTWARE_PROFILE: "internal" }), false);
  assert.equal(isRetailSoftwareProfile({}), false);
});
