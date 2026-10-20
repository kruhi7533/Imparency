import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";

/**
 * POST /api/admin/search { q } — one search across the admin catalogue
 * (roadmap row 7): organisations, donors, projects, CSR requirements,
 * contracts. Up to 8 per kind; exact ids match too.
 *
 * POST, not GET: admins search by email, PAN or phone, and a query string ends
 * up in URLs, history and server logs — personal data never goes in a URL
 * (CLAUDE.md, Privacy). Read-only, so it writes no audit entry (EXEMPT in
 * tests/admin-audit-coverage.test.ts).
 */
const TAKE = 8;

export async function POST(request: Request) {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;
  const rl = await checkRateLimit(request, "admin/search", 60, 60);
  if (rl.isBlocked) return rl.response;

  const body = await request.json().catch(() => ({}));
  const q = typeof body?.q === "string" ? body.q.trim().slice(0, 100) : "";
  if (q.length < 2) return NextResponse.json({ error: "Type at least 2 characters." }, { status: 400 });
  const like = { contains: q, mode: "insensitive" as const };

  const [ngos, donors, projects, requirements, contracts] = await Promise.all([
    prisma.nGOProfile.findMany({
      where: { OR: [{ id: q }, { orgName: like }, { registrationNumber: like }, { panNumber: { contains: q.toUpperCase() } }] },
      take: TAKE,
      select: { id: true, orgName: true, verificationStatus: true },
    }),
    prisma.user.findMany({
      where: { role: "DONOR", OR: [{ id: q }, { name: like }, { email: like }, { companyName: like }, { panNumber: { contains: q.toUpperCase() } }] },
      take: TAKE,
      select: { id: true, name: true, email: true, companyName: true },
    }),
    prisma.project.findMany({
      where: { isDeleted: false, OR: [{ id: q }, { title: like }] },
      take: TAKE,
      select: { id: true, title: true, status: true, ngo: { select: { orgName: true } } },
    }),
    prisma.sponsorRequirement.findMany({
      where: { OR: [{ id: q }, { fileName: like }] },
      take: TAKE,
      select: { id: true, fileName: true, status: true },
    }),
    prisma.contract.findMany({
      where: { OR: [{ id: q }, { contractNumber: like }, { title: like }] },
      take: TAKE,
      select: { id: true, contractNumber: true, title: true, status: true },
    }),
  ]);

  return NextResponse.json({
    results: [
      ...ngos.map((n) => ({ kind: "Organisation", id: n.id, title: n.orgName, sub: n.verificationStatus.toLowerCase(), href: `/admin/ngos/${n.id}` })),
      ...donors.map((d) => ({ kind: "Donor", id: d.id, title: d.companyName || d.name || d.email, sub: d.email, href: `/admin/donors/${d.id}` })),
      ...projects.map((p) => ({ kind: "Project", id: p.id, title: p.title, sub: `${p.ngo.orgName} · ${p.status.toLowerCase()}`, href: `/projects/${p.id}` })),
      ...requirements.map((r) => ({ kind: "CSR requirement", id: r.id, title: r.fileName || "Requirement", sub: r.status.replace(/_/g, " ").toLowerCase(), href: `/admin/requirements/${r.id}` })),
      ...contracts.map((c) => ({ kind: "Contract", id: c.id, title: `${c.contractNumber} — ${c.title}`, sub: c.status.toLowerCase(), href: `/admin/contracts/${c.id}` })),
    ],
  });
}
