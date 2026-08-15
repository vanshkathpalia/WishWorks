# Adopt-This-System — portable project operating manual

> ## ⚠️ STATUS & SAFE-USE BANNER — read fully before adopting (Notion = v2 FINAL)
>
> **1. Notion layout is FINALIZED (v2, Segment model) — Notion is still the LAST step.**
> The board uses a **`Segments` DB** of 6 lenses, `Phase` as a plain select, `Status` =
> Not Started/In Progress/Done, and **Learning + Documentation as separate inline DBs**
> under the *Learn* / *Documenting help* segment pages. The reusable spec is
> `docs/tracks/notion/NOTION_GUIDELINE.md` (v2). So:
> - **Build the non-Notion pillars first** — `CLAUDE.md`, `docs/architecture/`,
>   `docs/tracks/`, `docs/learning/`, and the documentation/learning *content*. These are
>   stable and independent.
> - **Do the Notion seed files LAST** (after the rest is confirmed). Nothing in
>   `CLAUDE.md` / `MEMORY.md` / `docs/learning/` / `docs/architecture/` / docs+learning
>   content depends on the Notion step, so Notion work cannot affect them.
>
> **2. Part-built projects are expected — backfill, don't overwrite.** Many target repos
> already have working code (e.g. up to ~level 6) but no `docs/learning/`, `docs/tracks/`,
> or `CLAUDE.md`. Do **not** ignore or overwrite that code. **Backfill** it (§6):
> reverse-engineer `docs/architecture/`, write **retroactive `docs/learning/` notes** for
> decisions already in the code, and reconstruct `docs/tracks/LEVELS.md` so already-built
> work shows as **cleared levels** (marked `Done`) and the rest as upcoming, phase-tagged.
>
> **3. Names may differ — FLAG, never assume.** The **folder name**, the **package name**,
> and the **Notion division/project name** can all be different. If you notice any naming
> mismatch, a reference to a *different* project, a path that doesn't exist, or anything
> suspicious — **STOP and ask the user.** Never guess, and never silently "fix" a name.
>
> **4. How many files to feed a NEW project → now 3 (Notion is finalized):**
> - **`ADOPT_THIS_SYSTEM.md`** (self-contained, mandatory),
> - **`docs/tracks/GUIDELINE.md`** (makes the `docs/tracks/` build exact),
> - **`docs/tracks/notion/NOTION_GUIDELINE.md`** (v2 Segment-model Notion build).
> - The seed/state files (`NOTION_BOARD_SEED.md`, `NOTION_DOCS_SEED.md`,
>   `NOTION_LEARNING_SEED.md`, `NOTION_SYNC.md`, `TICKET_STATUS.md`) are
>   **project-specific** — bring at most as *examples*, never feed verbatim to a new
>   project; that project generates its own from `NOTION_GUIDELINE.md`.

**What this is.** A single instruction you paste into **another** project's Claude Code
session so that project rebuilds the same operating system: a root **`CLAUDE.md`**, a
phase-aware **`docs/architecture/`**, a gamified **`docs/tracks/`** (linear levels annotated
by phase), a one-topic-per-file **`docs/learning/`** log, a repo-level
**`.claude/settings.json`**, and a **Notion board seed** you can hand to a
Notion-connected Claude — *without* needing the Notion MCP in the build session.

**How to use it.**
1. Open the *target* project in Claude Code.
2. Provide the reference files alongside this one:
   - **`docs/tracks/GUIDELINE.md`** (exact `docs/tracks/` build).
   - **`docs/tracks/notion/NOTION_GUIDELINE.md`** (v2 Notion build).
   - Optionally bring a seed file as an *example to mimic*, never to keep verbatim.
3. Paste the **one-shot prompt** at the bottom (§9), or paste this whole file, and let it
   work. It will ask you the few questions it can't infer.

> The philosophy: **the repo is the brain.** Everything that matters — design, plan,
> decisions, practices — lives in versioned Markdown so it survives new chats, new
> machines, renames, and a switch to a different Claude account. Notion is a *projection*
> of the repo, never a second source of truth.

---

## 0. First, understand the target project (don't write anything yet)

- Read every existing design/readme/architecture doc. If there's a `README.md` or an
  `architecture/` (or `docs/`) folder, read it in order.
