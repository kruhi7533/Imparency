// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * Component-level coverage for the "View case" navigation added to
 * RiskComplianceClient — the part lib/risk-compliance-view.ts's tests cannot
 * reach, because it lives in refs, scrollIntoView, and a mount effect rather
 * than in a pure function.
 *
 * This is the first component test in the repo (existing tests are all
 * Node-environment, Prisma-mocked route/lib tests). Scoped to this one file
 * via the `@vitest-environment jsdom` docblock above rather than changing
 * vitest.config.ts's global environment, so the other 28 test files keep
 * running under "node" exactly as before.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// jsdom has no real layout engine, so scrollIntoView does not exist on
// HTMLElement by default — without this, mounting a component that calls it
// throws "scrollIntoView is not a function" before the test gets anywhere.
Element.prototype.scrollIntoView = vi.fn();

import RiskComplianceClient from "@/app/admin/risk-compliance/RiskComplianceClient";

const OPEN_REVIEW = {
  id: "review_1",
  ngoId: "ngo_1",
  ngo: { orgName: "Asha Rural Development Trust" },
  riskLevel: "HIGH",
  status: "OPEN",
  findings: { reason: "name_mismatch" },
  reviewNote: null,
  createdAt: new Date("2026-08-01").toISOString(),
  resolvedAt: null,
};

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    initialFraudAlerts: [],
    initialDocErrors: [],
    initialResolved: [],
    initialRiskReviews: [OPEN_REVIEW],
    complianceSummaries: [],
    initialInvestigations: [],
    investigationStatusByAlertId: {},
    initialHighlightReviewId: null,
    ...overrides,
  };
}

describe("RiskComplianceClient — case navigation", () => {
  beforeEach(() => vi.clearAllMocks());
  // Not automatic under vitest without `globals: true` — without this, each
  // render() in this file stacks on the last one in the same jsdom document,
  // and "Found multiple elements with text: X" starts failing every test
  // after the first for a reason that has nothing to do with the component.
  afterEach(cleanup);

  it("arriving with ?case=<existing id> switches to Cases and highlights that card", async () => {
    const props1 = baseProps({ initialHighlightReviewId: "review_1" }) as any;
    render(<RiskComplianceClient {...props1} />);

    // The Cases tab is not the default — this proves the mount effect actually
    // switched tabs rather than the review just happening to be visible.
    await waitFor(() => {
      expect(screen.getByText("Asha Rural Development Trust")).toBeInTheDocument();
    });

    const card = screen.getByText("Asha Rural Development Trust").closest("div.rounded-2xl");
    expect(card).toHaveClass("ring-2");
    expect(screen.queryByTestId("missing-case-banner")).not.toBeInTheDocument();
  });

  it("arriving with ?case=<id not in the list> shows the stale-case banner instead of doing nothing silently", async () => {
    const props2 = baseProps({ initialHighlightReviewId: "review_resolved_already" }) as any;
    render(<RiskComplianceClient {...props2} />);

    await waitFor(() => {
      expect(screen.getByTestId("missing-case-banner")).toBeInTheDocument();
    });
    expect(screen.getByText(/no longer open/i)).toBeInTheDocument();
    // Still lands on Cases — the tab switch itself does not depend on the
    // target existing, only the scroll/highlight does.
    expect(screen.getByText("Asha Rural Development Trust")).toBeInTheDocument();
  });

  it("with no ?case= at all, stays on Alerts and shows neither highlight nor banner", () => {
    const props3 = baseProps() as any;
    render(<RiskComplianceClient {...props3} />);

    expect(screen.queryByTestId("missing-case-banner")).not.toBeInTheDocument();
    // "No active fraud alerts" is the Alerts-tab empty state — proves the
    // component did not jump to Cases when there was nothing to navigate to.
    expect(screen.getByText("No active fraud alerts")).toBeInTheDocument();
  });

  it('the "View case" link on an alert with a linked review switches tabs on click', async () => {
    const props4 = baseProps({
      initialFraudAlerts: [
        {
          id: "alert_1",
          type: "NEW_NGO_RAPID_FUNDING",
          entityId: "ngo_1",
          entityType: "NGO",
          description: "Rapid funding after launch.",
          severity: "HIGH",
          alertCategory: "FRAUD",
          subType: null,
          resolved: false,
          resolutionNote: null,
          createdAt: new Date("2026-08-01").toISOString(),
        },
      ],
      investigationStatusByAlertId: {
        alert_1: { status: "COMPLETED", riskLevel: "HIGH", summary: "Investigated, flagged.", riskReviewId: "review_1" },
      },
    }) as any;
    render(<RiskComplianceClient {...props4} />);

    const link = await screen.findByText("View case →");
    fireEvent.click(link);

    await waitFor(() => {
      expect(screen.getByText("Asha Rural Development Trust")).toBeInTheDocument();
    });
  });
});
