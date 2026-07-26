# Build the WishWorks inventory in Notion

**Paste this whole file into the Claude account that is connected to the right Notion
workspace.** It is a build spec — that Claude should create the databases, set the
properties, and load the seed rows below.

Source: the Google Sheet *"inventory for distribution"*, tab **Dropdown** (the kit/SKU
builder). It uses VLOOKUP against a material master and SUM for the SKU cost, which is
why its cost cells break. Notion replaces those with **relations + rollups**, which do
not break.

---

## Instructions for the Notion-connected Claude

Create **three** databases inside one parent page called **WishWorks Inventory**.
Build them in this order — Notion cannot create a relation until both sides exist, and
cannot create a rollup until the relation exists.

1. `Materials` — the master list. One row per physical item. This is what the sheet's
   VLOOKUP was reaching for.
2. `Kits` — one row per SKU (MKU003, etc.).
3. `Kit Lines` — the junction: "this kit contains N of that material". One row per line
   of the old sheet.

Do **not** put the quantities on `Materials`. A material appears in many kits at
different counts; that is what `Kit Lines` is for.

---

## 1. `Materials`

| Property | Type | Config |
|---|---|---|
| `Material` | Title | The specific material name |
| `Category` | Select | `Banner`, `Balloon`, `KT`, `Tape`, `Character`, `Light`, `Other` |
| `Unit cost` | Number | Format: Rupee. Cost of **one** piece |
| `Stock on hand` | Number | Integer. Optional — see "open question" at the end |
| `Reorder level` | Number | Integer. Optional |
| `Needs restock` | Formula | `if(prop("Stock on hand") <= prop("Reorder level"), "⚠️ Restock", "OK")` |
| `Used in` | Relation | → `Kit Lines` (created in step 3, shows up automatically) |
| `Active` | Checkbox | Default checked. Uncheck instead of deleting |

`Category` is a **Select**, not text. That is the dropdown that got lost in the CSV
export — CSV carries only the chosen value, never the list of options. Type all seven
options in by hand so the dropdown works on new rows.

### Seed rows

Unit costs are **derived** — the sheet stored a line cost for the whole quantity
(e.g. 20 balloons for ₹16), so unit cost = line cost ÷ quantity. Verify against the
real material master before trusting them.

| Material | Category | Unit cost |
|---|---|---|
| BLUE Balloon | Balloon | 0.80 |
| WHITE BALLOONS | Balloon | 0.80 |
| SILVER MATALIC BALLOONS | Balloon | 0.80 |
| BLUE Dark Balloon | Balloon | 0.80 |
| CONFETI SILVER BALLOONS | Balloon | 2.00 |
| BLUE MATTALIC Curtain | KT | 4.00 |
| Glue dote stripe | Tape | 1.00 |
| ARCH TAPE | Tape | 3.50 |
| Car theme topper | Character | *(unknown — was 0 in the sheet)* |

Leave `Unit cost` **empty** where it is unknown. Do not enter `0` — zero is a real price
and it silently under-counts the SKU cost. Empty shows up as a gap you can find.

---

## 2. `Kits`

| Property | Type | Config |
|---|---|---|
| `SKU` | Title | e.g. `MKU003` |
| `Kit name` | Text | e.g. "Blue & Silver Car Theme Decoration Kit" |
| `Theme` | Select | `Car`, `Birthday`, `Anniversary`, `Baby Shower`, `Other` |
| `Channel` | Multi-select | `Meesho`, `Flipkart` |
| `Status` | Status | `Draft` → `Ready to list` → `Live` → `Retired` |
| `Lines` | Relation | → `Kit Lines` |
| `Total pieces` | Rollup | `Lines` → `Quantity` → **Sum** |
| `Material cost` | Rollup | `Lines` → `Line cost` → **Sum** |
| `Costed lines` | Rollup | `Lines` → `Line cost` → **Not empty** |
| `Cost complete` | Formula | `if(prop("Costed lines") == prop("Lines").length(), "✅", "⚠️ missing cost")` |
| `Selling price` | Number | Format: Rupee |
| `Margin` | Formula | `prop("Selling price") - prop("Material cost")` |