- **Inspect the code that already exists.** Many projects are part-built (say up to
  "level 5–6") but have **no** `docs/learning/`, `docs/tracks/`, Notion tickets, or
  `CLAUDE.md`. Note what's already implemented — you'll **backfill** docs/levels for it
  (see §6).
- Identify: the product in one paragraph, the tech stack (and *why* each choice), the
  natural **phases** (even rough), and the genuinely separate **disciplines** (which become
  roles).
- **Flag naming mismatches (banner §3).** Check the folder name vs the package/app name vs
  any Notion division name. If they disagree, **stop and ask** — don't assume or rename.
- **Sequence the work so Notion is last** (banner §1).
- Then propose the plan and confirm with me before creating files.

---

## 1. The five pillars to create (the whole system)

```
CLAUDE.md                  operating manual, loaded every session
docs/architecture/         the "why" — numbered, phase-aware design docs
docs/tracks/               the gamified build plan: roles, rules, contracts, levels, tickets
docs/learning/             one-topic-per-file decision log (the teaching library)
docs/tracks/notion/        Notion seed files + in-repo ticket tracking
```

Plus three **cross-cutting layers:**
- **`.claude/settings.json`** (§5d) — repo-level Claude Code config (hook + git perms +
  co-author off); travels with the repo.
- **Claude Code file-based memory** (§5b) — convenience knowledge (preferences, the
  *why*, working rules) that **complements, never replaces** the repo.
- **`docs/key.md`** (§5c) — git-ignored catalogue of every external service/credential.

Build them in the order below. Match the *target project's* domain — everything here is a
pattern, not this project's content.

---

## 2. `docs/architecture/` — the "why"

