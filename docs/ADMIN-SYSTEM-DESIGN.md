# The admin console — system design

What the admin console is for, what it already does, what it does not do yet,
and the requirements — functional and non-functional — it has to meet before the
pilot.

Written 2026-09-26 against the merged tree. Every number below was measured, not
estimated: 33 admin pages, 44 admin API routes, counted from the codebase.

---

## 1. What admin is for

> **Admin is the platform's evidence and exceptions desk. It decides who is real,
> it decides what happens when something looks wrong, and it leaves a record of
> both.**

That sentence is the test for whether a feature belongs here. Two things follow
from it, and both are already load-bearing in the code:

**Admin does not stand in for a participant.** An admin verifying an NGO is
admin's job. An admin opening a funding opportunity *on a funder's behalf*, or
approving a proposal *for* a donor, is admin doing someone else's job because
that someone had no screen. Week 5 moved that out (`hubs.ts` no longer offers
the Grants hub). The principle holds generally: if a participant could do it
themselves, it is not admin work.

**Admin is the only role that can turn evidence into a claim.** A compliance flag
is only earned by a human validating a field (`lib/compliance-evidence.ts`); an
`ExtractedField` only becomes `VALIDATED` through a human PATCH; a
`MatchCandidate` only becomes `SHORTLISTED` through the decision route. The AI
proposes and the platform routes, but nothing becomes true without an admin.
That is the whole trust model, and it should not be softened for convenience.

---

## 2. What exists today

Seven domains. Status is what I could verify by running or reading, not what was
planned.

### 2.1 Verification — **strong**

Pages: `/admin/verification`, `/admin/document-review`, `/admin/fcra-review`,
`/admin/ngos`, `/admin/ngos/[id]`, `/admin/donors`, `/admin/donors/[id]`,
`/admin/requirements`, `/admin/requirements/[id]`.

Covers NGO approval (evidence-gated — no documents means no Approve button),
per-field validation of AI extraction, FCRA certificates, donor PAN, donor
organisation (CIN / trust / government, added this week), and CSR requirement
validation. The one-pass extraction plus deterministic triage
(`lib/verification-triage.ts`) means the model never issues a verdict; it
produces evidence a human rules on.

This is the most complete and most carefully reasoned part of the platform.

### 2.2 Risk and compliance — **strong, partly unproven**

Pages: `/admin/risk-compliance`, `/admin/risk-radar`, `/admin/fraud-alerts`,
`/admin/trust-trends`, `/admin/impact-health`.
Routes: `risk/flag`, `risk/review`, `resolve-alert`, `fraud-investigations`.

Risk scoring, a fraud investigator agent, risk reviews, suspension, and the
nightly sweep that retracts compliance flags with no validated field behind
them. Well-built. "Partly unproven" because the investigator's eval is parked
with two known open questions (timeout-as-clean, human agreement), and because
suspension has no appeal path in the UI.

### 2.3 Delivery and campaigns — **adequate**

Pages: `/admin/project-review`, `/admin/projects`, `/admin/proof-review`,
`/admin/crisis`, `/admin/initiatives`.

Project approval, milestone proof review with AI validation, crisis campaigns,
initiatives. Works; nothing surprising.

### 2.4 The inbox and SLA — **strong, and unusual**

Pages: `/admin/today`, `/admin/sla`.

`Today` answers "what should I do now"; `SLA` answers "which promises are we
breaking". Targets are declared in `lib/sla.ts` with a written rationale per
queue (fraud 1 day, risk review 2, inquiries 2, project/proof/opportunity 3, NGO
verification 5). Very few products state their targets in code where they can be
argued with.

**It is detection only.** Nothing escalates, notifies, or reassigns. The file
says so itself.

### 2.5 People and correspondence — **adequate**

`/admin/inquiries`, threads, `ask-ngo`, `nudge`, `send-reminders`, and the NGO
reply-email setting.

### 2.6 Audit and reporting — **strong on capture, thin on use**

`/admin/audit`, `audit/export`, `fcra-report/generate`, `fcra-report/[id]/export`.

