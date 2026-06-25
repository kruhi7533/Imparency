import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import DonorProfileClient from "./DonorProfileClient";

export const dynamic = "force-dynamic";

export default async function DonorProfilePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "DONOR") {
    redirect("/login?callbackUrl=/donor/profile");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });

  if (!user) {
    redirect("/login");
  }

  // Serialize models to plain JSON objects
  const serializedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    city: user.city || "",
    billingAddress: user.billingAddress || "",
    panNumber: user.panNumber || "",
    isCorporate: user.isCorporate,
    companyName: user.companyName || "",
    gstNumber: user.gstNumber || "",
    totalDonated: Number(user.totalDonated),
    createdAt: user.createdAt.toISOString(),
  };

  return (
    <DonorProfileClient user={serializedUser} />
  );
}
