import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import NotificationsClient from "./NotificationsClient";

export const dynamic = "force-dynamic";

/**
 * Every in-app notification for the signed-in user, any role. The bell shows
 * the latest 20; this is the full, paged list behind it.
 */
export default async function NotificationsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/notifications");
  return <NotificationsClient />;
}
