import prisma from "@/lib/prisma";
import Link from "next/link";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import IntegrityClient from "./IntegrityClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Audit integrity (ADM-017 / NEG-013): the hash chain over AdminActionLog,
 * a Verify button, signed head checkpoints, and upload-to-verify for an
 * exported CSV. Threat model: docs/AUDIT-INTEGRITY.md.
 */
export default async function AuditIntegrityPage() {
  let head, checkpoints, lastVerify;
  try {
    [head, checkpoints, lastVerify] = await Promise.all([
      prisma.auditChainHead.findUnique({ where: { id: 1 } }),
      prisma.auditChainCheckpoint.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      prisma.adminActionLog.findFirst({
        where: { action: "AUDIT_CHAIN_VERIFIED", entityId: "audit-trail" },
        orderBy: { seq: "desc" },
        select: { createdAt: true, metadata: true },
      }),
    ]);
  } catch (err: any) {
    return <SchemaOutOfSync title="Audit integrity failed to load" detail={err?.message ?? String(err)} />;
  }

  const keyConfigured = !!process.env.AUDIT_CHAIN_KEY;
  const lastMeta = (lastVerify?.metadata ?? null) as { ok?: boolean; breakSeq?: number | null; breakReason?: string | null } | null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <Link href="/admin/audit" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">← Audit trail</Link>
        <h1 className="mt-2 text-2xl font-extrabold text-gray-900 dark:text-white">Audit integrity</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-3xl">
          Every audit row carries a sequence number and a SHA-256 hash of its content plus the previous row&apos;s hash,
          assigned by the database. The table rejects updates and deletes. Verify walks the whole chain and names the
          first row that was changed, removed or re-linked.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="text-xs font-semibold uppercase text-gray-500">Chain head</div>
            <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">seq {head?.seq ?? 0}</div>
            <div className="mt-1 break-all font-mono text-[11px] text-gray-500">{head?.hash ?? "no rows yet"}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="text-xs font-semibold uppercase text-gray-500">Last verification</div>
            {lastVerify ? (
              <>
                <div className={`mt-1 text-lg font-bold ${lastMeta?.ok ? "text-emerald-600" : "text-red-600"}`}>
                  {lastMeta?.ok ? "Intact" : `Broken at seq ${lastMeta?.breakSeq ?? "?"} (${lastMeta?.breakReason ?? "?"})`}
                </div>
                <div className="text-xs text-gray-500">{lastVerify.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC</div>
              </>
            ) : (
              <div className="mt-1 text-sm text-gray-500">Never verified.</div>
            )}
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="text-xs font-semibold uppercase text-gray-500">Checkpoint signing key</div>
            <div className={`mt-1 text-lg font-bold ${keyConfigured ? "text-emerald-600" : "text-amber-600"}`}>
              {keyConfigured ? "AUDIT_CHAIN_KEY set" : "Not configured"}
            </div>
            <div className="text-xs text-gray-500">
              {keyConfigured
                ? "Checkpoints are HMAC-signed."
                : "Checkpoints are recorded unsigned; set AUDIT_CHAIN_KEY to sign them."}
            </div>
          </div>
        </div>

        <IntegrityClient />

        <h2 className="mt-10 text-lg font-bold text-gray-900 dark:text-white">Recent checkpoints</h2>
        {checkpoints.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No checkpoints yet. Record one to anchor the current head.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-800">
                <tr>
                  <th className="px-3 py-2">When (UTC)</th>
                  <th className="px-3 py-2">Seq</th>
                  <th className="px-3 py-2">Head hash</th>
                  <th className="px-3 py-2">Signed</th>
                </tr>
              </thead>
              <tbody>
                {checkpoints.map((cp) => (
                  <tr key={cp.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">{cp.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white">{cp.seq}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-500 break-all">{cp.hash}</td>
                    <td className="px-3 py-2">{cp.hmac ? <span className="text-emerald-600">HMAC ({cp.keyFingerprint})</span> : <span className="text-amber-600">unsigned</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-8 text-xs text-gray-500 dark:text-gray-400 max-w-3xl">
          What this does not cover: someone with database superuser access can disable the triggers and rewrite the
          entire chain consistently. Signed checkpoints catch that only if the key is not on the same machine, and only
          for rows up to the last checkpoint — publish the head hash outside the platform (e.g. in a board report) to
          anchor it. See docs/AUDIT-INTEGRITY.md.
        </p>
      </div>
    </div>
  );
}