`AdminActionLog` is well designed: ids only (never names, emails or amounts), a
nullable `adminId` so platform-taken actions live in the same trail as human
ones rather than in a parallel log nobody reads, `oldValue`/`newValue` snapshots
of only the fields an action touched, IP and user agent, and a `schemaVersion`
for future replay.

### 2.7 The funder-led track — **deprecated but installed**

`/admin/opportunities`, `/admin/proposals`, `matching/*`. Removed from the
navigation this week; routes still resolve and still work. **Undecided, and that
is the problem** — see NFR-9.

---

## 3. Functional requirements

Numbered so they can be argued with individually. **Built** = verified this
session. **Gap** = does not exist.

### Verification

| | Requirement | State |
|---|---|---|
| FR-1 | An admin can approve or reject an NGO, and cannot approve one with no document evidence | Built |
| FR-2 | An admin can validate or reject each AI-extracted field; only a validated field earns a compliance flag | Built |
| FR-3 | An admin can approve, reject or request re-upload of an FCRA certificate, and see expiry | Built |
| FR-4 | An admin can verify a donor's PAN and, separately, their organisation | Built |
| FR-5 | An admin can validate a CSR requirement before it enters matching | Built |
| FR-6 | A rejected party is told why, in the reviewer's words, and can resubmit | Built (NGO, donor); **Gap** for requirement rejection notification |
| FR-7 | An admin can re-open a verification when later evidence contradicts it | Built (platform-initiated); **Gap** as a manual action |

### Risk

| | Requirement | State |
|---|---|---|
| FR-8 | An admin sees every unresolved fraud alert and can resolve it with a reason | Built |
| FR-9 | An admin can open, review and close a risk review | Built |
| FR-10 | An admin can suspend an organisation, and suspension blocks funding paths | Built |
| FR-11 | A suspended organisation can appeal, and an admin can lift a suspension | Built — see note below |
| FR-12 | Compliance flags with no validated evidence behind them are retracted automatically | Built |

**FR-11 was recorded as a gap and is not one.** Re-checked against the code on
2026-09-26, the appeal path exists end to end:

- `app/ngo/dashboard/page.tsx` renders a suspended organisation its suspension
  *reason* and a direct link to open an appeal — suspension blocks donations
  (`create-order` returns `NGO_SUSPENDED`) and matching (the `NOT_SUSPENDED`
  rule), but never the organisation's own login, so the appeal is reachable by
  the party who needs it.
- `POST /api/ngo/threads` opens a `ReviewThread` with `kind: APPEAL` and
  `entityType: "SUSPENSION"`, created as `NGO_RESPONDED` so it needs admin
  attention from the first moment rather than waiting to be noticed, with an
  abuse guard at three open appeals.
- Admins are notified (`notifyAdminsOfNgoThreadActivity`) and the thread lands in
  `/admin/inquiries`.
- `POST /api/admin/risk/review` lifts the suspension, and deliberately only when
  nothing else is still open against that organisation.

What the original entry probably meant is that there is no *dedicated*
suspension-appeal queue in the console — appeals arrive in the shared inquiries
inbox and are not visually distinguished from a routine question beyond an
"Appeal" badge. That is a triage weakness, not a missing capability, and it is a
much smaller thing than "a suspended organisation cannot appeal".

### Delivery

| | Requirement | State |
|---|---|---|
| FR-13 | An admin approves or rejects a project before it can raise money | Built |
| FR-14 | An admin reviews milestone proof, with AI validation as advice | Built |
| FR-15 | An admin can run and manage a crisis campaign | Built |

### Work management

| | Requirement | State |
|---|---|---|
| FR-16 | An admin sees one prioritised inbox across every queue | Built |
| FR-17 | An admin sees which SLA targets are being breached and by how much | Built |
| FR-18 | A breach escalates — notifies, reassigns, or raises severity | **Gap** |
| FR-19 | Work can be assigned to a named admin, and "mine" is a filter | **Gap** |

### Oversight

| | Requirement | State |
|---|---|---|
| FR-20 | Every state-changing admin action is recorded with actor, entity, before and after | Built — 44 of 44 routes log or are exempt with a stated reason; enforced by a test (NFR-2) |
| FR-21 | The audit trail is exportable for a regulator or an auditor | Built |
| FR-22 | An admin can see what the AI recommended and whether the human overrode it | Built (`metadata.overrodeAi`) |
| FR-23 | A second admin must approve the most consequential actions | **Gap** — see NFR-3 |

