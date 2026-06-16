---
phase: 2
plan: 3
wave: 2
gap_closure: false
---

# Plan 2.3: Discovery Page & Public Profiles

## Objective
Build the responsive `/discover` page featuring search queries, cause category pill filters, side filters, and color-coded Health Score badges, and construct the `/ngo/[id]` public profile displaying metric bar breakdowns and active project details.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/phases/2/RESEARCH.md
- .gsd/DECISIONS.md
- prisma/schema.prisma

## Tasks

<task type="auto">
  <name>Build Discovery Page and API</name>
  <files>
    app/discover/page.tsx
    app/api/ngo/discover/route.ts
  </files>
  <action>
    Steps:
    1. Create `app/api/ngo/discover/route.ts` that retrieves all `NGOProfile` records:
       - Query filters: causeCategories, location, search (orgName), and sort options (healthScore desc, createdAt desc, totalRaised desc).
       - Expose cursor-based or offset-based pagination to support infinite scroll.
    2. Create `app/discover/page.tsx`:
       - Top search bar and horizontally scrollable pills for cause categories (Education, Healthcare, Environment, etc.).
       - Side filters for cause category checkboxes, city/state text searches, and sort dropdown.
       - Clean grid layout displaying NGO cards (orgName, cause tags, location, follow button, active projects count, and a color-coded Health Score badge: green if 80+, yellow if 50-79, red if < 50).
       - Integrated infinite scrolling loading indicators.
    
    AVOID: Complex layout styling issues. Ensure responsive design with clean Tailwind breakpoints.
  </action>
  <verify>
    npm run build --no-emit
  </verify>
  <done>
    Discovery search filters correctly trigger API queries, and result cards render with color-coded health badges.
  </done>
</task>

<task type="auto">
  <name>Create NGO Public Profile page and Follow API</name>
  <files>
    app/ngo/[id]/page.tsx
    app/api/ngo/[id]/follow/route.ts
  </files>
  <action>
    Steps:
    1. Create `app/api/ngo/[id]/follow/route.ts`:
       - Requires authentication.
       - POST toggles follows for the current user and specified NGO. Updates `NGOFollower` table.
    2. Create `app/ngo/[id]/page.tsx` public profile page:
       - Header: Cover banner, logo avatar, org name, location, cause tags, total raised/donors stats, and Follow button.
       - Tabs: Active Projects / Completed Projects / Impact Story / About.
       - Renders list of projects linking to their donation pages.
       - Renders Health Score section showing breakdown metrics (utilization rate, completion rate, average proof speed, donor return rate) as individual metric bars.
    
    AVOID: Static profiles. Animate progress bars on load and add hover lift on project cards (`hover:-translate-y-0.5 transition-all`).
  </action>
  <verify>
    Confirm build compiles cleanly.
  </verify>
  <done>
    NGO public profile layout is complete, health score progress bars animate, and follows toggle successfully.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] Discovery page filters and sorts results correctly.
- [ ] Health score badges display color-codes according to ranges.
- [ ] NGO Profile page shows tabs, metric bars, and follow toggle works.

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in tests
