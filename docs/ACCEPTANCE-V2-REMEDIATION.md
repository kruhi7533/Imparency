# Acceptance Test Pack v2 — remediation report

Source: *ImpactBridge — Acceptance Test Pack Report v2 (sheet-driven)*, 25 Oct 2026
(91 cases: 20 PASS · 28 PARTIAL · 22 FAIL · 7 NOT BUILT · 14 NOT RUN).
Branch: `fix/acceptance-v2-remediation`.

**How this was verified.** Unit/integration: Vitest (`npm test`, Prisma mocked). Browser: Playwright suites
that drive the real UI against a local server and a seeded Postgres database —
`e2e-tests/acceptance-v2-admin-security-ai.spec.ts` (ADM, NEG, AI) and
`e2e-tests/acceptance-v2-ngo-donor-e2e.spec.ts` (NGO, DON, E2E), one test per case ID.
Final results are in [§ Results](#results). No real money moved; all payments are sandbox/manual-test.

## The five P0 defects

| ID | Root cause | Fix |
|---|---|---|
| **D1** stale RiskReview blocks verification | `applyTriage` returned early on a SAFE verdict, so the OPEN review from the *old* documents was never superseded; `verify-ngo` read only the newest open review; no API listed reviews. Also: registration `require()`d the extraction runner, which returned no export, so re-analysis never started. | A clean re-run now closes triage-opened reviews and resolves their alerts (never admin/agent ones); `verify-ngo` weighs all open reviews; `GET /api/admin/risk/review`; dynamic `import()`; NGO dashboard "Replace your documents" + prefilled resubmission. `lib/verification-triage.ts`, `app/api/admin/verify-ngo`, `tests/verification-resubmission.test.ts`. |
| **D2** field photo sync 500 | `lib/storage.ts` private provider ignored Cloudinary and wrote to the read-only serverless disk (EROFS). | Cloudinary authenticated private storage; `StorageError` codes; structured route errors (413/415/503/409); clientId idempotency; byte-sniffed types incl. HEIC; signed 5-minute photo links that re-check access. |
| **D3** RFP upload 500 (empty body) | Parser modules failed to load on serverless before the handler ran; LLM/storage failures surfaced as bare 500s. | Lazy parser loading, catch-all JSON errors, retryable FAILED state with codes (`PDF_NO_TEXT`, `PDF_UNREADABLE`, `PRIVATE_STORAGE_UNAVAILABLE`, …), Claude → Gemini → rule-based extraction, manual entry. |
| **D4** milestones UNFUNDED after full reconciliation | Payments were recorded without a milestone link; nothing allocated reconciled money; allocation existed only for the legacy Proposal model. | `lib/contract-funding.ts`: allocation in milestone order (or donor-chosen milestone) inside a row-locked transaction, recalculated on reconciliation only; `ContractPaymentAllocation`; admin approve/reject; contract + project `fundedAt`. |
| **D5** UTR not matched | SANDBOX discarded the supplied UTR; the reconcile sweep did no UTR matching. | UTR kept and normalised in every mode, duplicate per payer account → 409; sweep matches bank lines by UTR + amount; unmatched lines → `UNMATCHED_BANK_LINE` exception queue with manual match. |

## Case map

Status column = verdict in the 25 Oct report → what was done. Browser result: see § Results.

### Admin (20)
| ID | Was | Change |
|---|---|---|
| ADM-001 | PASS | Unchanged; role gate also covers new admin sub-roles. |
| ADM-002 | FAIL | D1. |
| ADM-003 | PASS | Unchanged. |
| ADM-004 | NOT BUILT | `POST /api/admin/ngos/[id]/request-reverification` + button; NGO "Re-verification due" banner. |
| ADM-005 | PASS | Structured `fcraRequired` field drives eligibility (text sniffing only as fallback). |
| ADM-006 | FAIL | Admin shortlist approve / reject / reorder (`PUT /api/requirements/[id]/shortlist`); invites require approval. |
| ADM-007 | PARTIAL | Contract before proposal selection refused server-side (400), tested. |
| ADM-008 | PARTIAL | Receivable schedule per milestone; committed vs reconciled vs allocated shown separately. |
| ADM-009 | PARTIAL | D5. |
| ADM-010 | PARTIAL | Signed webhook replay test; 503 `WEBHOOK_NOT_CONFIGURED` when secret unset. |
| ADM-011 | FAIL | D4 + admin allocation approval on the requirement→contract flow. |
| ADM-012 | FAIL | D2 + `GET /api/admin/field-evidence` and review queue page. |
| ADM-013 | FAIL | Duplicate / GPS-mismatch flags; approving a flagged photo requires a note. |
| ADM-014 | FAIL | Claims citing approved photos approvable; +19 pp computed from approved claims only. |
| ADM-015 | NOT RUN | Consent-filtered public/donor stories (Claude → Gemini → labelled template), admin publishes. |
| ADM-016 | PASS | Unchanged. |
| ADM-017 | PARTIAL | Hash-chained, append-only `AdminActionLog` (DB triggers), verifier, export verifier, signed checkpoints. See `docs/AUDIT-INTEGRITY.md`. |
| ADM-018 | NOT BUILT | Dead-letter queue with one-time replay and dismiss (`/admin/dead-letters`). |
| ADM-019 | PARTIAL | Organisation isolation centralised in `lib/tenant-scope.ts`; coverage test over every org route. |
| ADM-020 | NOT BUILT | Break-glass: SUPPORT role, reasoned time-boxed grants (≤60 min), audited, revocable. |

### NGO (20)
| ID | Was | Change |
|---|---|---|
| NGO-001 | FAIL | Registration draft save-and-resume (`/api/ngo/register/draft`). |
| NGO-002 | PASS | Works without an AI key via rule-based document reading; Claude when configured. |
| NGO-003 | NOT BUILT | Team invites (Program Manager / Field Worker): hashed expiring single-use tokens, revoke, resend, accept. |
| NGO-004 | PASS | Unchanged. |
| NGO-005 | PARTIAL | `/ngo/match-inbox` lists CSR invitations with next action. |
| NGO-006 | PASS | Proposal-assist draft added (AI-005). |
| NGO-007 | PASS | Unchanged. |
| NGO-008 | PARTIAL | D4 — milestones and project reach FUNDED. |
| NGO-009 | PARTIAL | Tasks assignable to field workers / program managers. |
| NGO-010 | PARTIAL | Consent per purpose on feedback; beneficiary accounts deliberately not built (pseudonymous by design). |
| NGO-011 | NOT RUN | Field worker sees only their assigned tasks. |
| NGO-012 | FAIL | D2 + clientId replay idempotency. |
| NGO-013 | FAIL | D2. |
| NGO-014 | FAIL | Duplicate / bad-GPS flag → return to NGO → recapture loop. |
| NGO-015 | NOT BUILT | Expense / utilisation per contract milestone with private receipts. |
| NGO-016 | FAIL | +19 pp from approved claims. |
| NGO-017 | PARTIAL | Stored `ContractImpactReport` (DRAFT → SUBMITTED → PUBLISHED / RETURNED), approved-only figures. |
| NGO-018 | PARTIAL | Feedback aggregation; donor view aggregates only, k ≥ 5. |
| NGO-019 | PASS | Unchanged. |
| NGO-020 | NOT BUILT | Renewal / next-opportunity requests from stored reports. |

### Donor / CSR (18)
| ID | Was | Change |
|---|---|---|
| DON-001 | PASS | Unchanged. |
| DON-002 | PARTIAL | Donor team FINANCE role with distinct permissions. |
| DON-003 | PASS | Unchanged. |
| DON-004 | FAIL | D3. |
| DON-005..007 | PASS | Unchanged (shortlist now admin-ordered). |
| DON-008 | PARTIAL | Side-by-side v1/v2 proposal diff. |
| DON-009 | PASS | Unchanged. |
| DON-010 | PARTIAL | D4 + D5. |
| DON-011 | PARTIAL | Per-milestone utilisation correct. |
| DON-012 | NOT RUN | Milestone funded / completed notifications via preference-aware dispatch. |
| DON-013 | FAIL | Approved-only impact view and CSV with baseline→endline and `INSUFFICIENT_DATA`. |
| DON-014 | NOT RUN | Consent-safe donor story. |
| DON-015 | PASS | Unchanged. |
| DON-016 | FAIL | `POST /api/engagement/re-engage` with a stored report id. |
| DON-017 | PARTIAL | Donor responses redacted (reviewer notes, AI scores, risk data). |
| DON-018 | NOT RUN | Channel preferences, WhatsApp opt-out → email/in-app fallback, delivery log. |

### Cross-portal (8), Negative/Security (15), AI resilience (10)
| ID | Was | Change |
|---|---|---|
| E2E-001 | FAIL | D1 (sheet's own JJRT profile verified end to end in the browser). |
| E2E-002 | PARTIAL | D3 + ADM-006. |
| E2E-003 | PASS | Unchanged. |
| E2E-004 | PARTIAL | D4. |
| E2E-005 / 006 | FAIL | D2 chain through to approved outcome and donor report. |
| E2E-007 | PARTIAL | Re-engagement from a stored report. |
| E2E-008 | FAIL | P0 blockers removed; uninterrupted journey tested. |
| NEG-001 | PASS | Plus admin sub-role write refusal tested across all admin write routes. |
| NEG-002 | PARTIAL | Central org isolation + coverage test. |
| NEG-003 | NOT RUN | Withdrawal unpublishes stories, invalidates signed links, figures become "unverified". |
| NEG-004 | NOT RUN | Prompt-injection text flagged; hard rules unaffected. |
| NEG-005 / 006 / 007 | PARTIAL | Webhook replay; allocation over-allocation 422; pre-approval contract 400. |
| NEG-008 / 009 | FAIL | Duplicate / GPS flags observed. |
| NEG-010 | PARTIAL | Literal `INSUFFICIENT_DATA` rendered. |
| NEG-011 | NOT RUN | WhatsApp opt-out honoured with fallback and log. |
| NEG-012 | NOT BUILT | Dead-letter replay (ADM-018). |
| NEG-013 | PARTIAL | Tamper detection (ADM-017). |
| NEG-014 | PARTIAL | Three donor-facing leaks removed (report review note, per-candidate admin notes, AI score in donor feed). |
| NEG-015 | NOT RUN | Signed photo links expire and are revoked on rejection / consent withdrawal. |
| AI-001 / 002 | FAIL / NOT RUN | D3 + budget-conflict flag. |
| AI-003 / 004 | PASS | Unchanged. |
| AI-005 | NOT RUN | Proposal-assist draft. |
| AI-006 | FAIL | "AI flags, human decides" on field evidence. |
| AI-007 / 008 | NOT RUN / PARTIAL | Consent-filtered narrative generation. |
| AI-009 | NOT RUN | `AiCallLog` telemetry for every model call (+ rule-based runs), `/admin/ai-telemetry`. |
| AI-010 | NOT RUN | Timeouts + admin fault injection (refused in production); callers degrade to "AI unavailable — human review required". |

## Schema changes (additive migrations only)
`20261027120000` requirement extraction errors + shortlist review · `130000` contract milestone funding + UTR ·
`140000` team / admin roles / break-glass · `150000–150004` audit hash chain, dead letters, AI call log,
notification delivery log · `160000–160001` impact reports, stories, expenses, registration drafts.
Apply with `npx prisma migrate deploy`. **Do not** run the repo's `npm run build` against production as-is:
it executes `prisma db push --accept-data-loss` (pre-existing P0 in CLAUDE.md) — deploy with
`prisma migrate deploy && next build` instead.

Operational notes: the audit-log triggers make `AdminActionLog` append-only, so a user referenced by audit rows
cannot be hard-deleted (by design). Run `npm run seed:admin-roles` to create finance/auditor/support pilot accounts
(password from `PILOT_ADMIN_PASSWORD`).

## Environment variables
New, all optional: `ANTHROPIC_API_KEY` (+ `ANTHROPIC_WORKSPACE_ID` for org-level keys), `AUDIT_CHAIN_KEY`,
`AI_FAULT_INJECTION`, `AI_FAULT_INJECTION_ALLOW_PRODUCTION`, `AI_TIMEOUT_MS`, `PILOT_ADMIN_PASSWORD`.
Existing ones that the fixed paths rely on in production: `STORAGE_PROVIDER=cloudinary` + `CLOUDINARY_*`
(private uploads), `RAZORPAY_WEBHOOK_SECRET`, `GEMINI_API_KEY` (optional if Claude is set).

## UI
Light redesign of the homepage, admin console (sidebar shell + live dashboard) and NGO/donor portals
(sidebar shells + dashboards); every figure is read from the database; motion respects
`prefers-reduced-motion`; no horizontal scroll at 375 px.

## Results
_Filled in from the final Playwright runs._