### Administration of the platform itself

| | Requirement | State |
|---|---|---|
| FR-24 | An admin can manage platform settings from a screen | **Gap** — `settings/ngo-reply-email` is an API with no page |
| FR-25 | An admin can create, disable or change the role of another user | **Gap** — no user management at all |
| FR-26 | An admin can see system health: failed jobs, stuck queues, schema drift | Partial — `diagnostics` route and `SchemaOutOfSync` banner exist; no page |

---

## 4. Non-functional requirements

This is where the real work is. Each one states the target, then the measured
reality.

### NFR-1 — Authorisation: every admin route proves it is an admin

**Target:** no admin route relies on the layout for protection.
**Measured: 44 of 44 admin API routes call `verifySessionRole(ADMIN)`. Zero gaps.**

This is the strongest single fact about the console. The layout gate
(`app/admin/layout.tsx`) protects pages; the API protects itself. Keep it that
way — a new route without the guard is a security bug, not a style issue.

### NFR-2 — Auditability: every state change is recorded

**Target:** 100% of state-changing admin routes write an `AdminActionLog` row.
**Closed 2026-09-26.** All 44 routes now either write a log or are exempt with a
stated reason, and `tests/admin-audit-coverage.test.ts` fails the build if a new
one does neither.

The original count of 15 was two too high. It grepped route files rather than
following the call graph: `ngos/[id]/inquiry` and
`matching/candidates/[id]/notify` both log through `openNgoInquiryThread`
(`NGO_INQUIRY_SENT`) and always did. The real gap was 13.

Nine routes gained a log:

| Route | Action | Why it needed one |
|---|---|---|
| `audit/export` | `AUDIT_TRAIL_EXPORTED` | Moves the whole trail out; records filters, row count, truncation |
| `fcra-report/generate` | `FCRA_REPORT_GENERATED` | Provenance of a compliance document |
| `fcra-report/[id]/export` | `FCRA_REPORT_EXPORTED` | Carries org names and FCRA numbers out |
| `initiatives/[id]` | `INITIATIVE_BANK_DETAILS_VIEWED` | The only place a bank account is decrypted |
| `extract-ngo-fields` | `NGO_EXTRACTION_RUN` | Paid call; a re-run can reset human field decisions |
| `screen-project` | `PROJECT_SCREENED` | Paid call; overwrites `aiScreeningScore` in place |
| `ngos/[id]/trust-insight` | `NGO_TRUST_INSIGHT_RUN` | Paid call |
| `donors/[id]/risk-insight` | `DONOR_RISK_INSIGHT_RUN` | Paid call |
| `ngos/[id]/nudge` | `NGO_NUDGE_DRAFTED` | Paid call |

Four are exempt, named in the test with their reasons: `diagnostics`,
`initiatives` (list) and `threads` (list) are reads; `today/visit` writes only
this admin's own "last looked at Today" marker, and logging every page view
would bury real actions in noise.

**Two corrections to the original entry, both found by reading the code:**

- `initiatives` and `initiatives/[id]` are GET-only — there is no create or
  update here, so "creating an initiative" was never the gap. The detail route
  is far more interesting than that: it is the single place
  `decryptBankAccountNumber` is called, and it was handing back a decrypted
  account number with no record of who asked. It also returned a dead
  `_viewedBy` field that nothing consumed — someone had intended this log and
  never wrote it. Now removed, and replaced by the real thing.
- `today/visit` is a write, not a read as first recorded. It stays exempt on
  the argument above rather than by mistake.

Three rules the implementation follows, and the tests enforce:

1. **The log describes the export; it never becomes a second copy of it.** Row
   counts and filters go in metadata; exported names and notes do not.
2. **Nothing is logged for an action that did not happen.** A 404, a 403, or a
   failed model call writes no row.
3. **Ids only.** `tests/admin-audit-gaps.test.ts` serialises each payload and
   asserts it contains no `@` and none of the names in the fixture — verified
   by introducing a leak and watching it fail.

