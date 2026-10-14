# CUA → LiOS GM-14: finite captured-frame coordinate safety

**Selected exact source**: `kiranvbiim-coder/cua` fork of `trycua/cua` at commit `a7524cfd1d3e959963b43954d43f27c4bd260f08`. Root `LICENSE.md` MIT, original Git blob `b8b198ce3ebaa22c9f59588a80f9f1875d85b34a` reproduced without modification at `third_party/licenses/cua-MIT.txt`. CUA's `LICENSING.md` expressly identifies directory-specific FSL/third-party license exceptions; this lane selects only the MIT driver example and MIT agent regression material, not Cua Spaces, Keyvault, or FSL source.

**Selected package mechanics**:
- `libs/cua-driver/examples/jev-use/python/action_policy.py` Git blob `75c11a3bee546fa90cc8331aca73d67f67639b56`: the screenshot-to-action mapping requires finite/invertible numeric geometry; malformed or overflowing mappings fail rather than dispatching input.
- `libs/python/agent/tests/test_uitars_coordinate_security.py` Git blob `559c4c474ed4c8c2242063cd13f11048a587464e`: negative examples including nonnumeric, infinite, malformed and expression-based model coordinate payloads.
- **LiOS implementation** `src/server/computer/actions.ts` adds representable nonzero positive integer width/height and valid scaleFactor checks in the **already existing OpenClaw-derived** `scalePoint` function, before mathematical transformation. `computer-policy.test.ts` adds rejected zero, NaN, infinite, fractional, extremely large dimensions and real valid primary display math cases.

**Authority maintained:** LiOS's existing OpenClaw/GM-14 screenshot frame generation/invalidation, approvals and native transport ownership stay unchanged; CUA formulas are adapted only as validation invariants. This protects coordinate conversion for any future approved native driver. It does not activate the unavailable native computer execution runtime or grant screenshot/input permissions.

**Next gates:** native macOS existing GM-14 computer-policy and client boundary tests, TypeScript, owner review; actual driver binary redistributability, per-subdirectory licenses, consent, TCC and native packaged customer acceptance remain separate.
