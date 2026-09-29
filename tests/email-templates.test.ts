import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The template catalogue in lib/email.ts — the ~28 senders not already covered by
 * tests/email.test.ts, which owns the transport tiers and the highest-traffic
 * templates. Split into its own file to keep each readable; same mocks, same
 * rules, no mail leaves the process.
 *
 * These are not padding. Two classes of bug live in this half of the file:
 *
 *  1. Hand-rolled pluralisation. Every admin digest builds its subject as
 *     `${n} alert${n > 1 ? "s" : ""}`. That reads fine in review and ships
 *     "1 NGO applications" the first time a queue has exactly one item, so each
 *     digest is asserted at n=1 AND n>1.
 *
 *  2. Money formatting. Amounts are rendered with toLocaleString("en-IN"), so a
 *     lakh must group as 2,50,000 and not 250,000. Getting this wrong on a tax
 *     receipt is the kind of defect a donor notices before the team does.
 */

const sendMailMock = vi.hoisted(() => vi.fn());
const createTransportMock = vi.hoisted(() =>
  vi.fn((_config?: Record<string, any>) => ({ sendMail: sendMailMock }))
);
const resendSendMock = vi.hoisted(() => vi.fn());
const ResendCtor = vi.hoisted(() =>
  vi.fn(function (this: any) {
    this.emails = { send: resendSendMock };
  })
);

vi.mock("nodemailer", () => ({ default: { createTransport: createTransportMock } }));
vi.mock("resend", () => ({ Resend: ResendCtor }));

const ENV_KEYS = [
  "GMAIL_APP_PASSWORD",
  "GMAIL_USER",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "NEXTAUTH_URL",
] as const;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const k of ENV_KEYS) delete process.env[k];
  sendMailMock.mockResolvedValue({ messageId: "smtp-1" });
  resendSendMock.mockResolvedValue({ id: "resend-1" });
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

/** Loads the module fresh with Gmail as the active transport. */
async function loadGmail() {
  process.env.GMAIL_APP_PASSWORD = "app-pass";
  process.env.GMAIL_USER = "noreply@impactbridge.org";
  return import("@/lib/email");
}

/** The single sendMail payload. */
function smtpPayload() {
  expect(sendMailMock).toHaveBeenCalledTimes(1);
  return sendMailMock.mock.calls[0][0];
}

/** Subject and text together, for assertions that do not care which carries it. */
function whole() {
  const m = smtpPayload();
  return `${m.subject}\n${m.text}`;
}

