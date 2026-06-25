import { Resend } from "resend";
import nodemailer from "nodemailer";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Gmail SMTP transport — only built when a Gmail App Password is configured.
const gmailTransport = process.env.GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    })
  : null;

interface Attachment {
  content?: string | Buffer;
  filename: string;
  path?: string;
  contentType?: string;
}

interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  attachments?: Attachment[];
  from?: string;
}

async function sendEmail({ to, subject, body, attachments, from }: SendEmailParams) {
  const html = body.replace(/\n/g, "<br/>");

  // 1. Gmail SMTP — preferred when a Gmail App Password is configured.
  if (gmailTransport) {
    try {
      const fromHeader = from ? `${from.split(" <")[0]} <${process.env.GMAIL_USER}>` : `ImpactBridge <${process.env.GMAIL_USER}>`;
      const info = await gmailTransport.sendMail({
        from: fromHeader,
        to,
        subject,
        text: body,
        html,
        attachments: attachments || undefined,
      });
      return { success: true, data: info };
    } catch (err: any) {
      console.error("Failed to send email via Gmail:", err);
      return { success: false, error: err.message };
    }
  }

  // 2. Resend — fallback when RESEND_API_KEY is set.
  if (resend) {
    try {
      const data = await resend.emails.send({
        from: from || process.env.RESEND_FROM_EMAIL || "ImpactBridge <onboarding@resend.dev>", // default Resend sandbox domain
        to,
        subject,
        html,
        attachments: attachments || undefined,
      });
      return { success: true, data };
    } catch (err: any) {
      console.error("Failed to send email via Resend:", err);
      return { success: false, error: err.message };
    }
  }

  // 3. Mock — no transport configured, log to console.
  console.log("\n==================================================");
  console.log(" MOCK EMAIL DISPATCHED (no GMAIL_APP_PASSWORD or RESEND_API_KEY)");
  console.log(` To:      ${to}`);
  console.log(` Subject: ${subject}`);
  if (attachments && attachments.length > 0) {
    console.log(` Attachments: ${attachments.map(a => a.filename).join(", ")}`);
  }
  console.log("--------------------------------------------------");
  console.log(body);
  console.log("==================================================\n");
  return { success: true, mock: true };
}

export async function sendNGOApprovalEmail(to: string, orgName: string) {
  const subject = `Congratulations! ${orgName} has been verified on ImpactBridge`;
  const body = `Hi there,\n\nWe are pleased to inform you that your NGO application for "${orgName}" has been reviewed and verified successfully by our administration team.\n\nYou now have full dashboard access and can start publishing projects and milestones to receive donations.\n\nLink to Dashboard: ${process.env.NEXTAUTH_URL || "http://localhost:3000"}/ngo/dashboard\n\nThank you for partnering with us to bridge the trust gap.\n\nBest regards,\nThe ImpactBridge Team`;
  return sendEmail({ to, subject, body });
}

export async function sendNGORejectionEmail(to: string, orgName: string, reason: string) {
  const subject = `Update regarding your NGO application for ${orgName}`;
  const body = `Hi there,\n\nThank you for submitting your registration details for "${orgName}".\n\nUnfortunately, our administration team was unable to verify your application at this time due to the following reason:\n\n"${reason}"\n\nPlease update your documentation or registration details on your dashboard and resubmit them for verification.\n\nLink to Dashboard: ${process.env.NEXTAUTH_URL || "http://localhost:3000"}/ngo/dashboard\n\nBest regards,\nThe ImpactBridge Team`;
  return sendEmail({ to, subject, body });
}

export async function sendProjectPublishedEmail(to: string, orgName: string, projectTitle: string) {
  const subject = `Your project "${projectTitle}" is now LIVE!`;
  const body = `Hi there,\n\nWe are excited to let you know that your fundraising project "${projectTitle}" has been published and is now visible to all donors on the ImpactBridge Discovery feed.\n\nYou can track milestone progress and manage donation events directly from your dashboard.\n\nBest regards,\nThe ImpactBridge Team`;
  return sendEmail({ to, subject, body });
}

