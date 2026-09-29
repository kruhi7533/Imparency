import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * lib/email.ts is the single outbound-mail surface for the whole platform —
 * 30-odd templates over one three-tier transport (Gmail SMTP, then Resend, then
 * a console mock). It was the largest zero-coverage file in the repo at 188
 * lines, and it is the kind of file where a mistake is invisible in code review
 * and very visible in an NGO's inbox.
 *
 * Two things are worth pinning above the template text:
 *
 *  1. Transport SELECTION happens at module load from env vars, so the choice
 *     is baked in at import time — which means a deploy that sets both keys
 *     silently uses only Gmail. That is tested explicitly rather than assumed.
 *
 *  2. A Gmail failure does NOT fall through to Resend. The code returns the
 *     failure. That is a real behaviour with real consequences (a flaky SMTP
 *     connection drops the mail entirely rather than retrying on the other
 *     provider), so it is pinned as-is here; if it is ever changed to cascade,
 *     this test should fail and be updated deliberately.
 *
 * No mail leaves the process: nodemailer and resend are both module-mocked.
 */

const sendMailMock = vi.hoisted(() => vi.fn());
// The `_config` parameter is declared so the transport-options assertions can
// read mock.calls[0][0]; without it the call tuple is typed as empty.
const createTransportMock = vi.hoisted(() =>
  vi.fn((_config?: Record<string, any>) => ({ sendMail: sendMailMock }))
);
const resendSendMock = vi.hoisted(() => vi.fn());
// `new Resend(...)` — must be constructible, so a plain function (not an arrow).
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

/** Imports the module fresh, after env is arranged, so transport choice is rebuilt. */
async function load() {
  return import("@/lib/email");
}

/** Loads with Gmail configured as the active transport. */
async function loadGmail() {
  process.env.GMAIL_APP_PASSWORD = "app-pass";
  process.env.GMAIL_USER = "noreply@impactbridge.org";
  return load();
}

/** Loads with only Resend configured. */
async function loadResend() {
  process.env.RESEND_API_KEY = "re_test";
  return load();
}

/** The single sendMail payload, for Gmail-transport assertions. */
function smtpPayload() {
  expect(sendMailMock).toHaveBeenCalledTimes(1);
  return sendMailMock.mock.calls[0][0];
}

/** The single Resend payload. */
function resendPayload() {
  expect(resendSendMock).toHaveBeenCalledTimes(1);
  return resendSendMock.mock.calls[0][0];
}