describe("admin digests — singular/plural subject branches", () => {
  it("says 1 application, not 1 applications", async () => {
    const { sendAdminPendingNGOsReminder } = await loadGmail();
    await sendAdminPendingNGOsReminder("admin@impactbridge.org", [
      { orgName: "Helping Hands", email: "a@ngo.org", daysPending: 7 },
    ]);

    const subject = smtpPayload().subject;
    expect(subject).toContain("1 NGO application");
    expect(subject).not.toContain("applications");
  });

  it("pluralises the pending-NGO digest for more than one", async () => {
    const { sendAdminPendingNGOsReminder } = await loadGmail();
    await sendAdminPendingNGOsReminder("admin@impactbridge.org", [
      { orgName: "Helping Hands", email: "a@ngo.org", daysPending: 7 },
      { orgName: "Second Trust", email: "b@ngo.org", daysPending: 9 },
    ]);

    const msg = smtpPayload();
    expect(msg.subject).toContain("2 NGO applications");
    expect(msg.text).toContain("Helping Hands");
    expect(msg.text).toContain("Second Trust");
    expect(msg.text).toContain("pending for 9 days");
  });

  it("lists each unreviewed proof with how long it has waited", async () => {
    const { sendAdminUnreviewedProofsReminder } = await loadGmail();
    await sendAdminUnreviewedProofsReminder("admin@impactbridge.org", [
      { milestoneTitle: "Phase 1", orgName: "Helping Hands", daysWaiting: 4 },
    ]);

    const msg = smtpPayload();
    expect(msg.subject).toContain("1 milestone proof");
    expect(msg.subject).not.toContain("proofs");
    expect(msg.text).toContain("Phase 1");
    expect(msg.text).toContain("waiting 4 days");
  });

  it("pluralises the proof digest for more than one", async () => {
    const { sendAdminUnreviewedProofsReminder } = await loadGmail();
    await sendAdminUnreviewedProofsReminder("admin@impactbridge.org", [
      { milestoneTitle: "Phase 1", orgName: "Helping Hands", daysWaiting: 4 },
      { milestoneTitle: "Phase 2", orgName: "Helping Hands", daysWaiting: 6 },
    ]);

    expect(smtpPayload().subject).toContain("2 milestone proofs");
  });

  it("marks the fraud-alert digest urgent and humanises the alert type", async () => {
    const { sendAdminUnresolvedFraudAlertsReminder } = await loadGmail();
    await sendAdminUnresolvedFraudAlertsReminder("admin@impactbridge.org", [
      { type: "DUPLICATE_PAN_DETECTED", orgOrDonor: "Helping Hands", daysOpen: 9 },
    ]);

    const msg = smtpPayload();
    expect(msg.subject).toContain("[Urgent]");
    expect(msg.subject).toContain("1 fraud alert");
    expect(msg.subject).not.toContain("alerts");
    // Underscores become spaces so the digest reads as prose, not as an enum.
    expect(msg.text).toContain("DUPLICATE PAN DETECTED");
    expect(msg.text).not.toContain("DUPLICATE_PAN_DETECTED");
  });

  it("pluralises the fraud-alert digest for more than one", async () => {
    const { sendAdminUnresolvedFraudAlertsReminder } = await loadGmail();
    await sendAdminUnresolvedFraudAlertsReminder("admin@impactbridge.org", [
      { type: "A_B", orgOrDonor: "One", daysOpen: 8 },
      { type: "C_D", orgOrDonor: "Two", daysOpen: 12 },
    ]);

    expect(smtpPayload().subject).toContain("2 fraud alerts");
  });

  it("distinguishes an expired FCRA certificate from one merely expiring", async () => {
    const { sendAdminFcraExpiryDigest } = await loadGmail();
    await sendAdminFcraExpiryDigest("admin@impactbridge.org", [
      { orgName: "Helping Hands", status: "EXPIRING_SOON", daysLeft: 12 },
      { orgName: "Second Trust", status: "EXPIRED", daysLeft: 0 },
    ]);

    const text = smtpPayload().text;
    expect(text).toContain("12 days left");
    // daysLeft <= 0 must read "expired", never "0 days left".
    expect(text).toContain("expired");
    expect(text).not.toContain("0 days left");
    expect(text).toContain("EXPIRING SOON");
  });

  it("treats a negative daysLeft as expired too", async () => {
    const { sendAdminFcraExpiryDigest } = await loadGmail();
    await sendAdminFcraExpiryDigest("admin@impactbridge.org", [
      { orgName: "Helping Hands", status: "EXPIRED", daysLeft: -30 },
    ]);

    const text = smtpPayload().text;
    expect(text).toContain("expired");
    expect(text).not.toContain("-30");
  });

  it("pluralises the FCRA digest subject on count", async () => {
    const { sendAdminFcraExpiryDigest } = await loadGmail();
    await sendAdminFcraExpiryDigest("admin@impactbridge.org", [
      { orgName: "One", status: "EXPIRED", daysLeft: 0 },
      { orgName: "Two", status: "EXPIRED", daysLeft: 0 },
    ]);

    expect(smtpPayload().subject).toContain("2 certificates");
  });

  it("reports the quarterly FCRA figures it was given", async () => {
    const { sendAdminFcraQuarterlyReport } = await loadGmail();
    await sendAdminFcraQuarterlyReport("admin@impactbridge.org", {
      quarter: "Q2 FY2026-27",
      totalNgos: 42,
      activeCount: 30,
      expiringSoonCount: 5,
      expiredCount: 3,
      rejectedCount: 2,
      pendingCount: 2,
      reportId: "rep-99",
    });

    expect(whole()).toContain("Q2 FY2026-27");
    expect(smtpPayload().text).toContain("42");
    expect(smtpPayload().text).toContain("30");
  });
});

