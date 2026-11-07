"use client";

import { useRouter } from "next/navigation";

type QueueCount = { queue: string; count: number };

/**
 * One dropdown instead of a pill for every queue — the same picks (All, Past
 * target, each queue) made one at a time instead of all shown together.
 */
export default function InboxFilterSelect({
  queues,
  totalCount,
  breachedCount,
  activeQueue,
  onlyBreached,
}: {
  queues: QueueCount[];
  totalCount: number;
  breachedCount: number;
  activeQueue: string | undefined;
  onlyBreached: boolean;
}) {
  const router = useRouter();

  const value = onlyBreached ? "__breached" : activeQueue ?? "__all";

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="inbox-filter" className="text-xs font-bold text-gray-600">
        Filter
      </label>
      <select
        id="inbox-filter"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__all") router.push("/admin/today");
          else if (v === "__breached") router.push("/admin/today?breached=1");
          else router.push(`/admin/today?queue=${encodeURIComponent(v)}`);
        }}
        className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 focus:outline-none focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20"
      >
        <option value="__all">All · {totalCount}</option>
        {breachedCount > 0 && <option value="__breached">Past target · {breachedCount}</option>}
        {queues.map(({ queue, count }) => (
          <option key={queue} value={queue}>
            {queue} · {count}
          </option>
        ))}
      </select>
    </div>
  );
}
