# Technical deep dive — the whole project, what & how & why

> A long-form, single-file technical explanation of the NEEPCO e-procurement platform: what it is, how
> every layer works, and — most importantly — **why** each technical and coding decision was made,
> including the alternatives that were rejected. This is the "sit down and understand the whole thing"
> document. It complements, and does not replace: `docs/architecture/` (design-time *what to build*),
> `docs/HOW_IT_WORKS_PART2.md` (how to run/test/deploy), `docs/INTERVIEW_PREP.md` (Q&A), and the
> `docs/learning/` decision log (one decision per file, cited throughout as `learning/N`).
>
> Written 2026-07-19, after the MVP was completed and integrated (all three tracks + Integration
> Phases A–D). Read top to bottom, or jump via the table of contents.

---

## Table of contents

0. How to read this document
1. The product in one page
2. The architecture at 10,000 feet
3. The build methodology — the three-tracks game (and why)
4. The tech stack, choice by choice (with rejected alternatives)
5. The monorepo layout
6. Backend deep dive (apps/api)
7. The scoring engine deep dive (the moat)
8. Frontend deep dive (apps/web)
9. The integration layer — how three tracks became one system
10. Cross-cutting invariants (and why each exists)
11. Security posture
12. Testing strategy
13. The data model
14. Coding preferences & conventions (and the reasoning)
15. What's real vs stubbed
16. The lifecycle: clone → dev → test → demo → deploy
17. Why it's defensible — the "why" chain for interviews
18. The dev workflow & Turborepo task graph
19. Operational gotchas (the things that will bite a fresh session)
20. Appendix: glossary & the files that matter

---

## 0. How to read this document

Every section answers three questions in order: **what** it is, **how** it works (often with the
actual mechanism or a code shape), and **why** it was done this way (with the rejected alternative).
The "why" is the point — anyone can wire a framework together; the value of this project is that every
non-obvious choice has a defensible reason recorded in `docs/learning/`, and this document is the
narrative thread that connects them.

Two words recur and mean specific things here:
- **Contract** — the API's JSON shapes (formalised as an OpenAPI spec generated from Zod schemas). It's
  the boundary the three tracks agreed on and built against independently.
- **Track** — one of the three isolated development disciplines (Backend, Frontend, Data) the project
  was deliberately built in, plus a fourth Integration phase that joined them.

---

## 1. The product in one page

**What.** A full-stack **public-sector e-procurement platform**, modelled on NEEPCO (a North-Eastern
power utility). It runs the entire tender lifecycle end to end:

1. An **initiator** drafts a tender and submits it for approval.
2. An **authority** approves and it is **published**.
3. Registered **vendors** submit **two-cover bids** (a technical envelope and a financial envelope),
   sealed and signed.
4. A **technical evaluation committee** (TEC) opens the technical envelopes and scores each bidder.
5. Qualified bids have their **financial** envelopes opened; a winner is **recommended**.
6. An **authority approves** the award (under separation-of-duties), and the **initiator publishes**
   it, which **auto-creates a contract**.
7. The contract runs through milestones and is **closed with a performance grade**, which writes an
   immutable **performance record**.
8. That record feeds a per-vendor **analytics score** used to evaluate the vendor's *next* bid.

