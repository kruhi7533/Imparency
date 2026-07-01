import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";

export default async function NGOCRMPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "NGO" && session.user.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  let profile = null;
  if (session.user.role === "NGO") {
    profile = await prisma.nGOProfile.findUnique({
      where: { userId: session.user.id },
    });

    if (!profile) redirect("/ngo/register");
    if (profile.verificationStatus !== "VERIFIED") redirect("/ngo/dashboard");
  } else {
    // Admin override: just pick the first verified NGO for demo purposes, or redirect to admin panel
    profile = await prisma.nGOProfile.findFirst({
      where: { verificationStatus: "VERIFIED" },
    });
    if (!profile) redirect("/admin/dashboard");
  }

  // Fetch all successful donations for this NGO's projects
  const donations = await prisma.donation.findMany({
    where: {
      project: { ngoId: profile.id },
      status: "SUCCESS"
    },
    include: {
      donor: true,
      project: true,
    },
    orderBy: { createdAt: "desc" }
  });

  // Aggregate by donor
  const donorMap = new Map<string, any>();
  
  for (const donation of donations) {
    const donorId = donation.donorId;
    if (!donorMap.has(donorId)) {
      donorMap.set(donorId, {
        id: donorId,
        name: donation.donor.name || "Anonymous",
        email: donation.donor.email,
        totalDonated: 0,
        donationCount: 0,
        firstDonation: donation.createdAt,
        lastDonation: donation.createdAt,
        projectsSupported: new Set(),
        tier: donation.donor.donorTier || "STANDARD"
      });
    }
    
    const stats = donorMap.get(donorId);
    stats.totalDonated += Number(donation.amount);
    stats.donationCount += 1;
    stats.projectsSupported.add(donation.project.title);
    
    if (new Date(donation.createdAt) < new Date(stats.firstDonation)) {
      stats.firstDonation = donation.createdAt;
    }
    if (new Date(donation.createdAt) > new Date(stats.lastDonation)) {
      stats.lastDonation = donation.createdAt;
    }
  }

  const crmDonors = Array.from(donorMap.values()).sort((a, b) => b.totalDonated - a.totalDonated);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
              Donor CRM
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Manage relationships and track engagement with your supporters.
            </p>
          </div>
          <div className="flex gap-3">
            <button className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-xl text-sm font-semibold transition shadow-sm">
              Export CSV
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
          {crmDonors.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">No donors yet</h3>
              <p className="text-gray-500 mt-2">When people donate to your projects, they will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-gray-50/50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-6 py-4 font-semibold">Donor Name</th>
                    <th className="px-6 py-4 font-semibold">Total Donated</th>
                    <th className="px-6 py-4 font-semibold">Last Donation</th>
                    <th className="px-6 py-4 font-semibold">Tier</th>
                    <th className="px-6 py-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {crmDonors.map((donor) => (
                    <tr key={donor.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-bold flex items-center justify-center text-xs">
                            {donor.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-gray-900 dark:text-white">{donor.name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{donor.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-bold text-gray-900 dark:text-white">
                          ₹{donor.totalDonated.toLocaleString('en-IN')}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {donor.donationCount} {donor.donationCount === 1 ? 'donation' : 'donations'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-gray-700 dark:text-gray-300">
                          {new Date(donor.lastDonation).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide ${
                          donor.tier === 'MAJOR_DONOR' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
                          donor.tier === 'COMMITTED' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                          'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                        }`}>
                          {donor.tier.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <a 
                          href={`mailto:${donor.email}?subject=Thank you from ${profile.orgName}`}
                          className="inline-flex items-center justify-center bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 w-8 h-8 rounded-lg transition"
                          title="Email Donor"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                          </svg>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