describe("NGO-facing reminders", () => {
  it("lists overdue milestones with their project and slippage", async () => {
    const { sendNGOOverdueMilestoneReminder } = await loadGmail();
    await sendNGOOverdueMilestoneReminder("ngo@example.org", "Helping Hands", [
      { title: "Phase 1", projectTitle: "Solar Learning Center", daysOverdue: 11 },
    ]);

    const text = smtpPayload().text;
    expect(text).toContain("Phase 1");
    expect(text).toContain("Solar Learning Center");
    expect(text).toContain("11");
  });

  it("lists outstanding document issues", async () => {
    const { sendNGODocumentReminderEmail } = await loadGmail();
    await sendNGODocumentReminderEmail("ngo@example.org", "Helping Hands", [
      "80G certificate missing",
    ]);

    expect(smtpPayload().text).toContain("80G certificate missing");
  });

  it("passes a reviewer's proof question through verbatim", async () => {
    const { sendProofQuestionEmail } = await loadGmail();
    await sendProofQuestionEmail(
      "ngo@example.org",
      "Helping Hands",
      "Phase 1",
      "Can you share the vendor invoice for the lamps?"
    );

    expect(smtpPayload().text).toContain("Can you share the vendor invoice for the lamps?");
  });

  it("states the reason when re-verification is required", async () => {
    const { sendReverificationRequiredEmail } = await loadGmail();
    await sendReverificationRequiredEmail("ngo@example.org", {
      orgName: "Helping Hands",
      ngoId: "ngo-1",
      reason: "Registration certificate expired",
      severity: "HIGH",
      dueAt: new Date("2026-10-15T00:00:00Z"),
    });

    expect(smtpPayload().text).toContain("Registration certificate expired");
  });

  it("lists every overdue re-verification case in the digest", async () => {
    const { sendReverificationOverdueEmail } = await loadGmail();
    await sendReverificationOverdueEmail("admin@impactbridge.org", [
      { orgName: "Helping Hands", reason: "Expired 12A", daysOverdue: 14 },
      { orgName: "Second Trust", reason: "Name mismatch", daysOverdue: 21 },
    ]);

    const text = smtpPayload().text;
    expect(text).toContain("Helping Hands");
    expect(text).toContain("Second Trust");
    expect(text).toContain("21");
  });
});

describe("donor-facing lifecycle templates", () => {
  it("sends a password reset carrying the one-time URL unaltered", async () => {
    const { sendPasswordResetEmail } = await loadGmail();
    const url = "https://impactbridge-omega.vercel.app/reset-password?token=abc123";
    await sendPasswordResetEmail("donor@example.com", "Asha", url);

    expect(smtpPayload().text).toContain(url);
  });

  it("sends an 80G tax receipt naming the financial year and receipt number", async () => {
    const { sendTaxReceiptEmail } = await loadGmail();
    await sendTaxReceiptEmail(
      "donor@example.com",
      "Asha",
      "Helping Hands",
      250000,
      "IB-2026-0100",
      "FY2026-27",
      "https://example.com/receipt.pdf"
    );

    const msg = smtpPayload();
    expect(msg.subject).toContain("FY2026-27");
    expect(msg.subject).toContain("Helping Hands");
    expect(msg.text).toContain("IB-2026-0100");
    // Indian grouping: 2,50,000 — not the 250,000 a default locale gives.
    expect(msg.text).toContain("2,50,000");
    expect(msg.text).not.toContain("250,000");
  });

  it("includes a retry link and the amount when a payment needs retrying", async () => {
    const { sendPaymentRetryEmail } = await loadGmail();
    await sendPaymentRetryEmail(
      "donor@example.com",
      "Asha",
      "Helping Hands",
      5000,
      "https://impactbridge-omega.vercel.app/donor/retry/tok-1"
    );

    const text = smtpPayload().text;
    expect(text).toContain("https://impactbridge-omega.vercel.app/donor/retry/tok-1");
    expect(text).toContain("5,000");
  });

  it("nudges for a PAN when a receipt cannot be issued without one", async () => {
    const { sendPanReceiptNudgeEmail } = await loadGmail();
    await sendPanReceiptNudgeEmail("donor@example.com", "Asha", "Helping Hands", 10000);

    const text = smtpPayload().text;
    expect(text).toContain("Helping Hands");
    expect(text).toContain("10,000");
  });

  it("alerts a follower about a new project with a link to it", async () => {
    const { sendNewProjectAlertEmail } = await loadGmail();
    await sendNewProjectAlertEmail(
      "donor@example.com",
      "Asha",
      "Helping Hands",
      "Solar Learning Center",
      "proj-1"
    );

    const text = smtpPayload().text;
    expect(text).toContain("Solar Learning Center");
    expect(text).toContain("proj-1");
  });

  it("sends a project impact update carrying the event body", async () => {
    const { sendImpactUpdateEmail } = await loadGmail();
    await sendImpactUpdateEmail(
      "donor@example.com",
      "Asha",
      "Solar Learning Center",
      "Lamps installed",
      "All forty lamps are now live."
    );

    expect(smtpPayload().text).toContain("All forty lamps are now live.");
  });

  it("describes the crisis in a crisis alert", async () => {
    const { sendCrisisAlertEmail } = await loadGmail();
    await sendCrisisAlertEmail("donor@example.com", "Asha", {
      title: "Assam Floods 2026",
      slug: "assam-floods-2026",
      disasterType: "FLOOD",
      severity: "SEVERE",
      affectedLocation: "Majuli, Assam",
      description: "Sustained flooding has displaced 12,000 families.",
      coverImage: "https://example.com/cover.jpg",
    });

    expect(whole()).toContain("Assam Floods 2026");
    expect(smtpPayload().text).toContain("Majuli, Assam");
  });

  it("congratulates a donor on a tier upgrade with a call to action", async () => {
    const { sendTierUpgradeEmail } = await loadGmail();
    await sendTierUpgradeEmail("donor@example.com", "Asha", 12, "https://example.com/portfolio");

    const text = smtpPayload().text;
    expect(text).toContain("12");
    expect(text).toContain("https://example.com/portfolio");
  });

  it("invites a donor to volunteer for a specific NGO", async () => {
    const { sendVolunteerEmail } = await loadGmail();
    await sendVolunteerEmail("donor@example.com", "Asha", "Helping Hands", "https://example.com/v");

    expect(smtpPayload().text).toContain("Helping Hands");
  });

  it("suggests a referred NGO alongside the one already supported", async () => {
    const { sendNGOReferralEmail } = await loadGmail();
    await sendNGOReferralEmail(
      "donor@example.com",
      "Asha",
      "Helping Hands",
      "Second Trust",
      "ngo-2",
      "https://example.com/ngo/ngo-2"
    );

    const text = smtpPayload().text;
    expect(text).toContain("Helping Hands");
    expect(text).toContain("Second Trust");
  });

  it("reports total giving in a grant-mode invitation, in lakh grouping", async () => {
    const { sendGrantModeEmail } = await loadGmail();
    await sendGrantModeEmail(
      "donor@example.com",
      "Asha",
      "Helping Hands",
      500000,
      "https://x.test/g"
    );

    expect(smtpPayload().text).toContain("5,00,000");
  });
});

