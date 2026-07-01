import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DonorSidebarShell } from "@/components/donor/DonorSidebarShell";

export default async function DonorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "DONOR") {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-gray-950 flex">
      <DonorSidebarShell
        userName={session.user.name ?? "Donor"}
        userEmail={session.user.email ?? ""}
        userId={session.user.id}
      />
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  );
}
