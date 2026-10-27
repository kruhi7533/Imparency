import prisma from "@/lib/prisma";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Donor notification delivery log (DON-018 / NEG-011): every channel attempt
 * with its status and reason. Ids only — no email address or phone number.
 */
const STATUSES = ["SENT", "FAILED", "OPTED_OUT", "PROVIDER_NOT_CONFIGURED"];
const CHANNELS = ["IN_APP", "WHATSAPP", "EMAIL"];
const STATUS_STYLE: Record<string, string> = {
  SENT: "text-emerald-700 dark:text-emerald-400",
  FAILED: "text-red-700 dark:text-red-400",
  OPTED_OUT: "text-gray-600 dark:text-gray-300",
  PROVIDER_NOT_CONFIGURED: "text-amber-700 dark:text-amber-400",
};

export default async function NotificationDeliveriesPage({
  searchParams,
}: {
  searchParams: { status?: string; channel?: string; userId?: string };
}) {
  const status = STATUSES.includes(searchParams.status ?? "") ? searchParams.status : undefined;
  const channel = CHANNELS.includes(searchParams.channel ?? "") ? searchParams.channel : undefined;
  const userId = searchParams.userId?.trim() || undefined;

  let rows, counts;
  try {
    [rows, counts] = await Promise.all([
      prisma.notificationDeliveryLog.findMany({
        where: { ...(status ? { status } : {}), ...(channel ? { channel } : {}), ...(userId ? { userId } : {}) },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, userId: true, eventKey: true, channel: true, status: true, reason: true, attempt: true, title: true, createdAt: true },
      }),
      prisma.notificationDeliveryLog.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
  } catch (err: any) {
    return <SchemaOutOfSync title="Delivery log failed to load" detail={err?.message ?? String(err)} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Notification deliveries</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-3xl">
          Every donor notification attempt per channel. WhatsApp is tried first and falls back to email; in-app is
          always attempted while on. Failed attempts also appear in the dead-letter queue.
        </p>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          {STATUSES.map((s) => (
            <span key={s} className={STATUS_STYLE[s]}>
              {s.replace(/_/g, " ").toLowerCase()}: <strong>{counts.find((c) => c.status === s)?._count._all ?? 0}</strong>
            </span>
          ))}
        </div>
        <form method="GET" className="mt-4 flex flex-wrap gap-2">
          <select name="status" defaultValue={status ?? ""} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select name="channel" defaultValue={channel ?? ""} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white">
            <option value="">All channels</option>
            {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input name="userId" defaultValue={userId} placeholder="Donor user id" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Filter</button>
        </form>
        {rows.length === 0 ? (
          <p className="mt-8 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700">No delivery attempts recorded.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-800">
                <tr>
                  <th className="px-3 py-2">When (UTC)</th>
                  <th className="px-3 py-2">Donor id</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Channel</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 align-top dark:border-gray-800">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">{r.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-500">{r.userId}</td>
                    <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-200">
                      <div>{r.title}</div>
                      <div className="font-mono text-[11px] text-gray-400">{r.eventKey}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{r.channel}</td>
                    <td className={`px-3 py-2 text-xs font-semibold ${STATUS_STYLE[r.status] ?? ""}`}>{r.status}</td>
                    <td className="px-3 py-2 text-xs">{r.attempt}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{r.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