`Cost complete` is the guardrail. In the spreadsheet a single missing material poisoned
the whole SUM into `#VALUE!`. Notion's rollup just skips blanks, so the total looks fine
while being wrong — this flag is what tells you the total is only partial.

### Seed row

| SKU | Total pieces (expected) | Material cost (expected) |
|---|---|---|
| MKU003 | 88 | ₹80.50 so far, **incomplete** — Banner and Car theme topper have no cost |

88 and 80.50 are the check figures. After loading `Kit Lines`, the rollups must show
exactly these. If `Total pieces` isn't 88, a line didn't load.

---

## 3. `Kit Lines`

| Property | Type | Config |
|---|---|---|
| `Line` | Title | Auto-ish; use `MKU003 — BLUE Balloon` format |
| `Kit` | Relation | → `Kits` |
| `Material` | Relation | → `Materials` |
| `Quantity` | Number | Integer |
| `Unit cost` | Rollup | `Material` → `Unit cost` → **Show original** |
| `Line cost` | Formula | `prop("Quantity") * prop("Unit cost")` |
| `Category` | Rollup | `Material` → `Category` → **Show original** |

### Seed rows (all ten lines of MKU003)

| Line | Kit | Material | Quantity |
|---|---|---|---|
| MKU003 — Banner | MKU003 | *(create a `Banner` material first — the sheet left it blank)* | 1 |
| MKU003 — BLUE Balloon | MKU003 | BLUE Balloon | 20 |
| MKU003 — WHITE BALLOONS | MKU003 | WHITE BALLOONS | 20 |
| MKU003 — SILVER MATALIC BALLOONS | MKU003 | SILVER MATALIC BALLOONS | 20 |
| MKU003 — BLUE Dark Balloon | MKU003 | BLUE Dark Balloon | 20 |
| MKU003 — CONFETI SILVER BALLOONS | MKU003 | CONFETI SILVER BALLOONS | 2 |
| MKU003 — BLUE MATTALIC Curtain | MKU003 | BLUE MATTALIC Curtain | 2 |
| MKU003 — Glue dote stripe | MKU003 | Glue dote stripe | 1 |
| MKU003 — ARCH TAPE | MKU003 | ARCH TAPE | 1 |
| MKU003 — Car theme topper | MKU003 | Car theme topper | 1 |

---

## Views to create

On `Kits`:
- **All SKUs** — table. Show SKU, Kit name, Total pieces, Material cost, Cost complete, Status.
- **Needs costing** — filter `Cost complete` contains `⚠️`. This is the fix-it queue.

On `Kit Lines`:
- **By kit** — board or table grouped by `Kit`. This is the old spreadsheet view, one
  group per SKU, and it is where you build a new kit.
- **By category** — grouped by `Category`. Answers "how much latex do all live kits eat".

On `Materials`:
- **Master** — table, grouped by `Category`.
- **Restock** — filter `Needs restock` = `⚠️ Restock`. Skip this view if stock isn't
  being tracked yet.

---

## Things that did NOT come from the spreadsheet

Two prompt notes were sitting in the sheet's top rows. They are instructions, not data —
put them on the **parent page body**, not in a database:

> Based on image uploaded and content given below kindly make the 2nd image showing content of the kit
>
> Act like meesho expert and create the high CTR and SEO content based on 2nd image uploaded

## Open question for Vansh

The tab exported here is **Dropdown** (the kit builder). The **inventory calculation**
tab — the actual stock master — was not in the export, so `Stock on hand`, `Reorder
level` and the real unit costs are guesses. Export that tab too and the `Materials`
seed table above should be replaced wholesale with its real contents.