**The moat.** Step 8 is the headline. Most procurement systems evaluate vendors on gut feel ("I
remember vendor X delivered late"). This platform replaces that with a **deterministic, explainable,
reproducible-to-six-decimals vendor performance score** computed from the historical contract record.
It is **statistics, not AI** — no machine learning, no black box — precisely because a public-sector
procurement decision must be *auditable and contestable*: a vendor who scores 0.83 can be shown exactly
which past contracts and which metrics produced that number, and can dispute a specific metric. (See
`learning/4`.)

**Why this domain.** Procurement is a genuinely hard domain with real, non-trivial requirements —
sealed bids, separation-of-duties, tamper-evident audit, reproducible scoring — that force
interesting engineering, unlike a CRUD to-do app. It also has a clean "moat" feature (the analytics
layer) that differentiates the portfolio.

---

## 2. The architecture at 10,000 feet

The running system is four moving parts:

```
   Browser (Next.js, React)                     Node process (Fastify)              PostgreSQL 16
   ┌───────────────────────┐   /api/v1/*  proxy  ┌────────────────────────┐  Prisma  ┌───────────┐
   │  App Router pages      │ ───────────────────▶│  Routes → Services      │ ───────▶ │ business   │
   │  RBAC-gated segments   │   (same-origin,     │  Zod validation         │          │ tables     │
   │  Web Crypto (Ed25519)  │    cookies flow)    │  PASETO auth middleware  │          ├───────────┤
   │  IndexedDB (priv key)  │ ◀───────────────────│  RBAC + SoD             │ ◀─────── │ audit log  │
   └───────────────────────┘   JSON responses     │  libsodium sealing       │          │ (hash-     │
                                                   │  @repo/scoring engine    │          │  chained)  │
                                                   └────────────────────────┘          └───────────┘
                                                            │  BullMQ (optional)
                                                            ▼
                                                     Redis (optional: nightly snapshot cron)
```

The **security boundary is the API**, never the UI. The frontend's RBAC gating is a
convenience/defence-in-depth layer — every real access-control decision is enforced server-side and
audited (`learning/14`). The **audit log is a separate, append-only, hash-chained table** that no
business-logic code reads from or writes business state into (`learning/2`). **Money is integer paise**
everywhere and **timestamps are UTC** everywhere (`learning/8`).

The four parts map to the three build tracks plus integration:
- **Backend** owns the Fastify process, Postgres schema, auth, sealing, audit, and the API contract.
- **Frontend** owns the Next.js app.
- **Data** owns the scoring engine (originally Python, ported to TypeScript at integration).
- **Integration** wired the frontend to the real backend, ported the engine, hardened the sealing to
  a keyholder quorum, and packaged the one-command demo.

---

## 3. The build methodology — the three-tracks game (and why)

**What.** The project was built by **one person wearing three isolated hats** — Backend, Frontend,
Data — gamified into level campaigns with "bosses," and a final Integration phase that was hard-locked
until all three track bosses shipped. The rules were strict:
- **One hat per session.** No reading another track's source code.
- The **only legal cross-track communication is the contract** — the OpenAPI spec (for FE↔BE), MSW
  fixtures (the FE's stand-in for the backend), and CSV schemas (for the data track).
- Each level is a gate with a named, runnable clear-criterion (a Bruno collection, a Playwright spec, a
  pytest run). A "boss" proves a track's slice end to end.

**Why (the meta-decision, `learning/12`).** The goal was to genuinely *feel* three engineering
disciplines and produce three independently-defensible portfolios in one repo, and — crucially — to
build the muscle of **working against a contract** rather than against another team's implementation.
Integration then became "negotiate the seams," not "rebuild from scratch." This mirrors how real
organisations split frontend/backend/data teams that must agree on an interface and build in parallel.
The payoff showed up concretely at integration: because both sides had honoured the same JSON shapes,
turning MSW off mostly "just worked," and the bugs that surfaced were exactly the interesting ones —
places where the mock had been *more permissive than the contract*.

**Why gamified with levels/bosses.** Levels force a build *order* (you can't do analytics before the
scoring engine exists) and give each unit a crisp, testable definition of done. Bosses force an
end-to-end proof, not just a pile of units. It keeps a solo project honest about sequencing and
"done."

---

## 4. The tech stack, choice by choice (with rejected alternatives)

Every stack choice has a `docs/learning/` note; the rule was **no new technology without a note
explaining why** (and the rejected alternative). The headline choices:

**Runtime: Node + Fastify (not Express, not the original Hono/Cloudflare-Workers scaffold).** The repo
started as a Turborepo scaffold on Hono/Workers with a `JWT_SECRET`; that was thrown away. Fastify was
chosen for its first-class schema/serialization story (JSON-schema validation and fast serialization
built in), its plugin model, and its TypeScript ergonomics. Express was rejected as thinner and
older-idiom; the Workers runtime was rejected because the app needs a long-lived Node process with
libsodium, Prisma, and BullMQ — not an edge function.

**Auth tokens: PASETO v4.local (not JWT).** PASETO was chosen deliberately over JWT to avoid JWT's
algorithm-confusion footguns (the `alg: none` and RS256↔HS256 confusion classes). `v4.local` is a
symmetric, authenticated-encryption token — there is no algorithm field to confuse and the payload is
encrypted, not just signed. (`learning` in the auth notes.)

**Password hashing: argon2id.** The current memory-hard standard; chosen over bcrypt for resistance to
GPU/ASIC attacks. An optional `PASSWORD_PEPPER` can be mixed in.

**Database: PostgreSQL 16 + Prisma (not MySQL).** The scaffold shipped MySQL; it was reversed to
Postgres (`learning/16`) for richer types, better transactional DDL, stored-procedure support (used by
the audit chain), and the fact that the target hosting (Neon) is Postgres. Prisma gives typed queries,
a single migration history, and one place that owns the schema — with the explicit rule that **only the
data layer talks to the DB**.

**Sealing crypto: libsodium (backend) + native Web Crypto Ed25519 (frontend).** The backend uses
libsodium's `crypto_box_seal` for the two-cover envelope encryption and Ed25519 for manifest
signatures. The frontend uses the browser's native Web Crypto Ed25519 for *signing only* — because a
vendor's private signing key must never leave the browser (`learning/15`, `learning/21`). Ed25519 is
cross-library verifiable, so a signature produced in the browser verifies server-side with libsodium —
no integration mismatch. (libsodium is loaded via its CJS build through `createRequire` because its ESM
build is broken — a real gotcha.)

**Audit integrity: a SHA-256 hash chain in a stored procedure (not a blockchain).** Each audit row
stores the hash of `(this row's content ‖ previous row's hash)`, so any tampering breaks the chain from
that point on and a verify pass detects it. It's implemented as a Postgres stored procedure
(`audit_insert`) so the chaining is atomic and can't be bypassed by application code. A blockchain was
explicitly rejected as massive overkill for a single-writer append-only log — the hash chain gives the
tamper-evidence property without the distributed-consensus baggage (`learning/2`).

**Scoring: deterministic, rule-based statistics (not ML).** Non-negotiable domain requirement — the
score must be reproducible and explainable (`learning/4`).

**Frontend: Next.js 15 (App Router) + React 19 + Tailwind + shadcn/ui + Tremor.** Next for the App
Router + middleware (used for RBAC segment gating), shadcn for unstyled-but-owned components, Tremor
for the analytics charts. MSW (Mock Service Worker) mocks the API in the browser so the frontend could
be built and tested with zero backend.

**Jobs: BullMQ + Redis, but Redis-optional in dev (`learning/36`).** The nightly analytics snapshot is
a BullMQ job. In dev the cron only wires up if `REDIS_URL` is set; the same job runs Redis-free via
`npm run snapshot:run` or the recompute endpoint. This keeps local dev dependency-light.

**Monorepo: Turborepo.** One repo, workspaces for the two apps and the shared packages. Chosen for task
orchestration and the clean workspace boundaries it enforces.

**Testing: Bruno (API), Playwright (web, both modes), pytest+hypothesis (data), plus `tsx` verify
scripts.** Bruno is a files-in-repo REST test runner (Postman-like but versioned). See §12.

---

## 5. The monorepo layout

```
apps/
  api/            Fastify backend (Backend track)
  web/            Next.js frontend (Frontend track)
data-lab/         Python scoring engine (Data track) — deliberately OUTSIDE Turborepo (own venv/pytest)
packages/
  db/             @repo/db — Prisma schema + client (the ONLY code that talks to Postgres)
  scoring/        @repo/scoring — the TypeScript port of data-lab/scoring (added at Integration Phase B)
  contracts/      Zod contract types shared FE↔BE
  ui/, *config    shared UI + tsconfig/eslint config
docs/             the knowledge base (architecture / tracks / learning / features + these guides)
Makefile, scripts/demo.sh   the one-command demo (Integration Phase D)
```

Why `data-lab/` is outside Turborepo: data-science tooling (pandas, notebooks, matplotlib, rich) lives
in Python; forcing it into the TS monorepo would fight the ecosystem. Its *logic* (not its code)
crossed into TypeScript at Integration via a faithful port (§9), proven equivalent to six decimals.

Why `packages/db` is a package: exactly one module owns the database. Every other module imports
`@repo/db` for typed queries; nothing else constructs Prisma clients or writes raw SQL. This keeps the
schema, migrations, and connection in one place and makes "who can touch the DB" answerable.

---

## 6. Backend deep dive (apps/api)

### 6.1 Runtime & bootstrap

The process entry is `src/index.ts`, which builds the Fastify server (`src/server.ts`) and calls
`listen({ port, host: "0.0.0.0" })` on `API_PORT` (8080 in dev). `server.ts` registers plugins in
order: cookie parsing (`@fastify/cookie`), the Zod type provider (so route schemas both validate *and*
type the handler), Swagger + Swagger-UI (serving `/api/v1/docs`), and then each feature module's
routes. Dev runs under `tsx watch` (hot reload); prod builds with `tsc` and runs `node dist/index.js`.

The codebase is organised by **feature module**, each a folder under `src/modules/<name>/` with a
consistent triple:
- `*.routes.ts` — thin HTTP layer: URL, Zod schema (body/params/querystring/response), RBAC
  pre-handlers, and a one-liner delegating to the service.
- `*.service.ts` — all business logic, the state machine, transactions, crypto, and audit writes.
- `*.schemas.ts` — the Zod schemas that both validate at runtime and generate the OpenAPI spec.

Modules: `auth`, `tender`, `bid` (which also owns the award flow), `contract`, `analytics`, `audit`,
`admin`, `files`, plus `middleware/` (auth, permission, SoD) and `lib/crypto/` (seal, canonical, sodium,
shamir).

### 6.2 The request lifecycle (one request end to end)

Take `POST /api/v1/tenders/:id/award/approve`:
1. Fastify matches the route; the Zod type provider validates the params against `idParamSchema`.
2. The `requireAuth` pre-handler reads the HttpOnly PASETO cookie, decrypts+verifies it, and attaches
   the caller's identity (`sub`, `roles`) to the request. A missing/invalid token → `401` with the
   standard error envelope.
3. The `requirePermission("award:approve")` pre-handler checks the caller's role set includes a role
   that grants `award:approve`. A miss → `403` (and the denial is auditable).
4. The handler calls `approveAward(tenderId, actor)` in the service.
5. The service loads the tender + its award, checks the state is `AWARD_RECOMMENDED` (else `409`),
   runs the **SoD-1** check (the approver must not be the tender's initiator; a violation writes a
   `sod.blocked` audit event and returns `403 SOD_VIOLATION`), then in a **transaction** updates the
   tender to `AWARD_APPROVED`, stamps the award's `approvedAt`, and writes an `award.approved` audit
   event inside the same transaction.
6. The response is serialized through the Zod response schema (extra fields stripped) and returned.

Two things to notice: **the state transition and the audit write are atomic** (same transaction), so
you can never have an approved award without its audit row; and **the SoD decision is at the API**, not
the UI.

### 6.3 Validation & the OpenAPI contract

Every route declares Zod schemas for its inputs and outputs. `fastify-type-provider-zod` uses them to
(a) validate requests at runtime, (b) type the handler's `req`/reply, and (c) feed `@fastify/swagger`,
which a script (`npm run openapi:gen`) serializes to `apps/api/openapi.json` (currently 50 paths).
**That generated spec is the contract the frontend built against.** Changing a shape is a deliberate
ceremony: ticket → version bump → regenerate → announce — never a silent edit (`CLAUDE.md §5`).

### 6.4 Authentication (PASETO, argon2id, refresh rotation)

Login (`POST /auth/login`) verifies the password with argon2id and, on success, issues **two tokens**:
- a short-lived (15-minute) **access token** — a PASETO v4.local token in an HttpOnly cookie; and
- a **refresh session** row in Postgres, referenced by a refresh cookie.

The access token is *stateless* (the server trusts its own encrypted token for 15 minutes). The refresh
session is *stateful and revocable*. Refresh uses **one-time rotation with replay detection**: each
refresh consumes the current refresh token and issues a new one; if an already-consumed refresh token
is presented again (a sign it was stolen and replayed), **all** sessions for that user are revoked. This
is the standard defence against refresh-token theft. Logout revokes the server-side refresh session
(not just clearing the local cookie).

Why PASETO over JWT: no `alg` field to confuse, authenticated encryption by construction, and a smaller
footgun surface. Why the two-token split: short access-token lifetime limits the blast radius of a
leaked access token, while the revocable refresh session gives real logout/kill-switch semantics that a
pure-stateless JWT can't.

### 6.5 Authorization (RBAC + SoD)

Two distinct mechanisms, often confused, kept separate here:

**RBAC (role-based access control)** answers "may this role perform this action *type*?" There are five
roles — `VENDOR`, `INITIATOR`, `REVIEWER`, `AUTHORITY`, `ADMIN` — and a flat set of ~34 permission
strings (`tender:create`, `bid:submit`, `award:approve`, `audit:read`, …). A role→permissions map
grants each role its set. The `requirePermission("x")` middleware enforces it, cached per request. For
example: `INITIATOR` holds `tender:create`/`tender:publish`; `REVIEWER` holds `award:recommend`;
`AUTHORITY` holds `award:approve`; all three internal roles share `tender:view_published` (which is why
the award *read* model is gated on that permission — every actor in the award ceremony can view it).

**SoD (separation of duties)** answers "may this *specific person* perform this action *on this specific
object*, given what they've already done to it?" It's contextual, not role-static. The canonical rule is
**SoD-1**: the person who approves an award (or a tender for publication) must not be the same person who
initiated it. RBAC would happily let an `AUTHORITY` who is also the initiator approve; SoD stops it. SoD
violations are **audited** (a `sod.blocked` event) and cite the rule code. (`learning/10`, `learning/14`.)

Why enforce both at the API: the frontend also hides buttons a role can't use, but that's UX and
defence-in-depth only. A determined caller hitting the API directly must still be stopped and audited —
so the real control lives server-side.

### 6.6 The tender lifecycle state machine

A tender moves through a strict sequence: `DRAFT → PENDING_APPROVAL → PUBLISHED → BID_WINDOW_OPEN →
BID_WINDOW_CLOSED → TECH_EVAL_IN_PROGRESS → FINANCIAL_EVAL_IN_PROGRESS → AWARD_RECOMMENDED →
AWARD_APPROVED → CONTRACT_ACTIVE → CONTRACT_CLOSED`. Transitions are guarded: a service checks the
current state before moving, and the update is **conditioned on the validated from-state** so two
concurrent requests can't both advance it (the loser gets a `409`) — a TOCTOU fix from the review
hardening pass (`learning/40`). Each transition writes its audit row inside the same transaction.

Why a state machine rather than free-form status flags: procurement is a legally-constrained process
where illegal transitions (e.g. awarding before evaluation) must be *impossible*, not merely
discouraged. Encoding it as a guarded machine makes illegal states unreachable.

### 6.7 Two-cover sealed bidding (libsodium, per-tender envelope keys)

A bid has two sealed **covers**: a **technical** envelope and a **financial** envelope. The point of
two-cover bidding is that the committee scores the *technical* merit **before** anyone can see the
*price* — so price can't bias the technical evaluation.

Mechanism: at tender approval, the backend generates a per-tender keypair per envelope
(`TenderEnvelopeKey`), stores the **public** key, and seals each submitted envelope with libsodium's
`crypto_box_seal` (anonymous sealed-box: anyone can seal to the public key; only the private key can
open). The technical envelope is opened at the start of technical evaluation (the "committee ceremony"),
the financial envelope only after technical qualification. Opening is idempotent and audited once.

The private key is the sensitive part — see §9.4 (Shamir) for how integration removed the "server holds
the whole private key" shortcut.

### 6.8 Client-side signing (Ed25519) and server verification

A bid is also **signed**: the vendor's browser computes a canonical **manifest** (tender id, vendor id,
submit timestamp, and the SHA-256 hashes of each envelope's plaintext) and signs it with a **real
Ed25519 key generated in the browser**, whose private half lives only in the browser's IndexedDB and
**never touches the server** (`learning/15`, `learning/21`). The server **verifies** that signature on
submit (it does not re-sign) — signing custody belongs to the client, exactly as a hardware Digital
Signature Certificate (DSC) token would work in production (`learning/45`). At envelope-open time the
server re-derives the plaintext hash and binds it to the signed manifest (a `409` on mismatch), so the
sealed ciphertext provably matches what the vendor signed.

Why verify-not-re-sign: if the server signed on the vendor's behalf, the signature would prove nothing
about the vendor's intent. Verifying a client signature is the whole point of non-repudiation.

### 6.9 The hash-chained audit log

Every meaningful action writes an **audit event** via `recordAuditEvent(...)`, which calls the Postgres
`audit_insert` stored procedure. The procedure computes the new row's hash as
`SHA-256(sequence ‖ action ‖ resource ‖ actor ‖ payload ‖ previous_row_hash)` and stores it, so the rows
form a chain. `POST /admin/audit/verify` walks the whole chain, recomputes each hash, and reports
"intact" (green) or the first mismatched sequence (red). Tampering with any historical row — or deleting
one — breaks every subsequent hash and is detected.

Design rules that make this trustworthy: the audit table is **append-only and separate from business
tables** — no business-logic code reads state from it or writes business state into it (`learning/2`);
the actor is stored as a plain `actorUserId` with **no foreign key to User** (the chain must not depend
on mutable business rows), and the admin read model resolves `actorUserId → email` *outside* the chain
for display (`learning/48`). In production the DB user would additionally have `UPDATE`/`DELETE` revoked
on the table.

### 6.10 Contract execution & the feedback loop

Publishing an award auto-creates a **Contract** (in the same transaction as the publish), moving the
tender to `CONTRACT_ACTIVE`. The contract can accrue milestones and is eventually **closed with a grade**
(`POST /contracts/:id/close`), which — atomically — marks the contract `CLOSED`, writes the immutable
**`ContractPerformanceRecord`** (quality grade, review score, planned vs actual duration, billed vs
awarded amount, dispute count), advances the tender to `CONTRACT_CLOSED`, and audits it. That performance
record is the **only** thing the analytics layer consumes — closing the contract is the single point
where an award becomes a scoreable outcome. This is the moat's feedback loop: *close a contract → write a
record → the vendor's next score reflects it.*

### 6.11 The error model

Every error returns a consistent envelope: `{ error: { code, message, trace_id, ...details } }` with an
appropriate HTTP status (`400` validation, `401` unauth, `403` forbidden/SoD, `404` not-found, `409`
state/conflict). Unknown routes and uncaught exceptions both funnel to the same envelope. Consistent
error shape means the frontend has exactly one error-parsing path.

### 6.12 The patterns you'll see repeatedly (concrete shapes)

Four shapes recur across every backend module; internalising them makes the whole codebase legible.

**(a) The route → service → schema triple.** A route is thin and declarative — it never contains
business logic:

```ts
// bid.routes.ts — the award read model
app.get(
  "/api/v1/tenders/:id/award",
  {
    preHandler: [requireAuth, requirePermission("tender:view_published")],
    schema: { tags, params: idParamSchema,
              response: { 200: awardViewResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema } },
  },
  async (req) => getAwardView(req.params.id),   // ← all logic lives in the service
);
```

The `schema` block does triple duty: it validates the request, types the handler, and generates the
OpenAPI entry. The `preHandler` array is the security gate. The handler is a one-liner into the service.

**(b) State transition + audit, atomically in one transaction.** Every state change and its audit row
commit together, so you can never have one without the other:

```ts
const award = await prisma.$transaction(async (tx) => {
  await tx.tender.update({ where: { id: tenderId }, data: { state: "AWARD_APPROVED", version: { increment: 1 } } });
  const updated = await tx.award.update({ where: { tenderId }, data: { approvedAt: new Date(), approvedByUserId: actor.userId } });
  await recordAuditEvent({ action: "award.approved", resourceType: "Award", resourceId: updated.id,
                           actorUserId: actor.userId, payload: { tenderId, bidId: updated.bidId } }, tx);
  return updated;
});
```

Note `version: { increment: 1 }` — optimistic-concurrency bookkeeping; and `recordAuditEvent(..., tx)`
takes the transaction client so the audit insert is inside the same commit.

**(c) The guard-then-act shape.** Services validate the from-state and ownership *before* mutating, and
throw a typed error (mapped to the HTTP envelope) on any violation:

```ts
if (tender.state !== "AWARD_RECOMMENDED")
  throw new BidError(409, "STATE_INVALID", "Award is not awaiting approval.", { current_state: tender.state });
const violation = evaluateSoD("SoD-1", { tenderId, initiatorUserId: tender.initiatedById, actingUserId: actor.userId });
if (violation) { /* write sod.blocked audit event */ throw new BidError(403, "SOD_VIOLATION", violation.message, ...); }
```

**(d) The read-model shape.** Where the frontend needs a *view* the raw tables don't directly provide
(the eval grid, the award page, the enriched contract list), a service assembles it — joining related
rows, deriving fields, attaching analytics — but **mints nothing** (integration's rule: connections, not
capabilities). The award read model derives `stage` from the tender state, ranks bidders by an
L1-normalised financial score, and attaches each vendor's latest analytics composite — all reads.

---

## 7. The scoring engine deep dive (the moat)

The engine turns a vendor's historical `ContractPerformanceRecord`s into a single 0–1 **composite
score** with a full explanation. It was built first in Python (`data-lab/scoring/`), then ported 1:1 to
TypeScript (`packages/scoring`, `@repo/scoring`) at integration. The formula, in the order the values
flow:

### 7.1 The formula

**Per-contract raw metrics** (`metrics`): for each eligible closed/terminated contract, compute four
0–1 metrics:
- **timeliness** — did it finish within planned duration (`actual ≤ planned`)?
- **cost_efficiency** — final billed vs awarded amount (under-budget is good, capped).
- **quality_norm** — the 1–5 quality grade normalised to 0–1 as `(grade − 1) / 4`.
- **dispute_factor** — a penalty derived from disputes on the contract.

**Recency weighting** (`recency`): each contract's contribution is weighted by an exponential decay with
an **18-month half-life** — a contract from 9 months ago counts more than one from 3 years ago. There's
also a 5-year eligibility window (older contracts drop out). (`learning/27`.) Why decay: a vendor's
*recent* behaviour is more predictive than ancient history, but a hard cutoff would be arbitrary and
gameable; smooth decay is defensible.

**Category matching** (`category`): a contract in the *same* category as the tender being scored counts
at weight 1.0; a *related* category at 0.7; an *unrelated* one at 0.4. Critically, contracts are **not
filtered** by category — every eligible contract counts toward every target category, just *diluted* by
the category weight (`learning/29`). Why dilute rather than filter: a vendor with a strong record in a
related field is more informative than "no data," so we down-weight rather than discard. The related-set
map is asserted symmetric at import time so a one-directional edit can't silently break it
(`learning/31`).

**Composite** (`weights` + `score`): the four per-metric values are combined using one of four pluggable
**weight profiles** (`default`, `emergency_procurement`, `large_capex`, `services`), each validated at
import to sum to 1.0 (`learning/32`). The per-contract weighted values are aggregated (recency × category
weighted mean) into the final composite.

**Explainability** (`explain`): `explain(...)` returns the full "Why this score?" payload — per-metric
value/weight/contribution plus every source contract's recency and category weights and raw metrics.
The number and the explanation share a single `_weighted_contracts()` helper so they can never drift
(`learning/33`).

### 7.2 Determinism & explainability (no ML, and why)

The engine is a pure function: same inputs + same `ref_now` → same output, to 1e-6. There is no
training, no randomness, no model. This is a **hard domain requirement**, not a limitation: a
public-sector procurement decision must be reproducible (two officers running it get the same number),
explainable (you can show exactly why), and contestable (a vendor can dispute a specific metric on a
specific contract). An ML model would fail all three. (`learning/4`.)

### 7.3 `data_insufficient` (not zero)

A vendor with **fewer than 3 eligible contracts** is reported as **`data_insufficient`** (composite
`null`), **never** as a low score (`learning/7`). Why this matters enormously: scoring a brand-new
vendor 0.0 would be a *lie* that unfairly excludes newcomers — the honest statement is "we don't have
enough data," which the UI renders distinctly (an em-dash / "Insufficient data"), never a misleading
zero. This invariant is asserted in tests so it can't regress.

### 7.4 The port to TypeScript & the portability snapshot

At Integration Phase B the Python engine was ported file-by-file to TypeScript. Rather than trust "looks
the same," the Data track's boss produced a **portability snapshot** (`port_snapshot_v1.json`: embedded
inputs + expected outputs for 5 cases). Both the Python `test_portability.py` and the TS `port.test.ts`
replay **the same committed file** — one source of truth, never copied — and must reproduce it to 1e-6.
The byte-parity details that actually bit: pandas' `Timedelta.days` flooring, ISO timestamps ending
`+00:00` not `Z`, and stable descending sort for contract id lists. Getting these exactly right is what
made the port trustworthy (`learning/50`). Why port rather than call the Python service over HTTP: a
network hop, a second runtime to deploy, and a serialization boundary — for a pure function — isn't worth
it; a proven-equivalent port is simpler and faster.

---

## 8. Frontend deep dive (apps/web)

### 8.1 App Router & RBAC segments

Next.js 15 App Router with three top-level segments — `/vendor`, `/internal`, `/admin` — gated by
Next **middleware** that reads a routing cookie and redirects a role away from segments it can't use.
This is UX and defence-in-depth; the API is still the real gate.

### 8.2 MSW & building against a contract

The entire frontend was built and tested with **Mock Service Worker** intercepting `/api/v1/*` calls in
the browser and answering from JSON fixtures. This let the Frontend track ship a complete, testable app
with **zero backend** — the boss ("Demo Without a Backend") runs the whole lifecycle on MSW alone. The
discipline: MSW's responses had to match the *contract* (the OpenAPI shapes), so the frontend was really
building against the interface, not a fantasy. (The one recurring hazard: MSW being *more permissive*
than the real contract — e.g. ignoring query strings — which hid a bug until integration; §9.)

### 8.3 The bid composer & Web Crypto

The 5-step bid composer does real cryptography in the browser: it hashes the uploaded document with
SHA-256, generates/uses a **real Ed25519 keypair via the Web Crypto API** (private key persisted in
IndexedDB, never sent to the server), builds and signs the canonical manifest, and self-verifies before
submitting. This is genuine non-repudiation groundwork, not a mock (`learning/21`).

### 8.4 The scoring grid

The TEC scoring grid lets a reviewer score each bidder per criterion, showing the **auto-filled,
read-only historical-performance column** with a "Why?" breakdown — the analytics layer feeding the
evaluation. The grid computes client-side medians/outliers as a display aid; the backend aggregates
means as the scoring contract (a documented display-vs-contract distinction, `learning/41`).

### 8.5 The analytics flagship & Tremor

Three screens consume the engine's frozen 0–1 snake_case shape: a vendor **pool** ranked by a 0–100
Performance Index + band; a vendor **profile** (hero index, 5-metric contribution BarList, a 24-month
quarter-aggregated trend LineChart, contract history, and the "Why this score?" deep-dive); and a pool
**dashboard** (distribution + by-band donut + top/bottom-5). Charts via **Tremor** (installed with
`--legacy-peer-deps` against React 19, plus Tailwind token/safelist wiring — `learning/38`).
`data_insufficient` vendors are shown distinctly, never zero.

### 8.6 The live wiring (proxy, dual cookie)

To run against the real backend, the frontend keeps its relative `/api/v1/*` fetches; `next.config.ts`
**rewrites** them to the Fastify API (same-origin, so cookies flow and there's no CORS), and
`NEXT_PUBLIC_USE_MSW=false` disables MSW so the requests actually leave the browser. One login mints both
the HttpOnly PASETO cookie (API auth) and a client-readable routing cookie (Next middleware) — they
can't desync because every login is a real login (`learning/43`, `learning/44`).

---

## 9. The integration layer — how three tracks became one system

Integration adds **connections, not capabilities**. If a missing feature turned up, it was filed back to
its originating track, not built here. Four phases:

### 9.1 Phase A — wire frontend to real backend

Module by module (auth → tenders → bids → eval → analytics → admin), each MSW handler was retired and
the page verified against the real API. A **seed bridge** (`seed-from-frontend-fixtures.ts`) loads the
FE's fixture data into Postgres under the *exact same ids* the FE deep-links, so the wired app sees the
same entities it saw under MSW. The capstone was a **both-mode Playwright gate**: the MSW suite stayed
pristine (the Frontend-track artifact), and a *separate* live suite (`e2e-live/`) does a **real login**
and asserts against real API data across every wired module. Integration surfaced the class of bug MSW
had hidden by being laxer than the contract — most memorably the analytics profile page that never sent
the required `?category=` query and would have 400'd live (`learning/47`, `learning/49`).

### 9.2 Phase B — port the Data engine into the API

Covered in §7.4: the Python engine ported to `@repo/scoring`, frozen behind the portability snapshot,
then wired so the API serves *its* numbers. The seam chosen was the **snapshot**, not recompute-on-read
— because the bridged FE fixture vendors are snapshot-only and would collapse to `data_insufficient`
under a live read. Five duplicate scoring primitives were deleted from the API so there's **one engine
in the repo** (`learning/51`).

### 9.3 Phase C — Shamir split-key sealing

Covered below (§9.4).

### 9.4 Shamir 2-of-3 split-key sealing (Phase C, `learning/52`)

The dev shortcut in §6.7 was "the server holds each envelope's whole private key." Phase C replaced it
with real **Shamir Secret Sharing**: at approval each private key is split into **3 shares with a 2-of-3
threshold**, the whole key is **discarded**, and the shares are distributed to keyholder roles
(Authority / Custodian / an encrypted Escrow). Opening a cover requires a **quorum**: keyholders POST
their shares to `POST /tenders/:id/keys/contribute`, the server reconstructs the key **in memory** from
≥2 shares, decrypts, then discards the reconstructed key. Below 2 shares → `409 QUORUM_NOT_MET`.

It was written **from scratch** (~60 lines of GF(2⁸) field arithmetic — the AES field, poly `0x11b`,
generator `0x03`, with exp/log tables — no dependency), verified with a **known-answer test vector**.
Why from scratch over `npm i shamirs-secret-sharing`: Shamir is information-theoretic *secret sharing*,
not a cipher (the real encryption stays libsodium), the blast radius is a dev-simulated custody model,
and owning the maths is the better portfolio/interview artifact. A `SHAMIR_DEV_MODE` flag (default on)
lets the server auto-contribute its escrow shares so the headless test suite stays green; `false` demands
a real quorum — the production posture.

### 9.5 Phase D — the demo + the award/contract wire-up (`learning/53`)

Two pieces. **`make demo`** (a `Makefile` + `scripts/demo.sh`) cold-boots Postgres, migrates + seeds,
brings up API + web with MSW off, waits until both are healthy, and prints the URL + per-role
credentials — one command, clean clone, the whole lifecycle live. And the **award + contract UI
wire-up**: Phase A had left those two screens on MSW against an *imagined* backend shape while the real
backend served a different one, so under `make demo` they would have errored. They were reconciled with
the same pattern the earlier phases used (keep the Bruno-frozen backend shapes, adapt the frontend, add
only the missing read model): a new `GET /tenders/:id/award` read model, an enriched contract list, and
the frontend driving the **real 3-actor ceremony** — reviewer recommends → authority approves under
SoD-1 → initiator publishes → contract auto-created. Keeping the ceremony split (rather than the FE
BOSS's one-click approve) is *more* faithful and demonstrates separation-of-duties live.

---

## 10. Cross-cutting invariants (and why each exists)

These are enforced everywhere and each is backed by a `learning/` note; violating one requires a new
note.

- **Money is integer paise; timestamps are UTC.** Floating-point money is a classic source of
  rounding bugs; paise-as-integer eliminates it. UTC everywhere avoids timezone ambiguity in an
  audit-critical system. Paise are carried as *strings* in JSON to survive JavaScript's 53-bit integer
  limit. (`learning/8`.)
- **Scoring is deterministic and explainable; no ML.** (§7.2, `learning/4`.)
- **The audit log is append-only, hash-chained, and separate from business tables.** Never read
  business state from audit, or vice-versa. (`learning/2`.)
- **RBAC + SoD are enforced at the API, not just the UI.** Denials cite the rule code and are audited.
  (`learning/10`, `learning/14`.)
- **Vendor private signing keys never touch the server.** (`learning/15`.)
- **A vendor with < 3 eligible contracts is `data_insufficient`, not low-scored.** (`learning/7`.)
- **Contracts (the API shapes) are sacred** — changed only via the ceremony (ticket → version →
  regenerate → announce), never edited silently.

Why encode them as named invariants: they are exactly the decisions a reviewer or interviewer will
probe, and they're the ones most likely to be quietly violated under time pressure. Naming them (and
gating them with tests) makes a violation loud.

---

## 11. Security posture

Layered, with the API as the boundary:
- **Transport of identity:** HttpOnly, same-origin cookies; the access token is encrypted (PASETO
  local), short-lived, and paired with a revocable refresh session that detects replay.
- **AuthZ:** RBAC for action types + SoD for contextual conflicts, both server-side and audited.
- **Confidentiality of bids:** two-cover sealing means price is invisible during technical scoring;
  sealing keys are Shamir-split so no single party can open a cover alone.
- **Non-repudiation:** client-side Ed25519 signatures the server verifies but never produces.
- **Integrity:** a tamper-evident hash-chained audit log with a verify endpoint; in prod the audit
  table's `UPDATE`/`DELETE` are revoked at the DB level.
- **Secrets discipline:** `docs/key.md` catalogues every credential by env-var *name* only and is
  gitignored; the committed `.env.example` holds empty placeholders; only `NEXT_PUBLIC_*` vars reach
  the browser, and never a secret behind that prefix.

Deliberately deferred (documented, not forgotten): per-keyholder identity binding on Shamir shares,
antivirus scanning on uploads, RFC-3161 timestamp anchoring of the audit tip, and hardware DSC tokens —
all P4+/P5.

---

## 12. Testing strategy

Each track has a native, named, runnable check; "a level is done when its check passes."

- **Backend — Bruno** (`apps/api/bruno/`): a versioned REST collection that drives the whole lifecycle
  at the API level, including a scripted `_boss/full-lifecycle` cold run (cold DB → closed contract →
  snapshot → audit verify). Currently **185 requests / 327 assertions**, all green.
- **Backend — `verify:*` scripts:** `tsx` scripts that exercise a wired flow end-to-end against a
  running API (client-signed bid, eval read model, analytics, admin, Shamir, quorum). They complement
  Bruno by testing the integration seams that need the FE-fixtures bridge.
- **Frontend — Playwright, both modes:** the MSW suite (**20/20**) proves the UI story stands alone;
  the **live** suite (`e2e-live/`, **19/19**) does a real login and asserts against real API data in a
  browser. Keeping them as two suites (rather than retrofitting one) is deliberate — they're different
  artifacts (`learning/49`).
- **Data — pytest + hypothesis:** unit tests plus **property tests** (1000 examples each of invariants
  like bounded, deterministic, monotonic) plus the portability replay. **74/74.**
- **The port proof:** `npm test --workspace=@repo/scoring` replays the portability snapshot to 1e-6.
- **Static:** `tsc` typecheck + eslint on both apps, and `openapi:gen` to keep the spec current.

Why this spread rather than one framework: each track's *idiomatic* tool is the one that actually
exercises it well (a REST runner for an API, a browser driver for a UI, property-based tests for a pure
numeric function). Uniformity would have made each weaker.

---

## 13. The data model

The core entities (Prisma models in `packages/db`):
- **Identity/access:** `Organization`, `User`, `Role`, `Permission`, `RolePermission`, `UserRole`,
  `RefreshSession`.
- **Procurement:** `Tender` (with `ScoringCriterion`, `TenderDocument`, `TenderRoleAssignment`,
  `TenderApprovalChain/Step`), `Vendor`, `Bid` (with `BidSeal`, `BidSignature`, `TechnicalScore`,
  `FinancialScore`), `Award`.
- **Sealing:** `TenderEnvelopeKey` (public key), `TenderKeyShare` (the 3 Shamir shares),
  `KeyContribution` (the quorum inbox).
- **Execution:** `Contract`, `ContractMilestone`.
- **Analytics:** `ContractPerformanceRecord`, `VendorPerformanceSnapshot`, `ContractDispute`.
- **Audit:** `AuditEvent` — append-only, hash-chained, deliberately *without* a FK from `actorUserId`
  to `User` (the chain must not depend on mutable business rows).

Relationship notes worth knowing: one `Award` per tender (`@unique tenderId`), one `Contract` per award
(`@unique awardId`), a `Bid` is unique per `(tenderId, vendorId)`, and `Contract` has a `vendor` relation
but only a scalar `tenderId` (so contract lists batch-join tender titles rather than `include` them — a
detail that shaped the Phase D list serializer).

---

## 14. Coding preferences & conventions (and the reasoning)

These are enforced as standing rules (`CLAUDE.md`); the reasoning matters as much as the rule.

- **File-top summary comment on every code file** — what it does, which track/role owns it, and the
  relevant `learning/N` link, kept current on every change. Why: a file should announce its purpose and
  its provenance so a reader (or a future session) orients instantly.
- **Capture every non-obvious decision in `docs/learning/`** — one topic per file, with the why and the
  rejected alternative, as part of the commit, not a later chore. Why: the decisions *are* the value;
  losing the "why" is how codebases rot into cargo-cult.
- **Comment the *why*, not the obvious *what*.** Flag gotchas and invariants inline.
- **Contracts are sacred** — changed only via the ceremony. Why: the whole three-tracks approach depends
  on the contract being stable and truthful.
- **Tests are the definition of done** — a level is cleared only when its named check passes, with real
  commands, never "works on my machine."
- **Honesty about what's mocked** — every commit states real vs mocked. Why: a portfolio that
  over-claims is worse than one that's modest and accurate; the honesty *is* the credibility.
- **Branch per ticket, first** — `git checkout -b <ticket-branch>` is step one, merged back `--no-ff`
  so the graph keeps ticket history visible. Commit subjects are `[Phase][Role][Level] <what>` with a
  bulleted body; the full message is shown and approved before committing; no AI co-author line.
- **Secrets discipline** — `key.md` + `.env.example` updated in the same change as any new provider;
  env-var names only, never values.
- **Maintenance triggers** — after each commit, refresh the ledger (`TICKET_STATUS.md`), the diary
  (`RUNNING_DOCS_LOG.md`), the learning log, `key.md`/`.env.example` if needed, and the Notion sync
  delta. The repo is the system of record; git is the truth for *what* changed, the repo files for
  *state*.
- **The Part-2 doc convention** — when a major phase shifts a walkthrough doc's source of truth, write a
  `*_PART2.md` continuation rather than rewriting, preserving the before/after learning arc.

---

## 15. What's real vs stubbed

| Real | Stubbed / deferred |
|---|---|
| PostgreSQL data · Fastify API · same-origin Next proxy | Object storage: `POST /files` is a dev-ack stub (no MinIO) |
| The ported `@repo/scoring` engine drives all analytics numbers | Nightly snapshot cron needs Redis (`snapshot:run` runs it Redis-free) |
| Client Ed25519 bid signing + server-side verification | Email · RFC-3161 anchoring · hardware DSC (P4+/P5) |
| Real SHA-256 hash-chained audit + chain verify | Per-keyholder identity binding on Shamir shares |
| Full award ceremony (recommend→approve→publish, SoD-1) + contract close | An actual cloud deployment + CI/CD (Phase E) |
| Shamir 2-of-3 split-key sealing (dev fallback auto-contributes shares) | Antivirus scan on uploads |

Being explicit about this table *is* the point — the system is genuinely end-to-end for the core
lifecycle, and honestly stubbed at the peripheral, non-differentiating edges.

---

## 16. The lifecycle: clone → dev → test → demo → deploy

1. **Clone + `npm install`.** Nothing external needed yet.
2. **Frontend-only (30s):** `make demo-mock` — the whole UI on MSW, no backend.
3. **The real thing (one command):** `make demo` — Docker Postgres, migrate + seed, API + web (MSW
   off), prints the URL + credentials. The full lifecycle live.
4. **Prove it:** the §12 matrix — Bruno, Playwright both modes, pytest, the port test.
5. **Understand the secrets:** two buckets — app-generated (a session key, a DB password: free,
   self-made) vs vendor credentials (all optional/stubbed). Local needs nothing external beyond Docker
   Postgres + the existing PASETO key.
6. **Deploy (optional):** a managed Postgres (`DATABASE_URL`) + a generated `PASETO_LOCAL_KEY` are the
   only genuinely-required prod vars; build both apps, `prisma migrate deploy`, seed real users, start
   the two processes, and turn on S3/Redis/email per feature. `NEXT_PUBLIC_USE_MSW=false` at build time.
   Flip `SHAMIR_DEV_MODE=false` for the real keyholder-quorum posture.
7. **Harden (optional, Phase E):** CI, prod Docker images, Lighthouse, a deploy script, then the P5
   stretches. Full detail in `HOW_IT_WORKS_PART2.md`.

Steps 1–5 are done and green today; 6–7 are the optional road ahead.

---

## 17. Why it's defensible — the "why" chain for interviews

If asked "why is it built this way," the chain is:
- **Why three isolated tracks?** To feel three disciplines and build the muscle of working against a
  contract; integration then becomes negotiation, not rewrite (`learning/12`).
- **Why PASETO not JWT?** To remove the algorithm-confusion footgun class.
- **Why a hash chain not a blockchain?** Tamper-evidence for a single-writer append-only log without
  distributed-consensus overkill (`learning/2`).
- **Why deterministic scoring not ML?** A public procurement decision must be reproducible, explainable,
  and contestable (`learning/4`).
- **Why `data_insufficient` not zero?** Scoring a newcomer 0 is a lie that unfairly excludes them
  (`learning/7`).
- **Why two-cover sealing?** So price can't bias technical evaluation.
- **Why Shamir quorum?** So no single official can open a sealed bid alone (`learning/52`).
- **Why verify client signatures instead of server-signing?** A server-produced signature proves nothing
  about vendor intent (`learning/45`).
- **Why enforce SoD at the API?** The UI is convenience; the API is the security boundary
  (`learning/14`).
- **Why port the engine instead of calling Python?** No network hop / second runtime / serialization
  boundary for a pure function; a proven-equivalent port is simpler (`learning/50`).

Every answer has a note, a rejected alternative, and a test. That's the defensibility.

---

## 18. The dev workflow & Turborepo task graph

**What.** Turborepo orchestrates tasks across the workspaces. The root `package.json` exposes the
day-to-day scripts: `dev:api` / `dev:web` (filtered `turbo run dev`), `db:generate` / `db:migrate` /
`db:seed` / `db:reset` (delegated to `@repo/db`), plus `build` / `lint` / `format`. Each workspace
declares its own `dev` / `build` / `check-types` / `lint`.

**How the pieces run in dev.**
- `apps/api` runs under `tsx watch src/index.ts` — instant reload on save, no build step.
- `apps/web` runs `next dev` — Fast Refresh.
- `@repo/db` is consumed as source (`exports: ./src/index.ts`), so schema/client changes flow without a
  publish step; `prisma generate` regenerates the typed client, `prisma migrate dev` creates a
  migration, `prisma migrate reset --force` (the `db:reset` script) drops → re-migrates → **seeds**.
- `@repo/scoring` is likewise consumed as source; `npm test --workspace=@repo/scoring` runs the port
  proof via a `tsx` runner (no separate test framework was added — a deliberate minimalism).

**Environment passthrough gotcha (`turbo.json` `globalEnv`).** Turbo 2.x runs tasks in a strict
environment and *strips* env vars a task doesn't declare. `SHAMIR_DEV_MODE` and `NEXT_PUBLIC_USE_MSW`
are listed in `turbo.json`'s `globalEnv` precisely so they reach the dev tasks — omitting that is why an
early Shamir run "ignored" the flag until it was declared.

**The seed story.** `db:reset` runs `packages/db/prisma/seed.ts`, which seeds 5 roles, ~34 permissions,
7 users (one per role + a dual-role `senior@` for SoD-1 testing; all password `DevPass123!`), and 3 demo
analytics vendors whose snapshots are computed *through the engine* and asserted equal to the frozen
port fixtures to 1e-6 (a running port proof on every reset). Separately,
`seed-from-frontend-fixtures.ts` **bridges** the frontend's fixtures (12 tenders, 8 analytics vendors,
eval bids) plus the Phase-D demo states (an AWARD_RECOMMENDED tender and a standalone ACTIVE contract)
into Postgres — but only for the live/demo path; the plain Bruno suite runs on the base seed *without*
the bridge (the bridge would contaminate the boss flow).

---

## 19. Operational gotchas (the things that will bite a fresh session)

These are real, learned-the-hard-way notes (mirrored from the handoff):

- **Postgres runs on host port 5433**, not the usual 5432 — a native Postgres already held 5432 on the
  dev machine. `DATABASE_URL` points at 5433 (in the gitignored `apps/api/.env` + `packages/db/.env`).
- **Port 8080 occasionally has a stray process.** If the API won't bind, `lsof -ti:8080` and kill it, or
  run with `API_PORT=8081`. A *stale* server on 8080 is the sneakiest failure — it keeps answering while
  a fresh `dev:api` fails `EADDRINUSE`, so every request 401/500s against the old process.
- **libsodium-wrappers loads via its CJS build** (`createRequire`) because its ESM build is broken.
- **The full Bruno suite is `db:reset` → `test:bruno` with NO `seed:fe-fixtures`.** Seeding the bridge
  first contaminates the `_boss` flow (cascade failures). The `verify:*` scripts, by contrast, *do* need
  the bridge.
- **`make demo` spawns a whole process tree** (`turbo run dev` → several PIDs). To switch a flag like
  `SHAMIR_DEV_MODE` you must kill the whole tree, or a stale server keeps answering on 8080.
- **Stop `dev:web` before running Playwright** — both want port 3000.
- **Money is a string in JSON** (integer paise as a string) to survive JS's 53-bit integer limit; parse
  deliberately, never with implicit `Number()` where precision matters.
- **The Tremor-heavy `/internal/vendors` route** can fail a *cold-compile* Playwright run on first hit
  (a timeout, not a code bug) — warm it or re-run.
- **The old Neon Postgres URL from the original scaffold should be rotated** before any real deploy (it
  sat in a local file; dev uses local Docker so it's harmless locally).

---

## 20. Appendix: glossary & the files that matter

**Glossary.** *Two-cover bid* — a bid split into separately-sealed technical and financial envelopes.
*TEC* — Technical Evaluation Committee. *SoD* — Separation of Duties. *RBAC* — Role-Based Access
Control. *PASETO* — Platform-Agnostic Security Tokens (the JWT alternative used here). *Sealed box* —
libsodium's anonymous public-key encryption (`crypto_box_seal`). *Manifest* — the canonical
tender/vendor/hash bundle a vendor signs. *Shamir Secret Sharing* — splitting a secret into `n` shares
of which any `k` reconstruct it. *Composite* — the final 0–1 vendor score. *Snapshot* — a stored,
timestamped computation of a vendor's score. *data_insufficient* — the honest "not enough contracts"
status. *MSW* — Mock Service Worker (browser-side API mocking). *Contract (as we use it)* — the API's
JSON shapes / OpenAPI spec.

**Files that matter most.**
- `apps/api/src/server.ts` — plugin + route registration.
- `apps/api/src/modules/bid/bid.service.ts` — bids, sealing, signing, the award flow, the award read
  model.
- `apps/api/src/modules/contract/contract.service.ts` — contract execution + the close→record loop.
- `apps/api/src/modules/audit/` + the `audit_insert` stored proc — the hash chain.
- `apps/api/src/lib/crypto/shamir.ts` — the from-scratch GF(2⁸) Shamir.
- `packages/scoring/src/*` — the ported engine (`metrics`/`recency`/`category`/`weights`/`score`/
  `explain`).
- `packages/db/prisma/schema.prisma` — the data model + migrations.
- `apps/web/next.config.ts` — the `/api/v1/*` proxy. `apps/web/mocks/` — MSW. `apps/web/e2e-live/` — the
  live suite.
- `apps/api/src/scripts/seed-from-frontend-fixtures.ts` — the fixtures→Postgres bridge + demo seed.
- `Makefile` + `scripts/demo.sh` — the one-command demo.

**Where to go next.**
- Run/test/deploy → `docs/HOW_IT_WORKS_PART2.md`.
- The as-built tour → `docs/PROJECT_TOUR.md` + `docs/PROJECT_TOUR_PART2.md`.
- Interview drilling → `docs/INTERVIEW_PREP.md`.
- The design-time "what to build" → `docs/architecture/`.
- Any single decision's full reasoning → `docs/learning/<N>-*.md`.

---

*End of deep dive. If a claim here ever conflicts with the code, the code wins — flag it and fix the
doc (`CLAUDE.md §10`).*
