import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import PitchDeckSection from "@/components/ngo/PitchDeckSection";

export default async function NGOPitchDeckPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  // Admin or NGO can view
  if (session.user.role !== "NGO" && session.user.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  // Ensure they have an approved profile if they are an NGO
  if (session.user.role === "NGO") {
    const profile = await prisma.nGOProfile.findUnique({
      where: { userId: session.user.id },
    });

    if (!profile) {
      redirect("/ngo/register");
    }

    if (profile.verificationStatus !== "VERIFIED") {
      redirect("/ngo/dashboard");
    }
  }

  return (
    <div className="font-sans">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900 mb-8 tracking-tight">
          Pitch Deck Generator
        </h1>
        <PitchDeckSection />
      </main>
    </div>
  );
}
