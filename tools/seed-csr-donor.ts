/**
 * A real-style CSR company to walk the donor flow end to end (roadmap row 14,
 * "real-style CSR flow; donor UAT"). Pairs with docs/DONOR-GUIDE.md.
 *
 *   npx tsx -r dotenv/config tools/seed-csr-donor.ts            # dry run
 *   npx tsx -r dotenv/config tools/seed-csr-donor.ts -- --apply
 *   npm run seed:csr -- --apply
 *
 * House rules, as in tools/seed-ngo-demo.ts:
 *
 * 1. It REFUSES rather than fabricates prerequisites: it needs the demo NGOs
 *    from `npm run seed` (scripts/seed-demo.ts) so the requirement has a real
 *    project to match.
 * 2. Nothing it writes is a verdict. The company is left PENDING verification;
 *    the requirement is a donor draft (DONOR_REVIEW). Admin verification,
 *    validation, matching, selection, contract and payments are the UAT's to do
 *    through the app — a seeded "verified" or "approved" would prove nothing.
 *
 * Idempotent: users are upserted, team rows upserted, and the requirement is
 * created only if this account has none with the same title.
 */
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma";
import { confidenceMap, FORM_ENTRY_AGENT, withDonorProvenance } from "../lib/requirements/provenance";

const APPLY = process.argv.includes("--apply");
const PASSWORD = "demoPassword123";
const OWNER = { email: "csr.acme@demo.com", name: "Meera Iyer" };
const TEAM = [
  { email: "approver.acme@demo.com", name: "Arjun Nair", role: "APPROVER" as const },
  { email: "viewer.acme@demo.com", name: "Kavya Shah", role: "VIEWER" as const },
];
const TITLE = "FY 2026-27 — Digital learning in Karnataka government schools";

async function main() {
  console.log(APPLY ? "APPLYING\n" : "DRY RUN — nothing will be written. Pass --apply.\n");

  const ngo = await prisma.user.findUnique({ where: { email: "akshar@demo.org" }, select: { ngoProfile: { select: { id: true } } } });
  if (!ngo?.ngoProfile) {
    console.error("REFUSING: the demo NGOs are missing. Run `npm run seed` (scripts/seed-demo.ts) first.");
    process.exitCode = 1;
    return;
  }

  console.log(`CSR company  : Acme Industries Ltd — owner ${OWNER.email} (verification PENDING)`);
  TEAM.forEach((t) => console.log(`Team member  : ${t.role.padEnd(9)} ${t.email}`));
  console.log(`Requirement  : "${TITLE}" (DONOR_REVIEW, Education, Karnataka, ₹2.5–4 lakh, 1,000 students, quarterly)`);
  if (!APPLY) return;

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const owner = await prisma.user.upsert({
    where: { email: OWNER.email },
    update: {},
    create: {
      email: OWNER.email,
      name: OWNER.name,
      passwordHash,
      role: "DONOR",
      donorPersona: "CSR_OFFICER",
      isCorporate: true,
      companyName: "Acme Industries Ltd",
      // A syntactically valid, fictional CIN.
      cin: "U29100MH2004PLC123456",
      // Fictional, format-valid company PAN (4th letter C). Left UNVERIFIED:
      // the funder gate refuses matching until an admin verifies it.
      panNumber: "AAACA1234Q",
      csrRegistrationNumber: "CSR00012345",
      csrBudget: 2500000,
      csrPolicySummary:
        "Board-approved policy (FY 2026-27): education and skilling in Karnataka and Maharashtra, implemented through verified NGOs, with quarterly outcome reporting and an annual impact assessment.",
      csrFocusAreas: ["Education", "Livelihood"],
      orgVerificationStatus: "PENDING",
      orgSubmittedAt: new Date(),
    },
    select: { id: true, panNumber: true },
  });
  // Accounts seeded before the PAN was added get it now (only if empty).
  if (!owner.panNumber) await prisma.user.update({ where: { id: owner.id }, data: { panNumber: "AAACA1234Q" } });

  for (const t of TEAM) {
    const user = await prisma.user.upsert({
      where: { email: t.email },
      update: {},
      create: { email: t.email, name: t.name, passwordHash, role: "DONOR" },
      select: { id: true },
    });
    await prisma.donorTeamMember.upsert({
      where: { userId: user.id },
      update: { accountId: owner.id, role: t.role },
      create: { accountId: owner.id, userId: user.id, role: t.role, invitedById: owner.id },
    });
  }

  const existing = await prisma.sponsorRequirement.findFirst({ where: { sponsorId: owner.id, fileName: TITLE }, select: { id: true } });
  if (!existing) {
    const fields = withDonorProvenance({
      summary: "Equip government middle schools with digital classrooms and train their teachers, with measured learning gains.",
      sector: "Education",
      state: "Karnataka",
      budgetMin: 250000,
      budgetMax: 400000,
      currency: "INR",
      durationMonths: 12,
      expectedBeneficiaries: 1000,
      primaryKPIs: ["Students using digital lessons weekly", "Science and maths assessment scores"],
      reportingCadence: "Quarterly",
      contactPerson: OWNER.name,
      contactEmail: OWNER.email,
    });
    await prisma.sponsorRequirement.create({
      data: {
        sponsorId: owner.id,
        fileName: TITLE,
        status: "DONOR_REVIEW",
        extractedFields: fields as any,
        confidenceScores: confidenceMap(fields),
        extractedByAgent: FORM_ENTRY_AGENT,
        modelVersion: "manual-entry",
        versionNote: "Seeded by tools/seed-csr-donor.ts",
        versionAuthorId: owner.id,
        versionAuthorRole: "DONOR",
      },
    });
  }

  console.log(`\nLogins (password ${PASSWORD}): ${OWNER.email} (owner), ${TEAM.map((t) => t.email).join(", ")}`);
  console.log("Next: follow the UAT in docs/DONOR-GUIDE.md, starting with admin verifying Acme at /admin/donors.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
