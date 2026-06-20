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
}

async function sendEmail({ to, subject, body, attachments }: SendEmailParams) {
  const html = body.replace(/\n/g, "<br/>");

  // 1. Gmail SMTP — preferred when a Gmail App Password is configured.
  if (gmailTransport) {
    try {
      const info = await gmailTransport.sendMail({
        from: `ImpactBridge <${process.env.GMAIL_USER}>`,
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
        from: process.env.RESEND_FROM_EMAIL || "ImpactBridge <onboarding@resend.dev>", // default Resend sandbox domain
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

