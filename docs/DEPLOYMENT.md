# ImpactBridge — Production Deployment Guide

Consolidates everything found and fixed during the production-hardening pass (a
sequence of 9 incremental items, each individually reviewed and verified —
see git history for the detailed reasoning behind each). This is the
authoritative checklist for an actual deployment; don't rediscover these from
scratch.

**Target platform: Vercel.** `vercel.json` already defines 5 cron jobs; the
codebase assumes Vercel's serverless execution model throughout.

---

## 1. Before you deploy — required configuration changes

### 1.1 Storage — done, using Cloudinary
`.env` previously had `STORAGE_PROVIDER="local"`, which would have **silently
lost every uploaded file in production** — Vercel's serverless filesystem is
ephemeral, so NGO registration documents, project cover images, milestone
proof photos, and PDF tax receipts would all "succeed" on upload and then
vanish.

`lib/storage.ts` supports three providers: `local`, `s3`/`r2`, and
`cloudinary`. **Cloudinary was chosen** over S3/R2 specifically to avoid
Cloudflare/AWS's card-on-file requirement for account verification — this
project already had a working Cloudinary account (`CLOUDINARY_CLOUD_NAME`/
`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`, previously only used for
WhatsApp proof-photo re-hosting in `lib/whatsapp/worker.ts`), so it reuses
that account rather than opening a new one.

- `STORAGE_PROVIDER="cloudinary"` is now set in `.env` — copy the same value
  and the three `CLOUDINARY_*` vars into Vercel.
- Uploads use `resource_type: "auto"` (Cloudinary infers image/video/raw) and
  return `secure_url` directly — no separate CDN URL configuration needed,
  unlike R2.
- Deletion reads the resource type back out of the asset URL itself (the
  `/image/upload/`, `/video/upload/`, or `/raw/upload/` segment) and passes it
  explicitly to `cloudinary.uploader.destroy()` — required because `destroy()`
  defaults to `resource_type: "image"` and silently no-ops (reports "not
  found" rather than erroring) for non-image assets like PDFs otherwise.
- Verified end-to-end with a real upload → fetch → delete round-trip,
  confirmed via Cloudinary's Admin API (not just a CDN fetch — CDN edge
  caches can still serve a deleted asset for a while since instant cache
  invalidation is a paid Cloudinary feature, so a fetch-based delete check
  alone would be misleading).
- The S3/R2 code path is left in place and still fully functional if you ever
  want to switch later — just change `STORAGE_PROVIDER` and set the
  corresponding `AWS_*` vars.

### 1.2 Environment variables — full checklist
`.env.example` is now the accurate, complete list of every env var the
codebase actually reads (verified by scanning all `process.env.*` usages
against it — nothing is undocumented except `NODE_ENV`, which Vercel sets
automatically). Set every one of these in **Vercel → Project → Settings →
Environment Variables** — Vercel does not read your local `.env` file at all.

Pay special attention to:
- `NEXTAUTH_URL` — must be the real production URL, not `localhost:3000`.
- `NEXTAUTH_SECRET` — **generate a fresh one specifically for production**,
  don't reuse the value from local `.env`. Secrets shouldn't be shared across
  environments. (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)
- `CRON_SECRET` — see §1.5.

### 1.3 Database — production Neon project already provisioned
A separate, clean Neon project (`impactbridge-production`) was created and
initialized during this hardening pass — **do not point production at the
same database used for local dev**, which has known schema drift left over
from an unmerged branch (harmless for prod since it's a different database
entirely, but a reminder these must stay separate).

- `DATABASE_URL`/`DIRECT_URL` for the production database → set in Vercel.
- The production database was initialized via `prisma migrate deploy`
  against a baseline migration (`prisma/migrations/`) — **not** `db push`.
  Going forward, schema changes should be made with `prisma migrate dev
  --name <description>` locally (creates + applies a reviewable migration
  file), committed, then `prisma migrate deploy` against production. Do not
  run `db push` against the production database — it can silently apply
  destructive changes with no reviewable diff.

### 1.4 Google OAuth
Real credentials already exist (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in
local `.env` — copy the same values into Vercel), but the Google Cloud OAuth
client currently only has `http://localhost:3000` registered. Once you have
a production domain:
- Google Cloud Console → **APIs & Services → Credentials** → the existing
  OAuth client → add to **Authorized JavaScript origins**:
  `https://<your-domain>`
- Add to **Authorized redirect URIs**:
  `https://<your-domain>/api/auth/callback/google`
- No new client needed — add these to the same one already created.
- Confirm **Audience → Publishing status is "In production"**, not
  "Testing" — Testing mode blocks anyone not on an explicit allowlist.

### 1.5 Twilio / WhatsApp
- `TWILIO_WEBHOOK_URL` currently points at a dead ngrok tunnel — update to
  `https://<your-domain>/api/whatsapp` in both Vercel's env vars **and**
  Twilio Console's WhatsApp Sandbox webhook configuration. Both must match
  exactly, or signature validation fails closed (safe, but the bot goes
  silent with no obvious cause besides server logs).
