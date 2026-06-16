# Research: Phase 1 — Database, Auth & Storage Adapter

> **Phase**: 1
> **Status**: Completed

This document outlines the technical research, packages, and integration details for the foundation of ImpactBridge.

## 1. Database & ORM Configuration
- **Database**: Serverless PostgreSQL via Neon.
- **ORM**: Prisma ORM.
- **Connection Strings**:
  - `DATABASE_URL`: Pooled connection string (ends with `?pgbouncer=true` or matches Neon pool settings) for serverless route handlers to prevent connection exhaust.
  - `DIRECT_URL`: Direct connection string used by Prisma for running migrations.
- **Schema Reference**:
  - All keys, foreign key constraints, and default values are detailed in the Prisma schema design.
  - Hashed credentials stored in `User` table, with optional donor fields (`pan_number`, `phone`, `city`, `total_donated`) directly in `User`.
  - `NGOProfile` linked 1-to-1 with `User` via `user_id`.

## 2. NextAuth.js Integration
- **Version**: NextAuth.js v4.
- **Providers**:
  - `CredentialsProvider` for email/password using `bcryptjs` for secure comparison.
  - `GoogleProvider` for Google OAuth.
- **Session Strategy**: `jwt`.
- **JWT & Session Callbacks**:
  - Intercept the `jwt` callback to load the `role` and `ngoProfileId` from the database if not present, and store it in the token.
  - Intercept the `session` callback to copy `id`, `role`, and `ngoProfileId` from token to the session object.
  - Custom type declaration (`types/next-auth.d.ts`) will be created to ensure typescript compiler is aware of `role` and `ngoProfileId`.

## 3. Middleware Enforcements
- **Global Middleware (`middleware.ts`)**:
  - Utilizes NextAuth's token retrieval inside middleware.
  - Redirects users attempting to access `/ngo/*` without `role === 'NGO'`.
  - Redirects users attempting to access `/admin/*` without `role === 'ADMIN'`.
  - Redirects users attempting to access `/donor/*` without `role === 'DONOR'`.
- **API Guard Wrapper (`lib/auth-guards.ts`)**:
  - High-order helper function `withRole(role: Role)` that extracts the server session and verifies authorization at the request level, returning a 403 Forbidden on failure.

## 4. File Storage Utility (`lib/storage.ts`)
- **Interface**:
  - `uploadFile(file: File | Buffer, folder: string, filename: string): Promise<string>`
  - `deleteFile(url: string): Promise<void>`
- **Environment Variables**:
  - `STORAGE_PROVIDER`: `local` | `s3` | `r2`
  - For `local`: saves directly to `/public/uploads/` relative directories.
  - For `s3` / `r2`: initializes `S3Client` from `@aws-sdk/client-s3` using credentials:
    - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_BUCKET_NAME`, `AWS_CDN_URL` (optional).
- **Naming Policy**: Uses UUID v4 for the filename (e.g. `{uuid}.{ext}`).

## 5. PostgreSQL-Backed Rate Limiting
- **Schema Table**: `RateLimitLog`
  - `id`: String (uuid)
  - `identifier`: String (IP address hash or user email)
  - `route`: String (e.g., `/api/auth/login`)
  - `request_count`: Int
  - `window_start`: DateTime
- **Logic**:
  - Query existing log for the `identifier` and `route` where `window_start` is within the threshold (e.g., last 15 minutes).
  - If no record exists, create one with count 1 and current timestamp.
  - If record exists and count is below limit, increment count.
  - If count exceeds limit, throw 429 Too Many Requests.
  - A background prune task runs inline to delete logs older than their window.
