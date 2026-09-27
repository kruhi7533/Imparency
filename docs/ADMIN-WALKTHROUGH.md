# ImpactBridge, seen from the admin console

A plain-language walkthrough of what the platform does and where admin sits in
it. Written to be presented from: no code, no table names, and it says what is
real today versus what is not built yet.

If you want the engineering version — requirements, measurements, gaps — read
[`ADMIN-SYSTEM-DESIGN.md`](ADMIN-SYSTEM-DESIGN.md) instead.

---

## The one-sentence version

> ImpactBridge connects companies that must spend CSR money with NGOs that can
> deliver the work — and the reason anyone should believe either side is that a
> human checked the documents, and the platform can prove who checked what and
> when.

Admin is that human. Everything in the console exists to answer one of three
questions:

1. **Is this organisation real?** (Verification)
2. **Has something gone wrong?** (Risk and compliance)
3. **Can we prove what we decided?** (Audit)

## What admin is deliberately *not*

Admin does not pick who gets funded, does not write proposals, and does not
approve them. If a donor or an NGO could do it themselves, it is not admin's
job. That line was moved this week: the console used to let an admin open a
funding round and approve a proposal on a funder's behalf, because funders had
no screens. They do now, so those pages are marked superseded.

This matters when presenting. "Admin runs the marketplace" is the wrong story
and invites the obvious objection — that the platform is picking winners. The
right story is: **admin guards the front door and the record, and stays out of
the deal.**

---

## The journey, and where admin touches it

### 1. An NGO signs up

It registers and uploads its documents — registration certificate, PAN, and
whichever of 12A / 80G / FCRA it holds.

**One AI pass reads those documents.** It extracts about a dozen fields —
organisation name, registration number, PAN, dates — and records a confidence
score for each, plus which document each value came from.

**The AI never decides anything.** It produces evidence. A separate set of fixed
rules — no model involved — compares what the documents say against what was
typed into the form, and against each other. If an 80G certificate names a
different organisation than the registration certificate, that is a high-severity
finding, and it lands in the admin's risk queue.

> Worth saying out loud in a pitch: *a missing 80G or 12A is not a problem.*
> Plenty of legitimate NGOs hold neither. The platform only ever treats a
> **contradiction** as a defect, never an absence. Getting that wrong would
> flood the queue and make it worthless.

**Admin decides.** Approve, reject, or ask for a correction. Three things the
console will not let an admin do, by design:

- approve an organisation with no documents at all
- approve one whose documents were never analysed
- approve one where the name, PAN or registration number on the documents
  contradicts the form — and **this one cannot be overridden with a note**,
  unlike every other check

A rejected organisation is told why, in the reviewer's own words, and can fix
and resubmit.

### 2. A company signs up

Same shape, different documents. A company gives its CIN, a trust its
registration number, a government body neither — the console asks for the right
evidence per type rather than demanding a CIN from everyone, which would have
locked every foundation out permanently.

**Two separate checks, not one.** Whether the person's tax ID is real, and
whether the organisation behind them is real. Before this week the platform only
asked the first, which meant a company was effectively vouched for by one
employee's PAN.

### 3. The company says what it needs

It either uploads its CSR requirement document — an RFP — or fills in a form.
If it uploads, the platform reads the document and extracts about eighteen
things: sector, state, budget range, duration, beneficiaries, KPIs, which
registrations an NGO must hold, reporting expectations.

**The company corrects the extraction before it counts.** Every field shows its
confidence and whether the value came from the AI, the donor, or an admin.
Low-confidence fields are flagged for attention. An AI reading of a PDF is a
draft; a requirement nobody confirmed would silently decide who gets excluded.

**Admin validates it.** This is a real gate: nothing enters matching until an
admin has looked.

### 4. The platform finds NGOs — in two steps, in a fixed order

This is the part worth slowing down on, because it is the difference between
this platform and a search box.

**Step one: eligibility. A gate, and it cannot be overridden.**
Can this NGO legally take this money at all? Is it verified? Not suspended?
Does it hold the registrations this requirement demands? If the requirement
needs FCRA and the NGO has none, it is out — and the reason is recorded, rule by
rule, including the rules it passed.