- Signature validation, XML-injection escaping, and clear config-missing
  logging were all hardened in this pass — no further code changes needed
  here, just the URL sync above.
- **Known unresolved risk** (see §3) — AI enrichment of WhatsApp submissions
  runs as fire-and-forget background work, which is not reliably guaranteed
  to complete on Vercel's serverless model. Analyzed in depth, not yet fixed.
- Still on Twilio's shared WhatsApp **Sandbox** number — fine for continued
  testing, but real end-users need a proper WhatsApp Business Profile
  (separate Twilio/Meta onboarding, days-to-weeks lead time, out of scope of
  this codebase).

### 1.6 Razorpay — explicitly deferred, not configured
`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` are not
set. **Donations do not work at all without these** — this was a deliberate
decision (the `razorpay` branch with a parallel/experimental payment
implementation was intentionally left unmerged). Revisit before launch if
donations are meant to be live at launch.

### 1.7 Cron jobs
`vercel.json` defines 5 crons. `CRON_SECRET` must be set in Vercel — when it
is, **Vercel automatically sends it as `Authorization: Bearer $CRON_SECRET`**
on its own cron invocations, which is exactly what all 5 routes check for
(hardened to fail closed + timing-safe comparison in this pass). Also:
- `deliver-impact` was originally designed to run every 10 minutes
  (`*/10 * * * *`) for true INSTANT donor notifications, but **the Vercel
  Hobby plan only allows daily cron jobs** — the first deploy attempt failed
  outright on this. Changed to `0 3 * * *` (daily) to stay on the free plan;
  "instant" impact notifications are now effectively daily. Upgrade to Pro
  and tighten this schedule if near-real-time delivery matters later.
- All 5 routes correctly reject requests with no/wrong/misconfigured secret.
- 3 of the 5 (`reminders`, `fcra-expiry`, `fcra-quarterly-report`) now have a
  5-minute duplicate-invocation lock to prevent double-sent emails; the other
  2 (`deliver-impact`, `impact-digest`) already had their own outbox-pattern
  protection.

---

## 2. Deployment steps

1. Push to `origin/main` (already the deployment branch).
2. Vercel → New Project → import the GitHub repo.
3. Add every env var from `.env.example` in Vercel's project settings
   **before** the first deploy (per §1.2), using production-specific values
   per §1.1–1.6, not the local dev ones.
4. Deploy. `npm install` triggers Prisma's own `postinstall` (generates the
   client from `schema.prisma` — needs no DB connection to do this). `next
   build` runs next; this also synchronously regenerates the marketing pitch
   deck (`next.config.mjs`, wrapped in try/catch — a build-time failure here
   only warns, never fails the whole build).
5. Update the Google OAuth client (§1.4) and Twilio webhook (§1.5) to point
   at the new production domain.

---

## 3. Known gaps — carried forward deliberately, not blockers to a first deploy

Ranked by what would actually bite first:

1. **WhatsApp AI enrichment reliability** (analyzed in depth, not implemented
   per explicit request during this pass). Fire-and-forget background work
   after a webhook response is not guaranteed to survive on Vercel's
   serverless model — every local test passes because `next dev` is a
   persistent process, which masks this entirely. Recommended fix (not yet
   built): `waitUntil()` from `@vercel/functions` for the fast path, backed
   by a lightweight cron reconciliation sweep as a safety net — the same
   outbox pattern `deliver-impact`/`impact-digest` already use successfully.
2. **Razorpay unconfigured** (§1.6) — donations don't work until addressed.
3. **44 API routes return raw internal error messages to clients.** Most are
   admin-gated (lower risk, trusted audience); a handful are donor/NGO-facing.
   The two highest-severity instances (Razorpay order-creation error leaks)
   were fixed; the rest is a real but lower-urgency, broader initiative.
4. **`media-proxy` has an open redirect** — authenticated users can be
   redirected to an arbitrary URL via `?url=`. Narrow practical exposure
   today (the app's own UI never surfaces a URL this could be exploited
   with), but worth closing.
5. **Local dev database schema drift** (`ep-crimson-shadow-...`) — unrelated
   to the new production database, which is clean and verified. Left alone
   per explicit decision; only matters if that same connection string is
   ever mistakenly reused for anything production-facing.

---

## 4. Post-deployment verification

- Sign in with a real Google account → confirms OAuth end-to-end on the real
  domain (this pass only verified the flow reaches Google's consent screen
  correctly on `localhost`; the production redirect URI itself is untested
  until you actually do this).
- Upload something (an NGO document, a project cover image) → confirm the
  resulting URL is a real S3/R2/CDN link, not `/uploads/...`, and that it
  actually loads.
- Send a WhatsApp message to the Sandbox number → check Twilio Console's
  webhook debugger for a `200`, then check the resulting `DraftProof` row's
  `workerStatus` a minute later — if it's stuck at `PENDING`/`ENRICHING`
  indefinitely, that's §3 item 1 manifesting for real.
- Hit each cron route manually once with the real `CRON_SECRET` (as a
  `Bearer` header) to confirm each runs cleanly before trusting the schedule.
- Confirm `/api/cron/*` reject with no secret and with a wrong secret (401),
  not silently succeed.
