import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";

/**
 * Admin sub-roles (Workstream E): ADMIN_FINANCE, ADMIN_AUDITOR, SUPPORT.
 *
 * The headline test EXECUTES every write handler under app/api/admin as an
 * auditor and asserts 403 before anything touches the database — the prisma
 * mock throws on any access, so a handler that wrote first and checked later
 * would fail here, not pass. New admin routes are picked up automatically.
 */

const H = vi.hoisted(() => {
  const dbTouched: string[] = [];
  const state: { requestLine: { method: string; path: string } | null } = { requestLine: null };
  const prismaProxy: any = new Proxy(
    {},
    {
      get(_t, model: string) {
        if (model === "then") return undefined;
        return new Proxy(
          {},
          {
            get(_t2, op: string) {
              return () => {
                dbTouched.push(`${model}.${op}`);
                throw new Error(`DB touched: ${model}.${op}`);
              };
            },
          }
        );
      },
    }
  );
  return { dbTouched, state, prismaProxy };
});
const dbTouched = H.dbTouched;
vi.mock("@/lib/prisma", () => ({ default: H.prismaProxy, prisma: H.prismaProxy }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("next-auth", async (orig) => ({ ...(await (orig as any)()), getServerSession: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: () => {
    const l = H.state.requestLine;
    return new Headers(l ? { "x-ib-method": l.method, "x-ib-path": l.path } : {});
  },
  cookies: () => ({ get: () => undefined }),
}));
vi.mock("@/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })),
  rateLimit: vi.fn(async () => ({ success: true })),
  isRateLimited: vi.fn(async () => false),
  clearRateLimit: vi.fn(),
}));
vi.mock("@/lib/admin-log", async (orig) => ({ ...(await (orig as any)()), logAdminAction: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { getServerSession as getServerSessionRoot } from "next-auth";
import { adminApiDecision, adminPageAllowed, adminHome, effectiveAdminRole, orgScopeOfPath } from "@/lib/admin-roles";
import { verifySessionRole } from "@/lib/auth-guards";

const session = getServerSession as any;
const sessionRoot = getServerSessionRoot as any;
const asAdmin = (adminRole: string | null) => {
  const s = { user: { id: "admin-1", role: "ADMIN", adminRole } };
  session.mockResolvedValue(s);
  sessionRoot.mockResolvedValue(s);
};

const ADMIN_API = path.resolve(__dirname, "../app/api/admin");
function findRoutes(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...findRoutes(path.join(dir, entry.name), rel));
    else if (entry.name === "route.ts") out.push(prefix);
  }
  return out;
}
const WRITE = ["POST", "PUT", "PATCH", "DELETE"] as const;
const adminRoutes = findRoutes(ADMIN_API).sort();
const writeHandlers = adminRoutes.flatMap((r) => {
  const src = readFileSync(path.join(ADMIN_API, r, "route.ts"), "utf8");
  return WRITE.filter((m) => new RegExp(`export\\s+async\\s+function\\s+${m}\\b`).test(src)).map((m) => ({ route: r, method: m }));
});
const toUrlPath = (r: string) => "/api/admin/" + r.replace(/\[(\.\.\.)?(\w+)\]/g, (_m, _d, n) => `x-${n}`);
const toParams = (r: string) =>
  Object.fromEntries(Array.from(r.matchAll(/\[(\.\.\.)?(\w+)\]/g)).map((m) => [m[2], m[1] ? [`x-${m[2]}`] : `x-${m[2]}`]));

beforeEach(() => {
  vi.clearAllMocks();
  dbTouched.length = 0;
  H.state.requestLine = null;
});

// ─── The pure policy ─────────────────────────────────────────────────────────

describe("adminApiDecision — the single policy", () => {
  it("null / unknown adminRole is SUPER: every pre-existing admin keeps full access", () => {
    expect(effectiveAdminRole(null)).toBe("SUPER");
    expect(effectiveAdminRole("NONSENSE")).toBe("SUPER");
    expect(adminApiDecision(null, "POST", "/api/admin/verify-ngo").kind).toBe("allow");
  });

  it("AUDITOR: reads anywhere, audit export allowed, every write refused (incl. outside /api/admin)", () => {
    expect(adminApiDecision("AUDITOR", "GET", "/api/admin/risk/review").kind).toBe("allow");
    expect(adminApiDecision("AUDITOR", "GET", "/api/admin/audit/export").kind).toBe("allow");
    expect(adminApiDecision("AUDITOR", "POST", "/api/admin/audit/verify-export").kind).toBe("allow");
    expect(adminApiDecision("AUDITOR", "POST", "/api/admin/audit/checkpoint").kind).toBe("deny");
    expect(adminApiDecision("AUDITOR", "POST", "/api/admin/finance/reconcile").kind).toBe("deny");
    expect(adminApiDecision("AUDITOR", "POST", "/api/requirements/r1/admin-approve").kind).toBe("deny");
    expect(adminApiDecision("AUDITOR", "PATCH", "/api/admin/users/u2").kind).toBe("deny");
    expect(adminApiDecision("AUDITOR", "GET", "/api/admin/users").kind).toBe("allow");
    expect(adminApiDecision("AUDITOR", "POST", "/api/auth/signout").kind).toBe("allow");
  });

  it("FINANCE: reconciliation, exceptions, bank lines, allocations/payments — nothing else", () => {
    for (const p of ["/api/admin/finance/reconcile", "/api/admin/finance/exceptions/e1", "/api/admin/finance/bank-lines/b1/match", "/api/admin/allocations/a1/payments"]) {
      expect(adminApiDecision("FINANCE", "POST", p).kind, p).toBe("allow");
    }
    expect(adminApiDecision("FINANCE", "POST", "/api/admin/verify-ngo").kind).toBe("deny");
    expect(adminApiDecision("FINANCE", "GET", "/api/admin/audit/export").kind).toBe("deny");
    expect(adminApiDecision("FINANCE", "GET", "/api/admin/risk/review").kind).toBe("deny");
    expect(adminApiDecision("FINANCE", "PATCH", "/api/admin/users/u2").kind).toBe("deny");
  });

  it("SUPPORT: queues readable, org-scoped routes need a grant, no audit export, break-glass allowed", () => {
    expect(adminApiDecision("SUPPORT", "GET", "/api/admin/search").kind).toBe("allow");
    expect(adminApiDecision("SUPPORT", "POST", "/api/admin/verify-ngo").kind).toBe("deny");
    expect(adminApiDecision("SUPPORT", "GET", "/api/admin/audit/export").kind).toBe("deny");
    expect(adminApiDecision("SUPPORT", "POST", "/api/admin/break-glass").kind).toBe("allow");
    const d = adminApiDecision("SUPPORT", "POST", "/api/admin/ngos/ngo-9/nudge");
    expect(d).toEqual({ kind: "grant", org: { orgType: "NGO", orgId: "ngo-9" } });
    expect(adminApiDecision("SUPPORT", "GET", "/api/admin/donors/d-1/risk-insight")).toEqual({ kind: "grant", org: { orgType: "DONOR", orgId: "d-1" } });
  });

  it("an admin route nobody has heard of yet is still refused to every restricted role", () => {
    for (const r of ["FINANCE", "AUDITOR", "SUPPORT"]) {
      expect(adminApiDecision(r, "POST", "/api/admin/brand-new-thing").kind, r).toBe("deny");
    }
  });

  it("pages: finance sees only finance; support cannot open audit or the admin team; homes differ", () => {
    expect(adminPageAllowed("FINANCE", "/admin/finance")).toBe(true);
    expect(adminPageAllowed("FINANCE", "/admin/allocations")).toBe(true);
    expect(adminPageAllowed("FINANCE", "/admin/verification")).toBe(false);
    expect(adminPageAllowed("AUDITOR", "/admin/verification")).toBe(true);
    expect(adminPageAllowed("SUPPORT", "/admin/audit")).toBe(false);
    expect(adminPageAllowed("SUPPORT", "/admin/team")).toBe(false);
    expect(adminHome("FINANCE")).toBe("/admin/finance");
    expect(orgScopeOfPath("/admin/ngos/abc")).toEqual({ orgType: "NGO", orgId: "abc" });
  });
});

// ─── Enforcement, executed ───────────────────────────────────────────────────

describe("AUDITOR is refused by EVERY admin write handler (enumerated, executed)", () => {
  it("discovers the admin write handlers", () => {
    expect(writeHandlers.length).toBeGreaterThan(40);
  });

  it.each(writeHandlers.map((h) => [`${h.method} ${h.route}`, h] as const))("%s → 403", async (_label, h) => {
    asAdmin("AUDITOR");
    const urlPath = toUrlPath(h.route);
    // The audit "verify an uploaded export" POST is a read by policy.
    if (adminApiDecision("AUDITOR", h.method, urlPath).kind === "allow") return;
    H.state.requestLine = { method: h.method, path: urlPath };
    const mod = await import(/* @vite-ignore */ path.join(ADMIN_API, h.route, "route.ts"));
    const req = new Request(`http://localhost:3000${urlPath}`, {
      method: h.method,
      headers: { "Content-Type": "application/json", origin: "http://localhost:3000" },
      body: "{}",
    });
    const res: Response = await mod[h.method](req, { params: toParams(h.route) });
    expect(res.status).toBe(403);
    expect(dbTouched).toEqual([]);
  });
});

describe("contrast: the 403s above come from the sub-role gate, not from the handlers", () => {
  it("the same handler run as SUPER gets past the gate and reaches the database", async () => {
    asAdmin(null);
    H.state.requestLine = { method: "PATCH", path: "/api/admin/users/x-id" };
    const mod = await import("@/app/api/admin/users/[id]/route");
    const res = await mod.PATCH(
      new Request("http://localhost:3000/api/admin/users/x-id", { method: "PATCH", body: JSON.stringify({ adminRole: "AUDITOR" }) }),
      { params: { id: "x-id" } }
    );
    expect(res.status).not.toBe(403);
    expect(dbTouched.length).toBeGreaterThan(0);
  });
});

describe("verifySessionRole applies the sub-role gate", () => {
  it("SUPER (adminRole null) is untouched and never needs the request line", async () => {
    asAdmin(null);
    const r = await verifySessionRole("ADMIN" as any);
    expect(r.authorized).toBe(true);
  });

  it("FINANCE may reconcile but not verify an NGO", async () => {
    asAdmin("FINANCE");
    H.state.requestLine = { method: "POST", path: "/api/admin/finance/reconcile" };
    expect((await verifySessionRole("ADMIN" as any)).authorized).toBe(true);
    H.state.requestLine = { method: "POST", path: "/api/admin/verify-ngo" };
    const r = await verifySessionRole("ADMIN" as any);
    expect(r.authorized).toBe(false);
    expect(r.response!.status).toBe(403);
  });

  it("the gate applies even when the route asks for no role (bare verifySessionRole())", async () => {
    asAdmin("AUDITOR");
    H.state.requestLine = { method: "POST", path: "/api/requirements/r1/admin-approve" };
    const r = await verifySessionRole();
    expect(r.authorized).toBe(false);
  });

  it("fails CLOSED for a restricted admin when the request line is unknown", async () => {
    asAdmin("AUDITOR");
    H.state.requestLine = null;
    const r = await verifySessionRole("ADMIN" as any);
    expect(r.authorized).toBe(false);
  });

  it("non-admin roles are never affected", async () => {
    session.mockResolvedValue({ user: { id: "n1", role: "NGO", adminRole: "AUDITOR" } });
    expect((await verifySessionRole("NGO" as any)).authorized).toBe(true);
  });
});

describe("middleware stamps the request line it trusts (client values overwritten)", () => {
  const src = readFileSync(path.resolve(__dirname, "../middleware.ts"), "utf8");
  it("sets x-ib-method / x-ib-path from the real request", () => {
    expect(src).toMatch(/requestHeaders\.set\(METHOD_HEADER, req\.method\)/);
    expect(src).toMatch(/requestHeaders\.set\(PATH_HEADER, req\.nextUrl\.pathname\)/);
  });
  it("refuses restricted-admin API writes and redirects disallowed admin pages", () => {
    expect(src).toMatch(/adminApiDecision\(token\.adminRole/);
    expect(src).toMatch(/adminPageAllowed\(token\?\.adminRole, path\)/);
  });
});
