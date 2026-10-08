import prisma from "@/lib/prisma";
import EvidenceReviewActions from "./EvidenceReviewActions";
import { duplicateLabel } from "@/lib/proof-fingerprint";

export const dynamic = "force-dynamic";

/**
 * Week 7 field evidence queue (minimal). Pending photos with the flags a
 * reviewer needs — GPS against the project site, duplicate image, captured
 * offline, beneficiary consent — and approve / request resubmission / reject.
 * Access is gated by app/admin/layout.tsx; the PATCH route checks ADMIN itself.
 */
export default async function FieldEvidenceQueuePage() {
  const pending = await prisma.fieldEvidence.findMany({
    where: { status: "PENDING_REVIEW" },
    orderBy: { syncedAt: "asc" },
    take: 100,
    include: {
      task: { select: { title: true, project: { select: { title: true, location: true } } } },
      feedback: { select: { consentToRecord: true, consentToSharePhoto: true, withdrawnAt: true, rating: true, feedbackText: true } },
    },
  });

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Field evidence</h1>
        <p className="text-sm text-gray-500">
          {pending.length} awaiting review. Donors see a photo only after approval — and, if it shows people, only with the
          beneficiary&apos;s consent to share.
        </p>
      </div>

      {pending.length === 0 && <p className="text-sm text-gray-400 italic">Nothing waiting.</p>}

      {pending.map((e) => {
        const offline = e.syncedAt.getTime() - e.capturedAt.getTime() > 10 * 60_000;
        return (
          <div key={e.id} className="flex flex-col sm:flex-row gap-4 p-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/field/evidence/${e.id}/photo`} alt="Field evidence" className="w-full sm:w-48 h-48 rounded-xl object-cover" />
            <div className="flex-1 space-y-2 text-sm">
              <p className="font-bold text-gray-900 dark:text-white">{e.task.title}</p>
              <p className="text-xs text-gray-500">
                {e.task.project.title} · {e.task.project.location}
              </p>
              <div className="flex flex-wrap gap-1 text-xs">
                {/* NO_GPS_DATA is neutral: most phones strip location, and absence
                    of evidence is not evidence of a problem. Only MISMATCH is red. */}
                <Flag bad={e.locationStatus === "MISMATCH"}>
                  GPS {e.locationStatus.replace(/_/g, " ").toLowerCase()}
                  {e.distanceKm !== null ? ` · ${e.distanceKm.toFixed(1)} km from site` : ""}
                </Flag>
                {(() => {
                  const d = duplicateLabel(e.duplicateVerdict);
                  if (d) return <Flag bad={d.tone !== "neutral"}>{d.text}</Flag>;
                  // Rows captured before verdicts were stored.
                  return !e.duplicateVerdict && e.duplicateOfId ? <Flag bad>Duplicate of an earlier photo</Flag> : null;
                })()}
                {offline && <Flag>Captured offline, synced later</Flag>}
                {!e.containsPeople ? (
                  <Flag>No people in photo</Flag>
                ) : e.feedback?.consentToSharePhoto && !e.feedback.withdrawnAt ? (
                  <Flag>Consent to share with funder</Flag>
                ) : (
                  <Flag bad>Shows people, no consent to share — donors will not see it</Flag>
                )}
              </div>
              {e.note && <p className="text-gray-700 dark:text-gray-300">{e.note}</p>}
              {e.feedback?.consentToRecord && (e.feedback.feedbackText || e.feedback.rating) && (
                <p className="text-xs text-gray-600">
                  Beneficiary feedback{e.feedback.rating ? ` (${e.feedback.rating}/5)` : ""}: {e.feedback.feedbackText}
                </p>
              )}
              <p className="text-xs text-gray-400">
                Captured {e.capturedAt.toLocaleString("en-IN")} · synced {e.syncedAt.toLocaleString("en-IN")}
              </p>
              <EvidenceReviewActions evidenceId={e.id} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Flag({ bad = false, children }: { bad?: boolean; children: React.ReactNode }) {
  return (
    <span className={`px-2 py-0.5 rounded-full font-bold ${bad ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-700"}`}>
      {children}
    </span>
  );
}
