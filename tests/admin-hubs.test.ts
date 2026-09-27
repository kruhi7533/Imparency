import { describe, it, expect } from "vitest";
import { ADMIN_HUBS, hubForPath } from "@/app/admin/components/hubs";

/**
 * The console's information architecture, pinned.
 *
 * These are cheap tests for a class of mistake that is otherwise invisible
 * until someone reports a page they cannot get to: a route quietly listed in
 * two hubs, or a hub whose top-level link points somewhere its own tabs do not
 * include. Neither breaks a build, and neither shows up in a screenshot.
 */

describe("admin hubs", () => {
  it("lists every route exactly once", () => {
    const hrefs = ADMIN_HUBS.flatMap((h) => h.tabs.map((t) => t.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("points each hub's top-level link at one of its own tabs", () => {
    for (const hub of ADMIN_HUBS) {
      if (hub.tabs.length === 0) continue;
      expect(hub.tabs.map((t) => t.href)).toContain(hub.href);
    }
  });

  it("resolves every tab back to the hub that owns it", () => {
    for (const hub of ADMIN_HUBS) {
      for (const tab of hub.tabs) {
        expect(hubForPath(tab.href)?.key).toBe(hub.key);
      }
    }
  });

  it("keeps a nested route inside its hub", () => {
    // Crisis was removed from the admin console entirely — it is not admin work.
    // The routes still exist and function for the public/NGO relief flow, but the
    // admin nav no longer claims them, so they belong to no hub.
    expect(hubForPath("/admin/crisis/abc-123")).toBeNull();
    expect(hubForPath("/admin/initiatives")).toBeNull();
    expect(hubForPath("/admin/donors/abc-123")?.key).toBe("people");
    // The funder-led track left the admin console the same way Crisis did.
    // Matching an NGO to a CSR requirement is the two of them talking, not an
    // admin decision — it moves to the CSR and NGO panels (docs/WEEK5-FLOW.md).
    // The routes still exist and still function, and Today and the audit trail
    // still deep-link into them, but the admin nav no longer claims them, so
    // they belong to no hub and render no tab bar.
    expect(hubForPath("/admin/opportunities")).toBeNull();
    expect(hubForPath("/admin/opportunities/opp-1/jobs/job-1")).toBeNull();
    expect(hubForPath("/admin/proposals/prop-1")).toBeNull();
  });

  it("puts an NGO detail view under the catalogue that lists it", () => {
    // This used to assert null. The reasoning was sound at the time: detail
    // views were arrived at from a queue, never navigated between, so giving
    // them someone else's tab bar was worse than giving them none.
    //
    // Adding /admin/ngos changed the premise. An organisation now HAS a parent
    // listing, so showing the People tab bar on its detail view is no longer
    // borrowing an unrelated hub's furniture — it is the way back to where the
    // user came from.
    expect(hubForPath("/admin/ngos/abc-123")?.key).toBe("people");
  });

  it("claims nothing for a path that belongs to no hub", () => {
    expect(hubForPath("/admin/nonexistent-page")).toBeNull();
    expect(hubForPath(null)).toBeNull();
  });
});
