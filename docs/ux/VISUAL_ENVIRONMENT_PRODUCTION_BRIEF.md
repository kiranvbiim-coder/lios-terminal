# LiOS Visual Environment Production Brief

> **Authority:** Supporting visual-design reference for the integrated Contextual Visual Intelligence Canvas; the active interaction contract is [LIOS_UX_SYSTEM.md](../LIOS_UX_SYSTEM.md).
> **Purpose:** Preserve the environment library's production art direction and review criteria.
> **Verification boundary:** Asset presence and automated checks do not replace rendered, human, interactive, or packaged-desktop review.
> **Current precedence:** The supplied Figma graphite/gold matte shell with locally bundled Barlow Condensed display, Inter prose and JetBrains Mono data wins older orange/cinematic directions. New/unconfigured workspaces use matte backgrounds; environments are optional and explicit saved choices survive. SI/SP delivery remains behind existing TC/GM/CA/P owners, with P14 final release authority.

---

# 1. Product role

LiOS visual environments are not wallpapers.

They provide:

- orientation;
- Project identity;
- spatial continuity;
- premium depth;
- emotional quality;
- contextual cues.

They must always remain subordinate to analytical work.

The environment layer should help a user feel that they are entering and returning to an intelligent analytical place while preserving one coherent LiOS identity.

---

# 2. Three render states

Every environment must be evaluated in all three states.

## Immersive

Used for launch, Project entry and calm empty states.

The asset may be clearly visible.

Requirements:

- composer-safe negative space;
- readable primary UI;
- strong peripheral detail;
- no large bright object directly beneath expected text;
- image may provide emotional impact.

## Contextual

Used during active conversation.

Requirements:

- environment survives as a recognizable continuity cue;
- substantially reduced visual dominance;
- works beneath dark vignette/opacity treatment;
- no detail that creates false UI affordances;
- no competing text-like structures.

## Focus

Used for dense analytical work.

Requirements:

- asset may disappear almost completely;
- if visible, only faint edges/header/vignette remain;
- must not interfere with chart color, model readability or semantic finance colors.

---

# 3. Canonical first production set

## VE-01 — Global Intelligence

**Intent:** global markets, international research, broad intelligence.

Visual language:

- dark earth horizon or abstract globe geometry;
- economic/geographic network structure;
- subtle illuminated flows;
- premium, not sci-fi game UI.

Avoid:

- literal flags;
- glowing cryptocurrency globe clichés;
- excessive satellite imagery.

## VE-02 — Company Intelligence

**Intent:** company research, fundamentals, filings, competitive analysis.

Visual language:

- refined corporate architecture;
- structured data geometry;
- subtle document/knowledge structures;
- strong sense of organized information.

Avoid:

- office stock photography;
- logos;
- generic skyscraper hero image.

## VE-03 — Markets

**Intent:** active market analysis, price/volume, cross-asset exploration.

Visual language:

- flowing financial terrain;
- subtle rhythm;
- abstract liquidity/price structures;
- dynamic but restrained.

Avoid:

- giant candlestick charts;
- green/red arrow clichés;
- neon trading screens.

## VE-04 — Valuation / Modeling

**Intent:** DCF, scenario work, financial models.

Visual language:

- layered curves;
- grids;
- scenario pathways;
- geometric analytical depth;
- warm amber with restrained indigo.

Avoid:

- fake spreadsheet screenshots;
- floating numbers;
- formula wallpaper.

## VE-05 — Portfolio / Risk

**Intent:** portfolio, exposure, stress, risk.

Visual language:

- topographic surfaces;
- networked asset structures;
- contour fields;
- concentration/diversification visual metaphor.

Avoid:

- literal pie charts;
- warning-sign imagery;
- aggressive red risk palette.

## VE-06 — Quant / Strategy

**Intent:** signals, strategy, backtest, computational research.

Visual language:

- signal topology;
- structured wave/forms;
- model geometry;
- restrained computational atmosphere.

Avoid:

