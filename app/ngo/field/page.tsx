import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import FieldApp from "./FieldApp";

export const dynamic = "force-dynamic";

/** Week 7 mobile field capture. Works offline once opened (see public/field-sw.js). */
export default async function FieldPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "NGO") redirect("/login?callbackUrl=/ngo/field");
  return <FieldApp userName={session.user.name || "Field worker"} />;
}
