---
phase: 3
plan: 2
wave: 1
gap_closure: false
---

# Plan 3.2: Project Details, Donation Modal & Polling Page

## Objective
Implement the public project campaign view showing progress and milestones, the pre-donation billing verification modal integrating Razorpay Checkout, and the status polling pending page.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/phases/3/RESEARCH.md
- .gsd/DECISIONS.md
- prisma/schema.prisma
- app/discover/page.tsx

## Tasks

<task type="auto">
  <name>Create Public Project Details Page</name>
  <files>
    app/projects/[id]/page.tsx
  </files>
  <action>
    Steps:
    1. Create `app/projects/[id]/page.tsx` (using Next.js Server Components to fetch project, associated NGO details, and sequential milestones from Prisma).
    2. Render a premium UI with:
       - Cover image and project title/category badges.
       - Raised amount vs target amount progress bar with percentage, and count of active donors.
       - NGO details card displaying the NGO's name and its Health Score with dynamic color badge.
       - Description text.
       - Milestone sequence: Render as a vertical timeline showing each milestone's order, title, description, target amount, deadline, and status (e.g. PENDING, COMPLETED).
       - Prominent "Donate to Project" button (triggering the `DonateModal` client component).
    3. Ensure proper error handling and a loading skeleton.
  </action>
  <verify>
    Ensure route compiles cleanly.
  </verify>
  <done>
    Project detail page correctly retrieves data and renders campaigns, progress, and milestone timelines.
  </done>
</task>

<task type="auto">
  <name>Implement Donation Modal & Client Checkout Flow</name>
  <files>
    app/components/DonateModal.tsx
    app/donor/donations/[donationId]/pending/page.tsx
  </files>
  <action>
    Steps:
    1. Create `app/components/DonateModal.tsx`:
       - Open via a state variable from the project page.
       - Check if the donor has missing billing details (Name, PAN, Billing Address) by checking the session/user profile.
       - If details are missing, show a form capturing Full Name, PAN Number (validating with regex `/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/`), and Billing Address (street, city, state, pincode).
       - If details are present, display donation amount selectors (pre-set options + custom input).
       - Upon clicking "Confirm Payment", call `/api/donations/create-order` (sending the billing details if they were missing, which updates the `User` profile).
       - Dynamically inject the Razorpay checkout script if not already loaded: `https://checkout.razorpay.com/v1/checkout.js`.
       - Initialize the Razorpay Checkout modal using the returned `razorpayOrderId`.
       - On client success, redirect the user to `/donor/donations/[donationId]/pending`.
    2. Create `app/donor/donations/[donationId]/pending/page.tsx`:
       - Page polls `/api/donations/[donationId]/status` every 3 seconds.
       - Limit polling to 10 times max.
       - If the status updates to `SUCCESS`, show a premium success screen with link to download receipt and view impact portfolio.
       - If status becomes `FAILED` or polling limits out, show an error state and a "contact support" message.
  </action>
  <verify>
    Ensure modal and polling components compile cleanly.
  </verify>
  <done>
    Payment flow opens checkout modal, captures payment, redirects, and polls successfully until resolved.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] PAN format is validated via regex before initiating payment.
- [ ] Polling page halts after 10 retries and displays clear error feedback.

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in tests
