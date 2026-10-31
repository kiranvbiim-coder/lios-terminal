# LiOS Visual Environment Aesthetic Review — FIX-020 / FIX-021

**Production set:** v2.0.0  
**Scope:** premium environment artwork + three-state tuning only. The Project → Chat → Artifact → Living Workspace architecture is intentionally unchanged.

The current supplied Figma graphite/gold matte default and bundled Barlow Condensed display/Inter prose/JetBrains Mono data take precedence over older shell styling. This review covers optional scenes, not a mandatory Neutral background. Preserve explicit saved selections and also review the new/unconfigured matte and disabled-imagery baselines.

## Review contract

The production library contains ten canonical environment families, each with:
- a 1920×1080 production SVG used by the desktop client;
- a dedicated 1600×900 low-resource derivative;
- an archival vector master/provenance record;
- a quiet central composer/content zone with richer peripheral structure;
- restrained LiOS amber / indigo / cyan visual DNA;
- no embedded UI text, stock imagery, logos, businesspeople, ticker wallpaper or gain/loss red-green semantics.

## Automated asset gate

Run locally from `src/`:

```bash
npm run validate:visual-environments
npm run test:ux
npm run check
npm run validate:visual-environments
```

The asset gate validates the canonical ten IDs, production + low-resource + master files, dimensions, non-trivial scene structure, manifest provenance and absence of remote embedded assets.

## One-time human aesthetic review

FIX-021 is deliberately **not** satisfied by source presence or screenshot generation alone. Record one review for this production set after rendering the application locally.

Capture **Immersive / Contextual / Focus** at the same viewport for each environment:

| Environment | Immersive | Contextual | Focus | Human result |
| --- | --- | --- | --- | --- |
| Neutral LiOS | ☐ | ☐ | ☐ | ☐ PASS / ☐ REWORK |
| Global Intelligence | ☐ | ☐ | ☐ | ☐ PASS / ☐ REWORK |
| Company Intelligence | ☐ | ☐ | ☐ | ☐ PASS / ☐ REWORK |
| Markets | ☐ | ☐ | ☐ | ☐ PASS / ☐ REWORK |
| Valuation / Modeling | ☐ | ☐ | ☐ | ☐ PASS / ☐ REWORK |
| Portfolio / Risk | ☐ | ☐ | ☐ | ☐ PASS / ☐ REWORK |
| Quant / Strategy | ☐ | ☐ | ☐ | ☐ PASS / ☐ REWORK |
| Research / Knowledge | ☐ | ☐ | ☐ | ☐ PASS / ☐ REWORK |
| Personal Finance / Wealth | ☐ | ☐ | ☐ | ☐ PASS / ☐ REWORK |
| Economic Intelligence | ☐ | ☐ | ☐ | ☐ PASS / ☐ REWORK |

Review criteria:
- LiOS identity and premium art quality;
- composer/content safe zone;
- tonal balance and text readability;
- continuity from Immersive → Contextual;
- Artifact/chart readability;
- Focus suppression;
- low-resource fallback;
- absence of false controls or text-like affordances;
- no semantic-color confusion.
- reduced-motion static behavior, keyboard/focus and accessible solid fallback;
- no regression to rich adaptive Project Home, minimal Global/New Chat, hidden Working Context or shared P4 Artifact continuity.

## Acceptance journey

```text
Enable/select an optional environment → Open Project in Immersive
→ verify composer-safe negative space
→ submit prompt
→ verify Contextual continuity
→ read conversation and compact Artifact
→ open dense model/chart
→ verify Focus suppression
→ return to Contextual
→ close/reopen Project
→ verify the same environment is restored
→ enable low-resource mode
→ verify fallback remains coherent and readable
```

## Sign-off rule

**FIX-020 reaches LOCAL PASS** after the asset gate, UX tests and typecheck pass locally.  
**FIX-021 / PRODUCT PASS requires the one-time human in-app review above.**

Rendered smoke proves only that a scene renders. Human sign-off establishes the bounded aesthetic review, not release certification. Do not close FIX-021 from source presence or screenshots alone or spend repeated GitHub Actions runs on aesthetic review. Under the [Shipping Point contract](../technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md), every SP requires a real MSJ, applicable target execution, no fake success, regression protection and exact build/environment/journey/outcome/limitations evidence; screenshots, static gates and unsigned smoke cannot establish SP acceptance or P14 release proof. No LOCAL PASS, PRODUCT PASS, SP acceptance or release status is asserted here.
