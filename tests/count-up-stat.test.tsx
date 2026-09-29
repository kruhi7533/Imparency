// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * CountUpStat paints the four headline trust numbers on the landing page — the
 * figures a first-time donor uses to decide whether this platform is real.
 * It had no coverage, and a live check of the deployed build on 2026-09-27
 * turned up a real gap in it (documented at the bottom of this file).
 *
 * The component is driven by `useInView` + a framer-motion spring, so the
 * behaviour under test depends entirely on whether an intersection is ever
 * reported. jsdom ships no IntersectionObserver at all, so one is installed
 * here — and each suite below controls whether it reports the element as
 * intersecting, because that is precisely the axis the bug lives on.
 */

/** Installs an IntersectionObserver that reports `intersecting` on observe. */
function installIntersectionObserver(intersecting: boolean) {
  const instances: any[] = [];
  class IO {
    cb: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb;
      instances.push(this);
    }
    observe(el: Element) {
      // Report synchronously-ish, the way a real observer does on first tick.
      this.cb(
        [{ target: el, isIntersecting: intersecting, intersectionRatio: intersecting ? 1 : 0 } as any],
        this as any
      );
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as any).IntersectionObserver = IO as any;
  (window as any).IntersectionObserver = IO as any;
  return instances;
}

/**
 * Imported statically, and deliberately so. An earlier draft did
 * `await import(...)` inside each test after `vi.resetModules()`, which charged
 * ~3s of module transform to the first test's 5s budget and timed it out — the
 * same trap that made tests/fraud-investigator-openai-loop.test.ts flaky.
 *
 * Resetting modules buys nothing here: framer-motion's useInView constructs its
 * IntersectionObserver inside an effect, reading the global at render time, so
 * swapping the global between tests is enough.
 */
import CountUpStat from "@/components/home/CountUpStat";
import { formatCompactINR } from "@/lib/format-currency";

/** Kept as a function call so each test reads like the async version it replaced. */
const load = () => CountUpStat;

afterEach(() => {
  cleanup();
  delete (globalThis as any).IntersectionObserver;
});

describe("CountUpStat — once the element is seen", () => {
  beforeEach(() => {
    installIntersectionObserver(true);
  });

  it("counts a plain number up to its real value", async () => {
    const Stat = load();
    const { container } = render(<Stat value={2} label="Verified NGOs" />);

    await waitFor(() => {
      expect(container.textContent).toContain("2");
    });
  });

  it("renders the label it was given", async () => {
    const Stat = load();
    const { container } = render(<Stat value={3} label="Active Campaigns" />);

    expect(container.textContent).toContain("Active Campaigns");
  });

  it("formats a rupee amount compactly rather than as raw digits", async () => {
    const Stat = load();
    const { container } = render(
      <Stat value={250000} label="Donated so far" format="compact-inr" accent />
    );

    await waitFor(() => {
      expect(container.textContent).toContain(formatCompactINR(250000));
    });
  });

  it("appends a suffix when one is supplied", async () => {
    const Stat = load();
    const { container } = render(<Stat value={87} label="Uptime" suffix="%" />);

    await waitFor(() => {
      expect(container.textContent).toContain("87%");
    });
  });
});

describe("CountUpStat — the zero case", () => {
  beforeEach(() => {
    installIntersectionObserver(true);
  });

  it("shows the empty label instead of a bare 0 when there is nothing to report", async () => {
    const Stat = load();
    const { container } = render(
      <Stat value={0} label="Milestones Verified" emptyLabel="No milestones cleared yet" />
    );

    expect(container.textContent).toContain("No milestones cleared yet");
  });

  it("falls back to printing 0 when a zero value has no empty label", async () => {
    const Stat = load();
    const { container } = render(<Stat value={0} label="Verified NGOs" />);

    expect(container.textContent).toContain("0");
  });

  it("prefers the real value over the empty label as soon as there is one", async () => {
    const Stat = load();
    const { container } = render(
      <Stat value={2} label="Verified NGOs" emptyLabel="Onboarding our first NGOs" />
    );

    await waitFor(() => {
      expect(container.textContent).toContain("2");
    });
    expect(container.textContent).not.toContain("Onboarding our first NGOs");
  });
});

/**
 * FINDING — the first paint, before any intersection is reported.
 *
 * The spring starts at 0 and is only set to the real value inside an effect
 * gated on `inView`, so the markup React produces BEFORE an intersection is
 * reported contains "0" regardless of the value passed in. On the deployed
 * build (https://impactbridge-omega.vercel.app, checked 2026-09-27) the
 * server-rendered HTML therefore paints
 *
 *     ₹0   ·   0   ·   0
 *
 * while the RSC payload in that very same response carries
 *
 *     {"value":3000,...,"label":"Donated so far"}
 *     {"value":2,"label":"Verified NGOs"}
 *     {"value":3,"label":"Active Campaigns"}
 *
 * A sighted visitor with JavaScript never notices — the count-up runs the
 * moment the strip scrolls into view. What does see the zeros is everything
 * that consumes the HTML without running rAF: crawlers, link-preview
 * unfurlers, no-JS visitors, and the pre-hydration paint.
 *
 * These two tests pin that gap rather than asserting it is fine. They pass
 * against today's component, so the suite stays green; if the initial render is
 * ever changed to emit the true value (the recommended fix), they will fail and
 * should be rewritten to assert the real number instead of `0`. That is
 * deliberate — the failure is the signal that the finding was addressed.
 */
describe("CountUpStat — pre-intersection paint (documents a known gap)", () => {
  beforeEach(() => {
    installIntersectionObserver(false);
  });

  it("paints 0 rather than the real number before the element is seen", async () => {
    const Stat = load();
    const { container } = render(<Stat value={2} label="Verified NGOs" />);

    const numeral = container.querySelector(".tabular-nums");
    expect(numeral?.textContent).toBe("0");
    expect(numeral?.textContent).not.toBe("2");
  });

  it("paints a zero rupee figure before the element is seen", async () => {
    const Stat = load();
    const { container } = render(
      <Stat value={3000} label="Donated so far" format="compact-inr" accent />
    );

    expect(container.querySelector(".tabular-nums")?.textContent).toBe("₹0");
  });
});
