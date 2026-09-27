import Link from "next/link";

/**
 * Says out loud that this page belongs to the funder-led track, which the
 * CSR requirement workflow replaced.
 *
 * The pages were taken out of the navigation when the Grants hub was removed,
 * but every route still resolves and still works, and the dev database holds
 * more data on this track than on the one that replaced it. An admin who
 * reaches one of these by URL, a bookmark, or a stale link has no way to know
 * they are looking at the wrong system — two sets of tables answering the same
 * question, in nearly the same words.
 *
 * Deliberately a notice and not a redirect. Admin may still need to represent
 * an offline funder here until that decision is made, and silently bouncing
 * someone off a working page is worse than telling them where they are.
 */
export default function SupersededTrackNotice({ page }: { page: "opportunities" | "proposals" }) {
  return (
    <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
      <p className="text-sm font-extrabold text-amber-800 dark:text-amber-400">
        Superseded — this is the funder-led track
      </p>
      <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
        {page === "opportunities"
          ? "Opportunities created here are admin-run, on behalf of a funder with no account. "
          : "Proposals decided here are admin-approved, on behalf of a funder with no account. "}
        The live workflow is donor-led: a CSR organisation posts its own requirement, the platform
        matches it, and the donor selects. This page still works and is still reachable, but nothing
        on it feeds the CSR track, and the two do not share data.
      </p>
      <Link
        href="/admin/requirements"
        className="mt-2 inline-block text-xs font-bold text-amber-800 underline dark:text-amber-400"
      >
        Go to CSR requirements →
      </Link>
    </div>
  );
}
