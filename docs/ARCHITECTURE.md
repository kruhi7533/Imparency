# ImpactBridge — Developer Knowledge Base

> **Purpose:** this is the standing reference for this repo. It should be consulted before implementing any feature, and answers about "how does X work" should be built from this document plus targeted re-reads of the cited files — not full rediscovery. It reflects the codebase as read on 2026-07-16; if a cited function/file no longer exists, treat this doc as stale for that claim and re-derive it, then fix this file.
>
> Repo root: `c:\imparency-main`. App: **ImpactBridge** — a trust-first NGO donation platform (Next.js 14 App Router, Prisma 5 + Neon Postgres, NextAuth, Razorpay, Google Gemini, Twilio WhatsApp).
>
> This repo also has its own AI-agent methodology in `PROJECT_RULES.md`/`GSD-STYLE.md`/`.gsd/` (SPEC→PLAN→EXECUTE→VERIFY→COMMIT). That governs *process*; this file governs *what the code does*. Both apply.

**Primary author:** git history shows `kruhi7533@gmail.com` as the overwhelming majority author/committer across the whole project (first commit through present), with a few feature branches authored by collaborators (`sakshiawasthi00114@…`, `trmalge@gmail.com`) and one contributor operating as `Antigravity <antigravity@gemini.local>` — all merged into `main` by kruhi7533. Effectively the whole codebase should be treated as "yours."

**Most recently active modules** (tip of `git log`, in order — treat these as where work continues, and see §13 for depth beyond the rest of this doc):
1. Team invites (`bc0844b`)
2. WhatsApp bot + field-worker registration + NGO settings (profile/team) + CRM + pitch deck (`daceffd`)
3. Donor domain merge — dashboard/profile/persona/discover/quick-donate (`568d978`, `29f0c7f`, `e59d47e`, `8f70d4d`)

---

## 1. Feature Map

### Authentication
- **Purpose:** identity + role-based access (`DONOR`/`NGO`/`ADMIN`), plus a secondary per-NGO role (`TeamRole`: `OWNER`/`ADMIN`/`FINANCE`/`FIELD_STAFF`).
- **Files:** `lib/auth.ts` (NextAuth config, Credentials + Google providers, JWT/session callbacks), `lib/auth-guards.ts` (`verifySessionRole`), `middleware.ts` (edge redirect), `app/login/page.tsx`, `app/api/auth/signup/route.ts`, `app/api/auth/[...nextauth]/route.ts`, `types/next-auth.d.ts` (Session/JWT/User type augmentation).
- **APIs:** `POST /api/auth/signup`, `[...nextauth]` catch-all (signin/signout/session/callback).
- **DB models:** `User`, `NGOTeamMember`, `TeamInvite`.
- **Reusable components:** none dedicated; `useSession()` (`next-auth/react`) is used ad hoc wherever client components need identity.
- **Utilities:** `bcryptjs` (password hashing).

### Donation (donor-side browsing + giving)
- **Purpose:** let donors discover NGOs/projects and donate.
- **Files:** `app/discover/page.tsx`, `app/projects/[id]/page.tsx` + `ProjectClient.tsx`, `app/components/DonateModal.tsx`, `app/donor/donations/page.tsx`, `app/donor/donations/[donationId]/pending/page.tsx`, `app/donor/retry/[token]/page.tsx`.
- **APIs:** `app/api/ngo/discover/route.ts`, `app/api/donations/create-order`, `webhook`, `[donationId]/status`, `retry/[token]`, `csr-certificate`.
- **DB models:** `Donation`, `Project`, `TaxReceipt`, `RateLimitLog` (unused in practice — see §11).
- **Reusable components:** `DonateModal.tsx`, `ProjectCoverImage.tsx`, `ShareProjectModal.tsx`.
- **Utilities:** `lib/fcra-gate.ts`, `lib/retry-utils.ts`, `lib/receipt-generator.tsx`, `lib/finance-utils.ts`, `lib/storage.ts`, Razorpay SDK.

### NGO Dashboard
- **Purpose:** the NGO's home base — verification-state-aware (PENDING/REJECTED/VERIFIED branches), project/milestone management, WhatsApp join code display, proof submission.
- **Files:** `app/ngo/dashboard/page.tsx` (server, verification-state router) → `DashboardClient.tsx` (1157 lines, the biggest client component in the app) + `SubmitProofModal.tsx`.
- **APIs:** `app/api/ngo/projects` (GET/POST), `projects/[id]` (GET/PUT/DELETE), `submit-proof`, `settings`.
- **DB models:** `NGOProfile`, `Project`, `Milestone`, `MilestoneProof`.
- **Reusable components:** `DatePicker.tsx`, `AIGenerateField.tsx` (AI-assisted copy fields).
- **Utilities:** `lib/gemini/validate-proof.ts`, `lib/ngo-health.ts`, `lib/storage.ts`.

### Admin
- **Purpose:** platform moderation console — NGO verification, proof review, fraud/risk resolution, FCRA queue.
- **Files:** `app/admin/dashboard/page.tsx` + `AdminClient.tsx` (769 lines), `app/admin/proof-review/*`, `app/admin/fraud-alerts/*`, `app/admin/risk-compliance/*`, `app/admin/fcra-review/*`.
- **APIs:** `verify-ngo`, `review-proof`, `review-fcra`, `screen-ngo`, `resolve-alert`, `risk/flag`, `risk/review`, `ask-ngo`, `send-reminders`, `fcra-report/generate`, `fcra-report/[id]/export`.
- **DB models:** touches nearly everything — `NGOProfile`, `NGOCompliance`, `Milestone`, `MilestoneReview`, `FraudAlert`, `RiskReview`, `FcraQuarterlyReport`.
- **Utilities:** `lib/gemini/explain-rejection.ts`, `lib/ngo-compliance.ts`, `lib/risk-agent.ts`, `lib/fraud-alerts.ts`.

### Compliance (FCRA / health / risk)
- **Purpose:** India-specific regulatory gating (FCRA) plus two independent trust scores (compliance completeness, operational health) and a fraud/risk detection layer. Full detail in §9.
- **Files:** `lib/fcra-gate.ts`, `lib/fcra-quarterly.ts`, `lib/fcra-reminders.ts`, `lib/ngo-compliance.ts`, `lib/ngo-health.ts`, `lib/risk-agent.ts`, `lib/fraud-alerts.ts`, `lib/compliance-agent.ts`.
- **APIs:** `admin/review-fcra`, `admin/verify-ngo`, `admin/risk/flag`, `admin/risk/review`, `admin/resolve-alert`, `ngo/[id]/fcra-status`, `cron/fcra-expiry`, `cron/fcra-quarterly-report`.
- **DB models:** `NGOCompliance`, `ComplianceAuditLog`, `FraudAlert`, `RiskReview`, `FcraQuarterlyReport`.

### WhatsApp (field-worker proof channel)
- **Purpose:** an alternate, non-web ingestion path — NGO field workers submit milestone evidence via WhatsApp; AI enriches it into a reviewable draft.
- **Files:** `app/api/whatsapp/route.ts` (Twilio webhook), `lib/whatsapp/worker.ts` (background enrichment), `app/api/media-proxy/route.ts`, `app/api/drafts/*`, `app/api/ngo/whatsapp-drafts/convert/route.ts` (**dead code** — see §12).
- **DB models:** `FieldWorker`, `DraftProof`, `NGOProfile.joinCode`.
- **Utilities:** Twilio SDK, Cloudinary, `@google/generative-ai` (legacy SDK — not `@google/genai`, see §7).

### AI
- **Purpose:** Gemini-backed document screening, proof validation + Theory-of-Change scoring, narrative generation, campaign copy, milestone suggestion, geo-intelligence. Full detail in §7.
- **Files:** `lib/gemini/*.ts`, `lib/screening-runner.ts`, `lib/impact-metrics.ts`, `lib/geo-intelligence.ts`.
- **APIs:** `ai/generate-campaign-copy`, `ai/suggest-milestones`, `ai/ngo-insight`, `admin/screen-ngo`, `ngo/submit-proof`, `ngo/projects/[id]/geo-enrich`, `ngo/projects/[id]/toc-check`, `admin/ask-ngo`.

### Payments
- **Purpose:** Razorpay order/webhook lifecycle, retries, 80G/CSR PDF generation. Full detail in §8.
- **Files:** `app/api/donations/*`, `lib/receipt-generator.tsx`, `lib/retry-utils.ts`, `lib/finance-utils.ts`.

### Notifications
- **Purpose:** in-app `Notification` rows + FCM push; **no in-app UI surfaces them today** (see §12).
- **Files:** `lib/notification.ts` (`sendPushNotification`), `lib/notification-triggers.ts` (5 trigger functions), `public/firebase-messaging-sw.js`.
- **DB models:** `Notification`.

