# Changelog

All notable changes. Dates are UTC. Once the three PRs below are merged and the
pilot P0 items in `docs/PILOT-READINESS.md` pass, tag `main` as `v0.9.0-rc1`:

```bash
git tag -a v0.9.0-rc1 -m "Pilot release candidate 1"
git push origin v0.9.0-rc1
```

## [Unreleased] — v0.9.0-rc1 (pilot release candidate)

### NGO (`feat/ngo-outcomes-impact`)
- Impact page: outcome claims with pre-submit check, editing, AI suggestions that answer "insufficient data" rather than guess; donors see approved figures only.
- Project becomes FUNDED when every committed rupee is reconciled (manual confirmation or bank-statement matching).
- Beneficiary cohort and ready-for-matching profile; matching compares cohort, reporting cadence and declared KPIs.
- NGO contract page; field task edit/cancel; approved field evidence attached to milestone proof; NGO activity & audit.
- Accessibility and mobile pass; NGO guide, UAT and handover.

### Donor (`feat/donor-completion`)
- Donor organisations with team roles (Admin / Approver / Viewer) across every contract and requirement check.
- Cross-project impact report (PDF/CSV; "unverified", never 0), donor activity, notifications page, CSR requirement withdrawal, donor feedback on updates, CSR policy on the profile.
- Re-engagement moved from a webhook timer to an idempotent daily job.
- Fixes: unreviewed proof photos no longer reach donors; contract write routes rate-limited; contract amounts exact Decimals; no User rows created during page loads.
- Real donor E2E journeys, AI regression golden set, CSR demo seed, donor guide, handover, AI evals.

### Admin / platform (`feat/admin-platform`)
- Correlation ids restored on every request (lost in a merge).
- Security: cross-site write guard, rate limits on AI/upload/messaging routes, safe CSP subset enforced, Permissions-Policy no longer blocks field GPS.
- Four-eyes on committing money; Run now for scheduled jobs; daily SLA breach digest; `/api/health`; pilot health view.
- Donor organisation verification queue, global admin search (POST, no PII in URLs), platform trail of non-admin audit records.
- Tenant-isolation tests for donors, CSR teams and admin-negative cases.
- Runbook, backup/restore tooling, pilot readiness (P0/P1), admin handover.
