import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
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

  // Badge on "Payment Tracking": the donor's own failed payments. A count
  // failure must never take the portal down, so it degrades to no badge.
  const failedPayments = await prisma.donation
    .count({ where: { donorId: session.user.id, status: "FAILED" } })
    .catch(() => 0);

  return (
    <DonorSidebarShell
      userName={session.user.name ?? "Donor"}
      userEmail={session.user.email ?? ""}
      userId={session.user.id}
      failedPayments={failedPayments}
    >
      {children}
    </DonorSidebarShell>
  );
}