### Team Invites *(recently added — see §13 for full depth)*
- **Purpose:** let an NGO owner/admin invite teammates by email; auto-joins them as an `NGOTeamMember` on signup.
- **Files:** `app/ngo/settings/team/actions.ts`, `TeamSettingsClient.tsx`, `page.tsx`; `app/api/auth/signup/route.ts` (auto-accept logic); `lib/email.ts` (`sendTeamInviteEmail`).
- **DB models:** `TeamInvite`, `NGOTeamMember`.

### Pitch Deck *(recently added — see §13)*
- **Purpose:** auto-generated PPTX fundraising deck (platform-level marketing + per-NGO/per-campaign variants), with a lead-capture gate.
- **Files:** `scripts/generate-pitch.js`, `app/api/pitch/*`, `app/pitch/page.tsx`, `app/ngo/pitch-deck/page.tsx`, `components/ngo/PitchDeckSection.tsx`.
- **DB models:** `PitchLead`.

### Donor Domain *(recently merged — see §13)*
- **Purpose:** persona-tailored profile, portfolio, dashboard, quick-donate entry point.
- **Files:** `app/donor/layout.tsx`, `dashboard/page.tsx`, `portfolio/*`, `profile/*`, `onboarding/page.tsx`; `components/donor/DonorSidebarShell.tsx`, `ProfileActions.tsx`; `components/home/QuickDonateSelector.tsx`.
- **DB models:** `User` (persona/category/tier fields), `ReEngagementEvent`, `ConsentLog`.

---

## 2. Dependency Map

*Blast radius = what breaks, in plain terms, if the file's main export's signature changes.*