export async function sendNewProjectAlertEmail(
  to: string,
  donorName: string,
  orgName: string,
  projectTitle: string,
  projectId: string
) {
  const subject = `New Project from ${orgName}: "${projectTitle}"`;
  const body = `Hi ${donorName},\n\nAn NGO you follow, ${orgName}, has just launched a new fundraising project: "${projectTitle}".\n\nVisit the project page to view their milestones and make a donation:\n${process.env.NEXTAUTH_URL || "http://localhost:3000"}/projects/${projectId}\n\nBest regards,\nThe ImpactBridge Team`;
  return sendEmail({ to, subject, body });
}

export async function sendReceiptEmail(
  to: string,
  donorName: string,
  receiptNumber: string,
  receiptUrl: string,
  amount: number,
  projectTitle: string,
  pdfBuffer: Buffer
) {
  const subject = `Your Donation Receipt ${receiptNumber} for ${projectTitle}`;
  const body = `Hi ${donorName},\n\nThank you for your generous donation of ₹${amount.toLocaleString("en-IN")} towards the project "${projectTitle}".\n\nYour donation is eligible for 50% tax exemption under Section 80G of the Income Tax Act. We have auto-generated your official tax receipt.\n\nReceipt Number: ${receiptNumber}\nAmount: ₹${amount.toLocaleString("en-IN")}\nProject: ${projectTitle}\n\nYou can download the receipt directly from the link below:\n${process.env.NEXTAUTH_URL || "http://localhost:3000"}${receiptUrl}\n\nWe have also attached a copy of the PDF receipt to this email.\n\nThank you for supporting transparency in philanthropy!\n\nBest regards,\nThe ImpactBridge Team`;

  return sendEmail({
    to,
    subject,
    body,
    attachments: [
      {
        filename: `${receiptNumber}.pdf`,
        content: pdfBuffer,
      },
    ],
  });
}

export async function sendMilestoneCompletedEmail(
  to: string,
  donorName: string,
  projectTitle: string,
  ngoName: string,
  milestoneTitle: string,
  narrative: string
) {
  const subject = `Milestone Completed: "${milestoneTitle}" - ${projectTitle}`;
  const body = `Hi ${donorName},\n\nWe have exciting news! ${ngoName} has successfully completed the milestone "${milestoneTitle}" for the project "${projectTitle}".\n\nHere is how your contribution made an impact:\n\n${narrative}\n\nThank you for making a difference.\n\nBest regards,\nThe ImpactBridge Team`;
  return sendEmail({ to, subject, body });
}

export async function sendProofApprovedEmail(
  to: string,
  orgName: string,
  milestoneTitle: string
) {
  const subject = `Milestone proof APPROVED: "${milestoneTitle}"`;
  const body = `Hi there,\n\nWe are pleased to inform you that the milestone completion proof you submitted for "${milestoneTitle}" has been approved.\n\nDonors of this project have been notified of your success and sent their personalized impact narrative updates.\n\nKeep up the great work!\n\nBest regards,\nThe ImpactBridge Team`;
  return sendEmail({ to, subject, body });
}

export async function sendProofRejectedEmail(
  to: string,
  orgName: string,
  milestoneTitle: string,
  reason: string
) {
  const subject = `Milestone proof REJECTED: "${milestoneTitle}"`;
  const body = `Hi there,\n\nWe are writing to let you know that the milestone completion proof you submitted for "${milestoneTitle}" was not approved by our review team.\n\nReason for rejection:\n"${reason}"\n\nPlease address this feedback, update your completion evidence, and resubmit it from your dashboard.\n\nBest regards,\nThe ImpactBridge Team`;
  return sendEmail({ to, subject, body });
}

// ─── FCRA compliance emails ───────────────────────────────────────────────────

