import { describe, it, expect } from "vitest";
import { auditFilterQuery, buildAuditWhere, readAuditFilters } from "@/lib/audit-filters";

/**
 * What these tests protect.
 *
 * The audit trail page and its CSV export must filter identically — an export
 * that quietly returns a different set than the table it came from is worse
 * than no export, because an auditor has no way to notice. These tests pin the
 * one function both call.
 */

describe("readAuditFilters", () => {
  it("treats missing and blank filters the same", () => {
    expect(readAuditFilters({})).toEqual({ action: "", entityType: "", actor: "", from: "", to: "" });
    expect(readAuditFilters({ action: "   ", actor: "  " })).toMatchObject({ action: "", actor: "" });
  });

  it("trims surrounding whitespace rather than searching for it", () => {
    expect(readAuditFilters({ action: "  REJECTED " }).action).toBe("REJECTED");
    expect(readAuditFilters({ actor: " ada@example.org " }).actor).toBe("ada@example.org");
  });
});

describe("buildAuditWhere", () => {
  it("returns an empty filter when nothing is asked for", () => {
    expect(buildAuditWhere({})).toEqual({});
  });

  it("matches an action case-insensitively by substring", () => {
    expect(buildAuditWhere({ action: "reject" })).toEqual({
      action: { contains: "reject", mode: "insensitive" },
    });
  });

  it("matches an entity type exactly", () => {
    // Substring matching here would make "NGO" also match "NGO_DOCUMENT".
    expect(buildAuditWhere({ entityType: "OPPORTUNITY" })).toEqual({ entityType: "OPPORTUNITY" });
  });

  it("searches an actor across both name and email", () => {
    expect(buildAuditWhere({ actor: "ada" })).toEqual({
      admin: {
        OR: [
          { name: { contains: "ada", mode: "insensitive" } },
          { email: { contains: "ada", mode: "insensitive" } },
        ],
      },
    });
  });

  it("treats `to` as the end of that day, not its midnight", () => {
    // Otherwise "to today" excludes everything logged today.
    const where = buildAuditWhere({ to: "2026-09-18" });
    expect(where.createdAt.lte).toEqual(new Date("2026-09-18T23:59:59.999Z"));
    expect(where.createdAt.gte).toBeUndefined();
  });

  it("supports an open-ended `from`", () => {
    const where = buildAuditWhere({ from: "2026-09-01" });
    expect(where.createdAt.gte).toEqual(new Date("2026-09-01"));
    expect(where.createdAt.lte).toBeUndefined();
  });

  it("combines every filter at once", () => {
    const where = buildAuditWhere({
      action: "APPROVED",
      entityType: "NGO",
      actor: "ada",
      from: "2026-09-01",
      to: "2026-09-18",
    });
    expect(where.action).toEqual({ contains: "APPROVED", mode: "insensitive" });
    expect(where.entityType).toBe("NGO");
    expect(where.admin.OR).toHaveLength(2);
    expect(where.createdAt.gte).toEqual(new Date("2026-09-01"));
    expect(where.createdAt.lte).toEqual(new Date("2026-09-18T23:59:59.999Z"));
  });
});

describe("auditFilterQuery", () => {
  it("carries only the filters that are set", () => {
    expect(auditFilterQuery({ action: "APPROVED", to: "2026-09-18" }).toString()).toBe(
      "action=APPROVED&to=2026-09-18"
    );
  });

  it("omits blank filters so links stay clean", () => {
    expect(auditFilterQuery({ action: "  ", entityType: "" }).toString()).toBe("");
  });
});