| File | Imported by (callers) | Imports (calls) | Blast radius if changed |
|---|---|---|---|
| `lib/prisma.ts` | ~68 files across `app/`+`lib/` via `@/lib/prisma`, +6 scripts via relative import. **Bypassed** (own `new PrismaClient()`) by: `lib/whatsapp/worker.ts`, `app/api/whatsapp/route.ts`, `app/api/drafts/route.ts`, `app/api/drafts/[id]/route.ts`, `app/api/drafts/[id]/retry/route.ts`, `app/api/ngo/whatsapp-drafts/convert/route.ts`, `app/api/pitch/lead/route.ts`, + 8 scripts | `@prisma/client`, `@neondatabase/serverless`, `@prisma/adapter-neon` | Nearly every DB call in the app; the 7 bypassing files also **lose the Neon cold-start retry wrapper** (§ Common Mistakes). |
| `lib/auth.ts` | 39 files via `getServerSession(authOptions)` | `next-auth`, providers, `@/lib/prisma`, `bcryptjs` | All session/role gating platform-wide; also feeds `lib/auth-guards.ts`. |
| `lib/auth-guards.ts` | 20 API routes (`ngo/register`, `projects`, `submit-proof`, `admin/*`, `engagement/*`, `ai/*`, `donations/*`, `user/donor-category`, `verify-phase1`) | `next-auth/next`, `@/lib/auth` | Changing `verifySessionRole`'s return shape breaks the destructure in all 20 routes at once. |
| `lib/fcra-gate.ts` | `app/api/donations/create-order/route.ts`, `app/api/user/donor-category/route.ts` | `@/lib/ngo-compliance` (`deriveFcraStatus`) | The donation-eligibility gate at checkout. |
| `lib/ngo-compliance.ts` | `lib/fcra-gate.ts`, `lib/fcra-quarterly.ts`, `lib/fcra-reminders.ts`, `lib/compliance-agent.ts`, `app/api/ngo/[id]/fcra-status/route.ts`, `app/api/admin/review-fcra/route.ts` | `@/lib/prisma` | Compliance score, FCRA status derivation everywhere. |
| `lib/ngo-health.ts` | `app/api/ngo/submit-proof/route.ts`, `app/api/admin/review-proof/route.ts` | `@/lib/prisma` | Health score goes stale if `recalculateNGOHealthScore` breaks. |
| `lib/risk-agent.ts` | `app/api/ngo/submit-proof/route.ts` (dynamic require), `app/admin/risk-compliance/page.tsx` | `@/lib/prisma`, `@/lib/fraud-alerts` | Low-score fraud detection + admin risk page sweep. `checkDonationRate` export is **dead** (no callers found). |
| `lib/fraud-alerts.ts` | `lib/risk-agent.ts`, `app/api/ngo/register/route.ts` (dynamic require) | `@/lib/prisma` | Alert creation from both risk checks and registration duplicate-PAN detection. `checkPANUsage` export appears **dead**. |
| `lib/notification.ts` | `lib/notification-triggers.ts` only | `firebase-admin`, `@/lib/prisma` | All 5 triggers stop firing if `sendPushNotification` breaks. |
| `lib/notification-triggers.ts` | `app/api/admin/review-proof/route.ts`, `app/api/ngo/submit-proof/route.ts`, `app/api/ngo/projects/route.ts` (dynamic require) | `@/lib/prisma`, `@/lib/gemini/generate-narrative`, `@/lib/notification`, `@/lib/email` | Milestone-complete donor emails, proof approve/reject NGO alerts, new-project follower alerts. |
| `lib/email.ts` | ~10 files (`lib/reminders.ts`, `fcra-reminders.ts`, `fcra-quarterly.ts`, `notification-triggers.ts`, `admin/review-fcra`, `admin/ask-ngo`, `admin/verify-ngo`, `engagement/re-engage`, `donations/webhook`, `ngo/projects`, plus `ngo/settings/team/actions.ts` for invites) | `resend`, `nodemailer`, `./impact-metrics` | ~20 independent `send*Email` functions; each breaks only its own caller, but collectively this is all transactional email. |
| `lib/storage.ts` | 8 call sites (NGO register, settings, proof submit, project create/edit, donations webhook, `ngo/settings/profile/actions.ts`) | `@aws-sdk/client-s3`, `fs/promises` | Every file upload path (documents, avatars, proofs, receipts, cover images). |
| `lib/whatsapp/worker.ts` | `app/api/whatsapp/route.ts`, `app/api/drafts/[id]/retry/route.ts` | own `PrismaClient`, `@google/generative-ai`, `cloudinary` | Entire WhatsApp proof-enrichment pipeline (`processProofInBackground`). |
| `lib/gemini/validate-proof.ts` | `app/api/ngo/submit-proof/route.ts` (only caller) | `@google/genai` | All AI milestone-proof scoring platform-wide. |
| `lib/gemini/screen-ngo.ts` | `lib/screening-runner.ts` (reachable only via `app/api/ngo/register/route.ts`'s dynamic require) | `@google/genai` | NGO pre-screening at registration. |

---

## 3. Execution Paths

### User Login
```
app/login/page.tsx (form)
  → signIn("credentials"|"google", ...)  [next-auth/react]
  → app/api/auth/[...nextauth]/route.ts  (NextAuth(authOptions) wrapper)
  → lib/auth.ts
      Credentials: authorize() → prisma.user.findUnique + bcrypt.compare
      Google:      signIn() callback → auto-create DONOR or link googleId
      Both:        role overridden to "NGO" if user.teamMemberships.length > 0 (lines ~49, ~104)
  → jwt() callback → token.role/ngoProfileId/donorPersona set
  → session() callback → session.user populated
  → app/login/page.tsx redirects by role (NGO→/ngo/register, ADMIN→/admin/dashboard, DONOR→/donor/onboarding)
  → middleware.ts re-checks token.role on every subsequent role-gated navigation
```

### NGO Registration
```
app/ngo/register/page.tsx (form, multi-doc upload)
  → POST app/api/ngo/register/route.ts
      verifySessionRole("NGO")
      validate fields + PDFs → uploadFile() per document (lib/storage.ts)
      verifyPan() (non-blocking) — lib/pan-verification
      prisma.nGOProfile.create/update  { verificationStatus: "PENDING", joinCode: generateJoinCode(orgName) }
      prisma.consentAudit.create
      prisma.nGOCompliance.upsert  (fcraStatus: "PENDING" if FCRA doc supplied)
      fire-and-forget: verifyFcraDocument() (Gemini) → updates NGOCompliance
      fire-and-forget: verifyNGODocuments() (Gemini) → ai_verification_report; HIGH flags → createFraudAlert()
      fire-and-forget: runAndStoreNgoScreening() (lib/screening-runner.ts) → NgoScreening row only
  → app/ngo/dashboard/page.tsx reads verificationStatus === "PENDING" → shows review-pending screen
```

### Project Creation
```
app/ngo/projects/new/page.tsx
  → POST app/api/ngo/projects/route.ts
      verifySessionRole("NGO") + profile.verificationStatus === "VERIFIED" (else 403)
      validate title/description/target/location/coverImage(≤2MB)/milestones
      assert sum(milestone.targetAmount) === project.targetAmount  (±0.01)
      uploadFile(coverImage)
      prisma.$transaction: Project.create (status: "PENDING_APPROVAL" — awaits admin review, no longer auto-published) + Milestone.createMany
  → app/api/admin/review-project/route.ts: admin APPROVE moves it to "ACTIVE" (race-safe conditional updateMany), then:
      sendProjectPublishedEmail(ngoOwnerEmail)
      triggerFollowedNGONewProject(ngoId, projectId)  [lib/notification-triggers.ts]
        prisma.nGOFollower.findMany({ngoId}) → for each follower:
          sendPushNotification() → Notification row + FCM push
          sendNewProjectAlertEmail()
    REJECT returns it to "DRAFT" with reviewNote + sendProjectRejectedEmail
```

### Donation
```
app/components/DonateModal.tsx
  → POST app/api/donations/create-order/route.ts
      verifySessionRole("DONOR"); amount >= 100; project.status === "ACTIVE"; NGO not suspended
      checkFcraGate(donor, ngoCompliance)  [lib/fcra-gate.ts] — blocks non-domestic donors if FCRA not ACTIVE
      razorpay.orders.create({amount*100, currency, receipt})
      prisma.donation.create({status:"PENDING", razorpayOrderId})
  → donor completes checkout in Razorpay's hosted UI
  → app/donor/donations/[donationId]/pending/page.tsx polls GET /api/donations/[donationId]/status every 3s
```

### Payment Success
```
Razorpay → POST app/api/donations/webhook/route.ts  (event: "payment.captured")
  verify HMAC-SHA256(raw body, RAZORPAY_WEBHOOK_SECRET) === x-razorpay-signature  [non-constant-time compare — see §12]
  idempotency: no-op if donation.status already "SUCCESS"
  prisma.$transaction:
    Donation.update{status:"SUCCESS", razorpayPaymentId}
    Project.update{raisedAmount: increment}
    User.update{totalDonated: increment}
  generateTaxReceiptPDF() → uploadFile() → prisma.taxReceipt.create + Donation.update{receiptUrl}
  sendTaxReceiptEmail()
  setTimeout(48h): if an ImpactReport exists for this donation → POST /api/engagement/re-engage  [in-memory, non-durable — see §12]
  always returns HTTP 200 (so Razorpay stops retrying, even on internal error)
```
Failure path (`payment.failed`): increments `Donation.retryCount`; while retries remain, stays `PENDING`; once exhausted → `status:"FAILED"` + `generateRetryToken()` (24h expiry) + `sendPaymentRetryEmail()` linking `/donor/retry/[token]`.

### Milestone Submission
```
app/ngo/dashboard/SubmitProofModal.tsx
  → POST app/api/ngo/submit-proof/route.ts
      verifySessionRole("NGO"); verificationStatus==="VERIFIED"; !isSuspended; milestone ownership; not already COMPLETED/VERIFIED
      uploadFile() × up to 5 files (≤20MB total)
      validateMilestoneProof()  [lib/gemini/validate-proof.ts] → {score, reasoning, flags, tocAlignmentScore, ...}
      prisma.milestoneProof.create
      checkGeminiScore(milestoneId, score)  [lib/risk-agent.ts]
        score < 40 → createFraudAlert(HIGH); 2 consecutive <40 → auto-open CRITICAL RiskReview (no auto-suspend)
      finalStatus = score >= 70 ? "COMPLETED" : "PROOF_SUBMITTED"
      prisma.milestone.update{status: finalStatus}
      recalculateNGOHealthScore(ngoId)  [lib/ngo-health.ts]
      if COMPLETED: triggerMilestoneCompleted(milestoneId)  [lib/notification-triggers.ts]
        → per donor of this project: generate impact narrative (ImpactReport) + sendPushNotification()
      if PROOF_SUBMITTED (score 40-69): NO donor notification fires at all
```

### Admin Verification
```
app/admin/dashboard/AdminClient.tsx
  → POST app/api/admin/verify-ngo/route.ts
      verifySessionRole("ADMIN"); REJECT requires adminNote; APPROVE requires override note if AI said LIKELY_FRAUD
      REJECT: composeRejectionGuidance()  [lib/gemini/explain-rejection.ts, Gemini — falls back to raw note on failure]
      prisma.nGOProfile.update{verificationStatus: "VERIFIED"|"REJECTED", adminNote}
      APPROVE only: prisma.nGOCompliance.upsert{pan/registration/80G(+12A if present): verified}
                    logComplianceEvent() → ComplianceAuditLog rows
      sendNGOApprovalEmail() / sendNGORejectionEmail()
  → NGO sees updated status in app/ngo/dashboard/page.tsx (VERIFIED → can create projects; REJECTED → resubmit form)
```
FCRA is a **separate** queue: `app/api/admin/review-fcra/route.ts` (never touched by `verify-ngo`).

### Tax Receipt Generation
```
app/api/donations/webhook/route.ts  ("payment.captured" branch)
  → generateReceiptNumber()  [lib/finance-utils.ts]
  → generateTaxReceiptPDF(receiptData)  [lib/receipt-generator.tsx, @react-pdf/renderer] → Buffer
  → uploadFile(buffer, "receipt-<n>.pdf", "receipts")  [lib/storage.ts]
  → prisma.taxReceipt.create + prisma.donation.update{receiptUrl}
  → sendTaxReceiptEmail()  [lib/email.ts]
  → donor views later: app/donor/donations/page.tsx, app/donor/portfolio/PortfolioClient.tsx
```

### WhatsApp Proof Submission
```
Field worker sends WhatsApp message/photo
  → POST app/api/whatsapp/route.ts  (Twilio webhook, signature-validated except in dev)
      normalize senderPhone → prisma.fieldWorker.findUnique({phone})
      not found: match message body against NGOProfile.joinCode → create FieldWorker (self-registration)
      fingerprint = sha256(phone|body|lat|lng) → prisma.draftProof.create{status:"PENDING_REVIEW", workerStatus:"PENDING"}
        duplicate fingerprint (Twilio retry) → Prisma P2002 → silently ack via TwiML, no new row
      fire-and-forget: processProofInBackground(draftId, ngoId)  [lib/whatsapp/worker.ts]
  → worker: workerStatus:"ENRICHING" → Gemini call (predict project/milestone, risk level) → workerStatus:"ENRICHED"|"ENRICHMENT_FAILED"
    each mediaUrl uploaded to Cloudinary → DraftProof.persistentPhotoUrls
  → NGO reviews in dashboard → PATCH app/api/drafts/[id]/route.ts
      approve/reject → FieldWorker.approvedCount/rejectedCount updated → reliabilityScore recomputed after ≥3 actions
      approved + predictedMilestoneId set → Milestone auto-transitions to "PROOF_SUBMITTED"
      WhatsApp reply sent back to field worker via twilioClient.messages.create
```
Note: `app/api/ngo/whatsapp-drafts/convert/route.ts` is **dead code** referencing a non-existent `whatsAppDraft` model — not part of the live flow (see §12).

### Notification Creation
```
Any trigger event (new project, milestone completed, donation confirmed, ...)
  → lib/notification-triggers.ts  (5 functions)
      → sendPushNotification(userId, title, body, data?)  [lib/notification.ts]
          prisma.notification.create({type, title, body, read:false})   ← always written
          attempt FCM send via user.fcmToken → falls back to console "MOCK PUSH" log if unconfigured/invalid
  → surfaced via GET app/api/user/notifications/route.ts (session-scoped) → Notifications bell (navbar) and
    app/donor/impact/page.tsx (donor Impact Feed, shown alongside the ImpactReport timeline). Live-verified:
    read/unread state and `RECEIPT_PENDING_PAN`/`NGO_SUSPENDED`/`NGO_REINSTATED`/etc. notification types all
    render correctly end-to-end. (This closes what was previously a dead end — see §12 history.)
```

---

## 4. Frontend Architecture

- **Data origin:** almost always a **Server Component `page.tsx`** doing `getServerSession` + direct `prisma.*` calls, serializing the result (Decimal→Number, Date→ISO where needed) as props into a co-located `"use client"` component. Exceptions that fetch client-side instead: `app/discover/page.tsx` (fully client, own `useState`/`useEffect` + `fetch`), `app/donor/dashboard/page.tsx` (server component but currently **hardcoded**, no real Prisma call — see §12).
- **Server Components:** every `page.tsx` under `app/donor/`, `app/ngo/`, `app/admin/` except `discover/page.tsx`.
- **Client Components:** every `*Client.tsx` (`DashboardClient`, `AdminClient`, `PortfolioClient`, `DonorProfileClient`, `NGOProfileClient`, `ProjectClient`, `FCRAReviewClient`, `FraudAlertsClient`, `ProofReviewClient`, `RiskComplianceClient`, `TeamSettingsClient`, `EditProjectClient`), plus small islands (`DonateModal`, `AIGenerateField`, `DatePicker`, `ShareProjectModal`, `QuickDonateSelector`, `DismissButton`, `ReadMoreNarrative`, `ProfileActions`, `DonorSidebarShell`).
- **Where `fetch()` happens:** exclusively inside client components, always against relative `/api/...` paths — no shared API-client wrapper, no React Query/SWR.
- **Where `router.refresh()` happens:** after mutations that need the Server Component's data re-pulled, e.g. `DismissButton.tsx:26`, `DonorProfileClient.tsx:115` — this is the *only* cache-invalidation mechanism in the app (no client cache to invalidate otherwise).
- **Where forms submit:** two patterns coexist —
  1. Client `fetch(..., {method:"POST"})` from a `*Client.tsx` (majority pattern: donate, submit-proof, admin actions).
  2. **Next.js Server Actions** (`"use server"` files) for team/profile settings: `app/ngo/settings/team/actions.ts`, `app/ngo/settings/profile/actions.ts` — the only place server actions are used instead of an API route + fetch.
- **Most reused components:** `Navbar.tsx` (global, in root layout), `DonorSidebarShell.tsx` (wraps every donor page), `ProjectCoverImage.tsx` (project cards + detail), `AIGenerateField.tsx` (reused across NGO copy-generation forms).
- **State management:** confirmed zero Redux/Zustand/React Query/SWR — see §6 of the earlier architecture pass; local `useState` + server refetch is the pattern everywhere.

---

## 5. Backend Architecture (grouped by feature)

For every group: validation → auth → business logic → DB writes → external services → response shape.

**Auth** (`api/auth/signup`, `[...nextauth]`)
- Validation: manual field presence checks (signup); NextAuth handles its own.
- Auth: none required (signup is the entry point); NextAuth session middleware for the catch-all.
- Logic: bcrypt hash on signup; auto-accept pending `TeamInvite` by email match (see §13).
- DB: `User.create`, `NGOTeamMember.create`, `TeamInvite.update`.
- External: none.
- Response: `{success, userId}` / NextAuth's own JSON.

**Donations** (`api/donations/*`)
- Validation: amount floor, project ACTIVE, NGO not suspended.
- Auth: `verifySessionRole("DONOR")` (create-order, status); webhook uses HMAC signature instead of session.
- Logic: `checkFcraGate`, Razorpay order creation, webhook idempotency + `$transaction` ledger update, retry-token issuance.
- DB: `Donation`, `Project.raisedAmount`, `User.totalDonated`, `TaxReceipt`.
- External: Razorpay (order + webhook), `@react-pdf/renderer` (receipt), `resend`/`nodemailer` (email).
- Response: `{orderId, amount, currency, donationId}` (create-order); webhook always `200`.

**NGO** (`api/ngo/*`)
- Validation: heavy manual `if` checks (required fields, file size/type, milestone-sum match).
- Auth: `verifySessionRole("NGO")` + `verificationStatus === "VERIFIED"` gate on project/proof routes.
- Logic: document upload, Gemini screening/verification (register), milestone validation, geo/ToC enrichment.
- DB: `NGOProfile`, `NGOCompliance`, `Project`, `Milestone`, `MilestoneProof`, `ConsentAudit`, `FraudAlert`.
- External: Gemini (screening, ToC check, geo), Data.gov.in/AgroMonitoring (geo-enrich), storage (S3/local).
- Response: `{success, projectId}` style; discover route returns paginated `{ngos, pagination}`.

**Admin** (`api/admin/*`)
- Validation: required admin notes on reject/override actions.
- Auth: `verifySessionRole("ADMIN")` on every route.
- Logic: verification decisioning, Gemini rejection-guidance composition, compliance upserts, fraud/risk resolution.
- DB: `NGOProfile`, `NGOCompliance`, `ComplianceAuditLog`, `MilestoneReview`, `FraudAlert`, `RiskReview`.
- External: Gemini (`explain-rejection.ts`), email.
- Response: `{success}` + updated entity, or error JSON.

**AI** (`api/ai/*`)
- Validation: light (required prompt inputs).
- Auth: `verifySessionRole("NGO")` typically.
- Logic: direct Gemini prompt/response, no DB persistence for most (copy generation is ephemeral, returned straight to the form).
- DB: none written (exception: `ngo-insight` may read but not persist).
- External: Gemini only.
- Response: generated text/JSON.

**WhatsApp/Drafts** (`api/whatsapp`, `api/drafts/*`, `api/media-proxy`)
- Validation: Twilio signature (prod only), fingerprint uniqueness.
- Auth: Twilio signature for the webhook; session-based for drafts review; media-proxy requires session + only proxies `api.twilio.com` URLs.
- Logic: field-worker identification/registration, fire-and-forget AI enrichment, review/approve/reject with reliability scoring.
- DB: `FieldWorker`, `DraftProof`, `Milestone` (auto-transition on approve).
- External: Twilio (messages + media fetch), Gemini (legacy SDK), Cloudinary.
- Response: TwiML XML (webhook) / JSON (drafts CRUD).

**Cron** (`api/cron/*`)
- Validation/Auth: shared-secret header (`x-cron-secret` or `Authorization: Bearer`) against `CRON_SECRET`.
- Logic: FCRA expiry sweep, FCRA quarterly report, generic reminders.
- DB: `NGOCompliance` transitions, `ComplianceAuditLog`, `FcraQuarterlyReport`.
- External: email (NGO + admin digests).

**Engagement / Consent** (`api/engagement/*`, `api/consent/record`)
- Auth: session (donor self) or `x-internal-secret` (server-to-server from the webhook's delayed trigger).
- Logic: `computeDonorTier`, `selectReEngagementPath` (priority-ordered rules), consent logging (soft-fails, never blocks signup).
- DB: `ReEngagementEvent`, `User.donorTier/reEngagementPath`, `ConsentLog`.

**Pitch** (`api/pitch/*`) — see §13 for full depth.

---

## 6. Database Cheat Sheet

*Per model: purpose, key relations, which APIs write it, which pages/APIs read it. (Full read/write file lists are in §2's Part 2 output — condensed here to the essentials.)*

| Model | Purpose | Key relations | Written by | Read by (pages/UI) |
|---|---|---|---|---|
| `User` | Every account; role + donor persona/category/tier fields live here | 1:1 `NGOProfile`, 1:N `Donation`, `NGOTeamMember`, `ConsentLog`, `ReEngagementEvent` | signup, auth.ts, donor profile/persona APIs, webhook (totalDonated) | donor profile/portfolio pages, admin dashboard, CSR certificate |
| `NGOProfile` | The NGO org record + verification/health state | 1:N `Project`, `FieldWorker`, `NGOTeamMember`; 1:1 `NGOCompliance` | register, verify-ngo, risk/review, settings | discover, NGO public profile, admin dashboard, pitch deck, CRM |
| `NGOTeamMember` | Per-NGO staff role (OWNER/ADMIN/FINANCE/FIELD_STAFF) | belongs to `User` + `NGOProfile` | signup (auto-accept), team/actions.ts | team settings page, `lib/auth.ts` (effective-role lookup) |
| `NGOCompliance` | PAN/registration/12A/80G/FCRA verification state (1:1 per NGO) | belongs to `NGOProfile`; 1:N `ComplianceAuditLog` | register, verify-ngo, review-fcra, fcra-reminders | fcra-review page, create-order (FCRA gate), fcra-status API |
| `ComplianceAuditLog` | Immutable timeline of compliance events | belongs to `NGOCompliance` | `ngo-compliance.ts` `logComplianceEvent` | *(no read call site found — write-only today)* |
| `Project` | A funding campaign, milestone-sequenced | belongs to `NGOProfile`; 1:N `Milestone`, `Donation` | webhook (raisedAmount), geo-enrich, toc-check | discover, project detail, portfolio, CSR cert, pitch deck |
| `Milestone` | Sequential funding unlock unit | belongs to `Project`; 1:N `MilestoneProof`, `MilestoneReview` | review-proof, submit-proof, drafts (whatsapp auto-transition) | admin dashboard, proof-review, drafts, submit-proof |
| `MilestoneProof` | NGO-submitted evidence + AI score/ToC fields | belongs to `Milestone`, submitted by `User` | submit-proof, whatsapp-drafts/convert (dead) | risk-agent, ngo-compliance (`hasVerifiedImpactProof`) |
| `MilestoneReview` | Admin decision on a proof | belongs to `Milestone`, reviewed by `User` (admin) | review-proof | proof-review page |
| `Donation` | A single payment | belongs to `User` (donor) + `Project`; 1:1 `TaxReceipt`; 1:N `ImpactReport` | create-order, retry, webhook | donor donations/portfolio, project page, CRM, CSR cert, admin dashboard |
| `ImpactReport` | AI-generated narrative sent to a donor after milestone completion | belongs to `Donation`, `Milestone`, `User` | notification-triggers (milestone completed) | re-engage API, webhook (checks existence for delayed trigger) |
| `NGOFollower` | Donor "follow" relationship | composite key (donorId, ngoId) | `[id]/follow` route | NGO public profile, notification-triggers, user-follows API |
| `Notification` | In-app notification record | belongs to `User` | `lib/notification.ts` only | Notifications bell + `app/donor/impact/page.tsx` (Impact Feed), via `GET /api/user/notifications` |
| `TaxReceipt` | 80G receipt metadata + PDF URL | 1:1 `Donation` | webhook | donor donations/portfolio pages |
| `RateLimitLog` | Generic per-identifier request counter | none | `lib/rate-limiter.ts` | only used by `verify-phase1` route — **not wired into donation/auth/AI routes** |
| `NgoScreening` | AI pre-screening summary at registration | belongs conceptually to `NGOProfile` (ngoId) | `screening-runner.ts` (upsert only) | admin dashboard (pending NGO list includes `screening` relation) |
| `FraudAlert` | Flagged suspicious activity | free-text `entityId/Type` (not a real FK) | fraud-alerts.ts, risk-agent.ts, ngo/register | admin fraud-alerts page, dashboard badge counts |
| `RiskReview` | Escalated NGO risk case | belongs to `NGOProfile` | risk/flag, risk/review, risk-agent (auto-open) | risk-compliance page |
| `FcraQuarterlyReport` | Quarterly compliance snapshot | none (standalone, keyed by quarter) | `fcra-quarterly.ts` cron | fcra-review page, export route |
| `ConsentLog` | Signup/data-sharing consent record | belongs to `User` | consent/record | *(no read call site — audit-only)* |
| `ReEngagementEvent` | Tracks a sent re-engagement nudge | belongs to `User` (donor) | engagement/re-engage | dismiss route (reads own row) |
| `ConsentAudit` | NGO-side consent record (distinct from `ConsentLog`) | free-text `ngoId` | ngo/register | *(no read call site found)* |
| `FieldWorker` | WhatsApp-registered NGO staffer | belongs to `NGOProfile`; 1:N `DraftProof` | whatsapp webhook, worker.ts | whatsapp webhook lookups, `check-worker.ts` script |
| `DraftProof` | Raw WhatsApp submission pre-conversion | belongs to `NGOProfile`, `FieldWorker` | worker.ts, whatsapp webhook, drafts routes | drafts list/detail pages |
| `PitchLead` | Marketing lead captured before pitch-deck download | keyed by unique email | pitch/lead route | pitch/meta route (count only) |
| `TeamInvite` | Pending team invitation | belongs to `NGOProfile` | team/actions.ts, signup (accept) | signup route (lookup only) |

---

## 7. AI Layer (Gemini)

| Feature | File | Model | Notes |
|---|---|---|---|
| NGO document screening | `lib/gemini/screen-ngo.ts` `screenNgo()` | `gemini-2.5-flash-lite` | Deterministic regex checks (PAN/reg-no/IFSC) run first and are injected as "ground truth"; `enforceHonestLimit()` hard-downgrades a `LOOKS_CLEAR` verdict if format checks failed. |
| NGO doc verification | `lib/gemini/verify-ngo-docs.ts` | `gemini-2.5-flash-lite` | Also runs a Prisma duplicate-registration check and **force-overrides** the LLM's recommendation to `LIKELY_FRAUD` on a DB match. |
| FCRA cert extraction | `lib/gemini/verify-fcra-doc.ts` | `gemini-2.5-flash-lite` | Cross-checks extracted `fcra_number`/`org_name` vs form values. |
| Milestone proof validation + ToC scoring | `lib/gemini/validate-proof.ts` `validateMilestoneProof()` | `gemini-2.5-flash` | Prompt includes milestone + project `problem_statement`/`expected_outcome` + free-text NGO description + inline base64 media. Schema-constrained JSON (`Type.OBJECT`, not zod) requiring `score, reasoning, flags, tocAlignmentScore, tocReasoning, tocStrengths, tocGaps`. `score>=70` drives `Milestone.status` to `COMPLETED`. |
| Rejection-guidance rewriting | `lib/gemini/explain-rejection.ts` | `gemini-2.5-flash-lite` | Always swallows errors, returns the original admin note unchanged on failure. |
| Impact narrative generation | `lib/gemini/generate-narrative.ts` | `gemini-2.5-flash` | Produces donor-facing narrative + SDG/IRIS tags → `ImpactReport`. |
| Campaign copy / milestone suggestion / ToC check / NGO insight | `app/api/ai/generate-campaign-copy`, `suggest-milestones`, `ngo/projects/[id]/toc-check`, `ai/ngo-insight` | `gemini-2.5-flash` | Ephemeral — no DB persistence, returned straight to the calling form. |
| WhatsApp proof enrichment | `lib/whatsapp/worker.ts` | `gemini-2.5-pro` (**legacy `@google/generative-ai` SDK**) | Predicts `predictedProjectId/MilestoneId`, `predictionConfidence`, `aiSummary`, `riskLevel/Reason`. 25s timeout, 2 retries. |
| Pitch deck description rewrite | `app/api/pitch/generate/route.ts` `rewriteDescription()` | `gemini-2.5-flash` (**legacy SDK**) | Optional; silently skipped if it fails. |

**SDK split (important):** `@google/genai` is the current/primary SDK (16+ files, reads `GEMINI_API_KEY`). `@google/generative-ai` is legacy, used only in `lib/whatsapp/worker.ts` and `app/api/pitch/generate/route.ts`, and `worker.ts` reads a **different, undocumented env var** — `GOOGLE_GENERATIVE_AI_API_KEY` (not in `.env.example`). `@ai-sdk/google`/`ai` are dependencies with **zero imports found** — dead weight.

**Safeguards:** "AI proposes, code disposes" pattern repeated independently in three places — `enforceHonestLimit()` (screen-ngo), the duplicate-registration override (verify-ngo-docs), and `checkGeminiScore` two-strikes escalation (risk-agent) — each capable of overriding or escalating past the LLM's raw verdict. No key set → every `lib/gemini/*` function returns a labeled mock result rather than failing (except `worker.ts`/pitch, which throw/skip). Untrusted NGO text and document images are interpolated into prompts with no sanitization beyond response-schema constraints.

---

## 8. Payments (Razorpay, full trace)

1. **Order creation** — `app/api/donations/create-order/route.ts`: session+role check → project ACTIVE + NGO not suspended → `checkFcraGate()` → `razorpay.orders.create({amount: amount*100, currency:"INR", receipt: "rcpt_"+Date.now()})` → `prisma.donation.create({status:"PENDING", razorpayOrderId})`. Returns `{orderId, amount, currency, donationId}`.
   - ⚠️ `DonateModal.tsx` sends `panNumber`/`billingAddress` and expects `keyId`/`razorpayOrderId`/`donorName`/`donorEmail` back — the route accepts/returns none of these. This path is currently broken for the PAN/billing-details step (§12, item 1).
2. **Webhook** — `app/api/donations/webhook/route.ts`: raw body HMAC-SHA256 vs `x-razorpay-signature` (⚠️ plain `!==`, not `crypto.timingSafeEqual`). `payment.captured`: idempotent no-op if already `SUCCESS`; else `$transaction` (Donation→SUCCESS, Project.raisedAmount+=, User.totalDonated+=) → PDF receipt → email → `setTimeout` 48h re-engagement trigger (non-durable). `payment.failed`: increments `retryCount`; `getRetryDelay()` (`lib/retry-utils.ts`) returns 30s/120s/-1; exhausted → `FAILED` + `generateRetryToken()` (24h) + retry email. Always returns `200`.
3. **Retry** — `GET /api/donations/retry/[token]/route.ts`: single-use token lookup (`retryTokenExpiresAt > now`) → brand-new Razorpay order + new `Donation` row → invalidates original token.
4. **Status polling** — `GET /api/donations/[donationId]/status`: donor-or-admin only; `app/donor/donations/[donationId]/pending/page.tsx` polls every 3s, up to 10 attempts.
5. **Receipts** — `lib/receipt-generator.tsx` (80G, `@react-pdf/renderer`) embeds donor PAN/address, NGO PAN/reg/80G number, hardcoded validity window; `app/api/donations/csr-certificate/route.tsx` (corporate-only, requires `User.isCorporate`) aggregates a FY's donations + milestone completion for a utilization certificate.
6. **Rate limiting** — `lib/rate-limiter.ts` exists (DB-backed via `RateLimitLog`) but is **only called from `verify-phase1`** — no donation route is actually rate-limited.

---

## 9. Compliance (FCRA / scores)

**FCRA gate** (`lib/fcra-gate.ts`): `donorRequiresFcra()` — `INDIAN_IN_INDIA` never needs it; `FOREIGN_NATIONAL` always does; `INDIAN_ABROAD` (NRI) is exempt only if `nriSourceDeclaration === "ELIGIBLE_NRI_SOURCE"`. `checkFcraGate()` recomputes a **live** status via `deriveFcraStatus(ngo.fcraExpiryDate)` (pure date function in `lib/ngo-compliance.ts`: expired→`EXPIRED`, ≤90 days→`EXPIRING_SOON`, else `ACTIVE`) whenever the stored status is `ACTIVE/EXPIRING_SOON/EXPIRED`, so a cron lag never lets a stale DB status wrongly pass a foreign donation. Only a live `ACTIVE` passes.

**Compliance score** (`lib/ngo-compliance.ts` `computeCompliance()`): static, weighted, **derived on every read, never persisted** (explicit code comment) — `PAN 25 / Registration 25 / 12A 10 / 80G 20 / impact 20`. **FCRA is deliberately excluded** so domestic-only NGOs aren't penalized; shown as a separate badge instead.

**Health score** (`lib/ngo-health.ts` `recalculateNGOHealthScore()`): operational trust score, **persisted** on `NGOProfile.healthScore`, recomputed inside a `$transaction` after every proof submission/review. Blends fund-utilization (30%), milestone-completion rate (30%), proof-submission speed (20%), donor-return rate (20%); redistributes weight proportionally when a metric is inapplicable; new NGOs (< 1 completed milestone or < 3 unique donors) get `null` ("Pending"), never a misleadingly low score.

**Fraud/risk score:** there is no single numeric "fraud score" — it's alert-driven. `lib/fraud-alerts.ts` `createFraudAlert()` is the single writer for `FraudAlert` rows (severity LOW/MEDIUM/HIGH, category DOCUMENT_ERROR/FRAUD_ALERT). `lib/risk-agent.ts` adds AI/behavioral triggers on top: `checkGeminiScore()` (score<40 → alert; 2 consecutive <40 → auto-`RiskReview` at `riskLevel:"CRITICAL"`, no auto-suspend — admin must act) and `checkDonationRate()` (>5 donations/<10min → possible card-testing, though this export currently has **no live caller** — dead wiring, see §2/§12). Admin resolves via `admin/risk/review` (SUSPEND sets `NGOProfile.isSuspended`, CLEAR unsuspends, ESCALATE just notes) and `admin/resolve-alert` (per-alert closure).

**Where each is calculated:** compliance score — on every read in `computeCompliance()`; health score — on proof submit/review, persisted; FCRA status — on every donation attempt (live) plus daily cron sweep (`cron/fcra-expiry`) and quarterly report (`cron/fcra-quarterly-report`); fraud/risk — event-driven at registration, proof submission, and donation velocity checks.

---

## 10. Modification Guide

| If you need to... | Files to touch |
|---|---|
| **Add an API route** | New `app/api/<path>/route.ts`; guard with `verifySessionRole()` (`lib/auth-guards.ts`) or manual `getServerSession(authOptions)`; import `prisma` from `@/lib/prisma` (never `new PrismaClient()` — you lose the retry wrapper). |
| **Add a page** | New `app/<role>/<name>/page.tsx` (server: session check + Prisma fetch) + co-located `<Name>Client.tsx` (client: interactivity). If donor-scoped, it auto-inherits the sidebar via `app/donor/layout.tsx`; NGO/admin pages don't have an equivalent shared layout shell today. |
| **Add a database field** | Edit `prisma/schema.prisma` → `npm run db:migrate` (`prisma migrate dev`) to generate a migration in `prisma/migrations/` and apply it. **This repo now uses Prisma Migrate — do not use `prisma db push`**, which applies schema without recording history and reintroduces drift. The database was baselined on 2026-07-25 (all three migrations marked applied), and `predev`/`build` run `prisma migrate deploy`. A new model needs **both** the schema edit and a committed migration, or its table will never exist in another environment. Then update every route/page that does an explicit `select`/serialization for that model (Decimal/Date fields need manual `Number()`/`.toISOString()` at each call site — no shared serializer). |
| **Modify the payment flow** | `app/api/donations/create-order/route.ts` (order creation + FCRA gate), `webhook/route.ts` (the ledger + receipt + retry logic), `lib/retry-utils.ts`, `lib/receipt-generator.tsx`. Also check `app/components/DonateModal.tsx` for the frontend contract — the response shape now matches (`keyId`/`razorpayOrderId`/`donorName`/`donorEmail`, live-verified via a full mock-checkout donation), but the *request* side still has a gap: the modal sends `panNumber`/`billingAddress` that `create-order` accepts and silently ignores (see §12). |
| **Modify NGO verification** | `app/api/admin/verify-ngo/route.ts` (org-level KYC) is separate from `app/api/admin/review-fcra/route.ts` (FCRA-specific) — decide which queue you're changing. Compliance-score weighting lives in `lib/ngo-compliance.ts`'s `COMPLIANCE_WEIGHTS`. |
| **Add an AI feature** | New file in `lib/gemini/`, using `@google/genai` (the current SDK — don't add a third SDK usage) and `GEMINI_API_KEY`. Follow the existing pattern: mock-result fallback when the key is unset, schema-constrained JSON output, and a deterministic code-side guard if the output gates a workflow transition (see `enforceHonestLimit`/`checkGeminiScore` for precedent). |
| **Add a notification** | Add a new trigger function in `lib/notification-triggers.ts` calling `sendPushNotification()` (`lib/notification.ts`). Remember: nothing in the frontend currently reads `Notification` rows — if you need the user to actually see it, you'll need to build the missing read-side UI too (see §12). |
| **Add a dashboard widget** | NGO: extend `DashboardClient.tsx` (already 1157 lines — consider extracting a new file rather than growing it further) fed by new fields in `app/ngo/dashboard/page.tsx`'s Prisma query. Admin: extend `AdminClient.tsx` (769 lines) or add a Prisma aggregate to the `Promise.all` in `app/admin/dashboard/page.tsx`. Donor: `app/donor/dashboard/page.tsx` is currently a **stub** (hardcoded values) — implementing real data here is a good, contained first task (see §12, item 6). |

---

## 11. Hidden Conventions

- **`page.tsx` + `<Name>Client.tsx` pairing** is applied with zero exceptions across `donor/`, `ngo/`, `admin/` — the server file does session+role+Prisma, the client file does everything interactive.
- **Guard-then-query ordering**: every API route checks auth/role *before* touching Prisma, even when middleware.ts already covers the route — defense in depth is intentional, not redundant oversight.
- **`prisma.<modelName>` casing always mirrors the schema's declared model name with only the first letter lowercased** — this produces awkward accessors like `prisma.nGOProfile`, `prisma.nGOCompliance`, `prisma.nGOFollower`, `prisma.nGOTeamMember` (capital "GO" preserved) vs `prisma.ngoScreening` (schema model is literally spelled `NgoScreening`, lowercase "go") — these are two different casing outcomes for visually similar names; get it wrong and TypeScript will simply not find the property.
- **Decimal fields are always converted via `Number(...)` at the call site**, never through a shared serializer — every new route touching `targetAmount`/`raisedAmount`/`totalDonated`/`amount`/`healthScore` needs its own explicit conversion before arithmetic or JSON serialization.
- **Fire-and-forget side effects are deliberately not awaited** for anything non-essential to the primary transaction (email sends, notification triggers, screening runs, WhatsApp enrichment) — wrapped in `try/catch` that logs but never fails the parent request. This is a consistent resilience pattern, not sloppiness — but it also means these side effects have no retry/DLQ if they fail silently.
- **Two independent "shouldn't be visible" mechanisms** coexist: soft-delete flags (`Project.isDeleted`, `NGOProfile.isDeleted`) and hard suspension (`NGOProfile.isSuspended`) — always filter by both where relevant, they are not interchangeable.
- **Scores are computed live wherever staleness matters** (compliance score, FCRA status) and **persisted wherever the source computation is expensive/event-driven** (health score) — when adding a new score, decide deliberately which category it belongs to rather than defaulting to "just store it."
- **Server Actions (`"use server"`) are used only in `app/ngo/settings/{team,profile}/actions.ts`** — everywhere else, mutations go through an API route + client `fetch()`. If you're adding to NGO settings, follow the Server Action pattern already there rather than introducing a new API route for consistency's sake.
- **Dynamic `require()` instead of static `import`** shows up in several routes to call `lib/notification-triggers.ts`, `lib/fraud-alerts.ts`, and `lib/screening-runner.ts` from inside a `try/catch` — likely intentional to keep a failing/optional side-effect module from crashing the whole route file at import time.

---

## 12. Common Mistakes

1. **Assuming `DonateModal.tsx` and `create-order/route.ts` fully agree on the request/response shape.** The response side is fixed (the route now returns `keyId`/`razorpayOrderId`/`donorName`/`donorEmail`, live-verified via a real mock-checkout donation completing end-to-end). The request side still has a gap: the modal sends `panNumber`/`billingAddress` which the route accepts into its body but never reads — those donor-declared fields are silently dropped, not persisted anywhere. Don't assume filling in the PAN/billing step actually does anything server-side yet.
2. **Trusting `lib/rate-limiter.ts` is protecting anything.** It's fully built but only wired into `verify-phase1` — donation, auth, and AI-cost-incurring routes have no rate limiting today, despite the infrastructure existing.
3. **Bypassing `lib/prisma.ts`.** Several files (`lib/whatsapp/worker.ts`, all `app/api/drafts/*`, `app/api/whatsapp/route.ts`, `app/api/pitch/lead/route.ts`) instantiate their own `new PrismaClient()` — they silently lose the Neon cold-start retry wrapper. Always import the shared singleton unless you have a specific reason not to (and if you find one, document it).
4. ~~Expecting `Notification` rows to be visible anywhere in the UI~~ — fixed. `GET /api/user/notifications` now exists and is read by the navbar bell and the donor Impact Feed; live-verified end-to-end (milestone-completed push, receipt-pending-PAN nudge).
5. **Assuming `app/donor/dashboard/page.tsx` reflects real data.** It's currently hardcoded (₹0, 0 donations, "Standard" tier) with a `TODO B5` marker — don't build on top of it assuming it queries Prisma; it doesn't yet.
6. **Calling `app/api/ngo/whatsapp-drafts/convert/route.ts`.** It references a `prisma.whatsAppDraft` model that doesn't exist in the current schema — dead code from before the `DraftProof`/`FieldWorker` refactor. The live conversion path is `PATCH /api/drafts/[id]`.
7. **Mixing up the two Gemini env vars.** Most of the app reads `GEMINI_API_KEY` (`@google/genai`). `lib/whatsapp/worker.ts` reads `GOOGLE_GENERATIVE_AI_API_KEY` (`@google/generative-ai`, legacy SDK) — setting only the documented `.env.example` variable leaves WhatsApp AI enrichment silently degraded/mock-mode.
8. **Assuming the webhook signature check is timing-safe.** It's a plain `!==` string comparison, not `crypto.timingSafeEqual` — don't copy this pattern into new signature checks.
9. **Assuming `lib/risk-agent.ts`'s `checkDonationRate` or `lib/fraud-alerts.ts`'s `checkPANUsage` are active.** Both exist and are exported, but grep shows no live caller in `app/` — only stale `.gsd/phases/5/2-SUMMARY.md` prose claims they're wired up. Verify before relying on them firing.
10. **Forgetting the DONOR→effective-NGO role quirk.** A `User` whose stored `Role` is `DONOR` will get `role:"NGO"` at login if they're an `NGOTeamMember` of some NGO (`lib/auth.ts` `authorize`/`jwt` callbacks) — don't gate NGO-only logic on `User.role` in the database directly; always go through the session/JWT-derived role.
11. **Expecting `NGOTeamMember` creation and `TeamInvite.accepted` update to be transactional.** In `app/api/auth/signup/route.ts`'s auto-accept block, they're two separate calls wrapped in one try/catch, not a `$transaction` — a failure between them can leave an accepted-but-membership-less state.
12. ~~Assuming there's no automated test coverage~~ — there is now: `npm test` runs the Vitest suite (`tests/*.test.ts`, Prisma mocked per-test, no DB needed). As of this writing it covers `review-proof`, `verify-ngo`, `review-fcra`, and `risk/review` (133 tests) — most other admin routes and all of `donations/*` are still untested. Add new tests there rather than a new `scripts/test-*.ts` harness.

---

## 13. Deep Dive — Recently Modified Modules

*These are the modules at the tip of `git log` (see header) — treat them as the areas most likely to need further work, and read this section before touching any of them.*

### 13.1 Team Invites (`bc0844b`)

**Why it exists:** lets an NGO owner/admin bring on staff without the invitee needing to already have an account — closes the gap where `NGOTeamMember` existed in the schema but had no invitation UX.

**Execution flow — sending an invite:**
`TeamSettingsClient.tsx:14-32` `handleAdd` submits `{email, role}` to the server action `addTeamMember` (`app/ngo/settings/team/actions.ts:8`). That action:
- Requires the caller be `OWNER`/`ADMIN` on their own `NGOTeamMember` row (lines 15-26).
- `prisma.user.findUnique({where:{email}})` (line 36).
- **No existing user:** `prisma.teamInvite.upsert` keyed on `@@unique([email, ngoId])` (line 49, `where: email_ngoId`) — re-inviting resets the same row rather than duplicating — sets `role`, 7-day `expiresAt`, `accepted:false`; builds `signupUrl = ${NEXTAUTH_URL}/login?invite=${token}&email=...` (line 54); sends via `sendTeamInviteEmail` (`lib/email.ts:482-511`).
- **Existing user:** directly creates `NGOTeamMember` (immediate access, no accept step) and emails a link to `/ngo/dashboard` instead.

**Execution flow — accepting an invite:** `app/api/auth/signup/route.ts:9-11` accepts an optional `inviteToken` in the body. After `User.create` (lines 32-39), lines 41-80: if `inviteToken` is present, look it up directly; **otherwise** (the only path any current UI actually exercises, since nothing threads `inviteToken` from the `?invite=` URL param into the signup form) fall back to `prisma.teamInvite.findFirst({email: newUser.email (trimmed/lowercased), accepted:false, expiresAt:{gt:now}})`. On match: `NGOTeamMember.create` + `TeamInvite.update{accepted:true}`, both in a plain try/catch (not `$transaction`) so failures are logged (`"[signup] Invite auto-accept failed:"`) but never block account creation.

**Important functions:** `addTeamMember` (actions.ts:8), the signup route's invite-matching block (route.ts:41-80), `sendTeamInviteEmail` (email.ts:482-511).

**Related APIs:** `POST /api/auth/signup`, the `addTeamMember`/`removeTeamMember` server actions (no REST route — Server Actions only).

**Related DB tables:** `TeamInvite`, `NGOTeamMember`, `User`.

**Side effects:** the pre-existing DONOR→effective-NGO logic in `lib/auth.ts` (lines 49, 104 — *not added by this commit*) is what makes the new `NGOTeamMember` row immediately useful: the very next login computes `role:"NGO"` from it with no additional wiring.

**Debugging tips:** if an invited teammate signs up but doesn't get NGO access, check in order: (1) exact email match, case/whitespace — the match is `.trim().toLowerCase()`, so any mismatch on the sender's side silently fails; (2) `TeamInvite.expiresAt` still future and `accepted` still false; (3) query `NGOTeamMember` directly — the create/update pair isn't transactional; (4) the user's *existing* browser session won't reflect new access until they log out/in (JWT is only recomputed on login or explicit `update` trigger). Also note: no page currently reads `?invite=`/`?email=` from the URL, so the token-based branch of the signup route is effectively unreachable from the UI today — only the email-fallback branch fires in practice.

### 13.2 WhatsApp Bot + Field Worker Registration (`daceffd`)

*(Base mechanics are in §3's "WhatsApp Proof Submission" trace and §7's AI table — this adds commit-specific depth.)*

**Why it exists:** field workers in the field often don't have reliable access to the web app; WhatsApp is a lower-friction proof-submission channel, self-registered via a per-NGO join code rather than requiring admin-provisioned accounts.

**Execution flow recap with file:line anchors:** `app/api/whatsapp/route.ts` validates `twilio.validateRequest()` (skipped only in dev, lines 20-26), looks up `FieldWorker` by phone (line 55), self-registers on join-code match (lines 63-90, plus a "Case B" safety net for already-created-but-pending workers, lines 93-111), builds a SHA-256 `fingerprint` (lines 116-117), creates `DraftProof`, and fires `processProofInBackground()` **without awaiting** (line 145).

`lib/whatsapp/worker.ts` `processProofInBackground` (line 98): sets `ENRICHING` → Gemini 2.5 Pro call with a 25s timeout + 2 retries (`fetchWithRetryAndTimeout`, lines 50-96) → parses `predictedProjectId/MilestoneId`, `predictionConfidence`, `aiSummary`, `riskLevel/Reason` → `ENRICHED`/`ENRICHMENT_FAILED`. Media: each Twilio `mediaUrl` is uploaded to Cloudinary (lines 179-188, `Promise.allSettled`, non-fatal failures) into `persistentPhotoUrls` — necessary because Twilio's media URLs expire/require auth. `checkFailureRate()` (lines 29-45) logs (not yet alerts) if ≥5 drafts/hour with ≥20% failure for an NGO — the alerting hook is a `TODO`.

**Related APIs:** `POST /api/whatsapp` (Twilio webhook), `PATCH /api/drafts/[id]` (review/approve/reject — reliability scoring, Milestone auto-transition), `POST /api/drafts/[id]/retry` (re-enrich after `ENRICHMENT_FAILED`), `GET /api/media-proxy` (session-gated Twilio media relay).

**Related DB tables:** `FieldWorker` (reliabilityScore/approvedCount/rejectedCount), `DraftProof` (workerStatus, imageHashes **unused — planned dedup never implemented**), `NGOProfile.joinCode`.

**Side effects:** duplicate Twilio webhook deliveries hit the `fingerprint` unique constraint (Prisma `P2002`) and are silently acked via TwiML — this is the *only* idempotency/dedup mechanism; `imageHashes` exists in the schema but nothing reads/writes it.

**Debugging tips:** if enrichment never completes, check `GOOGLE_GENERATIVE_AI_API_KEY` is actually set (separate from `GEMINI_API_KEY` — see §12 item 7) before assuming a Gemini outage. If a field worker can't self-register, confirm their message body exactly matches `NGOProfile.joinCode` (case-sensitivity: the webhook upper-cases the body before comparing, line ~66) — and note there's currently **no in-app way for an NGO to regenerate/rotate their join code** (confirmed via grep: `app/ngo/settings/team/actions.ts` has zero `joinCode`/`FieldWorker` references) — it's set once at registration (`app/api/ngo/register/route.ts:218`, `generateJoinCode(orgName)`) and only ever displayed read-only in `DashboardClient.tsx:579-602`.

### 13.3 NGO Settings (Profile & Team) + CRM (`daceffd`)

**`app/ngo/settings/profile/`** — self-service editing of the **personal `User` record**, not the org `NGOProfile`. `actions.ts` `updateUserProfile` updates only `User.name` and optionally `User.avatar` (upload via `lib/storage.ts`, 5MB limit, JPEG/PNG/WEBP/GIF). `page.tsx` shows email as `disabled` (can't be changed here) and has decorative, non-functional "Notification Preferences" toggles. **Does not** touch `verificationStatus` or trigger re-review.

**`app/ngo/settings/team/`** — the team-invite UI described in §13.1, plus member removal (`removeTeamMember` action, not detailed above — grep `actions.ts` for its exact guard logic before modifying).

**`app/ngo/crm/page.tsx`** — despite the name, this is a **read-only donor-analytics view**, not a contact/notes CRM. Gated to `VERIFIED` NGOs (or ADMIN, via a "first verified NGO" demo override, lines 29-32). Fetches all `SUCCESS` donations for the NGO's projects, aggregates client-side by `donorId` into totals/counts/first-last-donation/project-set/`donorTier`, renders a sortable table with a decorative (non-functional) "Export CSV" button and a `mailto:` link per donor row. No pipeline, tagging, or note-taking exists despite the "CRM" name — don't assume functionality that isn't there.

**Debugging tips:** if a profile edit doesn't appear to save, remember it only touches `User`, not `NGOProfile` — org-level fields (org name, address, cause categories) are edited elsewhere (`app/api/ngo/settings/route.ts`, distinct from this settings subtree). If someone expects CRM "notes" or "export" to work, they don't — flag this as a known gap rather than a bug to chase.

### 13.4 Pitch Deck Generator (`daceffd`)

**Why it exists:** an auto-generated fundraising PPTX for NGO/platform-level pitching, doubling as a lead-capture funnel on the public marketing site.

**Execution flow:** `scripts/generate-pitch.js` (`main()`, lines 35-461) builds a **static** deck via `pptxgenjs` — nearly all figures (market size, donor-trust-gap stats, roadmap) are hard-coded literals, **not queried from Prisma**; the only dynamic input is an optional base64-encoded campaign payload used on the cover/ask slides when a specific project is requested. `app/api/pitch/generate/route.ts` `GET` (lines 91-135) serves a cached file if <24h old, else calls `ensureGenerated()` (lines 51-89) which optionally rewrites the description via Gemini (`rewriteDescription`, lines 26-48, legacy SDK) then shells out `execAsync('node scripts/generate-pitch.js <payload>')`. `POST` (lines 137-179, NGO/ADMIN only) force-regenerates behind a 5-minute **in-memory** rate limit keyed on `userId-projectId-audience` (not distributed-safe).

**Public funnel:** `app/pitch/page.tsx` has a lead form that POSTs to `app/api/pitch/lead/route.ts` (upserts `PitchLead` by unique email) but **always proceeds to download regardless of the lead API's result** — the form is optional UX, not a real gate; a "skip form" link downloads directly with no auth. That route also instantiates its own `new PrismaClient()` (bypasses the singleton — see §12 item 3).

**NGO-facing widget:** `components/ngo/PitchDeckSection.tsx` (rendered via `app/ngo/pitch-deck/page.tsx`, which just does the VERIFIED-NGO gate) lets an NGO pick org-level vs per-campaign decks, Indian/Foreign audience, download, and (if role NGO/ADMIN) force-regenerate; polls `app/api/pitch/meta/route.ts` for `{generatedAt, fileSizeKb, leadCount}` — note `leadCount` is a **global** `prisma.pitchLead.count()`, not scoped per-NGO, so every NGO sees the platform-wide lead total.

**Side effects:** `next.config.mjs:3-9` also runs `generate-pitch.js` synchronously during `NODE_ENV=production` builds, wrapped in try/catch so a failure only `console.warn`s — meaning `public/downloads/` can end up empty in production with no build failure signal, and the first real request pays full generation latency (and can fail outward-facing if runtime lacks write access too).

**Debugging tips:** env vars are all optional with hard-coded fallbacks (`PITCH_DECK_NGO_NAME` etc., `.env.example:49-52`); if downloads 404 or look stale, check `public/downloads/` is writable and check server logs around the `execAsync` call rather than assuming the route itself is broken.

### 13.5 Donor Domain Merge (`568d978`, `29f0c7f`, `e59d47e`, `8f70d4d`)

*(Broad mechanics already covered in §4 and the Feature Map — this is the "why" and merge-specific detail.)*

**Why these commits happened:** three parallel efforts (persona-tailored profile, home-page quick-donate entry point, and a full dashboard/portfolio/support rebuild) were developed on separate branches/by separate contributors and merged into `main` by kruhi7533, requiring a schema-conflict resolution (`568d978`'s message: "resolve schema conflicts").

**Persona system:** set at `app/donor/onboarding/page.tsx` (wizard) → `POST /api/donor/persona/route.ts`, or changed later via `app/donor/profile/DonorProfileClient.tsx` (4-way selector) → `PUT /api/donor/profile/route.ts`. Persona (`DonorPersona`: INDIVIDUAL/CSR_OFFICER/HNI/FOUNDATION/GOVERNMENT) is distinct from `donorCategory` (FCRA-relevant: INDIAN_IN_INDIA/INDIAN_ABROAD/FOREIGN_NATIONAL) — don't conflate the two when working in this area.

**Known incomplete state (inherited from the merge, not fixed since):** `app/donor/dashboard/page.tsx` is a stub (§12 item 5); `DismissButton.tsx`/`ReadMoreNarrative.tsx` are fully built but unimported anywhere; `/donor/portfolio` isn't in `DonorSidebarShell.tsx`'s nav list despite existing as a page. If continuing work here, wiring the dashboard to real data and connecting the two orphaned components is the highest-leverage next step.

**Debugging tips:** `components/donor/DonorSidebarShell.tsx` owns its own active-nav-item and mobile-drawer state — if a new donor page isn't appearing in the sidebar, it's because the nav list is hardcoded there (lines ~80-131), not derived from the route tree.

### 13.6 Long-Running Core Modules (high historical edit frequency, not just recent)

Per `git log --author=kruhi7533 --name-only`, these files have been touched across the most commits historically and represent the platform's oldest, most load-bearing logic — treat changes here with extra caution even though they predate the "recent" cluster above: `prisma/schema.prisma` (12 touches — the entire domain model), `app/ngo/dashboard/page.tsx`/`DashboardClient.tsx` (10 combined), `app/api/ngo/register/route.ts` (5), `app/api/donations/webhook/route.ts` (5), `app/api/ngo/submit-proof/route.ts` (4), `app/api/ngo/projects/route.ts` (4), `app/projects/[id]/page.tsx` (4), `lib/auth-guards.ts`/`lib/auth.ts` (5 combined), `app/admin/dashboard/page.tsx`/`AdminClient.tsx` (5 combined). These are already covered in full depth in §3, §5, §7, §8, §9 above — no separate write-up needed, but expect them to be the files most other features depend on transitively (confirmed in §2's dependency map).
