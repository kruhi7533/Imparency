import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "fs";
import path from "path";

/**
 * What this test protects.
 *
 * A "use client" component and everything it imports is compiled for the
 * BROWSER. Webpack does not polyfill the `node:` scheme, so a single Node
 * builtin anywhere in that import closure does not degrade gracefully — the
 * page fails to build and the route serves a 500.
 *
 * This is not hypothetical. Week 7 shipped `duplicateLabel` in
 * lib/proof-fingerprint.ts, whose first line was `import { createHash } from
 * "node:crypto"`. ProofReviewClient.tsx ("use client") imported the label, so
 * /admin/proof-review returned 500 with:
 *
 *   Module build failed: UnhandledSchemeError: Reading from "node:crypto"
 *   is not handled by plugins
 *
 * The full 1668-test suite was green at the time, because vitest runs in Node
 * and resolves `node:crypto` perfectly happily. Only the client bundler
 * objects, so only a check that reasons about the client boundary can catch
 * it. The hashing moved to lib/proof-hash.ts; this keeps it moved.
 *
 * Scope: the closure is followed through `@/lib/...` imports, which is where
 * shared helpers live and where the mistake is made. Type-only imports are
 * ignored — `import type` is erased before bundling and costs nothing.
 */

const REPO_ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(REPO_ROOT, "app");

/** Node builtins, bare and `node:`-prefixed. Bundling any of these is the bug. */
const NODE_BUILTINS = [
  "assert", "buffer", "child_process", "cluster", "crypto", "dgram", "dns",
  "fs", "fs/promises", "http", "http2", "https", "inspector", "module", "net",
  "os", "path", "perf_hooks", "process", "querystring", "readline", "stream",
  "timers", "tls", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** True when the file opts into the client bundle. */
function isClientComponent(src: string): boolean {
  // The directive must be the first statement, so only the head matters.
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(src);
}

/**
 * Value imports only. `import type { X }` and `import { type X }` are erased
 * by the compiler and never reach the bundler, so flagging them would be a
 * false positive.
 */
function valueImportSources(src: string): string[] {
  const out: string[] = [];
  const re = /import\s+(?!type\s)([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const clause = m[1];
    // `import { type A, type B } from "x"` is entirely type-only.
    const named = clause.match(/^\s*\{([\s\S]*)\}\s*$/);
    if (named) {
      const specs = named[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (specs.length > 0 && specs.every((s) => s.startsWith("type "))) continue;
    }
    out.push(m[2]);
  }
  // Bare side-effect imports (`import "x"`) are value imports too.
  const bare = /import\s+["']([^"']+)["']/g;
  while ((m = bare.exec(src))) out.push(m[1]);
  return out;
}

/** Resolve a `@/lib/foo` specifier to a real file, or null. */
function resolveLibSpecifier(spec: string): string | null {
  const rel = spec.replace(/^@\//, "");
  for (const cand of [
    path.join(REPO_ROOT, `${rel}.ts`),
    path.join(REPO_ROOT, `${rel}.tsx`),
    path.join(REPO_ROOT, rel, "index.ts"),
    path.join(REPO_ROOT, rel, "index.tsx"),
  ]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

function offendingBuiltin(spec: string): string | null {
  if (spec.startsWith("node:")) return spec;
  return NODE_BUILTINS.includes(spec) ? spec : null;
}

/**
 * Every Node builtin reachable from `entry` through @/lib value imports,
 * reported as the chain that reaches it so the failure names the fix.
 */
function nodeBuiltinsReachableFrom(entry: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  const visit = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const spec of valueImportSources(src)) {
      const builtin = offendingBuiltin(spec);
      if (builtin) {
        const shown = [...chain, path.relative(REPO_ROOT, file)].join(" -> ");
        problems.push(`${shown} imports "${builtin}"`);
        continue;
      }
      if (spec.startsWith("@/lib/")) {
        const next = resolveLibSpecifier(spec);
        if (next) visit(next, [...chain, path.relative(REPO_ROOT, file)]);
      }
    }
  };

  visit(entry, []);
  return problems;
}

describe("client bundle safety", () => {
  const clientComponents = walk(APP_DIR).filter((f) =>
    isClientComponent(readFileSync(f, "utf8"))
  );

  it("finds the client components to check", () => {
    // Guards the detector itself: if the directive regex ever stops matching,
    // this suite would vacuously pass and protect nothing.
    expect(clientComponents.length).toBeGreaterThan(20);
  });

  it("no \"use client\" component pulls a Node builtin into the browser bundle", () => {
    const failures: string[] = [];
    for (const file of clientComponents) {
      failures.push(...nodeBuiltinsReachableFrom(file));
    }
    expect(failures.sort()).toEqual([]);
  });

  it("lib/proof-fingerprint.ts stays client-safe (it is imported by ProofReviewClient)", () => {
    // The specific regression, pinned by name: this module holds both the
    // verdict table and duplicateLabel, so it is bundled for the browser.
    const file = path.join(REPO_ROOT, "lib/proof-fingerprint.ts");
    expect(nodeBuiltinsReachableFrom(file)).toEqual([]);
  });
});
