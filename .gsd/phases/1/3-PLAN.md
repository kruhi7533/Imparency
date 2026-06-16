---
phase: 1
plan: 3
wave: 2
gap_closure: false
---

# Plan 1.3: File Storage Adapter & Rate Limiter

## Objective
Build a unified file storage utility supporting local uploads and S3/R2 providers with UUID prefixing, and implement a database-backed rate-limiter for authentication API endpoints.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/phases/1/RESEARCH.md
- .gsd/DECISIONS.md
- prisma/schema.prisma
- lib/prisma.ts

## Tasks

<task type="auto">
  <name>Build Unified File Storage Utility</name>
  <files>
    lib/storage.ts
  </files>
  <action>
    Steps:
    1. Import `@aws-sdk/client-s3` and helper methods.
    2. Write a `lib/storage.ts` module exporting two primary functions:
       - `uploadFile(file: Buffer, originalName: string, folder: string): Promise<string>`
       - `deleteFile(fileUrl: string): Promise<void>`
    3. Filename logic: Extract extension from `originalName`, generate a new UUID v4 string, and join as `{uuid}.{ext}`.
    4. Implement provider branches based on `process.env.STORAGE_PROVIDER`:
       - `local`: Save to `public/uploads/{folder}/{uuid}.{ext}` using Node `fs/promises`. Return relative URL path `/uploads/{folder}/{uuid}.{ext}`.
       - `s3` / `r2`: Initialize `S3Client` with credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_BUCKET_NAME`). Perform `PutObjectCommand` and return public S3 CDN URL.
    5. In `deleteFile`: parse URL to extract file path and delete either from disk or from S3.
    
    AVOID: Crashing if S3 credentials are missing in local dev. Default to `local` provider if `STORAGE_PROVIDER` is unset.
  </action>
  <verify>
    Create a temporary test script or verify module exports compile correctly.
  </verify>
  <done>
    `lib/storage.ts` correctly handles saving and deleting files locally or in S3.
  </done>
</task>

<task type="auto">
  <name>Implement PostgreSQL Rate Limiter Helper</name>
  <files>
    lib/rate-limiter.ts
  </files>
  <action>
    Steps:
    1. Create `lib/rate-limiter.ts` using Prisma client to query `RateLimitLog` table.
    2. Write function `rateLimit(identifier: string, route: string, maxRequests: number, windowSeconds: number): Promise<{ success: boolean; limitRemaining: number }>`:
       - Identifier is IP address hash or email address.
       - Calculate window start timestamp (`now - windowSeconds`).
       - Fetch record for (`identifier`, `route`) where `windowStart` is greater than window start threshold.
       - If no record, create one with count = 1 and `windowStart = now`. Return `success: true`.
       - If record exists and count < `maxRequests`, increment count and update db. Return `success: true`.
       - If record exists and count >= `maxRequests`, return `success: false`.
    3. Include automated pruning: every time a rate limit check runs, trigger a non-blocking cleanup of logs where `windowStart < now - windowSeconds` using a raw/background prisma command.
    4. Design rate-limit middleware wrapper or helper that can be added to login, register, and password-reset API route handlers, returning a 429 status code if rateLimit returns `success: false`.
  </action>
  <verify>
    Ensure rate-limiter functions compile and can execute query operations.
  </verify>
  <done>
    Rate limiting engine successfully accesses the database and correctly tracks and prunes request counts.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] `lib/storage.ts` can upload and delete.
- [ ] `lib/rate-limiter.ts` correctly reads and writes database records.
- [ ] Rate limits trigger 429 errors when counts are exceeded.

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in tests
