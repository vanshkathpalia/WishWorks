# WishWorks Seller OS — Architecture

Lean architecture for the WishWorks listing-automation + seller-intelligence system
(balloon / party-supplies business selling on **Flipkart** and **Meesho**).

## Read in order

| # | Doc | What it covers |
|---|-----|----------------|
| 1 | [1-overview.md](1-overview.md) | The product, priorities, and hard platform constraints |
| 2 | [2-tech-stack.md](2-tech-stack.md) | Stack choices and why |
| 3 | [3-data-model.md](3-data-model.md) | The canonical database schema |
| 4 | [4-listing-factory.md](4-listing-factory.md) | **P0** — the #1 pain-killer: idea → upload-ready listing |
| 5 | [5-combo-generator.md](5-combo-generator.md) | **P1** — systematic "what to list next" engine |
| 6 | [6-marketplace-adapters.md](6-marketplace-adapters.md) | Flipkart API + Meesho Excel: exact integration surface |
| 7 | [7-roadmap.md](7-roadmap.md) | Linear build order (no roles/tracks — straight campaign) |

## The system in one diagram

```
                        WISHWORKS SELLER OS

  SOURCES                      CORE                        OUTPUTS
┌─────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│ Keyword          │   │  PostgreSQL           │   │ Meesho bulk-upload   │
│ Harvester        │──▶│  ─ components         │   │ Excel (filled)       │
│ (FK/Meesho       │   │  ─ products/combos    │──▶├──────────────────────┤
│  autosuggest)    │   │  ─ keywords           │   │ Flipkart catalog     │
├─────────────────┤   │  ─ listings/channels  │   │ Excel + /listings/v3 │
│ Competitor       │──▶│  ─ orders             │   ├──────────────────────┤
│ signal collector │   │  ─ business_events    │   │ Pre-QC validation    │
├─────────────────┤   ├──────────────────────┤   │ report               │
│ Flipkart Seller  │──▶│  Combo Generator      │   ├──────────────────────┤
│ API (orders,     │   │  + Opportunity Scorer │   │ Ranked "list next"   │
│ price, stock)    │   ├──────────────────────┤   │ queue                │
├─────────────────┤   │  Content Generator    │   ├──────────────────────┤
│ Meesho panel     │──▶│  (Claude + keyword    │   │ (P3) Dashboard       │
│ exports (CSV)    │   │   bank, per-platform  │   │  Next.js             │
└─────────────────┘   │   templates)          │   └──────────────────────┘
                       └──────────────────────┘
```

## Phases

| Phase | Name | Goal |
|-------|------|------|
| **P0** | Listing Factory | Product idea → upload-ready Flipkart + Meesho listing in minutes |
| **P1** | Combo Generator | Ranked queue of new balloon-kit combinations worth listing |
| **P2** | Ops Sync | Flipkart API price/stock/orders automation + business event log |
| **P3** | Dashboard & Intelligence | Command center, product intelligence, historical Seller A/B analysis |

**We are on P0.** Don't build future-phase work early.

## Core principles

1. **Semi-automated creation, fully-automated ops.** Neither platform lets an API create
   brand-new products, so listing creation is generate-validate-review-upload; price/stock/orders
   (Flipkart) are fully automatic.
2. **One canonical product model, marketplace adapters at the edge.** Flipkart and Meesho are
   export/import adapters. Amazon later = one more adapter, zero core change.
3. **Deterministic data decides; the LLM only writes and explains.** Keyword scores, opportunity
   scores, and validations are code. Claude generates copy grounded in the keyword bank.
4. **Log business events from day 1.** Every listing published, price changed, discount started —
   cheap to record now, priceless for P3 intelligence.
