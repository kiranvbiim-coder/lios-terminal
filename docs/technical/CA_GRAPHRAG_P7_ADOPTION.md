# GraphRAG → LiOS P7: rights-gated evidence relationships (SI-05)

**Donor:** microsoft/graphrag, exact source/tree SHA `769542fbf1d8e5b4c6a8677fefc34621c87894c5`, MIT (full license `third_party/licenses/graphrag-MIT.txt`, upstream blob `9e841e7a26e4eb057b24511e7b92d42b257a80e5`). GitHub mirror `kiranvbiim-coder/graphrag` observed at the same SHA; the mirror is not itself a product import.

**Selected coherent mechanism:** `packages/graphrag/graphrag/query/input/retrieval/relationships.py` (in-network relationship selection and rank) + `packages/graphrag/graphrag/query/context_builder/source_context.py` (bounded source context). Original blobs `fdb3f81ed897fd929593303a1c9274af4a6b518e`, `ff121b8cdd91e3a0e85465ff54167b791c7ab580`. Adapted into `src/server/graphragPermittedEvidenceLinks.ts`, tests in `src/server/graphragPermittedEvidenceLinks.test.ts`, **actual tool consumer** `src/server/researchSourceCompositionTool.ts`.

**Canonical seam:** The existing P7 tool authenticates exact tenant, Project, source scope, allowed ref set and AI transmission rights before returning `composition.included`. The new pure helper compares ONLY those permitted source objects and counts shared canonical P5 entity refs; never queries GraphRAG indexes/models, P7 raw documents or blocked source identities. The returned `graphLinks` are **co-mention proximity hints**, not factual claims of influence, ownership, supply chain or financial materiality. No new graph DB, index, LLM, API credentials or storage authority.

**Selection / exclusions:** Source text-unit shuffling, random seed/global RNG, pandas and tokenizer are deliberately removed because P7 owns query ranking, deterministic receipts and output bounds. External-community modeling, auto-extraction, vector store, GraphRAG's database/cache provider, prompt assembly and multi-agent search are deferred until a source-rights/installer/customer journey qualifies them. These exclusions are for conflicting P7/P5 identities, evidence rights and unnecessary dependency closure, not because donor material is harder to import. Upstream Python unit harness is replaced here by deterministic native tests covering ranking, no false edges, duplicate ID rejection, bounds and real tool output schema. This is **one mechanism adapted**, not a full GraphRAG package audit or runtime installation.

**Execution gates:** Native V1 source and tool/schema tests; re-check real Project/AI rights in existing P7 regression; select complete larger upstream package by a user-facing financial twin journey; verify SPDX for any new paths and license third-party embed; target installer and SP-05 packaged acceptance. This PR remains unmerged until review and does not certify end-to-end financial knowledge-graph Q&A.

## Coherent in-network neighborhood expansion (SI-03 follow-on)

The existing GraphRAG-approved two-source import now additionally adapts
`get_candidate_relationships`, `get_in_network_relationships`, and
`source_context.count_relationships`-style bounded incidence selection into
a deterministic P7 `graphNeighborhoods` response alongside `graphLinks`.
It exposes **direct** evidence co-mention neighbors and explicitly labeled
**two-hop** navigation hints, with no invented relationship, causal inference,
model citation, graph store, or outside-rights source. All source IDs must be
within `composeResearchSources(...).included` after authenticated P7/AI rights
filtering; a forged external/blocked source edge fails closed. Rank and
neighborhood output is capped to the same 50-source/50-link policy and used
by the existing `lios.research.compose_sources` tool. The MIT upstream pin,
license, retained source paths and owner remain unchanged. This does **not**
import GraphRAG's Python runtime, tokenizer, vector DB, community discovery,
text extraction or Microsoft model/data assets. Native V1 and owner-scoped
Project V2/packaged V3 are separate acceptance gates.
