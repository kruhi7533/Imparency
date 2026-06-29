import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import DashboardClient from "./DashboardClient";

export default async function NGODashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "NGO") {
    redirect("/unauthorized");
  }

  // Fetch NGO Profile details
  const profile = await prisma.nGOProfile.findUnique({
    where: { userId: session.user.id },
    include: {
      projects: {
        where: { isDeleted: false },
        include: {
          milestones: {
            orderBy: { sequenceOrder: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!profile) {
    // If NGO registered but hasn't submitted verification docs, send them to register
    redirect("/ngo/register");
  }

  const status = profile.verificationStatus;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      


      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        
        {/* State 1: PENDING */}
        {status === "PENDING" && (
          <div className="max-w-2xl mx-auto bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-8 shadow-md text-center">
            <div className="inline-flex items-center justify-center p-3 bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 rounded-full mb-6">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
              </svg>
            </div>
            
            <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white mb-2">Application Under Review</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-8 max-w-md mx-auto">
              Your registration documents are currently under review. Our administration team will notify you within 2-3 business days.
            </p>

            {/* Stepper Timeline */}
            <div className="relative flex items-center justify-between max-w-md mx-auto">
              <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-gray-200 dark:bg-gray-800 -translate-y-1/2 -z-10"></div>
              
              {/* Step 1: Submitted */}
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center text-sm font-bold shadow-md shadow-emerald-500/20 z-10">✓</div>
                <span className="mt-2 text-xs font-semibold text-gray-700 dark:text-gray-300">Submitted</span>
              </div>

              {/* Step 2: Under Review */}
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center text-sm font-bold shadow-md shadow-amber-500/20 z-10 animate-pulse">2</div>
                <span className="mt-2 text-xs font-semibold text-gray-700 dark:text-gray-300">Under Review</span>
              </div>

              {/* Step 3: Verified */}
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 text-gray-400 flex items-center justify-center text-sm font-bold z-10">3</div>
                <span className="mt-2 text-xs font-semibold text-gray-400">Verified</span>
              </div>
            </div>
          </div>
        )}

        {/* State 2: REJECTED */}
        {status === "REJECTED" && (
          <div className="max-w-2xl mx-auto bg-white dark:bg-gray-900 rounded-2xl border border-red-100 dark:border-red-950 p-8 shadow-md text-center">
            <div className="inline-flex items-center justify-center p-3 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 rounded-full mb-6">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
              </svg>
            </div>

            <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white mb-2">Application Rejected</h2>
            
            {profile.adminNote && (
              <div className="my-6 p-4 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 rounded-lg text-sm text-red-700 dark:text-red-300 text-left max-w-md mx-auto">
                <strong className="block font-bold mb-1">Reason from Administrator:</strong>
                {profile.adminNote}
              </div>
            )}

            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
              Please review the feedback above, update your verification materials, and resubmit them for evaluation.
            </p>

            <Link
              href="/ngo/register"
              className="inline-block bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition"
            >
              Update & Resubmit Documents
            </Link>
          </div>
        )}

        {/* State 3: VERIFIED (Full Dashboard) */}
        {status === "VERIFIED" && (
          <DashboardClient 
            profile={profile as any} 
            whatsappBotNumber={process.env.TWILIO_WHATSAPP_NUMBER}
            joinCode={profile.joinCode ?? null}
          />
        )}
      </main>
    </div>
  );
}
