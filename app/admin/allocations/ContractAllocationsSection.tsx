import Link from "next/link";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { fundingSummary } from "@/lib/contract-payments";
import { allocatedByMilestone, countingLines, unallocatedByPayment } from "@/lib/contract-funding";
import { AllocationLineDecision, ManualAllocationForm } from "./ContractAllocationActions";

/**
 * Requirement → contract flow: committed vs cash per contract, the receivable
 * schedule per milestone (ADM-008), and the payment → milestone allocation
 * lines waiting for an admin (ADM-011). Server component, real data only.
 */

const inr = (v: { toString(): string } | string | number) =>
  `₹${Number(v.toString()).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const FUNDING_CLS: Record<string, string> = {
  UNFUNDED: "bg-gray-100 text-gray-600",
  PARTIALLY_FUNDED: "bg-amber-100 text-amber-700",
  FUNDED: "bg-emerald-100 text-emerald-700",
};
const LINE_CLS: Record<string, string> = {
  PENDING_APPROVAL: "bg-amber-100 text-amber-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
};

export default async function ContractAllocationsSection() {
  const contracts = await prisma.contract.findMany({
    where: { status: { in: ["ACTIVE", "COMPLETED"] } },
    orderBy: { updatedAt: "desc" },
    take: 25,
    select: {
      id: true,
      contractNumber: true,
      title: true,
      requirementId: true,
      totalGrantAmount: true,
      fundedAt: true,
      ngo: { select: { orgName: true } },
      milestones: {
        orderBy: { orderIndex: "asc" },
        select: { id: true, title: true, allocatedAmount: true, dueDate: true, fundingStatus: true },
      },
      payments: { orderBy: { paidAt: "asc" }, select: { id: true, amount: true, status: true, reference: true, mode: true, paidAt: true, contractMilestoneId: true } },
      paymentAllocations: {
        orderBy: { createdAt: "asc" },
        select: { id: true, paymentId: true, contractMilestoneId: true, amount: true, status: true, rule: true },
      },
    },
  });

  const pendingLines = contracts.reduce((n, c) => n + c.paymentAllocations.filter((a) => a.status === "PENDING_APPROVAL").length, 0);

  return (
    <section>
      <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-1">
        Contract milestone allocations — requirement → contract ({pendingLines} awaiting approval)
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 max-w-3xl">
        Each contract payment is split onto milestones when it is recorded (the donor&rsquo;s chosen milestone, or
        milestones filled in order). A milestone is funded only by <strong>reconciled</strong> money. Approving a line
        vouches that reconciled cash belongs to that milestone; rejecting one frees it to be allocated by hand.
      </p>
      {contracts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-10 text-center">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No signed contracts yet.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {contracts.map((c) => {
            const summary = fundingSummary(c, c.milestones, c.payments, c.paymentAllocations);
            const counting = countingLines(c.paymentAllocations, c.payments);
            const used = allocatedByMilestone(counting);
            const unallocated = unallocatedByPayment(c.payments, c.paymentAllocations);
            const title = (id: string) => c.milestones.find((m) => m.id === id)?.title ?? "—";
            const payment = (id: string) => c.payments.find((p) => p.id === id);
            const rooms = c.milestones
              .map((m) => ({ id: m.id, title: m.title, room: new Prisma.Decimal(m.allocatedAmount).minus(used.get(m.id) ?? 0) }))
              .filter((m) => m.room.greaterThan(0))
              .map((m) => ({ ...m, room: m.room.toFixed(2) }));
            return (
              <li key={c.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">
                      {c.contractNumber} · {c.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {c.ngo.orgName}
                      {c.requirementId && (
                        <>
                          {" · "}
                          <Link href={`/admin/requirements/${c.requirementId}`} className="underline">
                            requirement
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p>
                      Committed <strong>{inr(summary.committed)}</strong> · Reconciled cash{" "}
                      <strong className="text-emerald-700">{inr(summary.reconciled)}</strong> · Pending{" "}
                      <strong className="text-amber-700">{inr(summary.pending)}</strong>
                    </p>
                    <p className={c.fundedAt ? "text-emerald-700 font-bold" : "text-gray-400"}>
                      {c.fundedAt ? `Contract FUNDED ${c.fundedAt.toLocaleDateString("en-IN")}` : "Not fully funded"}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-[11px] uppercase tracking-wide text-gray-400">
                      <tr>
                        <th className="text-left py-1">Receivable (milestone)</th>
                        <th className="text-left py-1">Due</th>
                        <th className="text-right py-1">Committed</th>
                        <th className="text-right py-1">Pending</th>
                        <th className="text-right py-1">Reconciled</th>
                        <th className="text-right py-1">Allocated</th>
                        <th className="text-right py-1">Outstanding</th>
                        <th className="text-right py-1">Funding</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {c.milestones.map((m) => {
                        const f = summary.milestones.find((x) => x.id === m.id)!;
                        const overdue = !!m.dueDate && m.dueDate.getTime() < Date.now() && f.fundingStatus !== "FUNDED";
                        return (
                          <tr key={m.id}>
                            <td className="py-1.5 font-medium text-gray-900 dark:text-white">{m.title}</td>
                            <td className={`py-1.5 ${overdue ? "text-red-600 font-bold" : "text-gray-500"}`}>
                              {m.dueDate ? m.dueDate.toLocaleDateString("en-IN") : "—"}
                              {overdue && " · overdue"}
                            </td>
                            <td className="py-1.5 text-right">{inr(f.allocated)}</td>
                            <td className="py-1.5 text-right text-amber-700">{inr(f.pending)}</td>
                            <td className="py-1.5 text-right text-emerald-700 font-bold">{inr(f.reconciled)}</td>
                            <td className="py-1.5 text-right">{inr(f.approved)}</td>
                            <td className="py-1.5 text-right">{inr(f.outstanding)}</td>
                            <td className="py-1.5 text-right">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${FUNDING_CLS[f.fundingStatus]}`}>
                                {f.fundingStatus.replace("_", " ")}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {c.paymentAllocations.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-[11px] uppercase tracking-wide text-gray-400">
                        <tr>
                          <th className="text-left py-1">Payment (ref)</th>
                          <th className="text-left py-1">Payment status</th>
                          <th className="text-left py-1">Milestone</th>
                          <th className="text-right py-1">Amount</th>
                          <th className="text-left py-1 pl-3">Rule</th>
                          <th className="text-left py-1">Line</th>
                          <th className="text-right py-1">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {c.paymentAllocations.map((a) => {
                          const p = payment(a.paymentId);
                          return (
                            <tr key={a.id}>
                              <td className="py-1.5 font-mono text-gray-500">{p?.reference ?? a.paymentId.slice(0, 8)}</td>
                              <td className="py-1.5 text-gray-600">{p?.status.replace("_", " ").toLowerCase()}</td>
                              <td className="py-1.5">{title(a.contractMilestoneId)}</td>
                              <td className="py-1.5 text-right font-bold">{inr(a.amount)}</td>
                              <td className="py-1.5 pl-3 text-gray-500">{a.rule.replaceAll("_", " ").toLowerCase()}</td>
                              <td className="py-1.5">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${LINE_CLS[a.status]}`}>
                                  {a.status.replace("_", " ")}
                                </span>
                              </td>
                              <td className="py-1.5 text-right">
                                {a.status === "PENDING_APPROVAL" && (
                                  <AllocationLineDecision allocationId={a.id} canApprove={p?.status === "RECONCILED"} />
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {Array.from(unallocated.entries())
                  .filter(([, left]) => left.greaterThan(0))
                  .map(([paymentId, left]) => (
                    <div key={paymentId} className="rounded-lg bg-amber-50 dark:bg-amber-950/20 p-2 text-xs space-y-1">
                      <p className="text-amber-800 dark:text-amber-300">
                        Payment {payment(paymentId)?.reference ?? paymentId.slice(0, 8)} has <strong>{inr(left)}</strong> not
                        allocated to any milestone.
                      </p>
                      <ManualAllocationForm paymentId={paymentId} unallocated={left.toFixed(2)} milestones={rooms} />
                    </div>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
