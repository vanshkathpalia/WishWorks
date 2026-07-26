# 3. Data model — the canonical schema

Marketplace-agnostic core; Flipkart/Meesho specifics live only in `ChannelListing.payload`
(JSONB) and the adapters. Money is **integer paise**. Timestamps are **UTC**.

## Entity map

```
Component ──< ComboItem >── Product ──< ChannelListing >── (marketplace)
                               │
Keyword (bank)                 ├──< ListingContent  (generated copy, versioned)
                               └──< OpportunityScore (P1)
Order ──< OrderItem ──> Product          (P2)
BusinessEvent (append-only log)          (all phases)
```

## Tables (Prisma-shaped; final types decided at implementation)

### Component — the atoms of the balloon business
| field | type | notes |
|---|---|---|
| id | cuid | |
| name | string | "12in metallic balloon", "foil digit 1 (gold, 32in)" |
| category | enum | `LATEX, METALLIC, FOIL_LETTER, FOIL_DIGIT, FOIL_SHAPE, BANNER, ARCH_STRIP, PUMP, RIBBON, LED, TOPPER, CURTAIN, MISC` |
| color | string? | normalized palette name ("rose-gold", "black") |
| size | string? | "12in", "32in" |
| costPaise | int | supplier cost per unit |
| weightGrams | int | feeds shipping estimates |
| inStock | bool | |

### Product — a sellable SKU (single item OR combo kit)
| field | type | notes |
|---|---|---|
| id | cuid | |
| sku | string @unique | our internal SKU code |
| title | string | internal working name |
| kind | enum | `SINGLE, COMBO` |
| theme | string? | "1st-birthday", "baby-shower", "anniversary", "haldi" |
| palette | string? | "black-gold", "pastel-rainbow" |
| costPaise | int | derived from components at creation, snapshotted |
| status | enum | `IDEA, DRAFT, READY, LISTED, RETIRED` |
| source | enum | `MANUAL, COMBO_GENERATOR` |

### ComboItem
`productId + componentId + quantity` — what's inside a kit.

### Keyword — the keyword bank
| field | type | notes |
|---|---|---|
| id | cuid | |
| phrase | string | normalized lowercase |
| marketplace | enum | `FLIPKART, MEESHO, GOOGLE` |
| source | enum | `AUTOSUGGEST, MANUAL, COMPETITOR_TITLE, MEESHO_RECS` |
| firstSeenAt / lastSeenAt | datetime | rising-query detection = seen recently but not before |
| tags | string[] | "birthday", "foil", occasion tags for matching to products |

### ListingContent — generated copy, versioned per product per marketplace
| field | type | notes |
|---|---|---|
| id, productId, marketplace | | |
| version | int | regeneration bumps it; never overwrite |
| title | string | per-platform formula |
| description | text | |
| bullets | string[] | |
| attributes | jsonb | full platform attribute map (color, occasion, material, pack size…) |
| keywordsUsed | string[] | traceability back to the bank |
| model | string | which Claude model produced it |

### ChannelListing — a product live (or being prepared) on a marketplace
| field | type | notes |
|---|---|---|
| id, productId | | |
| marketplace | enum | `FLIPKART, MEESHO` |
| externalId | string? | FSN / Meesho catalog id, once known |
| state | enum | `PREPARING, EXPORTED, UPLOADED, QC_PENDING, LIVE, QC_REJECTED, INACTIVE` |
| priceMrpPaise / priceSellingPaise | int | |
| stock | int | |
| payload | jsonb | the exact exported row/API body — audit + re-export |
| qcNotes | text? | rejection reasons, for the validator to learn from |

### OpportunityScore (P1)
`productId (kind=COMBO, status=IDEA)`, `score float`, `signals jsonb`
(autosuggest hits, competitor count, median competitor price, review counts, margin %),
`computedAt`. Score formula lives in [5-combo-generator.md](5-combo-generator.md).

### Order / OrderItem (P2)
Marketplace order id, marketplace enum, state, amounts in paise, per-item link to Product.
Flipkart rows from API; Meesho rows from panel CSV import.

### BusinessEvent — append-only, from day 1
| field | type | notes |
|---|---|---|
| id, at | | |
| type | string | `listing.published, price.changed, discount.started, stockout, qc.rejected, …` |
| productId? / channelListingId? | | |
| payload | jsonb | old/new values, free-form context |

No updates, no deletes. This is the seed of P3's Business Memory.
