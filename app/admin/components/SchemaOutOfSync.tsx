/**
 * The card an admin page shows when a Prisma query fails outright.
 *
 * One component rather than four near-identical copies, which is how the
 * wording drifted: some copies named only the database cause, so the second
 * cause — by far the more common one in day-to-day work — went unmentioned and
 * every occurrence cost someone the same ten minutes.
 *
 * The two causes, and they need different fixes:
 *
 *   1. The branch's database is behind the Prisma schema. Fix with `db:sync`.
 *   2. A dev server that has been running since BEFORE the last migration is
 *      holding a Prisma client generated when the new column did not exist.
 *      The database is fine and `db:sync` changes nothing; the process has to
 *      restart, because `predev` is what regenerates the client. Tell-tale
 *      wording in the error: "Unknown argument" or "reading 'findMany'" of
 *      undefined.
 */
export default function SchemaOutOfSync({
  title = "This page failed to load",
  detail,
}: {
  title?: string;
  detail?: string;
}) {
  const looksLikeStaleClient =
    !!detail && (detail.includes("Unknown argument") || detail.includes("reading 'findMany'"));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900/40 rounded-2xl shadow-sm p-8">
        <h1 className="text-xl font-extrabold text-gray-900 dark:text-white">{title}</h1>

        {looksLikeStaleClient ? (
          <>
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              This looks like a <strong>stale Prisma client</strong>, not a database problem. The dev server has been
              running since before the last migration, so it is still using a client generated without this column.
              Restart it — <code className="font-mono text-xs">predev</code> regenerates the client on startup:
            </p>
            <pre className="mt-3 rounded-lg bg-gray-900 text-emerald-300 text-sm px-4 py-3 font-mono">npm run dev</pre>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-500">
              If it persists after a restart, the database really is behind — run{" "}
              <code className="font-mono">npm run db:sync</code>.
            </p>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              A database query failed — usually the branch&apos;s database is behind the Prisma schema:
            </p>
            <pre className="mt-3 rounded-lg bg-gray-900 text-emerald-300 text-sm px-4 py-3 font-mono">npm run db:sync</pre>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-500">
              If the database is already in sync, restart the dev server — a long-running one holds the Prisma client
              it started with.
            </p>
          </>
        )}

        {detail && (
          <p className="mt-4 text-xs text-gray-400 font-mono break-all border-t border-gray-100 dark:border-gray-800 pt-3">
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}
