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
    expect(hubForPath("/admin/crisis/abc-123")?.key).toBe("crisis");
    expect(hubForPath("/admin/donors/abc-123")?.key).toBe("people");
  });

  it("claims nothing for a page that belongs to no hub", () => {
    // Detail views are arrived at from a queue, not navigated between — giving
    // them someone else's tab bar would be worse than giving them none.
    expect(hubForPath("/admin/ngos/abc-123")).toBeNull();
    expect(hubForPath(null)).toBeNull();
  });
});