**Step two: ranking, and only over the survivors.**
Among the NGOs that *can* participate, how well does each fit? Sector, geography,
budget, KPIs, duration, track record — weighted, scored out of 100, with a
written explanation per dimension and the main gap named.

A high fit score on an ineligible NGO must never reach a shortlist, because it
invites someone to pick it. That is why the order is fixed.

**And a third outcome that matters: "we could not evaluate this."** Not a pass,
not a fail. An organisation with no evidence renders as unknown, in red — never
as clean. This is the single rule the platform is most careful about, and it was
extended this week: a *verified* organisation whose evidence does not support
its status now says so on its own page, where before it showed a green badge and
nothing else.

**What to show in a demo:** the same NGO, against two requirements. Eligible for
the domestic education grant; ineligible for the international one, because it
holds no FCRA — with the reason on screen. One organisation, two opposite
verdicts. That proves the platform is filtering, not just listing.

### 5. The company invites, the NGO responds, the company decides

The donor shares the brief with the NGOs it wants. Each invited NGO sees a
summary — never the donor's own document. It replies with a proposal: budget,
duration, plan, milestones, expected outcomes.

The donor can send a proposal back for changes; the NGO revises; the donor
approves one. **Admin is not in this loop at all** — the funder approves its own
proposal. The only place admin re-enters is a genuine exception, such as a
foreign funder paired with an NGO that cannot legally receive foreign money.

### 6. Money, delivery, and proof

A funded project raises against milestones. The NGO submits proof of delivery —
photographs, documents, and field reports collected over WhatsApp. An AI checks
the proof against what was promised, and **an admin approves it.** Payment truth
comes from the payment provider's webhook, never from the browser.

---

## What admin actually looks at, day to day

**Today** — one prioritised inbox across every queue, answering "what should I
do now".

**SLA** — a different question: which promises are we breaking, and by how much.
Targets are written into the code with a stated reason for each — a suspected
fraud gets one day, a risk review two, a project or proof review three, an NGO
verification five. Most products keep these in a slide deck. Worth mentioning:
it is measurement, not enforcement — nothing escalates automatically yet.

**Verification** — approvals, per-field document review, FCRA certificates, and
CSR requirement validation, in one place.

**Risk and compliance** — fraud alerts, risk reviews, suspension. Plus a nightly
sweep that does something unusual: it **retracts** compliance badges that have no
validated evidence behind them. The platform actively takes back claims it
cannot support.

**Audit** — every state-changing admin action, with who did it, what changed
from and to, their IP, and the exact filters used on any export. **Ids only —
never names, emails or donation amounts**, because the log outlives the data it
points at. Exportable for a regulator.

---

## The trust model, in four sentences

Worth memorising for a pitch, because it is the actual product:

1. **The AI proposes; a human decides.** Nothing becomes true on a model's word.
2. **A badge must be backed by evidence** — and if the evidence disappears, the
   badge is withdrawn automatically.
3. **Absence of evidence is never reported as safety.** "We did not check" and
   "we checked and it passed" never look the same.
4. **Every decision is attributable, and every rejection carries a reason** in
   the reviewer's own words, stored so it survives later edits.

---

## Being straight about what is not built

Do not oversell these. They are all known, written down, and scoped.

**Working today:** NGO and company verification, document extraction and
review, requirement intake with human correction, eligibility filtering with
stored reasons, ranked matching with explanations, invitations, NGO proposals,
risk and fraud queues, milestone proof review, the audit trail, and the admin
inbox with SLA measurement.

**Not built yet:**

- **A finance ledger, reconciliation, and fund disbursement.** Deliberately
  last. The platform tracks donations; it does not yet move money to NGOs.
- **Beneficiary-level consent.** Consent today covers donors only.
- **Admin roles.** Every admin can do everything — approve, suspend, export.
  Fine for a team of three, not for a partner's compliance review.
- **SLA escalation and work assignment.** The targets are measured; nothing acts
  on them.
- **A staging environment.** Everything is still developer machines and a shared
  development database.

**Two live examples of the system working as intended,** which are worth showing
rather than hiding: one verified NGO in the database has three unresolved
high-severity document contradictions, and another was verified with no evidence
at all. Both now say so, in red, at the top of their own page. That is not a
demo of a bug — it is a demo of a platform that reports its own problems instead
of rendering them green.
