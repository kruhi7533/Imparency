import FieldEvidenceQueue from "./FieldEvidenceQueue";

export const dynamic = "force-dynamic";

/**
 * Field evidence review queue (ADM-012). The list, filters and decisions all
 * go through the API (GET /api/admin/field-evidence, PATCH .../[id]) so the
 * page and any other client see the same rules. Access is gated by
 * app/admin/layout.tsx; both routes check ADMIN themselves.
 */
export default function FieldEvidenceQueuePage() {
  return <FieldEvidenceQueue />;
}
