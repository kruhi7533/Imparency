import type { AuditItem } from "@/lib/requirements/queries";

/** Admin-only requirement timeline (who did what, when, and the status change). */
export function AuditTrail({ events }: { events: AuditItem[] }) {
  if (events.length === 0) return <p className="text-xs text-gray-500">No events recorded.</p>;
  return (
    <ol className="space-y-2">
      {events.map((e) => (
        <li key={e.id} className="text-xs border-l-2 border-gray-800 pl-3">
          <p className="text-gray-200">
            <span className="font-mono font-bold text-gray-300">{e.action}</span>
            <span className="text-gray-500"> · {e.actorRole}</span>
            {e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus && (
              <span className="text-gray-500">
                {" "}
                · {e.fromStatus} → {e.toStatus}
              </span>
            )}
          </p>
          {e.detail && <p className="text-gray-400">{e.detail}</p>}
          {Array.isArray(e.metadata?.changedFields) && (
            <ul className="text-gray-500 mt-0.5">
              {e.metadata.changedFields.map((c: any) => (
                <li key={c.field}>
                  {c.field}: {JSON.stringify(c.from)} → {JSON.stringify(c.to)}
                </li>
              ))}
            </ul>
          )}
          <p className="text-gray-600">{new Date(e.createdAt).toLocaleString("en-IN")}</p>
        </li>
      ))}
    </ol>
  );
}
