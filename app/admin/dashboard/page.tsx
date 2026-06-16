import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import AdminClient from "./AdminClient";

export default async function AdminDashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  // Fetch all pending NGOs
  const pendingNGOs = await prisma.nGOProfile.findMany({
    where: { verificationStatus: "PENDING" },
    select: {
      id: true,
      orgName: true,
      registrationNumber: true,
      panNumber: true,
      address: true,
      causeCategories: true,
      website: true,
      foundedYear: true,
      documents: true,
      createdAt: true,
      user: {
        select: {
          email: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      
      {/* Navbar */}
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xl font-black text-emerald-600 tracking-tight">ImpactBridge</span>
          <span className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-full font-bold">Admin Console</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Administrator</span>
          <a
            href="/api/auth/signout"
            className="text-xs font-semibold text-gray-500 hover:text-red-500 transition"
          >
            Logout
          </a>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Verification Panel</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Review and approve pending NGO registrations and document submissions.
          </p>
        </div>

        <AdminClient initialPendingNGOs={pendingNGOs} />
      </main>
    </div>
  );
}
