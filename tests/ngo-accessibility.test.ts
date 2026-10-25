import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static guards for the NGO accessibility/mobile pass (roadmap row 13). Vitest
 * has no browser, so these pin the specific fixes that would silently regress:
 * each one was a real failure on a phone or with a screen reader.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("navigation on a phone", () => {
  const nav = src("app/components/Navbar.tsx");

  it("has a small-screen menu button with an accessible name and expanded state", () => {
    expect(nav).toMatch(/aria-controls="mobile-nav"/);
    expect(nav).toMatch(/aria-expanded=\{menuOpen\}/);
    expect(nav).toMatch(/aria-label=\{menuOpen \? "Close menu" : "Open menu"\}/);
  });

  it("the small-screen menu lists the Field App for NGOs (field staff work from phones)", () => {
    expect(nav).toMatch(/\{ href: "\/ngo\/field", label: "Field App"/);
    expect(nav).toMatch(/role === "NGO"\s*\?\s*\[[^\]]*\.\.\.NGO_LINKS\]/);
  });

  it("NGO links never render inline: twelve links overflow the capped header at any width (zoomed-out bug)", () => {
    expect(nav).toMatch(/const desktopNav = role === "NGO" \? "hidden" :/);
    expect(nav).toMatch(/role === "NGO" \? "" : "md:hidden"/);
  });

  it("the account button is named", () => {
    expect(nav).toMatch(/aria-label="Account menu"/);
  });
});

describe("field app", () => {
  const app = src("app/ngo/field/FieldApp.tsx");

  it("announces sync and connectivity changes", () => {
    expect(app.match(/role="status"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(app).toMatch(/role="alert"/);
  });

  it("does not create a blob URL during render (leaks one per keystroke)", () => {
    expect(app).not.toMatch(/src=\{URL\.createObjectURL/);
    expect(app).toMatch(/URL\.revokeObjectURL/);
  });

  it("keeps its header below the global sticky navbar", () => {
    expect(app).toMatch(/sticky top-16/);
  });
});

describe("forms announce their results", () => {
  it.each([
    ["app/ngo/impact/ImpactCockpitClient.tsx", /role="alert"/],
    ["app/ngo/projects/[id]/MatchingProfilePanel.tsx", /role="alert"/],
    ["app/ngo/projects/[id]/FieldTasksPanel.tsx", /role="alert"/],
    ["app/ngo/dashboard/SubmitProofModal.tsx", /role="dialog"/],
  ])("%s", (file, pattern) => {
    expect(src(file)).toMatch(pattern);
  });

  it("the proof modal never claims a proof was auto-approved (the API never does that)", () => {
    expect(src("app/ngo/dashboard/SubmitProofModal.tsx")).not.toMatch(/Auto-Approved/);
  });
});