export async function sendFcraApprovalEmail(to: string, orgName: string) {
  const subject = `FCRA verified for ${orgName} on ImpactBridge`;
  const body = `Hi there,\n\nGood news — the FCRA registration you submitted for "${orgName}" has been reviewed and verified by our team.\n\nYour public profile now displays an active FCRA compliance badge, letting donors abroad know you are authorised to receive foreign contributions. This also strengthens your Compliance Score.\n\nLink to Dashboard: ${process.env.NEXTAUTH_URL || "http://localhost:3000"}/ngo/dashboard\n\nBest regards,\nThe ImpactBridge Team`;
  return sendEmail({ to, subject, body });
}

export async function sendFcraRejectionEmail(to: string, orgName: string, reason: string) {
  const subject = `Update regarding your FCRA submission for ${orgName}`;
  const body = `Hi there,\n\nThank you for submitting your FCRA registration for "${orgName}".\n\nUnfortunately our team could not verify it at this time for the following reason:\n\n"${reason}"\n\nPlease review the feedback and re-submit a clear copy of your FCRA certificate from your dashboard.\n\nLink to Dashboard: ${process.env.NEXTAUTH_URL || "http://localhost:3000"}/ngo/dashboard\n\nBest regards,\nThe ImpactBridge Team`;
  return sendEmail({ to, subject, body });
}

export async function sendFcraReuploadEmail(to: string, orgName: string, reason: string) {
  const subject = `Action needed: re-upload your FCRA certificate for ${orgName}`;
  const body = `Hi there,\n\nWe've started reviewing the FCRA registration for "${orgName}" but need a clearer or corrected document before we can verify it:\n\n"${reason}"\n\nPlease re-upload your FCRA certificate from your dashboard at your earliest convenience.\n\nLink to Dashboard: ${process.env.NEXTAUTH_URL || "http://localhost:3000"}/ngo/dashboard\n\nBest regards,\nThe ImpactBridge Team`;
  return sendEmail({ to, subject, body });
}

export async function sendFcraExpiryReminderEmail(to: string, orgName: string, daysLeft: number) {
  const expired = daysLeft <= 0;
  const subject = expired
    ? `Your FCRA registration for ${orgName} has expired`
    : `Your FCRA registration for ${orgName} expires in ${daysLeft} days`;
  const body = expired
    ? `Hi there,\n\nThe FCRA registration on record for "${orgName}" has now expired. Your public profile reflects this, and donors abroad will see that you cannot currently receive foreign contributions.\n\nPlease renew your FCRA registration and upload the updated certificate from your dashboard to restore your active status.\n\nLink to Dashboard: ${process.env.NEXTAUTH_URL || "http://localhost:3000"}/ngo/dashboard\n\nBest regards,\nThe ImpactBridge Team`
    : `Hi there,\n\nThis is a reminder that the FCRA registration for "${orgName}" will expire in ${daysLeft} days. Donors abroad rely on an active FCRA status to contribute.\n\nPlease begin your renewal and upload the updated certificate from your dashboard before it lapses.\n\nLink to Dashboard: ${process.env.NEXTAUTH_URL || "http://localhost:3000"}/ngo/dashboard\n\nBest regards,\nThe ImpactBridge Team`;
  return sendEmail({ to, subject, body });
}

export async function sendAdminFcraExpiryDigest(
  adminEmail: string,
  items: { orgName: string; status: string; daysLeft: number }[]
) {
  const list = items
    .map((i) => `  • ${i.orgName} — ${i.status.replace(/_/g, " ")} (${i.daysLeft <= 0 ? "expired" : i.daysLeft + " days left"})`)
    .join("\n");
  const subject = `[FCRA] ${items.length} certificate${items.length > 1 ? "s" : ""} expiring or expired`;
  const body = `Hi Admin,\n\nThe following NGO FCRA registration${items.length > 1 ? "s have" : " has"} changed compliance state and may need follow-up:\n\n${list}\n\nReview them here:\n${process.env.NEXTAUTH_URL || "http://localhost:3000"}/admin/fcra-review\n\nBest regards,\nImpactBridge System`;
  return sendEmail({ to: adminEmail, subject, body });
}

// ─── Admin reminder emails ────────────────────────────────────────────────────