Numbered Markdown files, `README.md` first (index + a phase table + a system diagram).
Typical set (adapt count to the project): overview, tech stack (+ "tech introduced by
phase"), user roles/RBAC, core flow(s), data model, API design, auth/security,
events/privacy, frontend architecture, infra/deployment, an MVP/phase plan, risks/open
questions, plus any product-specific docs.

**The thing most other projects miss: phases.** Define a canonical phase model (usually
P0 = foundation → later = scale/expansion) in one doc, and give **every** architecture
doc a short *"By phase"* footer. Phases must thread through the whole design.

---

## 3. `CLAUDE.md` — the operating manual (loaded into every session)

A root file that is the durable contract for how we work. Sections:

1. **What this project is** (60-second version + the moat/goal).
2. **Phases** (the canonical table; "we are on P_n"; "don't build future-phase work early").
3. **Tech stack** (the short list; "no new tech without a `docs/learning/` note explaining
   why").
4. **How we build** (if using the multi-role game: one hat per session, no cross-role
   source reading, contracts as the only handoff — see §4).
5. **Coding practices (non-negotiable):**
   - **File-top summary comment on every code file** (what it does · which role owns it ·
     relevant `docs/learning/` link) — *updated whenever the file changes.*
   - **Capture every new/non-obvious decision in `docs/learning/`** — however small (why
     GET vs POST, why a tool, why a number).
   - **Explaining code on request → persist it as a `docs/learning/` note**, not just chat.
   - **Comment the *why*, not the obvious *what*;** flag gotchas and invariants.
   - **Contracts are sacred** (change only via the ceremony in `docs/tracks/`).
   - **Project invariants** (list them; each backed by a `docs/learning/` note).
   - **Notion tickets (no MCP on this account):** repo holds ticket state — living ledger
     (`docs/tracks/notion/TICKET_STATUS.md`, updated the instant a task completes) + overwritten
     sync delta (`docs/tracks/notion/NOTION_SYNC.md`, regenerated at sync points). See §7a.
   - **Git — branch-per-ticket, commit approval + direct execution:**
     0. **Create the ticket's branch FIRST — before any code or doc edit**
        (`git checkout -b <phase>-<role>-<level>-<slug>`). Branch per role/task, named after
        the hat. Merge with `--no-ff` once the level's clear criteria pass, so the branch stays
        visible in the graph. This is a **standing rule, not a one-time step** — do not slip
        back to committing on the default branch (it lapses easily; catch it early).
     1. Before running `git add`/`git commit`, show the user the staged files and the **full
        proposed commit message (subject + body)** — this applies to **merge-commit** messages
        too. Wait for explicit approval ("go", "yes", "do it"); one showing per commit is enough.
     2. Once approved, run `git add` + `git commit` directly via Bash — do not hand back
        a heredoc.
     3. **Never add a `Co-Authored-By: Claude` line** or mention Claude anywhere in the
        commit message.
     4. Commit message format: `[P1][BE][L5] <brief what-changed>` — **ticket code in the
        subject** for every ticket-relevant commit (say "partial" if the level isn't fully
        cleared); **bullet body, not paragraphs** (same for ledger/docs entries).
     5. The PostToolUse hook fires automatically after each commit — it checks for maintenance
        tasks (ticket updates, `NOTION_SYNC.md`, `docs/learning/` notes, `docs/key.md`/`.env.example`).
        **Fold the `NOTION_SYNC.md` delta into the ticket's own commit**, not a separate one.
   - **Off-campaign / custom work → `[CUSTOM<n>]` tickets** (`[P_n][ROLE][CUSTOM<n>]`), numbered
     in **one global sequence** in the order raised — independent of the level campaign.
   - **Tests are the definition of done** (fill in the real test commands as services land).
6. **Repo map** + a housekeeping section.

Keep it blunt and specific. `CLAUDE.md` + `docs/architecture/` + `docs/tracks/` +
`docs/learning/` are the **portable context** — they travel with the folder even if chat
history and path-keyed memory don't.

---

## 4. `docs/tracks/` — the gamified build plan

Follow `docs/tracks/GUIDELINE.md` (copy it over if you can). Essentials:

- Build the project as **one person wearing several isolated hats** (2–4 roles by
  discipline + an Integration role). One hat per session; no peeking at another hat's
  source; **contracts are the only handoff**; bosses gate integration.
- Files: `README.md` (overview, roles table, XP scale, how levels work), `00_RULES.md`
  (isolation + Definition of Done), `01_CONTRACTS.md` (the 2–3 cross-role artifacts +
  change ceremony), a **canonical ticket schema** doc, then `<role>/README.md` +
  `<role>/LEVELS.md` per role, and `integration/README.md`.
- **`LEVELS.md` is the important part:**
  - **One file per role, a linear building-wise campaign.** Level 1 = real basics
    (scaffold, install, boot, first commit). Each level builds on the last up to a **Boss**.
  - **The spine is the build order, not the phases. Phases are *annotations*** — tag each
    level `Phase: P_n` and note where a phase ends mid-campaign. Add this phase-annotation
    explicitly — most projects miss it.
  - **Detail the current phase fully; outline later phases.** Each level: Goal · Tasks ·
    **Clear criteria** (a named runnable check) · Unlocks. XP `10/25/50/75/100/150`,
    Boss `500`.

---

## 5. `docs/learning/` — the decision log

- A `README.md` (index + a one-topic template) plus `<N>-<slug>.md` files, **one topic
  per file**. **Name with plain integers only — `1-slug.md`, `2-slug.md` — never
  zero-padded (`0001-slug.md`).**
- Each note: the decision, the *why*, the alternative rejected, and links from the relevant
  file-top comments + Notion tickets.
- Seed it with the decisions already implied by the architecture and the existing code.
- **Update `docs/learning/` on every code addition** that introduces a new/non-obvious
  decision — part of the commit, not a later chore.
- **Project it into a Notion *Learning* segment** for revision + interview prep (§7b):
  one page per concept with **masterable checkboxes** and **interview questions**.

## 5b. Memory — Claude Code's file-based memory

Claude Code keeps a **per-project memory dir**
(`~/.claude/projects/<project-path>/memory/`) with a `MEMORY.md` index loaded every
session. Maintain it as a second brain that complements the repo:

- **One fact per file**, with frontmatter `type: user | feedback | project | reference`.
  - `user` — who the user is (role, expertise, preferences).
  - `feedback` — how I should work (corrections + confirmed approaches), **with the why**.
  - `project` — ongoing goals/constraints not derivable from the code.
  - `reference` — pointers to external resources (URLs, dashboards, tickets).
- **Index every memory** with a one-line pointer in `MEMORY.md` (never put fact content there).
- **Save the non-obvious; never duplicate the repo.** Code structure, git history, and
  anything already in `CLAUDE.md`/`architecture/`/`tracks/`/`learning/` do **not** belong
  in memory. Capture preferences, the *why* behind decisions, and working agreements.
- **Link related memories** with `[[slug]]`; update or delete stale ones instead of
  duplicating.
- **Why the repo is still the brain:** memory is path-keyed and may not survive a folder
  rename or a move to another machine/account.
- **Refresh memory at the same maintenance triggers (§7c):** when a new preference,
  working rule, or project constraint appears, write/update the matching memory.

**Seed on adoption:** a `user` note (who they are), `feedback` notes for the working
practices (confirm-the-plan-before-writing, file-top comments, the `docs/learning/` log,
the no-MCP Notion workflow, reference-accuracy, and the git rules — **branch-per-ticket-first**,
no-co-author, **show the full commit message before committing**, ticket-code-in-subject,
fold-`NOTION_SYNC`-into-the-ticket-commit), and `project` notes for the product + build
approach. **`feedback` memories accrue over the project — add one the moment the user corrects
how you work** (a new git rule, a commit-message rule, a formatting preference); they are not a
one-time seed.

## 5c. `docs/key.md` — external services & credentials catalogue (git-ignored)

Create **`docs/key.md`** cataloguing every external service the project needs: purpose,
**buy (hosted) vs self-host**, the **env-var name(s)**, the phase it's needed in, and where
the real value lives. **It must be git-ignored and never committed.**

- Add `docs/key.md`, `.env`, and `.env*.local` to **`.gitignore`**; keep a committed
  `.env.example` with empty placeholders.
- **Only env-var *names* in the file — never real secret values.**
- **Derive the services from *this* project's actual stack** and **phase them**. Spell out
  client-exposure rules (e.g. only `NEXT_PUBLIC_*` reaches the browser).
- **Update it whenever a new provider/env-var is introduced** — commit-time trigger (§7c).
- **Split env-vars into two buckets, and say which is which** — it's the difference between "I need
  to buy things to run this" and "I don't":
  - **App-generated secrets** you create yourself (a session key, a DB password, an optional pepper) —
    no vendor, no purchase. Generate them once; they're what makes local dev work.
  - **Third-party vendor credentials** (object storage, cache, email, error-tracking) — real accounts,
    some paid. **Design every one so the project runs *without* it** in dev: stub it (a dev-ack upload
    endpoint), make it optional (a Redis-free path), or gate it behind a phase. The payoff: the whole
    system runs locally on self-generated secrets + a local database, and a deploy needs only the
    genuinely-required minimum (here: a managed DB URL + a generated session key). Document that minimum
    explicitly so "how do I run/deploy this" has a one-line answer.

## 5d. `.claude/settings.json` — repo-level Claude Code settings

Create **`.claude/settings.json`** at the repo root. This file travels with the repo and
overrides the machine-level settings for this project. Split the two layers cleanly:

**Repo-level (`.claude/settings.json`)** — project-specific behavior:
```json
{
  "permissions": {
    "allow": [
      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(git diff *)",
      "Bash(git status)",
      "Bash(git log *)"
    ]
  },
  "attribution": { "commit": "", "pr": "" },
  "includeCoAuthoredBy": false,
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.command' | grep -q 'git commit' && printf '{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":\"POST-COMMIT MAINTENANCE TRIGGER: A git commit just ran. Before responding you MUST: (1) run git diff HEAD~1 to see what changed, (2) check if this project has ticket/task tracking files (TICKET_STATUS.md, NOTION_SYNC.md, or equivalent) that need updating based on the diff, (3) update them now. Never include Co-Authored-By: Claude in any commit.\"}}' || exit 0",
            "statusMessage": "Post-commit: checking for maintenance tasks..."
          }
        ]
      }
    ]
  }
}
```

**Machine-level (`~/.claude/settings.json`)** — personal/machine preferences only (not committed, not project-specific):
- `permissions.deny` — blanket deny rules for secrets/keys (applies across all projects)
- `enabledPlugins`, `theme`, `voice`, `effortLevel` — personal UI preferences

The hook `additionalContext` above is the **generic starter**. As the project matures, expand it
to the **full maintenance checklist (§7c)** — have it also remind you to add a `docs/learning/`
note and to update `docs/key.md`/`.env.example` when a new decision/provider lands, not just the
ticket files. (This project's live hook already does.)

Add `.claude/settings.local.json` to `.gitignore` (user overrides, never committed).

## 5e. Walkthrough docs & the "Part 2" convention

Beyond the decision log, keep a small set of **plain-language walkthrough docs** that a human (or a
future you, or an interviewer) reads to *understand and run* the project — not the design-time `why`
(that's `architecture/`) but the as-built `how`:

- **`HOW_IT_WORKS.md`** — how the running system fits together + **how to run and test it yourself**
  (the single most valuable onboarding doc).
- **`PROJECT_TOUR.md`** — the "as the dev who built it" tour of every shipped piece.
- **`DEMO.md`** — the scene-by-scene demo script.
- **`INTERVIEW_PREP.md`** — how the dots connect + Q&A + a map of every doc.

**The Part-2 convention (a real learning from this project):** when a major phase **shifts the source
of truth** — e.g. an Integration phase that turns three mocked, isolated tracks into one wired system —
**don't rewrite the walkthrough doc; write a `*_PART2.md` that continues it.** Part 1 stays as the
honest record of "how it worked when the tracks were separate"; Part 2 becomes the new source of truth
("how the wired system runs, tests, and deploys"), and says plainly "where Part 1 and Part 2 disagree,
Part 2 wins." This preserves the **before/after learning arc** (invaluable for interviews — you can
show the seam) instead of erasing it. Reserve full rewrites for docs that are meant to always reflect
*current* state (the ledger, the status trackers); use Part 2 for narrative walkthroughs where the
history is itself the teaching. *(This repo did exactly this at Integration:
`HOW_IT_WORKS_PART2.md` + `PROJECT_TOUR_PART2.md`.)*

---

## 6. Backfilling a part-built project

If code already exists but docs don't:

1. **Reverse-engineer `docs/architecture/`** from the code + reconstruct the phase model.
2. **Write `docs/learning/` notes retroactively** for the non-obvious decisions already
   made in the code (one per topic). This is the highest-value step.
3. **Reconstruct `docs/tracks/LEVELS.md`** so the *already-done* work appears as cleared
   levels (mark them done) and the remaining work as upcoming levels + bosses, all
   phase-tagged.
4. **Add `CLAUDE.md`** and add file-top summary comments to existing files as you touch
   them (opportunistically, not all at once).
5. Generate the Notion seed (§7) for the **current and next phase** only.

---

## 7. `docs/tracks/notion/` — the no-MCP Notion hand-off

All Notion files live in **`docs/tracks/notion/`**. Follow
`docs/tracks/notion/NOTION_GUIDELINE.md`. The trick: **the repo-aware Claude (this
session) writes self-contained seed files; a *different* Claude that has the Notion MCP
connected reads those files and creates the board.**

The seed file (`NOTION_BOARD_SEED.md`) must contain, top-to-bottom:
- **Instructions + order of operations** for the writing Claude.
- **The full property schema** for the Tasks DB — Priority (**include `Critical`**), Type,
  Role, Level, Phase, Contract-touched, and an **`Affected` multi-select tag palette
  derived from that project's architecture** (its product surfaces + cross-cutting concerns).
- **How "Segments" are used:** 6 lenses DB; `Phase` = plain select on each task.
- A **defaults block** (set once for all tickets) so each ticket only lists what differs.
- **Every ticket, fully written:** title `[P_n][ROLE][L_n] <summary>`, Properties block,
  Body (Goal · Sub-tasks checklist · Clear criteria · Definition of Done).
- A **Documentation DB** spec + a **Learning DB** spec.
- Scope to the **current + next phase** only.

### 7a. Ticket tracking in the repo (no Notion MCP in the build session)

Maintain two files in `docs/tracks/notion/`:

- **`TICKET_STATUS.md` — the living ledger.** Current status of every ticket
  (`Not started / In progress / Done`) + a one-line *"left at"* note + completion date.
  This is the **source of truth for where the project stands.** Update it the instant a
  ticket's status changes.
- **`NOTION_SYNC.md` — the overwritten delta.** Holds **only what changed since the last
  sync**. Regenerate it from scratch when the user says "done for the day"; user pastes it
  into the Notion-connected Claude, then it resets to "nothing pending."

Loop: **repo is truth → keep `TICKET_STATUS.md` current → regenerate `NOTION_SYNC.md` at
sync points → user applies it in Notion.**

### 7b. Two more Notion segments: Documentation & Learning

- **`NOTION_DOCS_SEED.md`** — one page per subsystem: file map, dependencies, what breaks
  if you change it, copy-ready code blocks. Pages start `Status: Planned`. Update a page
  after any code change that alters its file-map/dependencies/behavior.
- **`NOTION_LEARNING_SEED.md`** — one page per `docs/learning/` concept with
  **concepts-to-master checkboxes** and **interview questions** (answer hints in toggles).
  Update when a `docs/learning/` note is added/changed.

### 7c. Maintenance triggers

Wire into `CLAUDE.md` **three** refresh triggers — **not** every-new-chat:

1. **After every `git add` + commit (primary).** The PostToolUse hook fires automatically.
   Claude must: run `git diff HEAD~1`, update `TICKET_STATUS.md`, add a `docs/learning/`
   note if the diff introduces a new decision, update the docs/learning seeds, and fold
   changes into `NOTION_SYNC.md`. **Show the proposed updates to the user and wait for
   approval before writing files.**
2. **On chat compaction** — refresh so state survives the summary.
3. **When the user says "new status"** — regenerate on demand.

---

## 8. Order of operations (what to actually do)

1. Read the repo + existing code; reconstruct the phase model; **confirm the plan with me.**
2. Create `docs/architecture/` (or make existing docs phase-aware).
3. Write `docs/learning/` (including retroactive notes for existing code).
4. Create `docs/tracks/` (rules, contracts, ticket schema, per-role LEVELS with phase tags,
   integration).
5. Write root `CLAUDE.md`; create **`docs/key.md`** (§5c) + update `.gitignore`;
   create **`.claude/settings.json`** (§5d); seed Claude Code **memory** (§5b).
6. Generate the three Notion seed files for the current + next phase in
   `docs/tracks/notion/` — `NOTION_BOARD_SEED.md`, `NOTION_DOCS_SEED.md`,
   `NOTION_LEARNING_SEED.md` — plus the tracking pair `TICKET_STATUS.md` and
   `NOTION_SYNC.md`.
7. Tell me the test commands to record, and remind me to paste the seeds into a
   Notion-connected Claude.

**Do not** introduce a new technology, change a contract, or build future-phase work
without saying so. Keep every doc blunt, specific, and lean.

---

## 9. One-shot prompt (paste this into the target project's Claude Code)

> Read this whole repo — every design doc **and** the existing code — and reconstruct the
> project's phase model. Then adopt the operating system described in
> `docs/ADOPT_THIS_SYSTEM.md`: build a phase-aware `docs/architecture/`, a one-topic-per-file
> `docs/learning/` log (plain integer filenames: `1-slug.md` — including **retroactive** notes
> for decisions already in the existing code), a `docs/tracks/` folder with per-role
> `LEVELS.md` written as a **linear building-wise campaign with phases as annotations**
> (Level 1 = scaffold; tag each level `Phase: P_n`; mark already-built levels done), a root
> `CLAUDE.md` operating manual with our coding practices (file-top summary comments, a
> `docs/learning/` note for every new decision, contracts-are-sacred, invariants, git
> branch-per-ticket-first + commit-approval rules, tests = done), and a repo-level `.claude/settings.json` with the
> PostToolUse hook, git allow-list, and `includeCoAuthoredBy: false` (§5d). Build **three**
> Notion seed files in `docs/tracks/notion/` — Tasks (`NOTION_BOARD_SEED.md`), Documentation
> (`NOTION_DOCS_SEED.md`: per-subsystem file-maps, dependencies, change-impact, code blocks),
> and Learning (`NOTION_LEARNING_SEED.md`: one page per `docs/learning/` concept with
> masterable checkboxes + interview questions). Because this account has **no Notion MCP**,
> also create `docs/tracks/notion/TICKET_STATUS.md` (living status ledger — mark
> already-built work `Done`) and `docs/tracks/notion/NOTION_SYNC.md` (overwritten delta for
> all three segments; initial = "create everything from the seeds"). Wire into `CLAUDE.md`
> the rule that **before any `git add`+commit**, Claude shows the staged files and proposed
> message and waits for explicit approval; once approved, runs the commands directly (no
> heredoc). The PostToolUse hook fires automatically after each commit — Claude must then
> check for maintenance tasks and show proposed updates before writing them. Also maintain
> **Claude Code's file-based memory** (`MEMORY.md` index + one-fact-per-file, types
> user/feedback/project/reference) seeded on adoption (§5b). Create a git-ignored
> **`docs/key.md`** (§5c) cataloguing every external service/credential (names only, no
> values). Confirm the plan with me before writing files, and ask me anything you can't infer.

---

### Tone
Blunt, specific, lean. The deliverables are documents a future stranger (or a fresh Claude)
could pick up cold and continue. The repo is the brain; everything else is a projection.
