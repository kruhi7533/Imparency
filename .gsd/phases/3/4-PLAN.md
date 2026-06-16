---
phase: 3
plan: 4
wave: 1
gap_closure: false
---

# Plan 3.4: 80G PDF Generation & Donor Impact Portfolio

## Objective
Configure next.config.mjs for `@react-pdf/renderer`, design the 80G tax receipt PDF layout, save and upload generated PDFs upon payment webhook completion, dispatch email receipts with attachments, and implement the Donor Impact Portfolio.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/phases/3/RESEARCH.md
- .gsd/DECISIONS.md
- prisma/schema.prisma
- lib/storage.ts
- lib/email.ts
- next.config.mjs

## Tasks

<task type="auto">
  <name>Configure React-PDF and Implement 80G Receipt Generation</name>
  <files>
    next.config.mjs
    lib/receipt-generator.tsx
    app/api/donations/webhook/route.ts
  </files>
  <action>
    Steps:
    1. Update `next.config.mjs` adding `experimental: { serverExternalPackages: ['@react-pdf/renderer'] }`.
    2. Create `lib/receipt-generator.tsx`:
       - Define the PDF document layout using `@react-pdf/renderer` components (`Document`, `Page`, `Text`, `View`, `StyleSheet`).
       - Requirements for layout: ImpactBridge logo/header, receipt number/date, donor name/PAN/billing address, donation amount in figures and words (from `amountToWords`), NGO name/PAN/registration/80G cert details, project name, financial year (from `getIndianFinancialYear`), 80G tax deduction exemption declaration, authorized signatory line, and a footer noting it is a computer-generated receipt.
       - Implement `generateReceiptBuffer(donation, taxReceipt, donor, ngo, project): Promise<Buffer>` rendering the PDF document to a buffer.
    3. Modify `/api/donations/webhook/route.ts`:
       - Integrate financial year and padded receipt sequence generation (count receipts in the DB for the current FY and increment).
       - Call `generateReceiptBuffer` with fetched relation data.
       - Save the resulting buffer using the storage adapter `uploadFile(buffer, filename, folder)` (path: `receipts/${donation.id}/${receiptNumber}.pdf`).
       - Write a record to the `TaxReceipt` table and link it to the donation.
  </action>
  <verify>
    Ensure PDF generation and webhook integration compile cleanly.
  </verify>
  <done>
    Next.js configuration allows `@react-pdf/renderer` to run on Node API routes, and webhook successfully generates, uploads, and saves PDF tax receipts.
  </done>
</task>

<task type="auto">
  <name>Integrate Receipt Emails and Donor Portfolio Page</name>
  <files>
    lib/email.ts
    app/api/donations/webhook/route.ts
    app/donor/portfolio/page.tsx
  </files>
  <action>
    Steps:
    1. Update `lib/email.ts` to add a receipt email helper. Accept the PDF URL (and optionally PDF buffer for attachments). Send the email via Resend client (fallback to console logging if `RESEND_API_KEY` is absent).
    2. Update `/api/donations/webhook/route.ts` to trigger the receipt email after writing to the `TaxReceipt` table.
    3. Create `app/donor/portfolio/page.tsx`:
       - Restrict access to authenticated users with `role === 'DONOR'`.
       - Query and display donor stats: total amount donated, count of supported projects, and list of followings.
       - Render feed/tabs for:
         * **Donations History Ledger:** List of donations with date, project name, amount, status, and button to view/download receipt PDF.
         * **Followed NGOs Feed:** List of followed non-profits (with status updates/quick links).
         * **Funded Campaigns:** List of projects donor supported and current milestone completeness.
  </action>
  <verify>
    Ensure email functions and portfolio UI compile cleanly.
  </verify>
  <done>
    Confirmation emails dispatch receipts successfully, and the Donor Portfolio displays analytics, ledger feeds, and receipt downloads.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] 80G tax receipt PDF incorporates all 11 content requirements specified in decisions.
- [ ] Donor portfolio page displays active funded projects and links to tax receipts.

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in tests