- Matrix-style code rain;
- AI brain imagery;
- overly technical circuit boards.

## VE-07 — Research / Knowledge

**Intent:** documents, evidence, thesis development, deep research.

Visual language:

- evidence network;
- information constellations;
- abstract document architecture;
- connection/traceability.

Avoid:

- floating paper pages;
- library stock photography;
- illegible fake text.

## VE-08 — Personal Finance / Wealth

**Intent:** household finance, goals, planning, long-horizon wealth.

Visual language:

- calmer horizon;
- progression;
- balance;
- understated optimism;
- less institutional density.

Avoid:

- luxury lifestyle imagery;
- stacks of money;
- aspirational manipulation.

## VE-09 — Economic Intelligence

**Intent:** inflation, rates, GDP, macro cycles.

Visual language:

- time/geography;
- layered economic flows;
- macro data contours;
- subtle structural cycles.

Avoid:

- flags and politicians;
- literal newspaper montage;
- overly national visual coding.

## VE-10 — Neutral LiOS

**Intent:** general chat, unclassified Project, onboarding.

Visual language:

- strongest pure LiOS identity;
- dark architectural intelligence environment;
- amber focal identity;
- adaptable to any domain.

Neutral is the general-purpose reference within the optional environment library, not a mandatory shell or new/unconfigured workspace default.

---

# 4. Shared visual DNA

All assets should feel created by one art direction.

Required:

- near-black base;
- matte rather than glossy;
- premium contrast;
- controlled amber / burnt orange / warm gold;
- restrained indigo / violet / cyan;
- high detail around edges;
- quieter central working zone;
- architectural depth;
- realistic or abstract-premium rendering;
- no visual noise behind content;
- no embedded text;
- no logos or third-party marks.

The first reaction should be:

> “This feels like LiOS.”

Not:

> “This is a random AI-generated finance wallpaper.”

---

# 5. Composition safe zones

Desktop master assets should anticipate common UI regions.

## Left rail zone

Keep enough tonal stability for the Project/Chat rail.

## Center composer zone

Avoid:

- bright highlights;
- faces;
- high-contrast objects;
- strong lines cutting through text.

## Right Artifact zone

Contextual rendering may retain richer detail here, but Focus mode will usually cover it with opaque analytical surfaces.

## Top chrome zone

Avoid highly luminous edges that compete with navigation/status elements.

---

# 6. Asset variants

For each environment, produce:

1. **Master**
   - high-resolution archival source.

2. **Desktop production**
   - optimized for common desktop sizes.

3. **Low-resource**
   - smaller dimensions/size;
   - no motion dependency.

4. **Fallback**
   - compatible with reduced visual mode.

Optional only after performance validation:

5. **Depth/motion layer**
   - extremely subtle;
   - must not require video;
   - should be possible with still layers/parallax or lightweight shader/CSS effects.

---

# 7. Suggested technical characteristics

Final exact values should be benchmarked during UX-P12/P13.

Guidance:

- prefer modern compressed image formats supported by packaged desktop stack;
- preserve a high-quality fallback where needed;
- preload only current environment and likely next environment;
- do not load all masters at startup;
- use local cache;
- avoid large animated GIF/video;
- motion layer should be optional and separable from base image;
- include deterministic manifest versioning.

---

# 8. Environment selection policy

Selection order should be predictable.

First respect imagery disabled/solid/reduced-resource preferences and the matte new/unconfigured default. When environments are enabled, use:

1. explicit Project pin;
2. explicit saved user selection for current Project;
3. strong Project semantic context;
4. strong active workflow context;
5. enabled Project environment default;
6. Neutral LiOS only as the enabled library fallback.

Do not switch environment merely because the user asks a small follow-up question.

---

# 9. Project continuity rule

Once a Project environment is selected and work begins:

- keep it stable;
- preserve it across chats where appropriate;
- restore it when the Project is reopened;
- allow explicit pin/change;
- do not turn Project use into a slideshow.

The visual environment acts as soft spatial memory.

---

# 10. Color behavior