### NFR-3 — Separation of duties

**Target:** the most consequential actions need a second pair of eyes.
**Measured: none do. `Role` is `DONOR | NGO | ADMIN` — one undifferentiated admin
role, no maker-checker anywhere.**

Any admin can today: approve an NGO, suspend an organisation, resolve a fraud
alert, and export the full audit trail. For a pilot with three or four trusted
people this is survivable. It is not survivable at scale, and it is the kind of
thing a partner's compliance team asks about in the first meeting.

Two options, in increasing order of cost:

- **Admin sub-roles** — `REVIEWER` (verification and proof), `RISK_OFFICER`
  (alerts, suspension), `SUPER_ADMIN` (settings, exports, user management). A
  `TeamRole`-shaped enum on the admin side, which the NGO side already
  demonstrates the pattern for.
- **Maker-checker on a short list** — suspension, un-suspension, audit export,
  and any manual reversal of a verification. A second admin confirms, and the
  log records both.

**Recommendation: sub-roles first.** They are cheaper, they cover most of the
risk, and maker-checker can be added on top of them later for the three or four
actions that truly need it.

### NFR-4 — Abuse and cost control

**Target:** every route that costs money or sends a message is rate-limited.
**Measured: 9 of 44 admin routes call `checkRateLimit`.**

**This entry was wrong, and the gap is smaller than it claimed.** Of the three
routes named, two are already limited: `ask-ngo` and `ngos/[id]/nudge` both call
`checkRateLimit`. And `nudge` does not send anything at all — it drafts a
message with the model and returns it for the admin to copy into `ask-ngo`, as
its own header says. Every paid model route is covered.

**The actual gap is one route: `send-reminders`.** It has no limit, and NFR-6
already notes it as the one path that could double-send. That makes it a
rate-limiting and an idempotency problem in the same place, which is the reason
to fix it next rather than a reason to widen the item.

### NFR-5 — Privacy

**Target:** logs and error context carry ids only; never names, emails or
amounts. Documents are served through the app, never from a public URL. No
personal data in query strings.
**State: holding.** `logAdminAction` snapshots only touched fields,
`captureError` follows the same rule, and the CSR document route
(`/api/requirements/[id]/file`) serves from private storage after an ownership
check. This is a rule that decays silently — it needs a test, not just a
convention. A lint rule or a unit test asserting that no `AdminActionLog` payload
contains an `@` would catch the regression.

### NFR-6 — Idempotency

**Target:** replaying any admin action or job does not double-apply.
**State: good where it matters.** `MatchCandidate` has a database-level
`@@unique([jobId, ngoId])` rather than application logic; the donations webhook,
receipt claims and risk crons are idempotent; requirement transitions use
compare-and-swap on version *and* status (`lib/requirements/commit.ts`).
**Gap:** the 15 unaudited routes above have no such guarantee, and
`send-reminders` in particular could double-send.

### NFR-7 — Performance

**Target:** an admin page returns in under a second on a queue of realistic size.
**State: mostly fine, with one structural risk.** Admin lists use `take`/`skip`
pagination. The known baseline is ~340ms driven by round trips to a Singapore
Neon instance — a network shape, not a query problem. The nav badge block in
`app/admin/layout.tsx` runs five counts in parallel on **every admin page load**;
that is five extra round trips per navigation and the first thing to cache when
the queues grow.

### NFR-8 — Resilience

**Target:** a degraded dependency degrades a feature, not the console.
**State: good.** Nav badges are wrapped in try/catch with a comment saying a
schema or connection hiccup must not take the console down; the Neon driver has
a retry wrapper; `SchemaOutOfSync` renders a banner instead of an exception.
**Gap:** several files still bypass the `lib/prisma.ts` singleton with their own
`new PrismaClient()` and so lose that retry wrapper — the WhatsApp worker, the
drafts routes, and the pitch/lead route.

### NFR-9 — One system per question

**Target:** one model of a thing, not two.
**Violated.** `FundingOpportunity`/`MatchCandidate`/`Proposal` and
`SponsorRequirement`/`RequirementMatch`/`OpportunityResponse` both exist, both
work, and both answer "who should get this money". The nav hides the first; the
routes still serve it. Two systems with one purpose drift, and the next person
will not know which to extend.

