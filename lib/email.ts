import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
}

async function sendEmail({ to, subject, body }: SendEmailParams) {
  if (!resend) {
    console.log("\n==================================================");
    console.log(" MOCK EMAIL DISPATCHED (RESEND_API_KEY missing)");
    console.log(` To:      ${to}`);
    console.log(` Subject: ${subject}`);
    console.log("--------------------------------------------------");
    console.log(body);
    console.log("==================================================\n");
    return { success: true, mock: true };
  }

  try {
    const data = await resend.emails.send({
      from: "ImpactBridge <onboarding@resend.dev>", // default Resend sandbox domain
      to,
      subject,
      html: body.replace(/\n/g, "<br/>"),
    });
    return { success: true, data };
  } catch (err: any) {
    console.error("Failed to send email via Resend:", err);
    return { success: false, error: err.message };
  }
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
