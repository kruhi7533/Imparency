import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { uploadFile } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rate-limiter";
import { DRAFT_DOC_SLOTS, isDraftDocuments, sanitizeDraftFields, validateDraftPdf, type DraftDocuments } from "@/lib/registration-draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function view(d: { status: string; fields: unknown; documents: unknown; updatedAt: Date; submittedAt: Date | null }) {
  const docs = isDraftDocuments(d.documents) ? d.documents : {};
  return {
    status: d.status,
    fields: d.fields,
    // File names only — the URL is a private-storage path the client never needs.
    documents: Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, { name: (v as any)?.name ?? "uploaded.pdf" }])),
    updatedAt: d.updatedAt.toISOString(),
    submittedAt: d.submittedAt?.toISOString() ?? null,
  };
}

/**
 * GET /api/ngo/register/draft — what to prefill the registration form with:
 * the caller's saved draft (if any) and, for an NGO that already submitted
 * (PENDING / REJECTED / VERIFIED re-upload), its current profile fields. The
 * client lets the newer of the two win. Only the caller's own rows.
 */
export async function GET() {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const [draft, profile] = await Promise.all([
      prisma.ngoRegistrationDraft.findUnique({ where: { userId: session.user.id } }),
      prisma.nGOProfile.findUnique({
        where: { userId: session.user.id },
        select: {
          orgName: true,
          registrationNumber: true,
          panNumber: true,
          address: true,
          website: true,
          foundedYear: true,
          description: true,
          causeCategories: true,
          verificationStatus: true,
          updatedAt: true,
        },
      }),
    ]);
    return NextResponse.json({
      draft: draft && draft.status === "DRAFT" ? view(draft) : null,
      profile: profile
        ? {
            fields: {
              orgName: profile.orgName,
              registrationNumber: profile.registrationNumber,
              panNumber: profile.panNumber,
              address: profile.address,
              website: profile.website ?? "",
              foundedYear: String(profile.foundedYear),
              description: profile.description,
              causeCategories: profile.causeCategories,
            },
            verificationStatus: profile.verificationStatus,
            updatedAt: profile.updatedAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    console.error("[api/ngo/register/draft] GET error:", error);
    return NextResponse.json({ error: "Failed to load draft" }, { status: 500 });
  }
}

/**
 * PUT multipart — save progress. Text fields are optional (a draft may be
 * incomplete); any PDF sent in a document slot is uploaded to private storage
 * and replaces that slot. Keyed on the user, so saving twice updates one row.
 * Only the caller's own draft is ever read or written.
 */
export async function PUT(request: Request) {
  const rl = await checkRateLimit(request, "ngo/register/draft", 60, 3600);
  if (rl.isBlocked) return rl.response;
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const userId: string = session.user.id;

    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });

    const raw: Record<string, unknown> = {};
    form.forEach((v, k) => {
      if (typeof v === "string") raw[k] = v;
    });
    const fields = sanitizeDraftFields(raw);

    const existing = await prisma.ngoRegistrationDraft.findUnique({ where: { userId } });
    const docs: DraftDocuments = existing && existing.status === "DRAFT" && isDraftDocuments(existing.documents) ? { ...existing.documents } : {};
    for (const slot of DRAFT_DOC_SLOTS) {
      const f = form.get(slot);
      if (!f || typeof f === "string" || (f as File).size === 0) continue;
      const file = f as File;
      const problem = validateDraftPdf(file);
      if (problem) return NextResponse.json({ error: `${slot} ${problem}` }, { status: 400 });
      const url = await uploadFile(Buffer.from(await file.arrayBuffer()), file.name, "documents", { private: true });
      docs[slot] = { url, name: file.name.slice(0, 200) };
    }

    const saved = await prisma.ngoRegistrationDraft.upsert({
      where: { userId },
      create: { userId, fields: fields as any, documents: docs as any },
      // Re-opening a SUBMITTED draft (e.g. after rejection) starts a fresh draft.
      update: { fields: fields as any, documents: docs as any, status: "DRAFT", submittedAt: null },
    });
    return NextResponse.json({ draft: view(saved) });
  } catch (error) {
    console.error("[api/ngo/register/draft] PUT error:", error);
    return NextResponse.json({ error: "Failed to save draft" }, { status: 500 });
  }
}
