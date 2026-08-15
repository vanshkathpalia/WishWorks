# Handover — four seller accounts, shared data, no server

> **Written 2026-08-14 to start a fresh chat on WW-154.** Everything decided so far is here, with
> the reasoning, so nothing gets re-litigated. Read `../../CLAUDE.md` first for how we work, then
> this. The live ledger is `../tracks/notion/TICKET_STATUS.md` (WW-153, WW-154, WW-155) and the
> mistake trail is `../tracks/notion/CORRECTIONS.md` (C-055).

---

## 1. What the business actually looks like

Six or seven people, **four seller accounts**, roughly two people per account. Each seller account
is a Flipkart + Meesho seller login, and **both were created from a Gmail**. The pair on one
account must see that account's data. A different account means different data — different SKUs,
different listings, different costings.

One PC currently holds **one account**. Several PCs can share an account. Nobody is switching
accounts on a single machine yet, and that is what makes the first version small (see WW-155).

Only the **finished** output has to be shared — the images with the metadata already ingested,
the ones that go up on the marketplace. Vansh, verbatim: *"all these raw data should be insane
[not in sync]. The final product which is going under WishWorks ready should be in sync, not the
raw data which we are getting from ChatGPT or getting from downloading from Meesho or Flipkart."*

---

## 2. The decisions already made — do not re-open these

**No login screen. No server. No Google OAuth, no Drive API.**

The identity already exists: one seller account = one Gmail = one Drive folder = one workspace,
shared in Drive with exactly the pair who work it. Google's folder sharing is the access control,
and it is real — a password check inside an Electron app is theatre, because the files sit on the
local disk and Explorer opens them regardless of what our UI says. Drive Desktop syncs a folder;
the app reads a path. That is the whole integration.

Vansh's reason for tying the Drive to the seller Gmail is worth keeping: *"this Meesho and
Flipkart ID are also made from Gmail, then why not keep this Google Drive same... so that there is
less confusion about where the Google Drive data for which account is stored."* One less identity
to invent, and no mapping table to keep correct.

**One folder per account for the finished output.** No per-occasion or per-SKU folder trees —
*"just be simple with that."*

**Flag, never block.** The partners are new to this and mistakes are expected. Nothing in this
feature may stop work; it may only mark it.

**Raw downloads stay local.** ChatGPT replies and marketplace exports are not synced.

---

## 3. What to build (WW-154)

### 3.1 The accounts list

`settings.json` (in `userData`, see `gui/main.ts`) gains:

```json
"accounts": [
  { "label": "GTB — gtb.wishworks@gmail.com", "workspace": "G:\\My Drive\\WishWorks-GTB", "skuPrefix": "GTB" }
],
"activeAccount": 0
```

`skuPrefix` is optional. **Unset means no flagging at all** — an account that does not want the
warning never sees one.

### 3.2 Switching

Switching writes `activeAccount` and **relaunches**, exactly as `chooseProductsFolder` and
`chooseKitsFolder` already do. The reason is not laziness: `paths.ts` resolves `WW_*_DIR` once, at
module load, from env vars `gui/main.ts` sets before the engine is imported. A setting that
half-applied would be worse than one that restarts. WW-153 built this pattern for the products
folder — copy it, do not invent a second mechanism.

`WORKSPACE` in `gui/main.ts:92` becomes "the active account's workspace", and every existing
`WW_*_DIR` line below it keeps working untouched.

### 3.3 The always-visible label

**The current account's name is on screen at all times**, in the step rail (`renderer/main.tsx`).
This is the actual safety feature — a standing answer to "whose data am I looking at", which is a
question nobody thinks to ask before making the mistake. It is worth more than every flag below.

### 3.4 The SKU flag, in four places

The person who imports a file is often not the person who fills the form an hour later, so a
warning that appears once and vanishes is a warning nobody sees:

1. **On import** (Listing copy / `inbox.ts`): `ANP003 — this account is GTB.` It still imports on
   the same click. Blocking is wrong here: sometimes the file is right and the prefix is a typo.
2. **On the listing row** in `ListingPicker` (`renderer/ui.tsx`) — a chip, so a wrongly-imported
   file stays visibly wrong for whoever picks it up next.
3. **In the Fill pre-flight** — one more reason `needsEyes` is non-zero, which the Flipkart panel
   already shows before Save.
4. Nothing else. No blocking, no modal, no confirmation dialog.

### 3.5 The shared folder itself

Nothing to build. The Finish step's output folder is already a remembered per-step folder picked
in a dialog (`renderer/steps.tsx:311`), and Check reads the same one. Point it at the account's
Drive folder and the pair are in sync today. If a per-account default is wanted later, it belongs
in the account entry beside `workspace`.

---

## 4. What NOT to build

- **Per-account Chrome profiles — WW-155, deferred deliberately.** `PROFILE_DIR` is one profile in
  `userData`, so two accounts on one machine would leave you logged in as the previous seller
  while filling the next seller's listing, on a live marketplace. It cannot happen while one PC
  holds one account, and the guard would be untestable code for a case nobody is in. When it is
  built: `userData/profiles/<account>/`, and it must **never** live in the Drive folder — a synced
  Chrome profile corrupts.
- **Syncing images or the whole workspace.** A sync service can replace a file with a placeholder,
  which `sharp` then reads as a broken image. Megabytes per listing across seven people is how you
  find that out. The kits setting exists precisely to sync kilobytes of JSON without the images.
- **Syncing the prompts.** A prompt edit made in the app is per-machine on purpose (WW-125/C-050);
  syncing them silently overrides everyone.
- **A real backend (Supabase/Firebase).** It earns its place the day someone must be *stopped*
  from seeing something — an employee who must not see the partners' costings. Nobody is in that
  position yet.

---

## 5. Where the release stands

`WW-153` is done and uncommitted in the working tree alongside several earlier sessions' work.
**Agreed with Vansh, still to run:**

- Commit the tree in feature-sized groups. Where one file carries two features, it goes in one
  commit rather than being split — *"don't overcomplicate."*
- **Never commit `products/*.json` or `image-meta/*.json`.** They are Vansh's real listings; a
  partner pulling the repo would see already-built data and take it for his own. In development
  the workspace **is** the repo (`gui/main.ts:storedWorkspace`), which is the only reason they
  land there — `products/GTB002(2).json` and the deleted `image-meta/EXAMPLE-ANP-1042.json` are
  both that churn, not source changes. Worth a `.gitignore` rule and a `git rm --cached` pass.
- **Version goes to `1.0.0`**, not a patch bump — Vansh's call, and the accumulated work is a
  release, not a fix. `flipkart-autofill/package.json`, then tag `v1.0.0` and push. The tag is
  what triggers `.github/workflows/build.yml` to build the `.exe` + `.dmg` and publish the
  GitHub Release; installed apps update themselves from it on next launch.

---

## 6. The five files this touches

| File | What changes |
|---|---|
| `flipkart-autofill/gui/main.ts` | `accounts` + `activeAccount` in `Settings`; `WORKSPACE` reads the active one; switch handler that relaunches |
| `flipkart-autofill/gui/shared.ts` + `preload.ts` | two channels: read the accounts, switch to one |
| `flipkart-autofill/gui/renderer/main.tsx` | the always-visible label in the rail; account list in Settings |
| `flipkart-autofill/gui/renderer/ui.tsx` | the prefix chip on `ListingPicker` rows |
| `flipkart-autofill/src/inbox.ts` | the prefix mismatch on import — reported, never blocking |

Start from the WW-153 diff: it is the same shape (a stored folder setting, a chooser that
relaunches, a path shown on the panel that uses it) and it is the pattern to copy.