describe("inquiry threads", () => {
  it("forwards a donor inquiry to the NGO with the question intact", async () => {
    const { sendAdminInquiryEmail } = await loadGmail();
    await sendAdminInquiryEmail(
      "ngo@example.org",
      "Helping Hands",
      "Budget breakdown",
      "How much of this goes to salaries?"
    );

    expect(smtpPayload().text).toContain("How much of this goes to salaries?");
    expect(whole()).toContain("Budget breakdown");
  });

  it("acknowledges to the donor that their inquiry was received", async () => {
    const { sendDonorInquiryReceivedEmail } = await loadGmail();
    await sendDonorInquiryReceivedEmail(
      "donor@example.com",
      "Asha",
      "Helping Hands",
      "How much goes to salaries?"
    );

    expect(smtpPayload().text).toContain("Helping Hands");
  });

  it("tells the donor when the NGO has replied", async () => {
    const { sendNGOReplyReceivedEmail } = await loadGmail();
    await sendNGOReplyReceivedEmail(
      "donor@example.com",
      "Asha",
      "Helping Hands",
      "About 8% goes to salaries."
    );

    expect(smtpPayload().text).toContain("About 8% goes to salaries.");
  });

  it("notifies an admin of an NGO reply with a preview and the thread subject", async () => {
    const { sendAdminNgoReplyEmail } = await loadGmail();
    await sendAdminNgoReplyEmail(
      "admin@impactbridge.org",
      "Helping Hands",
      "Budget breakdown",
      "INQUIRY",
      "About 8% goes to salaries."
    );

    expect(smtpPayload().text).toContain("About 8% goes to salaries.");
    expect(whole()).toContain("Budget breakdown");
  });
});

describe("team invites and initiatives", () => {
  it("names the org and the role in a team invite", async () => {
    const { sendTeamInviteEmail } = await loadGmail();
    await sendTeamInviteEmail({
      to: "newmember@example.org",
      recipientName: "Ravi",
      ngoName: "Helping Hands",
      role: "FINANCE",
      dashboardUrl: "https://impactbridge-omega.vercel.app/ngo/dashboard",
    });

    const msg = smtpPayload();
    expect(msg.to).toBe("newmember@example.org");
    expect(msg.text).toContain("Helping Hands");
    expect(msg.text).toContain("FINANCE");
    expect(msg.text).toContain("https://impactbridge-omega.vercel.app/ngo/dashboard");
  });

  it("confirms a verified initiative to its submitter", async () => {
    const { sendInitiativeVerifiedEmail } = await loadGmail();
    await sendInitiativeVerifiedEmail("submitter@example.com", "Asha", "Helping Hands");

    expect(smtpPayload().text).toContain("Helping Hands");
  });

  it("carries the reason when an initiative is rejected", async () => {
    const { sendInitiativeRejectedEmail } = await loadGmail();
    await sendInitiativeRejectedEmail(
      "submitter@example.com",
      "Asha",
      "Helping Hands",
      "Could not confirm the organiser"
    );

    expect(smtpPayload().text).toContain("Could not confirm the organiser");
  });
});
