---
phase: 5
plan: 3
wave: 2
gap_closure: false
---

# Plan 5.3: CSR Portal & Utilization Certificate

## Objective
Build the corporate donor CSR dashboard tab within the donor portfolio, implementing compliance-ready project-wise tables, CSV exporter, and dynamic utilization certificate PDFs generated server-side.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/DECISIONS.md
- prisma/schema.prisma
- app/donor/portfolio/page.tsx
- lib/receipt-generator.tsx

## Tasks

<task type="auto">
  <name>Build CSR Dashboard tab inside Donor Portfolio</name>
  <files>
    app/donor/portfolio/page.tsx
  </files>
  <action>
    Steps:
    1. Update `app/donor/portfolio/page.tsx`:
       - Check if the logged-in user has `isCorporate === true`.
       - If true, display a "CSR Portal" tab alongside standard tabs.
       - CSR Tab Content:
         * Aggregate CSR spend summary by financial year.
         * Project-wise breakdown table: Campaign Name, NGO Name, Amount Donated, Milestones Completed, Milestones Pending, average AI proof scores.
         * Export to CSV button implementing Client-side download for the table data.
         * Downloadable Utilization Certificate button triggering the certificate API route.
  </action>
  <verify>
    Verify compilation.
  </verify>
  <done>
    Corporate donors see the CSR Portal tab with summary stats, compliance tables, and CSV exports.
  </done>
</task>

<task type="auto">
  <name>Create Dynamic Utilization Certificate Generator API</name>
  <files>
    app/api/donations/csr-certificate/route.ts
  </files>
  <action>
    Steps:
    1. Create `app/api/donations/csr-certificate/route.ts` running under the Node.js runtime:
       - Restrict route access to logged-in users with `isCorporate === true`.
       - Read search param `fy` (financial year).
       - Fetch all successful donations by this donor in the given financial year.
       - Group/aggregate by project and milestones completed with AI scores.
       - Render a professional Utilization Certificate PDF using `@react-pdf/renderer` containing:
         * Company Name and GST Number (if provided).
         * Financial Year.
         * Total CSR spend.
         * Project Table: NGO Name, Project, Amount, Milestones Completed, Proof Verified by AI, average Score.
         * Declaration: "The above contributions were made to verified NGOs on ImpactBridge platform. Milestone completion has been independently validated."
         * ImpactBridge letterhead, receipt number, generation date, and digital signature placeholder.
       - Return the generated PDF buffer.
  </action>
  <verify>
    Run compiler checks.
  </verify>
  <done>
    Corporate users can download high-fidelity, compliance-ready Utilization Certificate PDFs.
  </done>
</task>

## Success Criteria
- [ ] CSR Portal tab is visible only to corporate donors.
- [ ] Exporter provides clean, structured CSV format.
- [ ] Certificate PDF compiles and renders layout elements correctly.
