import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import ReportConcernForm from "./ReportConcernForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Report a concern about an organisation on the platform.
 *
 * MINIMAL BY DESIGN — this is the API's companion so the channel exists and is
 * demonstrable, not a finished public intake experience. The polished version
 * belongs to whoever owns the public surface; see the boundary note in
 * docs/WEEK7-BLUEPRINT.md and the Week 5 precedent where the NGO proposal
 * route shipped API-only.
 *
 * Requires a session, and says so rather than silently redirecting into a
 * login wall: someone who came here to report something serious deserves to
 * know why they are being asked to sign in, and that the platform cannot yet
 * take an anonymous report.
 */
export default async function ReportConcernPage() {
  const session = await getServerSession(authOptions);

  const organisations = await prisma.nGOProfile.findMany({
    where: { verificationStatus: "VERIFIED", isDeleted: false },
    select: { id: true, orgName: true },
    orderBy: { orgName: "asc" },
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-12">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Report a concern</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          If you believe an organisation on this platform is misusing funds, has not done work it
          reported as finished, or has put someone at risk, tell us here. A person on the platform
          team reads every report.
        </p>

        <div className="mt-5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Who sees this
          </h2>
          <ul className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-400">
            <li>
              <span className="font-semibold text-gray-900 dark:text-white">Platform admins only.</span>{" "}
              The organisation you report cannot see the report, and cannot see that you filed it.
            </li>
            <li>
              <span className="font-semibold text-gray-900 dark:text-white">Not anonymous.</span>{" "}
              Filing needs an account, and your name is visible to the admin who reviews it. We
              cannot currently take anonymous reports — if that matters for your safety, use the
              Grievance Officer contact in our{" "}
              <Link href="/privacy-policy#grievance" className="underline">
                privacy policy
              </Link>{" "}
              instead.
            </li>
            <li>How serious it is gets decided by the reviewer, not by you — so nothing is lost by stating it plainly.</li>
          </ul>
        </div>

        <div className="mt-6">
          {session?.user ? (
            <ReportConcernForm organisations={organisations} />
          ) : (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                You need to be signed in to file a report. This is a limitation, not a policy
                choice we are happy with — anonymous reporting is not built yet.
              </p>
              <Link
                href="/login?next=/report-concern"
                className="mt-4 inline-block rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
              >
                Sign in to continue
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
