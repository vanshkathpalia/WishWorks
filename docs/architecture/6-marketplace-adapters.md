# 6. Marketplace adapters — exact integration surface

One canonical model in Postgres; everything platform-specific lives here. Verified July 2026;
re-verify endpoints when P2 starts.

## 6.1 Flipkart

### Access
1. Seller Dashboard → Manage Profile → **Developer Access** → create **Self Access Application**
   → get `app-id` + `app-secret`.
2. OAuth **Client Credentials** flow → access token (valid **60 days**; refresh 180). Client
   caches the token and auto-renews.
3. Sandbox: email `seller-api-queries@flipkart.com` for credentials →
   `https://sandbox-api.flipkart.net`. Production: `https://api.flipkart.net`.
4. Docs: `seller.flipkart.com/api-docs/` + `flipkart.github.io/fk-api-platform-docs/`.

### What we use, per phase
| Capability | Endpoint area | Phase | Notes |
|---|---|---|---|
| Create listing on **existing** FSN | `POST /listings/v3` | P2 | requires 13–16-char `product_id`; **max 10 SKUs/batch**; overwrites existing SKU listing |
| Price/MRP update | listings API | P2 | fully automatable |
| Stock update (location-level) | listings API | P2 | fully automatable |
| Activate/deactivate | listings API | P2 | |
| Orders / shipments / returns | orders APIs | P2 | order ingestion → `Order` table + events |
| **New product (new FSN)** | ❌ not in public API | P0 | category catalog **Excel via dashboard** + QC (24–72h) → Listing Factory exports this file |

### Required fields the exporter must always produce
`product_id` (post-QC), pricing (MRP + selling, paise→rupees), tax (**HSN + tax code** —
balloons typically HSN 9503/9505 chapter; confirm with CA once, store per category), listing
status, fulfillment profile, shipping provider, procurement type + SLA, location stock,
manufacturer/packer address, package dimensions & weight.

## 6.2 Meesho

### Access
- **No public seller API** (partner-gated: Unicommerce/EasyEcom/Fynd via
  `meesholink-integration@meesho.com`). Decision: not worth it at current scale — revisit if
  order volume makes panel work the bottleneck.
- Everything goes through the **Supplier Panel**.

### The flow our adapter automates around
1. Download the category's **bulk catalog Excel template** → keep versioned copy in
   `data/templates/meesho/` (snapshot test alerts when columns change).
2. Exporter fills the template: red-header columns (mandatory) always; green (recommended)
   always too — completeness is ranking fuel.
3. Images: pre-processed by the validator (2000×2000 JPG, 85%, 200–600 KB) → operator uploads
   via panel **Images Bulk Upload** → pastes returned links into the CLI → tool patches the
   Excel.
4. Operator uploads the Excel via "Add Bulk Catalog"; on approval, records the catalog id
   (`wishworks mark-live`).

### Meesho-side data ingestion (P2)
Orders/payments come from **panel CSV exports**, imported by a CLI command into the same
`Order` tables. Weekly manual harvest of the panel's **Product Recommendations** tool feeds
the keyword bank (`source: MEESHO_RECS`).

## 6.3 Adapter contract (code shape)

```ts
interface MarketplaceAdapter {
  buildExport(product: Product, content: ListingContent, listing: ChannelListing):
    Promise<ExportResult>;          // Excel file path or API payload
  validate(product, content, images): QcReport;   // platform-specific rules
  // P2, Flipkart only:
  pushPrice?(listing): Promise<void>;
  pushStock?(listing): Promise<void>;
  pullOrders?(since: Date): Promise<RawOrder[]>;
}
```

Adding Amazon later = implementing this interface. Core never imports platform specifics.
