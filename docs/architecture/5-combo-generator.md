# 5. Combo Generator (P1) — "what should we list next?"

**Goal:** a ranked, refreshed queue of new balloon-kit combinations worth listing, each one
click away from entering the Listing Factory.

## Why this works for balloons specifically

Kits are combinatorial: `theme × occasion × color palette × component set × pack size`
yields thousands of candidates from a few dozen components — e.g.
*"Golden 1st Birthday kit: foil digit '1' + 30 metallic (black/gold) + HBD banner + arch strip
+ glue dots"*. Competitors can't cover the space either; the winner is whoever finds the
under-served combinations first. That's a search problem, and search problems are code.

## Pipeline

```
generate candidates ──▶ gather signals ──▶ score ──▶ ranked queue ──▶ human picks ──▶ Listing Factory
     (combinatorics)      (keyword bank +      (deterministic         (CLI/report)      (P0 pipeline)
                           public signals)      formula)
```

### 5.1 Candidate generation
- Template-driven, not brute force: a `KitTemplate` (e.g. "digit birthday kit" = 1 foil digit
  + N metallic + banner + strip) crossed with themes, palettes, and digit/letter variants,
  constrained to in-stock components. Dedup against existing `Product` rows.
- Each candidate is stored as `Product(kind=COMBO, status=IDEA, source=COMBO_GENERATOR)`
  with computed `costPaise`.

### 5.2 Signals (observable, free, respectful)
| Signal | Source | Meaning |
|---|---|---|
| `demand` | keyword-bank hits matching the candidate's theme/palette (weighted: rising query ×2) | people search for this |
| `competition` | count of matching listings in Flipkart/Meesho public search results (rate-limited fetch) | how crowded |
| `priceGap` | median competitor price vs our cost → achievable margin % | is there money in it |
| `reviewMass` | total review counts of top matching listings | proven category demand |
| `seasonality` | static calendar map (Diwali, NY, wedding season, Raksha Bandhan…) | list 3–4 weeks before the spike |

All signals snapshot into `OpportunityScore.signals` (JSONB) — **known facts vs estimates are
labeled**; review counts are facts, "demand" is a proxy.

### 5.3 Score (deterministic, explainable — same philosophy as the planning doc)
```
score = demandNorm^0.35 × marginNorm^0.30 × competitionGapNorm^0.25 × seasonBoost^0.10
```
Geometric weighting: a candidate that's terrible on any axis dies (a zero-margin combo can't
be rescued by demand). Weights are constants in code, tuned by looking at outcomes — never
by the LLM. Every score renders an explanation ("scored 0.71: 14 matching queries (3 rising),
62% margin at ₹349 median, only 8 competitors, Diwali +boost").

### 5.4 Output
`wishworks opportunities` prints/exports the top 20 with explanations. Operator accepts →
`status: IDEA → DRAFT` → straight into `wishworks generate`. Rejected candidates keep their
scores so we never re-surface duds.

### The feedback loop (bridge to P3)
Every accepted candidate that goes live gets its actual sales (P2 order data) compared against
its predicted score — the first real "recommendation → outcome → learning" loop from the
planning doc, arriving naturally without building the intelligence platform first.
