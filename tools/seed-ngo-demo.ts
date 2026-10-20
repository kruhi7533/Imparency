/**
 * Representative NGO operating data on top of scripts/seed-demo.ts (roadmap
 * row 14): a team with distinct roles and the field work they are assigned,
 * so the NGO/field UAT in docs/NGO-GUIDE.md has something to walk through.
 *
 *   npx tsx -r dotenv/config tools/seed-ngo-demo.ts            # dry run
 *   npx tsx -r dotenv/config tools/seed-ngo-demo.ts -- --apply
 *
 * House rules, as in tools/seed-week8-demo.ts:
 *
 * 1. It REFUSES rather than fabricates prerequisites. It only touches the demo
 *    NGO seeded by scripts/seed-demo.ts (akshar@demo.org); if that is missing it
 *    stops and says which seed to run.
 * 2. Nothing it writes is a verdict. Field tasks start OPEN; evidence, review,
 *    outcome claims and approval are left for the UAT to do through the app.
 *    Readiness is printed from the real lib/project-readiness.ts.
 *
 * Idempotent: team members are upserted, and a task is created only if a task
 * with the same title does not already exist on that project.
 */
import bcrypt from "bcryptjs";
import { TeamRole } from "@prisma/client";
import prisma from "../lib/prisma";
import { matchingReadiness } from "../lib/project-readiness";

const APPLY = process.argv.includes("--apply");
const OWNER_EMAIL = "akshar@demo.org";
const PASSWORD = "demoPassword123";

const TEAM: Array<{ email: string; name: string; role: TeamRole }> = [
  { email: "finance.akshar@demo.org", name: "Akshar Finance Lead", role: TeamRole.FINANCE },
  { email: "field.akshar@demo.org", name: "Akshar Field Coordinator", role: TeamRole.FIELD_STAFF },
];

const TASKS: Array<{ project: string; milestone?: string; title: string; instructions: string; dueInDays: number }> = [
  {
    project: "Digital Classrooms Initiative",
    milestone: "Installation and teacher training",
    title: "Photograph installed projectors in all 5 schools",
    instructions: "One wide photo per classroom with the projector running. No students' faces unless consent is recorded.",
    dueInDays: 7,
  },
  {
    project: "Digital Classrooms Initiative",
    milestone: "Installation and teacher training",
    title: "Collect teacher training attendance sheets",
    instructions: "Scan the signed attendance sheet from each training day and add a short note on attendance.",
    dueInDays: 10,
  },
  {
    project: "Rural Literacy Kits",
    title: "Record beneficiary feedback from 10 families",
    instructions: "Ask the consent questions first. Record whether the family agrees to sharing with donors.",
    dueInDays: 21,
  },
];

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000);

async function main() {
  console.log(APPLY ? "APPLYING\n" : "DRY RUN — nothing will be written. Pass --apply.\n");

  const owner = await prisma.user.findUnique({
    where: { email: OWNER_EMAIL },
    select: { id: true, ngoProfile: { select: { id: true, orgName: true } } },
  });
  if (!owner?.ngoProfile) {
    console.error(`REFUSING: ${OWNER_EMAIL} has no NGO profile. Run \`npm run seed\` (scripts/seed-demo.ts) first.`);
    process.exitCode = 1;
    return;
  }
  const ngo = owner.ngoProfile;
  console.log(`Organisation: ${ngo.orgName}\n`);

  // ---- team ---------------------------------------------------------------
  const memberIds: Partial<Record<TeamRole, string>> = {};
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const m of TEAM) {
    console.log(`Team member  ${m.role.padEnd(11)} ${m.email}`);
    if (!APPLY) continue;
    const user = await prisma.user.upsert({
      where: { email: m.email },
      update: {},
      create: { email: m.email, name: m.name, passwordHash, role: "NGO" },
      select: { id: true },
    });
    await prisma.nGOTeamMember.upsert({
      where: { userId_ngoId: { userId: user.id, ngoId: ngo.id } },
      update: { role: m.role },
      create: { userId: user.id, ngoId: ngo.id, role: m.role },
    });
    memberIds[m.role] = user.id;
  }

  // ---- field tasks --------------------------------------------------------
  console.log();
  for (const t of TASKS) {
    const project = await prisma.project.findFirst({
      where: { ngoId: ngo.id, title: t.project, isDeleted: false },
      select: { id: true, milestones: { select: { id: true, title: true } } },
    });
    if (!project) {
      console.log(`skip  "${t.title}" — project "${t.project}" not found`);
      continue;
    }
    const exists = await prisma.fieldTask.findFirst({ where: { projectId: project.id, title: t.title }, select: { id: true } });
    console.log(`${exists ? "keep " : "task "} ${t.project} → ${t.title}`);
    if (!APPLY || exists) continue;
    await prisma.fieldTask.create({
      data: {
        ngoId: ngo.id,
        projectId: project.id,
        milestoneId: project.milestones.find((m) => m.title === t.milestone)?.id ?? null,
        title: t.title,
        instructions: t.instructions,
        assignedToId: memberIds.FIELD_STAFF ?? owner.id,
        createdById: owner.id,
        dueDate: daysFromNow(t.dueInDays),
      },
    });
  }

  // ---- matching readiness, computed by the real rule ----------------------
  console.log("\nMatching readiness (lib/project-readiness.ts):");
  const projects = await prisma.project.findMany({
    where: { ngoId: ngo.id, isDeleted: false },
    select: { title: true, causeCategory: true, stateName: true, expectedBeneficiaries: true, beneficiaryGroup: true, durationMonths: true, primaryKPIs: true, reportingCadence: true },
  });
  for (const p of projects) {
    const r = matchingReadiness(p);
    console.log(`  ${r.ready ? "ready  " : "missing"} ${p.title}${r.ready ? "" : ` — ${r.missing.join(", ")}`}`);
  }

  console.log(`\nLogins (password ${PASSWORD}): ${OWNER_EMAIL} (owner), ${TEAM.map((m) => m.email).join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
