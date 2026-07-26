# 1. Overview — what we're building and why

## The product in one paragraph

**WishWorks Seller OS** is an internal automation system for a balloon / party-supplies business
selling on Flipkart and Meesho. It kills the #1 operational pain — creating new listings is slow,
repetitive, and error-prone — by generating upload-ready, SEO-optimized listing packages from a
single product definition, and it systematically answers "what combo should we list next?".
Later phases add fully-automated Flipkart ops (price/stock/orders) and the intelligence dashboard
described in `wishworks_seller_intelligence_platform_planning.md`.

## Priorities (user-stated, in order)

1. **Make listing easy and fast** — the Listing Factory (P0).
2. **Find new combinations to list** — the Combo Generator (P1).
3. Ops automation via Flipkart API (P2).
4. Dashboard / seller intelligence (P3) — builds on data P0–P2 already collect.

## Hard platform constraints (verified July 2026 — these shape everything)

### Flipkart
- Self-service seller API exists: Seller Dashboard → Manage Profile → **Developer Access** →
  Self Access Application (Client Credentials OAuth; access token valid 60 days, refresh 180).
- `POST /listings/v3` **cannot create new products** — it requires an existing 13–16-char
  `product_id` (FSN). Max batch = 10 SKUs.
- What the API *can* fully automate: selling price, MRP, stock at location level,
  activate/deactivate, procurement SLA, orders, shipments, returns.
- **New product creation** = seller dashboard catalog flow / bulk Excel + QC (24–72h).
  Common QC rejections: MRP visible in image, blurry images, wrong dimensions, missing
  manufacturer details.

### Meesho
- **No public seller API.** Integration credentials are partner-gated (Unicommerce, EasyEcom,
  Fynd). Not worth chasing at our scale yet.
- Listing = Supplier Panel → "Add Single Catalog" or "Add Bulk Catalog" (Excel template;
  red columns mandatory, green recommended). Images upload separately via "Images Bulk Upload";
  the resulting links are pasted into the Excel.
- Image spec: ~2000×2000 JPG, 85% quality, 200–600 KB, clean white background.
- Free demand signal: the panel's **Product Recommendations** tool — harvest it manually/weekly.

### Consequence
Listing creation is **generate → validate → human review → upload** (minutes, not half-hours).
Full no-touch automation applies only where APIs exist (Flipkart ops, P2).

## What "SEO" means here (synthesized from seller blogs/community)

- **Flipkart title formula:** `Brand + Main Keyword + Feature + Size/Pack`
  e.g. *"WishWorks Metallic Balloons for Birthday Decoration, 12 inch, Pack of 50 – Rose Gold"*.
- **Meesho titles:** specific and descriptive — *"Happy Birthday Foil Balloon Set with 30
  Metallic Balloons – Black & Gold"* beats *"Balloon Set"*.
- Keywords come from **platform autosuggest** (real buyer queries), not guesswork.
- Long-tail keywords go in bullets/description; never stuff titles.
- **Every attribute filled** — attributes drive filter visibility on both platforms.
- Meesho: Next-Day Dispatch tag = big organic boost; quality score ≥ 4.0; competitive pricing.
- Flipkart ranks products that *sell* — conversion, pricing, and seller metrics feed ranking.

## Non-goals (for now)

- No multi-tenant SaaS. Internal tool for WishWorks (+ Seller A/B data later in P3).
- No scraping that violates platform ToS; competitor signals limited to publicly observable
  data, collected respectfully and rate-limited.
- No Meesho partner-API integration until volume justifies it.
- No roles/tracks build methodology — single linear campaign (user decision, 2026-07-19).
