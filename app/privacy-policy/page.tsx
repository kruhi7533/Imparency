import React from "react";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy · ImpactBridge",
  description:
    "How ImpactBridge collects, uses, shares and retains personal data under India's Digital Personal Data Protection Act, 2023.",
};

/**
 * Public privacy policy.
 *
 * `POLICY_VERSION` must stay in sync with the `consentVersion` written at
 * signup (`app/login/page.tsx`) and NGO registration (`app/ngo/register/page.tsx`),
 * and with `ConsentLog.policyVersion` in the schema — consent records are only
 * meaningful if they point at the exact text the user agreed to. Bump all of
 * them together and re-prompt existing users when the substance changes.
 */
const POLICY_VERSION = "v1.0";
const LAST_UPDATED = "25 July 2026";

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <h2 className="font-display text-2xl font-semibold text-white tracking-tight">{title}</h2>
      <div className="space-y-4 text-sm leading-relaxed text-gray-400">{children}</div>
    </section>
  );
}

function DataTable({
  caption,
  rows,
}: {
  caption: string;
  rows: { what: string; why: string }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left">
        <caption className="mb-3 text-left font-mono text-[11px] uppercase tracking-widest text-gold-400">
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-gray-800">
            <th className="w-2/5 pb-2 pr-4 text-xs font-semibold text-gray-300">What we hold</th>
            <th className="pb-2 text-xs font-semibold text-gray-300">Why we hold it</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.what} className="border-b border-gray-900 align-top">
              <td className="py-3 pr-4 text-xs text-gray-300">{row.what}</td>
              <td className="py-3 text-xs text-gray-400">{row.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-950 bg-gradient-to-b from-trust-950/40 via-gray-950 to-gray-950 text-white font-sans">
      <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-28">
        {/* Header */}
        <header className="space-y-4 border-b border-gray-800 pb-10">
          <p className="font-mono text-[11px] uppercase tracking-widest text-gold-400">
            Policy {POLICY_VERSION} · Last updated {LAST_UPDATED}
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="text-sm leading-relaxed text-gray-400">
            This policy explains what personal data ImpactBridge collects, why we collect it, who we
            share it with, and the rights you hold over it under India&apos;s Digital Personal Data
            Protection Act, 2023 (&quot;DPDP Act&quot;).
          </p>
        </header>

        <div className="mt-14 space-y-14">
          <Section id="who-we-are" title="1. Who we are">
            <p>
              ImpactBridge is a donation platform that connects donors with verified non-profit
              organisations using milestone-based funding. For the purposes of the DPDP Act, the Data
              Fiduciary responsible for your personal data is:
            </p>
            <p className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 font-mono text-xs leading-relaxed text-gray-300">
              [LEGAL ENTITY NAME]
              <br />
              [REGISTERED ADDRESS]
              <br />
              [CONTACT EMAIL]
            </p>
          </Section>

          <Section id="what-we-collect" title="2. What we collect">
            <p>
              We collect only what the platform needs to operate. What we hold depends on whether you
              use ImpactBridge as a donor or on behalf of an NGO.
            </p>

            <DataTable
              caption="Everyone with an account"
              rows={[
                {
                  what: "Name, email address, password (stored only as a salted hash)",
                  why: "To create and secure your account and sign you in.",
                },
                {
                  what: "Google account identifier and profile picture, if you sign in with Google",
                  why: "To authenticate you without a separate password.",
                },
                {
                  what: "Consent records: the purpose consented to, the policy version, timestamp and IP address",
                  why: "To evidence lawful consent as the DPDP Act requires.",
                },
                {
                  what: "Device notification token, if you enable notifications",
                  why: "To send you updates about projects you support.",
                },
                {
                  what: "Request metadata (IP address, browser user agent) on sensitive actions",
                  why: "Abuse prevention, rate limiting and security auditing.",
                },
              ]}
            />

            <DataTable
              caption="If you donate"
              rows={[
                {
                  what: "Donation amount, date, and the project funded",
                  why: "To process your gift, show your impact, and maintain our public ledger.",
                },
                {
                  what: "Payment identifiers issued by our payment gateway",
                  why: "To reconcile payments. We never see or store your card, UPI or bank credentials.",
                },
                {
                  what: "PAN, and the name registered against it",
                  why: "Required by Indian tax law to issue a valid 80G tax-exemption receipt.",
                },
                {
                  what: "Phone number, city, billing address, where you provide them",
                  why: "To issue receipts and contact you about your donations.",
                },
                {
                  what: "Donor category and, for non-resident donors, a declaration of the source of funds",
                  why: "To meet Foreign Contribution (Regulation) Act obligations before a donation is accepted.",
                },
                {
                  what: "Company name, GST number, and CSR registration number, for corporate donors",
                  why: "To issue compliant corporate receipts and CSR documentation.",
                },
                {
                  what: "Optional profile details such as giving preferences, adviser contact, or annual giving budget",
                  why: "To tailor the campaigns we surface to you. Entirely optional.",
                },
              ]}
            />

            <DataTable
              caption="If you register an NGO"
              rows={[
                {
                  what: "Organisation name, registration number, organisational PAN, address, founded year and description",
                  why: "To verify the organisation is genuine before it can raise funds.",
                },
                {
                  what: "Registration certificate, PAN card, 80G, 12A and FCRA documents you upload",
                  why: "Statutory verification and ongoing compliance monitoring.",
                },
                {
                  what: "Milestone evidence: receipts, invoices, photographs and written notes",
                  why: "To evidence that funds were spent as promised before the next instalment is released.",
                },
                {
                  what: "Names and email addresses of team members you invite",
                  why: "To give your colleagues access to your organisation's account.",
                },
              ]}
            />

            <p className="rounded-lg border-l-2 border-gold-500/70 bg-gray-900/40 p-4 text-xs leading-relaxed text-gray-300">
              <strong className="font-semibold text-white">A note on published evidence.</strong>{" "}
              Milestone evidence is shown on public campaign pages so donors can audit how money was
              spent. Do not upload documents containing personal details of beneficiaries, bank
              account numbers, or identity documents. Redact them first.
            </p>
          </Section>

          <Section id="why-we-use-it" title="3. Why we use it">
            <p>We process personal data for these purposes and no others:</p>
            <ul className="list-disc space-y-2 pl-5 marker:text-gold-500">
              <li>Creating, securing and operating your account.</li>
              <li>Processing donations and issuing 80G tax receipts.</li>
              <li>Verifying NGOs and reviewing milestone evidence before funds are released.</li>
              <li>Detecting fraud, duplicate registrations and other misuse of the platform.</li>
              <li>Meeting our obligations under Indian tax, FCRA and anti-money-laundering law.</li>
              <li>
                Sending transactional messages — receipts, verification outcomes, and updates on
                projects you fund.
              </li>
            </ul>
            <p>
              We do not sell personal data. We do not use it for advertising or share it with data
              brokers.
            </p>
          </Section>

          <Section id="automated-processing" title="4. Automated and AI-assisted review">
            <p>
              ImpactBridge uses automated systems, including Google&apos;s Gemini models, to
              pre-screen NGO registration documents and to score milestone evidence for
              plausibility and budget consistency. Documents and evidence you upload are sent to that
              service for analysis.
            </p>
            <p className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 text-xs leading-relaxed text-gray-300">
              <strong className="font-semibold text-white">
                No decision is made about you by a machine alone.
              </strong>{" "}
              AI output is advisory. Every approval, rejection and suspension is made by a human
              reviewer, who must record a written justification whenever they act against the
              automated recommendation. If a decision goes against you, you may ask for the reason
              and request that it be reconsidered.
            </p>
          </Section>

          <Section id="sharing" title="5. Who we share it with">
            <p>
              We share personal data only with service providers who process it on our instructions,
              and only to the extent each one needs:
            </p>
            <ul className="list-disc space-y-2 pl-5 marker:text-gold-500">
              <li>
                <strong className="text-gray-300">Razorpay</strong> — payment processing. Your
                payment credentials go directly to them and never reach our servers.
              </li>
              <li>
                <strong className="text-gray-300">Google (Gemini)</strong> — document screening and
                evidence validation.
              </li>
              <li>
                <strong className="text-gray-300">Cloudinary and Amazon Web Services</strong> —
                storage of uploaded documents, images and receipts.
              </li>
              <li>
                <strong className="text-gray-300">Resend</strong> — delivery of transactional email.
              </li>
              <li>
                <strong className="text-gray-300">Twilio</strong> — WhatsApp messaging, where an NGO
                field worker submits evidence by WhatsApp.
              </li>
              <li>
                <strong className="text-gray-300">Google Firebase</strong> — push notifications.
              </li>
              <li>
                <strong className="text-gray-300">Neon and Vercel</strong> — database hosting and
                application hosting.
              </li>
              <li>
                <strong className="text-gray-300">A PAN verification provider</strong> — validating
                a PAN against government records before a tax receipt is issued.
              </li>
            </ul>
            <p>
              Some of these providers process data on servers outside India. We rely on their
              contractual data-protection commitments when they do.
            </p>
            <p>
              We may also disclose data where the law compels it — for example to a tax authority, a
              regulator, or in response to a valid court order.
            </p>
          </Section>

          <Section id="retention" title="6. How long we keep it">
            <p>
              Donation records, tax receipts and NGO verification documents are retained for at least
              eight years, because Indian tax and FCRA rules require it. Consent records are kept for
              as long as we rely on that consent, plus the same statutory period.
            </p>
            <p>
              Account and profile data that is not subject to a statutory retention period is deleted
              within 90 days of you closing your account. Password reset tokens expire one hour after
              they are issued.
            </p>
          </Section>

          <Section id="security" title="7. How we protect it">
            <p>
              Passwords are stored only as salted hashes and are never recoverable in plain text.
              Access to administrative functions is restricted by role and every sensitive
              administrative action is written to an audit log recording who acted, what changed, and
              from where. Payment webhooks are cryptographically verified before they are accepted.
            </p>
            <p>
              No system is perfectly secure. If a breach affects your personal data, we will notify
              you and the Data Protection Board of India as the DPDP Act requires.
            </p>
          </Section>

          <Section id="your-rights" title="8. Your rights">
            <p>Under the DPDP Act you have the right to:</p>
            <ul className="list-disc space-y-2 pl-5 marker:text-gold-500">
              <li>Ask what personal data we hold about you and how it has been shared.</li>
              <li>Have inaccurate or incomplete data corrected or updated.</li>
              <li>
                Have your data erased, unless we are required by law to retain it — donation and tax
                records generally cannot be erased before their statutory period ends.
              </li>
              <li>
                Withdraw your consent at any time. Withdrawal applies going forward and does not
                affect processing already carried out, or records the law requires us to keep.
              </li>
              <li>
                Nominate another person to exercise these rights on your behalf if you die or become
                incapacitated.
              </li>
              <li>Raise a grievance with us, and escalate it to the Data Protection Board of India.</li>
            </ul>
            <p>
              To exercise any of these rights, write to our Grievance Officer using the details in
              section 10. We will respond within 30 days.
            </p>
          </Section>

          <Section id="children" title="9. Children">
            <p>
              ImpactBridge is not intended for anyone under 18. We do not knowingly collect data from
              children. If you believe a child has created an account, contact us and we will delete
              it.
            </p>
          </Section>

          <Section id="grievance" title="10. Grievance Officer">
            <p>
              The DPDP Act requires us to name a Grievance Officer as your first point of contact for
              any concern about how your data is handled.
            </p>
            <p className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 font-mono text-xs leading-relaxed text-gray-300">
              [GRIEVANCE OFFICER NAME]
              <br />
              [GRIEVANCE OFFICER EMAIL]
              <br />
              [POSTAL ADDRESS]
            </p>
            <p>
              If you are not satisfied with our response, you may complain to the Data Protection
              Board of India.
            </p>
          </Section>

          <Section id="changes" title="11. Changes to this policy">
            <p>
              When we change this policy we update the version number at the top. Where a change
              materially affects how we use data you have already given us, we will ask for your
              consent again rather than relying on the old version.
            </p>
          </Section>
        </div>

        {/* Footer nav */}
        <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-gray-800 pt-8">
          <p className="font-mono text-[10px] uppercase tracking-widest text-gray-600">
            ImpactBridge · Policy {POLICY_VERSION}
          </p>
          <div className="flex gap-5 text-xs">
            <Link href="/" className="text-trust-300 transition hover:text-trust-200 hover:underline">
              Home
            </Link>
            <Link
              href="/discover"
              className="text-trust-300 transition hover:text-trust-200 hover:underline"
            >
              Discover NGOs
            </Link>
            <Link
              href="/login"
              className="text-trust-300 transition hover:text-trust-200 hover:underline"
            >
              Sign In
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