describe("transport selection", () => {
  it("uses Gmail SMTP when an app password is configured", async () => {
    const { sendNGOApprovalEmail } = await loadGmail();
    const result = await sendNGOApprovalEmail("ngo@example.org", "Helping Hands");

    expect(result.success).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("builds the Gmail transport with explicit timeouts, not nodemailer's multi-minute defaults", async () => {
    await loadGmail();

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    const cfg = createTransportMock.mock.calls[0][0] as any;
    expect(cfg.service).toBe("gmail");
    expect(cfg.connectionTimeout).toBe(10_000);
    expect(cfg.greetingTimeout).toBe(10_000);
    expect(cfg.socketTimeout).toBe(15_000);
  });

  it("does not construct a Gmail transport at all when no app password is set", async () => {
    await loadResend();
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("falls back to Resend when only a Resend key is configured", async () => {
    const { sendNGOApprovalEmail } = await loadResend();
    const result = await sendNGOApprovalEmail("ngo@example.org", "Helping Hands");

    expect(result.success).toBe(true);
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("prefers Gmail over Resend when both are configured", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const { sendNGOApprovalEmail } = await loadGmail();
    await sendNGOApprovalEmail("ngo@example.org", "Helping Hands");

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("reports success in mock mode with no transport configured, and sends nothing", async () => {
    const { sendNGOApprovalEmail } = await load();
    const result = await sendNGOApprovalEmail("ngo@example.org", "Helping Hands");

    expect(result).toEqual({ success: true, mock: true });
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});

describe("transport failure handling", () => {
  it("returns a failure result rather than throwing when Gmail rejects", async () => {
    sendMailMock.mockRejectedValue(new Error("535 auth failed"));
    const { sendNGOApprovalEmail } = await loadGmail();

    const result = await sendNGOApprovalEmail("ngo@example.org", "Helping Hands");
    expect(result.success).toBe(false);
    expect(result.error).toBe("535 auth failed");
  });

  it("does NOT cascade to Resend after a Gmail failure — the mail is dropped", async () => {
    // Pinning current behaviour, not endorsing it: with both providers
    // configured a transient SMTP fault loses the message outright.
    process.env.RESEND_API_KEY = "re_test";
    sendMailMock.mockRejectedValue(new Error("ETIMEDOUT"));
    const { sendNGOApprovalEmail } = await loadGmail();

    const result = await sendNGOApprovalEmail("ngo@example.org", "Helping Hands");
    expect(result.success).toBe(false);
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("returns a failure result rather than throwing when Resend rejects", async () => {
    resendSendMock.mockRejectedValue(new Error("domain not verified"));
    const { sendNGOApprovalEmail } = await loadResend();

    const result = await sendNGOApprovalEmail("ngo@example.org", "Helping Hands");
    expect(result.success).toBe(false);
    expect(result.error).toBe("domain not verified");
  });
});

describe("message construction", () => {
  it("sends both a plain-text and an HTML part, with newlines converted for HTML", async () => {
    const { sendNGOApprovalEmail } = await loadGmail();
    await sendNGOApprovalEmail("ngo@example.org", "Helping Hands");

    const msg = smtpPayload();
    expect(msg.text).toContain("\n");
    expect(msg.html).toContain("<br/>");
    // The HTML part is the text part with breaks substituted — no stray newlines.
    expect(msg.html).not.toContain("\n");
  });

  it("forces the Gmail envelope sender to the authenticated account", async () => {
    // Gmail rejects a From it does not own, so the address must be GMAIL_USER
    // even when a caller supplies a different display name.
    const { sendNGOApprovalEmail } = await loadGmail();
    await sendNGOApprovalEmail("ngo@example.org", "Helping Hands");

    expect(smtpPayload().from).toBe("ImpactBridge <noreply@impactbridge.org>");
  });

  it("uses the configured Resend sender when one is set", async () => {
    process.env.RESEND_FROM_EMAIL = "ImpactBridge <hello@impactbridge.org>";
    const { sendNGOApprovalEmail } = await loadResend();
    await sendNGOApprovalEmail("ngo@example.org", "Helping Hands");

    expect(resendPayload().from).toBe("ImpactBridge <hello@impactbridge.org>");
  });

  it("falls back to the Resend sandbox sender when none is configured", async () => {
    const { sendNGOApprovalEmail } = await loadResend();
    await sendNGOApprovalEmail("ngo@example.org", "Helping Hands");

    expect(resendPayload().from).toBe("ImpactBridge <onboarding@resend.dev>");
  });

  it("addresses the recipient it was given", async () => {
    const { sendNGOApprovalEmail } = await loadGmail();
    await sendNGOApprovalEmail("someone@ngo.org", "Helping Hands");

    expect(smtpPayload().to).toBe("someone@ngo.org");
  });

  it("omits attachments entirely rather than sending an empty array", async () => {
    const { sendNGOApprovalEmail } = await loadGmail();
    await sendNGOApprovalEmail("ngo@example.org", "Helping Hands");

    expect(smtpPayload().attachments).toBeUndefined();
  });
});

describe("links in outbound mail", () => {
  it("builds dashboard links from NEXTAUTH_URL when it is configured", async () => {
    process.env.NEXTAUTH_URL = "https://impactbridge-omega.vercel.app";
    const { sendNGOApprovalEmail } = await loadGmail();
    await sendNGOApprovalEmail("ngo@example.org", "Helping Hands");

    expect(smtpPayload().text).toContain(
      "https://impactbridge-omega.vercel.app/ngo/dashboard"
    );
  });

  it("falls back to localhost when NEXTAUTH_URL is unset", async () => {
    const { sendNGOApprovalEmail } = await loadGmail();
    await sendNGOApprovalEmail("ngo@example.org", "Helping Hands");

    expect(smtpPayload().text).toContain("http://localhost:3000/ngo/dashboard");
  });
});

describe("NGO lifecycle templates", () => {
  it("names the organisation in the approval subject", async () => {
    const { sendNGOApprovalEmail } = await loadGmail();
    await sendNGOApprovalEmail("ngo@example.org", "Helping Hands");

    expect(smtpPayload().subject).toContain("Helping Hands");
  });

  it("lists every document issue as its own bullet", async () => {
    const { sendNGODocumentIssueEmail } = await loadGmail();
    await sendNGODocumentIssueEmail("ngo@example.org", "Helping Hands", [
      "PAN number could not be read",
      "Registration certificate is not legible",
    ]);

    const text = smtpPayload().text;
    expect(text).toContain("• PAN number could not be read");
    expect(text).toContain("• Registration certificate is not legible");
  });

  it("keeps the document-issue email neutral — it asks, it does not accuse", async () => {
    // Per lib/verification-triage.ts, serious findings go to an admin only. This
    // NGO-facing mail must never carry accusatory language.
    const { sendNGODocumentIssueEmail } = await loadGmail();
    await sendNGODocumentIssueEmail("ngo@example.org", "Helping Hands", [
      "PAN number could not be read",
    ]);

    const text = smtpPayload().text.toLowerCase();
    for (const word of ["fraud", "fraudulent", "suspicious", "forged", "fake"]) {
      expect(text).not.toContain(word);
    }
  });

  it("carries the admin's reason into a rejection", async () => {
    const { sendNGORejectionEmail } = await loadGmail();
    await sendNGORejectionEmail("ngo@example.org", "Helping Hands", "Registration expired");

    expect(smtpPayload().text).toContain("Registration expired");
  });

  it("carries the reason into a suspension", async () => {
    const { sendNGOSuspendedEmail } = await loadGmail();
    await sendNGOSuspendedEmail("ngo@example.org", "Helping Hands", "Unresolved risk review");

    expect(smtpPayload().text).toContain("Unresolved risk review");
  });

  it("sends a reinstatement without requiring a reason", async () => {
    const { sendNGOReinstatedEmail } = await loadGmail();
    const result = await sendNGOReinstatedEmail("ngo@example.org", "Helping Hands");

    expect(result.success).toBe(true);
    expect(smtpPayload().text).toContain("Helping Hands");
  });
});

describe("project lifecycle templates", () => {
  it("names the project in a submission acknowledgement", async () => {
    const { sendProjectSubmittedEmail } = await loadGmail();
    await sendProjectSubmittedEmail("ngo@example.org", "Helping Hands", "Solar Learning Center");

    expect(smtpPayload().subject + smtpPayload().text).toContain("Solar Learning Center");
  });

  it("carries the reason into a project rejection", async () => {
    const { sendProjectRejectedEmail } = await loadGmail();
    await sendProjectRejectedEmail(
      "ngo@example.org",
      "Helping Hands",
      "Solar Learning Center",
      "Budget lacks milestone breakdown"
    );

    expect(smtpPayload().text).toContain("Budget lacks milestone breakdown");
  });

  it("announces a published project", async () => {
    const { sendProjectPublishedEmail } = await loadGmail();
    await sendProjectPublishedEmail("ngo@example.org", "Helping Hands", "Solar Learning Center");

    expect(smtpPayload().text).toContain("Solar Learning Center");
  });
});

describe("proof review templates", () => {
  it("marks an approval clearly in the subject", async () => {
    const { sendProofApprovedEmail } = await loadGmail();
    await sendProofApprovedEmail("ngo@example.org", "Helping Hands", "Phase 1 delivery");

    expect(smtpPayload().subject).toContain("APPROVED");
    expect(smtpPayload().subject).toContain("Phase 1 delivery");
  });

  it("marks a rejection clearly and quotes the reviewer's reason", async () => {
    const { sendProofRejectedEmail } = await loadGmail();
    await sendProofRejectedEmail(
      "ngo@example.org",
      "Helping Hands",
      "Phase 1 delivery",
      "Receipt total does not match the milestone budget"
    );

    const msg = smtpPayload();
    expect(msg.subject).toContain("REJECTED");
    expect(msg.text).toContain("Receipt total does not match the milestone budget");
  });
});

describe("donation receipt", () => {
  const pdf = Buffer.from("%PDF-1.7 fake");

  it("attaches the PDF under the receipt number as its filename", async () => {
    const { sendReceiptEmail } = await loadGmail();
    await sendReceiptEmail(
      "donor@example.com",
      "Asha",
      "IB-2026-0042",
      "/donor/receipts/IB-2026-0042",
      150000,
      "Solar Learning Center",
      pdf
    );

    const msg = smtpPayload();
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0].filename).toBe("IB-2026-0042.pdf");
    expect(msg.attachments[0].content).toBe(pdf);
  });

  it("formats the amount in the Indian numbering system", async () => {
    const { sendReceiptEmail } = await loadGmail();
    await sendReceiptEmail(
      "donor@example.com",
      "Asha",
      "IB-2026-0042",
      "/donor/receipts/IB-2026-0042",
      150000,
      "Solar Learning Center",
      pdf
    );

    // 1,50,000 — lakh grouping, not the 150,000 a default locale would give.
    expect(smtpPayload().text).toContain("₹1,50,000");
    expect(smtpPayload().text).not.toContain("₹150,000");
  });

  it("states the 80G entitlement and the receipt number", async () => {
    const { sendReceiptEmail } = await loadGmail();
    await sendReceiptEmail(
      "donor@example.com",
      "Asha",
      "IB-2026-0042",
      "/donor/receipts/IB-2026-0042",
      1000,
      "Solar Learning Center",
      pdf
    );

    const text = smtpPayload().text;
    expect(text).toContain("80G");
    expect(text).toContain("IB-2026-0042");
  });

  it("builds an absolute receipt link from the relative path it is given", async () => {
    process.env.NEXTAUTH_URL = "https://impactbridge-omega.vercel.app";
    const { sendReceiptEmail } = await loadGmail();
    await sendReceiptEmail(
      "donor@example.com",
      "Asha",
      "IB-2026-0042",
      "/donor/receipts/IB-2026-0042",
      1000,
      "Solar Learning Center",
      pdf
    );

    expect(smtpPayload().text).toContain(
      "https://impactbridge-omega.vercel.app/donor/receipts/IB-2026-0042"
    );
  });
});

describe("milestone completion email", () => {
  const base = [
    "donor@example.com",
    "Asha",
    "Solar Learning Center",
    "Helping Hands",
    "Phase 1 delivery",
    "Forty classrooms now have light after sunset.",
  ] as const;

  it("includes the impact narrative verbatim", async () => {
    const { sendMilestoneCompletedEmail } = await loadGmail();
    await sendMilestoneCompletedEmail(...base);

    expect(smtpPayload().text).toContain("Forty classrooms now have light after sunset.");
  });

  it("omits the metrics block entirely when no tags are supplied", async () => {
    const { sendMilestoneCompletedEmail } = await loadGmail();
    await sendMilestoneCompletedEmail(...base);

    expect(smtpPayload().text).not.toContain("Verified Impact Metrics");
  });

  it("expands an SDG tag to its official goal name", async () => {
    const { SDG_MASTER } = await import("@/lib/impact-metrics");
    const tag = Object.keys(SDG_MASTER)[0];

    const { sendMilestoneCompletedEmail } = await loadGmail();
    await sendMilestoneCompletedEmail(...base, [tag], []);

    const text = smtpPayload().text;
    expect(text).toContain("Verified Impact Metrics");
    expect(text).toContain("SDGs:");
    expect(text).toContain(`• ${tag} - ${SDG_MASTER[tag]}`);
  });

  it("expands an IRIS+ metric code to its official name", async () => {
    const { IRIS_MASTER } = await import("@/lib/impact-metrics");
    const code = Object.keys(IRIS_MASTER)[0];

    const { sendMilestoneCompletedEmail } = await loadGmail();
    await sendMilestoneCompletedEmail(...base, [], [code]);

    const text = smtpPayload().text;
    expect(text).toContain("IRIS+ Metrics:");
    expect(text).toContain(`• ${code} - ${IRIS_MASTER[code]}`);
  });

  it("falls back to echoing an unrecognised code rather than printing undefined", async () => {
    const { sendMilestoneCompletedEmail } = await loadGmail();
    await sendMilestoneCompletedEmail(...base, ["SDG-NOT-REAL"], ["PI-NOT-REAL"]);

    const text = smtpPayload().text;
    expect(text).toContain("• SDG-NOT-REAL - SDG-NOT-REAL");
    expect(text).toContain("• PI-NOT-REAL - PI-NOT-REAL");
    expect(text).not.toContain("undefined");
  });

  it("includes both metric families when both are supplied", async () => {
    const { SDG_MASTER, IRIS_MASTER } = await import("@/lib/impact-metrics");
    const tag = Object.keys(SDG_MASTER)[0];
    const code = Object.keys(IRIS_MASTER)[0];

    const { sendMilestoneCompletedEmail } = await loadGmail();
    await sendMilestoneCompletedEmail(...base, [tag], [code]);

    const text = smtpPayload().text;
    expect(text).toContain("SDGs:");
    expect(text).toContain("IRIS+ Metrics:");
  });
});

describe("FCRA compliance templates", () => {
  it("carries the reason into an FCRA rejection", async () => {
    const { sendFcraRejectionEmail } = await loadGmail();
    await sendFcraRejectionEmail("ngo@example.org", "Helping Hands", "Certificate expired in 2024");

    expect(smtpPayload().text).toContain("Certificate expired in 2024");
  });

  it("carries the reason into an FCRA re-upload request", async () => {
    const { sendFcraReuploadEmail } = await loadGmail();
    await sendFcraReuploadEmail("ngo@example.org", "Helping Hands", "Scan was unreadable");

    expect(smtpPayload().text).toContain("Scan was unreadable");
  });

  it("states the days remaining in an expiry reminder", async () => {
    const { sendFcraExpiryReminderEmail } = await loadGmail();
    await sendFcraExpiryReminderEmail("ngo@example.org", "Helping Hands", 30);

    expect(smtpPayload().text).toContain("30");
  });

  it("sends an FCRA approval naming the organisation", async () => {
    const { sendFcraApprovalEmail } = await loadGmail();
    await sendFcraApprovalEmail("ngo@example.org", "Helping Hands");

    expect(smtpPayload().text + smtpPayload().subject).toContain("Helping Hands");
  });
});
