---
phase: 1
plan: 2
wave: 1
gap_closure: false
---

# Plan 1.2: NextAuth & Role-Based Auth Guard

## Objective
Implement NextAuth.js authentication configuration with credentials and Google OAuth providers, enrich JWT and session objects with custom user properties (id, role, ngoProfileId), create global route interception middleware, and design API role guards.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/phases/1/RESEARCH.md
- .gsd/DECISIONS.md
- prisma/schema.prisma

## Tasks

<task type="auto">
  <name>Configure NextAuth.js and Type Extensions</name>
  <files>
    app/api/auth/[...nextauth]/route.ts
    types/next-auth.d.ts
  </files>
  <action>
    Steps:
    1. Define custom TypeScript interface extensions in `types/next-auth.d.ts` to extend `User`, `Session`, and `JWT` types with `id`, `role` (DONOR/NGO/ADMIN), and `ngoProfileId` (string | null).
    2. Configure NextAuth options in `app/api/auth/[...nextauth]/route.ts` (or options file):
       - Enable `CredentialsProvider` for email/password validation. Use `bcryptjs` to securely compare password hashes from the `User` table.
       - Enable `GoogleProvider` for OAuth. On OAuth registration, auto-create a user record with `role: DONOR` and set `googleId`.
       - Enable JWT strategy.
       - Implement `jwt` callback: if it's the initial sign-in, fetch user details and their `NGOProfile` id (if they have one) from Prisma. Assign `id`, `role`, and `ngoProfileId` to the token.
       - Implement `session` callback: assign `id`, `role`, and `ngoProfileId` from token to the session's user object.
       - Configure custom sign-in page path if needed, e.g., `/login`.
  </action>
  <verify>
    npm run build --no-emit (or check NextAuth routes build compile status)
  </verify>
  <done>
    NextAuth compiles correctly with type extensions and JWT/session enrichment.
  </done>
</task>

<task type="auto">
  <name>Implement Global Middleware and API Guard Helper</name>
  <files>
    middleware.ts
    lib/auth-guards.ts
  </files>
  <action>
    Steps:
    1. Create `middleware.ts` at the root of the project using NextAuth middleware wrapper:
       - Match paths `/ngo/:path*`, `/admin/:path*`, and `/donor/:path*`.
       - Check user session token: redirect unauthenticated users to `/login`.
       - Check user roles: if accessing `/ngo/*`, require `role === 'NGO'`; for `/admin/*`, require `role === 'ADMIN'`; for `/donor/*`, require `role === 'DONOR'`. Redirect unauthorized users to `/unauthorized` or `/`.
    2. Create `lib/auth-guards.ts`:
       - Write a `withRole(role: 'DONOR' | 'NGO' | 'ADMIN')` function that retrieves the server session (using `getServerSession`) and checks authorization. If authorization fails, returns a standard `Response.json({ error: "Forbidden" }, { status: 403 })`.
       - Write a custom helper `getRequiredSession()` that returns the validated session or throws an authorization error.
  </action>
  <verify>
    Ensure middleware compiles and exports correctly.
  </verify>
  <done>
    Global route checks and API-level role guard helpers are fully implemented and compile without errors.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] Session interface has custom types registered in Next.js build context.
- [ ] Middleware handles route interception and matches the required matchers.
- [ ] `lib/auth-guards.ts` functions are ready to import.

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in tests