export async function sendAdminPendingNGOsReminder(
  adminEmail: string,
  ngos: { orgName: string; email: string; daysPending: number }[]
) {
  const list = ngos.map(n => `  • ${n.orgName} (${n.email}) — pending for ${n.daysPending} days`).join("\n");
  const subject = `[Action Required] ${ngos.length} NGO application${ngos.length > 1 ? "s" : ""} awaiting your review`;
  const body = `Hi Admin,\n\nThe following NGO application${ngos.length > 1 ? "s have" : " has"} been sitting in the verification queue for more than 5 days without a decision:\n\n${list}\n\nPlease log in to the admin panel and review them:\n${process.env.NEXTAUTH_URL || "http://localhost:3000"}/admin/dashboard\n\nBest regards,\nImpactBridge System`;
  return sendEmail({ to: adminEmail, subject, body });
}

export async function sendAdminUnreviewedProofsReminder(
  adminEmail: string,
  proofs: { milestoneTitle: string; orgName: string; daysWaiting: number }[]
) {
  const list = proofs.map(p => `  • "${p.milestoneTitle}" by ${p.orgName} — waiting ${p.daysWaiting} days`).join("\n");
  const subject = `[Action Required] ${proofs.length} milestone proof${proofs.length > 1 ? "s" : ""} awaiting review`;
  const body = `Hi Admin,\n\nThe following milestone proof submission${proofs.length > 1 ? "s have" : " has"} not been reviewed for more than 3 days:\n\n${list}\n\nPlease log in to review and approve or reject them:\n${process.env.NEXTAUTH_URL || "http://localhost:3000"}/admin/proof-review\n\nBest regards,\nImpactBridge System`;
  return sendEmail({ to: adminEmail, subject, body });
}

export async function sendAdminUnresolvedFraudAlertsReminder(
  adminEmail: string,
  alerts: { type: string; orgOrDonor: string; daysOpen: number }[]
) {
  const list = alerts.map(a => `  • ${a.type.replace(/_/g, " ")} — ${a.orgOrDonor} (open for ${a.daysOpen} days)`).join("\n");
  const subject = `[Urgent] ${alerts.length} fraud alert${alerts.length > 1 ? "s" : ""} unresolved for 7+ days`;
  const body = `Hi Admin,\n\nThe following high-priority fraud alert${alerts.length > 1 ? "s have" : " has"} been open for more than 7 days without resolution:\n\n${list}\n\nThese require your immediate attention. Please investigate and resolve:\n${process.env.NEXTAUTH_URL || "http://localhost:3000"}/admin/fraud-alerts\n\nBest regards,\nImpactBridge System`;
  return sendEmail({ to: adminEmail, subject, body });
}

export async function sendNGODocumentReminderEmail(
  ngoEmail: string,
  orgName: string,
  issues: string[]
) {
  const list = issues.map(i => `  • ${i}`).join("\n");
  const subject = `Reminder: Your NGO registration documents need attention`;
  const body = `Hi there,\n\nThis is a reminder that your NGO registration for "${orgName}" has been pending for 7 days due to the following document issue${issues.length > 1 ? "s" : ""}:\n\n${list}\n\nPlease log in to your dashboard and resubmit the correct documents to complete your verification:\n${process.env.NEXTAUTH_URL || "http://localhost:3000"}/ngo/register\n\nIf you have already resubmitted, please ignore this message.\n\nBest regards,\nThe ImpactBridge Team`;
  return sendEmail({ to: ngoEmail, subject, body });
}

export async function sendTaxReceiptEmail(
  to: string,
  donorName: string,
  ngoName: string,
  amount: number,
  receiptNumber: string,
  financialYear: string,
  pdfUrl: string
) {
  const subject = `Your 80G Tax Receipt — ${ngoName} (${financialYear})`;
  const body = `Hi ${donorName},

Thank you for your donation of ₹${amount.toLocaleString("en-IN")} to ${ngoName}.

Your 80G tax receipt for Financial Year ${financialYear} is ready.

Receipt Number: ${receiptNumber}
Download Receipt: ${pdfUrl}

This receipt is valid for claiming deduction under Section 80G of the
Income Tax Act, 1961. Please retain it for your tax filing records.

If you have any questions, reply to this email or contact us at
support@imparency.in

Best regards,
The Imparency Team`;

  return sendEmail({
    to,
    subject,
    body,
    from: "Imparency <onboarding@resend.dev>",
  });
}

