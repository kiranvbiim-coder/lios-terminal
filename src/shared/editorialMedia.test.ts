import test from "node:test";
import assert from "node:assert/strict";
import { editorialMediaSchema, eligibleEditorialMedia } from "./editorialMedia";

const hash = "a".repeat(64);
function valid() {
  return {
    kind: "image" as const,
    assetPath: "/editorial-media/" + hash + ".webp",
    sha256: hash,
    alt: "Aerial photograph of a solar power installation",
    caption: "Recorded solar facility",
    attribution: "Original image by LiOS editorial",
    owner: "Limuria Intelligence LLP",
    licenseName: "Owned original asset",
    licenseEvidenceRef: "internal-rights-review:solar:2026-10-27",
    sourceEvidenceId: "solar:filing:2026-10-27",
    verifiedBy: "editorial-reviewer",
    verifiedAt: "2026-10-27T04:00:00.000Z",
    permission: "commercial_redistribution_and_display" as const,
    offlineBundlingPermitted: true as const,
    state: "approved" as const,
  };
}
test("approved local asset is displayed only with exact source identity and valid rights period", () => {
  const media = valid();
  assert.equal(editorialMediaSchema.safeParse(media).success, true);
  assert.deepEqual(eligibleEditorialMedia(media, [media.sourceEvidenceId], "2026-10-27T08:00:00Z"), media);
  assert.equal(eligibleEditorialMedia(media, ["other:id"], "2026-10-27T08:00:00Z"), null);
  assert.equal(eligibleEditorialMedia(media, [], "2026-10-27T08:00:00Z"), null);
  assert.equal(eligibleEditorialMedia(media, [media.sourceEvidenceId], "2026-10-27T01:00:00Z"), null);
  assert.equal(eligibleEditorialMedia(media, [media.sourceEvidenceId], "invalid-date"), null);
});
test("rights revocation, pending grants and expiry collapse to text-only view", () => {
  const media = valid();
  assert.equal(eligibleEditorialMedia({...media,state:"revoked"},[media.sourceEvidenceId],"2026-10-27T08:00:00Z"),null);
  assert.equal(eligibleEditorialMedia({...media,state:"pending"},[media.sourceEvidenceId],"2026-10-27T08:00:00Z"),null);
  const expiring={...media,expiresAt:"2026-10-28T00:00:00.000Z"};
  assert.ok(eligibleEditorialMedia(expiring,[media.sourceEvidenceId],"2026-10-27T23:59:59.999Z"));
  assert.equal(eligibleEditorialMedia(expiring,[media.sourceEvidenceId],"2026-10-28T00:00:00Z"),null);
  assert.equal(eligibleEditorialMedia({...media,expiresAt:"2026-10-26T00:00:00Z"},[media.sourceEvidenceId],"2026-10-27T08:00:00Z"),null);
});
test("never render remote URLs, file/data/javascript schemes, credentials, SVG scripts or arbitrary local paths", () => {
  const media=valid();
  for (const assetPath of [
    "https://example.org/portrait.jpg", "http://127.0.0.1:8080/spy.jpg", "//example.org/spy.png",
    "file:///tmp/picture.png", "data:image/svg+xml;base64,AAAA", "javascript:alert(1)",
    "/api/secret?access_token=abc", "/editorial-media/../../private.png", "/visual-environments/neutral.svg",
    "/editorial-media/"+hash+".svg", "/editorial-media/"+hash+".jpg?sig=key",
    "/editorial-media/"+hash.toUpperCase()+".png",
  ]) {
    assert.equal(eligibleEditorialMedia({...media,assetPath},[media.sourceEvidenceId],"2026-10-27T08:00:00Z"),null,assetPath);
  }
  assert.equal(eligibleEditorialMedia({...media,sha256:"b".repeat(64)},[media.sourceEvidenceId],"2026-10-27T08:00:00Z"),null);
});
test("media permission is explicit, attributed, reviewable, with exact known fields", () => {
  const media=valid();
  for(const change of [
    {permission:"display_only"}, {offlineBundlingPermitted:false},
    {attribution:""}, {verifiedBy:""}, {licenseEvidenceRef:""},
    {sourceEvidenceId:""}, {kind:"video"}, {scripts:["alert(1)"]},
    {verifiedAt:"bad-timestamp"}, {owner:" "},
  ]) {
    const received={...media,...change};
    assert.equal(eligibleEditorialMedia(received,[media.sourceEvidenceId],"2026-10-27T08:00:00Z"),null,JSON.stringify(change));
  }
});
