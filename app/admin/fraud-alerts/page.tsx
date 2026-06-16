import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import FraudAlertsClient from "./FraudAlertsClient";

export const runtime = "nodejs";

export default async function AdminFraudAlertsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  // Run general platform checks to generate fresh alerts (e.g. deadline exceeded or inactive NGO activity)
  try {
    const { checkGeneralPlatformAlerts } = require("@/lib/fraud-alerts");
    await checkGeneralPlatformAlerts();
  } catch (err) {
    console.error("Failed to run platform-wide fraud checks on page load:", err);
  }

  // Fetch all unresolved fraud alerts
  const unresolvedAlerts = await prisma.fraudAlert.findMany({
    where: { resolved: false },
    orderBy: { createdAt: "desc" }
  });

  // Fetch resolved fraud alerts history
  const resolvedAlerts = await prisma.fraudAlert.findMany({
    where: { resolved: true },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  // Custom sort unresolved by severity (HIGH -> MEDIUM -> LOW)
  const severityRank: Record<string, number> = { HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sortedUnresolved = [...unresolvedAlerts].sort(
    (a, b) => (severityRank[a.severity] || 4) - (severityRank[b.severity] || 4)
  );

  // Serialize dates
  const serializedUnresolved = sortedUnresolved.map((a) => ({
    ...a,
    createdAt: a.createdAt.toISOString()
  }));

  const serializedResolved = resolvedAlerts.map((a) => ({
    ...a,
    createdAt: a.createdAt.toISOString()
  }));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      {/* Navbar */}
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xl font-black text-emerald-600 tracking-tight">ImpactBridge</span>
          <span className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-full font-bold">Admin Console</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex gap-4 text-sm font-semibold">
            <a href="/admin/dashboard" className="text-gray-500 hover:text-emerald-600 transition">NGO Verification</a>
            <a href="/admin/proof-review" className="text-gray-500 hover:text-emerald-600 transition">Proof Review</a>
            <a href="/admin/fraud-alerts" className="text-emerald-600 hover:text-emerald-700 transition underline decoration-2 underline-offset-4">Fraud Alerts</a>
          </div>
          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700"></div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Administrator</span>
            <a
              href="/api/auth/signout"
              className="text-xs font-semibold text-gray-500 hover:text-red-500 transition"
            >
              Logout
            </a>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Fraud Prevention & Alerts</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Monitor suspicious platform behaviors, duplicate identities, low-score milestone proofs, and resolve flags with resolution notes.
          </p>
        </div>

        <FraudAlertsClient
          initialUnresolved={serializedUnresolved}
          initialResolved={serializedResolved}
        />
      </main>
    </div>
  );
}