**This is a decision, not a task, and it is admin's to make** because admin is
the only role that can see both.

### NFR-10 — Environments

**Target:** changes are exercised somewhere that is not a laptop before they
reach a person.
**Measured: there is no staging environment.** The end-to-end run in
`WEEK5-GAPS.md` happened on a developer machine against the shared dev database,
and two migrations failed in the process — on the *shared* database, because
there was nowhere else to fail. This is the top non-functional gap on the list
and nothing on this page fully compensates for it.

### NFR-11 — Admin account security

**Target:** an admin account is harder to take over than a donor account.
**State: identical to a donor account.** Same credentials flow, no second factor,
no session pinning, no IP allow-list, no forced re-auth before a consequential
action. `AdminActionLog` captures IP and user agent, so there is forensics after
the fact but no prevention. For a role that can approve organisations and export
the audit trail, that asymmetry is wrong.

### NFR-12 — Observability

**Target:** a failure in an admin path is visible without someone reporting it.
**State: partial.** `captureError` exists and is used; the `diagnostics` route
exists. There is no dashboard, no alerting, and no page surfacing failed jobs or
stuck queues — FR-26.

---

## 5. What to start, in order

Ranked by risk removed per unit of work, not by size.

**1. Close the audit gaps — NFR-2. Done, 2026-09-26.** Nine routes gained a
log, two turned out never to have been gaps, and
`tests/admin-audit-coverage.test.ts` now fails the build when a state-changing
admin route ships without one — so the count in this document cannot silently
rot again. It took about half a day. The unexpected find was the bank-detail
disclosure in `initiatives/[id]`, which the original list had mischaracterised
as a create/update.

**2. Admin sub-roles — NFR-3.** The largest structural gap. A single
undifferentiated ADMIN that can suspend organisations and export everything is
the finding a partner's compliance review opens with. Start with the enum and
the guard; the UI can follow.

**3. Decide the two-engine question — NFR-9.** Not code, an afternoon of
agreement, and it blocks sensible work in two portals. Either the funder-led
track is read-only support for offline funders — say so in `hubs.ts` and freeze
it — or it goes, with its routes, models and tests.

**4. Rate-limit `send-reminders` — NFR-4.** One route, not three: `nudge` and
`ask-ngo` are already limited, and `nudge` never sends. Worth pairing with the
idempotency fix NFR-6 calls for on the same route, since a double-send is
visible to an outside organisation.

**5. Second factor for admin accounts — NFR-11.** Before any real organisation's
data is in the system, not after.

**6. SLA escalation — FR-18, and assignment — FR-19.** The targets are declared
and measured; nothing acts on them. With more than three admins, "everyone can
see everything and nobody owns anything" stops working.

**7. Staging — NFR-10.** Listed last only because it is not an admin feature.
By actual priority it is first, and it is not admin's to build alone.

### Deliberately not now

- **Payouts and disbursement.** Still the last module, by decision.
- **A finance ledger and reconciliation.** Real, P0 for the pilot, and a
  different system from this one — it should not be bolted into the console.
- **Maker-checker.** Wait until sub-roles exist; adding it first would mean
  building the approval machinery twice.

---

## 6. The invariants

The rules that must survive every change above. Each is already true in code;
each would be easy to break by accident.

1. **Role is not ownership.** `verifySessionRole("ADMIN")` proves the caller is
   an admin, never that they may touch this row. Cross-tenant checks stay
   explicit and per-route.
2. **No evidence never reads as safe.** An organisation with nothing extracted
   renders as "Not analysed", not as clean. `UNKNOWN` is a third outcome, never
   folded into pass or fail.
3. **Nothing becomes true without a human.** The AI proposes and the platform
   routes; `VALIDATED`, `SHORTLISTED`, `APPROVED` and `VERIFIED` are human acts.
4. **A decision without a reason is not a decision.** Rejection and suspension
   require a note, stored verbatim so it survives a later edit to the record.
5. **Ids only in logs and error context.** The log outlives PII retention on the
   tables it points at.
6. **Replay changes nothing.** Every job, webhook and admin action is safe to
   run twice.