export async function sendPaymentRetryEmail(
  to: string,
  donorName: string,
  ngoName: string,
  amount: number,
  retryUrl: string
) {
  const subject = `Action needed: Your donation to ${ngoName} didn't go through`;
  const body = `Hi ${donorName},

We noticed your donation of Rs.${amount.toLocaleString("en-IN")} to ${ngoName}
was unsuccessful.

This can happen due to a temporary issue with your bank or payment network.
The good news — you can retry your donation with one click:

Retry Donation: ${retryUrl}

This link is valid for 24 hours. After that, you will need to initiate
a new donation from the project page.

If you believe this is an error or your account was charged, please
contact us at support@imparency.in and we will resolve it immediately.

Best regards,
The Imparency Team`;
  return sendEmail({ to, subject, body });
}

export async function sendTierUpgradeEmail(
  to: string,
  donorName: string,
  donationCount: number,
  ctaUrl: string
) {
  const subject = `You've made ${donationCount} donations — ready to go deeper?`;
  const body = `Hi ${donorName},

You've now donated ${donationCount} times through Imparency. That's
real, verified impact — and you can see exactly where every rupee went.

Donors who make a monthly standing commitment see 3x more impact
updates and get priority access to new high-trust NGO campaigns.

Consider setting up a monthly commitment on your dashboard:
${ctaUrl}

Thank you for being one of our most consistent supporters.

Best regards,
The Imparency Team`;
  return sendEmail({ to, subject, body });
}

export async function sendNGOReferralEmail(
  to: string,
  donorName: string,
  previousNGO: string,
  referredNGO: string,
  referredNGOId: string,
  ctaUrl: string
) {
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const subject = `Since you supported ${previousNGO}, you might love this`;
  const body = `Hi ${donorName},

Your donation to ${previousNGO} created verified impact — we hope you
saw the full report.

We thought you might want to know about another organization doing
similar work: ${referredNGO}.

They're verified on Imparency and have a strong transparency record.
See their profile here:
${baseUrl}/ngo/${referredNGOId}

You can also view this on your dashboard:
${ctaUrl}

Best regards,
The Imparency Team`;
  return sendEmail({ to, subject, body });
}

export async function sendGrantModeEmail(
  to: string,
  donorName: string,
  ngoName: string,
  totalDonated: number,
  ctaUrl: string
) {
  const subject = `Your giving to ${ngoName} — let's talk about what's next`;
  const body = `Hi ${donorName},

Your organization has contributed Rs.${totalDonated.toLocaleString("en-IN")}
through Imparency. That's a significant commitment, and we want to
make sure you're getting the most from it.

For organizations at your giving level, a structured multi-year grant
can deliver better outcomes, stronger compliance documentation, and
deeper partnership with the NGOs you support.

We'd love to explore this with you. See your options on the dashboard:
${ctaUrl}

Best regards,
The Imparency Team`;
  return sendEmail({ to, subject, body });
}

export async function sendVolunteerEmail(
  to: string,
  donorName: string,
  ngoName: string,
  ctaUrl: string
) {
  const subject = `Would you like to contribute more than money to ${ngoName}?`;
  const body = `Hi ${donorName},

Your financial support for ${ngoName} has made a real difference.

We wanted to ask: would you be open to contributing your professional
skills or expertise to this organization as well? Many of our verified
NGOs are looking for advisors, mentors, and skilled volunteers in areas
like technology, finance, legal, and communications.

If this interests you, let us know through your dashboard:
${ctaUrl}

No commitment required — just an expression of interest.

Best regards,
The Imparency Team`;
  return sendEmail({ to, subject, body });
}

