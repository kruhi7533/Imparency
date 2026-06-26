import { redirect } from "next/navigation";

export const runtime = "nodejs";

export default function AdminFraudAlertsPage() {
  redirect("/admin/risk-compliance");
}
