---
phase: 5
plan: 4
wave: 2
gap_closure: false
---

# Plan 5.4: Platform-Wide Admin Analytics & UI Polish

## Objective
Implement platform-wide administrative analytics computed via Prisma aggregations, integrate loading skeleton screens, set up React error boundaries with retry buttons, and polish mobile responsive styling.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/DECISIONS.md
- prisma/schema.prisma
- app/admin/dashboard/page.tsx
- app/discover/page.tsx

## Tasks

<task type="auto">
  <name>Build Platform Analytics for Admin Dashboard</name>
  <files>
    app/admin/dashboard/page.tsx
  </files>
  <action>
    Steps:
    1. Update server actions / fetching in `app/admin/dashboard/page.tsx` to compute:
       - Total donations (today, this week, this month, this financial year).
       - NGO status counts (active, pending, rejected).
       - Donor counts (total and corporate).
       - Average NGO health score.
       - Top 5 NGOs by funds raised.
       - Top 5 projects by donor count.
       - Platform-wide milestone completion rate.
       - Unresolved fraud alerts counts.
    2. Render these metrics cleanly inside a stats overview section at the top of the Admin Verification page.
  </action>
  <verify>
    Ensure admin dashboard compiles cleanly.
  </verify>
  <done>
    Admin panel displays platform-wide compliance, donation, and alert statistics.
  </done>
</task>

<task type="auto">
  <name>Implement Skeletons, Error Boundaries & Polish UI</name>
  <files>
    app/discover/page.tsx
    app/donor/portfolio/page.tsx
    app/ngo/dashboard/page.tsx
  </files>
  <action>
    Steps:
    1. Add skeleton loader states (using Tailwind transitions and layouts matching cards/tables) for:
       - NGO discovery grid card elements.
       - Donor portfolio tables.
       - Admin dashboard lists.
    2. Create a generic React `ErrorBoundary` component in components. Wrap major sections of discovery, portfolio, profiles, and dashboard in it, rendering a "Something went wrong" card with a retry button.
    3. Update mobile responsiveness:
       - Discovery sidebar filters collapse to a drawer panel.
       - Tables in admin review and CSR portals become horizontally scrollable cards.
       - The project page donate CTA is rendered as a sticky footer bar on mobile viewports.
    4. Implement clean empty states for all lists (NGOs with no projects, donors with no donations, admins with no pending items).
  </action>
  <verify>
    Verify compilation with `npx tsc --noEmit`.
  </verify>
  <done>
    All dashboard, discovery, and portfolio layouts have skeletons, error boundaries, responsive tables, and custom empty states.
  </done>
</task>

## Success Criteria
- [ ] Analytics compute correctly without crashing.
- [ ] Skeletons align with content layouts.
- [ ] Mobile responsive tables and sticky buttons render correctly.
