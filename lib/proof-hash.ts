import { createHash } from "node:crypto";

/**
 * Hashing the BYTES of an uploaded evidence file. Server-only, deliberately
 * separate from lib/proof-fingerprint.ts.
 *
 * Why its own module: proof-fingerprint.ts holds the pure verdict table, and
 * two of its exports (`duplicateLabel`, the verdict types) are needed by
 * reviewer UI that runs in the browser — `app/admin/proof-review/
 * ProofReviewClient.tsx` is a "use client" component. A single `node:crypto`
 * import at the top of that module put a Node builtin into the client bundle,
 * and webpack does not polyfill the `node:` scheme: the whole page failed to
 * build with `UnhandledSchemeError` and /admin/proof-review returned 500.
 *
 * Unit tests did not catch it because vitest resolves `node:crypto` happily —
 * only the client bundler objects. So the boundary is kept physical rather
 * than remembered: anything needing a Node builtin lives here, and
 * proof-fingerprint.ts stays importable from either side of the wire.
 * tests/client-bundle-safety.test.ts fails the build if that drifts back.
 */

/** SHA-256 of a file's bytes, hex-encoded. */
export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