Gold remains the current shell brand identity; legacy amber/orange scene accents are optional artwork, not shell-token authority.
Environment art may introduce:

- warm gold;
- burnt orange;
- indigo;
- violet;
- cyan.

Semantic market colors remain reserved primarily for actual analytical meaning.

Do not use environment green/red in ways that could be confused with gain/loss, success/failure or risk state.

---

# 11. Motion specification

Permitted:

- extremely slow parallax;
- faint network pulse;
- subtle light drift;
- short environment intensity transition.

Not permitted:

- looping financial ticker animation;
- fast particles;
- flashing market indicators;
- continuous camera movement;
- moving charts behind the UI.

Motion must stop/reduce in Focus state.


Reduced-motion uses static imagery; disabled imagery, reduced-data/software/low-resource modes retain a readable solid fallback. The separately approved illustrative foreground landing sample ticker is not a financial background-motion allowance.
---

# 12. Asset review scorecard

Each candidate should be reviewed on:

| Dimension | Question |
| --- | --- |
| LiOS identity | Does it unmistakably belong to the same product family? |
| Premium quality | Does it feel designed rather than generically generated? |
| Context fit | Does it communicate its environment without literal clichés? |
| Composer safety | Can text/composer sit over it cleanly? |
| Peripheral richness | Is visual detail concentrated where UI can tolerate it? |
| Contextual viability | Does it remain useful after opacity/vignette reduction? |
| Focus viability | Can it disappear gracefully? |
| Semantic safety | Does it avoid confusing finance color meaning? |
| Accessibility | Can a solid or reduced-image fallback substitute cleanly? |
| Performance | Can it be compressed enough for desktop packaging? |

Do not approve an asset solely because it looks good full-screen.

---

# 13. Prompting/art direction template

When generating production candidates, prompts should describe:

- product context;
- visual architecture;
- negative space requirement;
- LiOS palette;
- professional tone;
- prohibited clichés;
- camera/composition;
- no text/logos;
- dark near-black base;
- peripheral richness;
- center readability.

Example art-direction structure:

```text
Premium dark financial intelligence environment for a desktop analytical operating system.
Near-black matte architecture with restrained amber/gold identity accents and subtle indigo/cyan depth.
High visual detail at the outer edges, quiet negative space around the central composer area.
Sophisticated abstract representation of [CONTEXT].
Cinematic depth but professional, not cyberpunk, not gaming UI.
No text, no logos, no stock charts, no businesspeople, no floating finance icons.
Designed to sit behind a highly legible conversational interface and recede beneath analytical panels.
```

Each environment should then add its own context-specific vocabulary.

---

# 14. Ownership and provenance

For every production asset record:

- environment ID;
- generation/source method;
- creation date;
- final approved file;
- derivative/optimization chain;
- usage rights/ownership;
- version;
- checksum where useful.

Avoid introducing ambiguous third-party visual licensing into the packaged desktop product.

---

# 15. Acceptance journey for environments

A candidate library is not complete until tested in this flow:

```text
Open Project in Immersive
→ read composer and starter actions
→ submit prompt
→ transition to Contextual
→ read conversation and compact Artifact
→ open model/chart
→ transition to Focus
→ close/focus out
→ return to Contextual
→ close LiOS
→ reopen Project
→ same environment restored
```

The user should notice continuity, not the mechanism.

---

# 16. Final production rule

The environment library should make LiOS **more memorable without making analysis harder**.

If an environment is beautiful but reduces clarity, remove or redesign it.

If an environment is contextual but visually generic, improve it.

The bar is:

> premium intelligence atmosphere + analytical discipline + unmistakable LiOS identity.


Human environment review is necessary but not sufficient release evidence. Under the [Shipping Point contract](../technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md), SP-01–SP-07 require real MSJs, applicable packaged/target execution, no fake success, accepted-behavior regression protection and exact commit/build/topology/journey/outcome/limitations records. Source presence, screenshots and unsigned smoke cannot establish SP acceptance or P14 release proof; no acceptance is asserted here.