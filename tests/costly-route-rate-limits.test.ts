import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Routes whose abuse costs money or reaches other people — a model call, a
 * file upload, an email or notification — must be rate-limited. Pinned by file
 * so removing a limit fails the build. (Contract routes have their own guard:
 * tests/contract-rate-limits.test.ts.)
 */
const COSTLY: Record<string, string> = {
  "app/api/ai/generate-campaign-copy/route.ts": "model call",
  "app/api/ai/suggest-milestones/route.ts": "model call",
  "app/api/ngo/projects/[id]/toc-check/route.ts": "model call",
  "app/api/pitch/generate/route.ts": "model call",
  "app/api/requirements/[id]/rerun-extraction/route.ts": "model call",
  "app/api/requirements/upload/route.ts": "upload + model call",
  "app/api/ngo/register/route.ts": "upload + model call",
  "app/api/ngo/submit-proof/route.ts": "upload + model call",
  "app/api/ngo/outcome-claims/extract/route.ts": "model call",
  "app/api/field/evidence/route.ts": "upload",
  "app/api/ngo/projects/route.ts": "upload + notification",
  "app/api/ngo/projects/[id]/route.ts": "upload",
  "app/api/ngo/settings/route.ts": "upload",
  "app/api/crisis/[id]/campaigns/route.ts": "upload + notification",
  "app/api/ngo/[id]/inquiry/route.ts": "notification",
  "app/api/ngo/inquiries/[threadId]/reply/route.ts": "notification",
  "app/api/ngo/outcome-claims/[id]/route.ts": "notification",
  "app/api/donor/team/route.ts": "email",
  "app/api/donations/create-order/route.ts": "payment order",
  "app/api/auth/signup/route.ts": "account creation",
};

describe("costly routes are rate-limited", () => {
  it.each(Object.entries(COSTLY))("%s (%s)", (file) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    const writes = (src.match(/export async function (POST|PUT|PATCH|DELETE)\b/g) ?? []).length;
    expect((src.match(/checkRateLimit\(/g) ?? []).length).toBeGreaterThanOrEqual(Math.max(writes, 1));
  });
});
