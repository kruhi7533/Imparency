/**
 * Seed the pilot admin sub-role accounts (Workstream E).
 *
 *   PILOT_ADMIN_PASSWORD='…' npx tsx -r dotenv/config tools/seed-admin-roles.ts
 *
 * Creates (or brings into line) three ADMIN accounts:
 *   finance.pilot@example.test   AdminRole FINANCE  — reconciliation, exceptions, payments
 *   auditor.pilot@example.test   AdminRole AUDITOR  — read-only + audit export
 *   support.pilot@example.test   AdminRole SUPPORT  — queues + break-glass grants
 *
 * Idempotent by email. The password is read from PILOT_ADMIN_PASSWORD; when it
 * is unset a random one is generated and printed ONCE — nothing is hardcoded.
 * An existing account keeps its password unless PILOT_ADMIN_RESET_PASSWORD=1.
 * It refuses to touch an existing account that is not already an ADMIN (it
 * will not silently turn a donor or NGO into an admin).
 */
import { PrismaClient, type AdminRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

const ACCOUNTS: { email: string; name: string; adminRole: AdminRole }[] = [
  { email: "finance.pilot@example.test", name: "Pilot Finance Admin", adminRole: "FINANCE" },
  { email: "auditor.pilot@example.test", name: "Pilot Auditor", adminRole: "AUDITOR" },
  { email: "support.pilot@example.test", name: "Pilot Support Admin", adminRole: "SUPPORT" },
];

async function main() {
  const fromEnv = process.env.PILOT_ADMIN_PASSWORD;
  if (fromEnv && fromEnv.length < 12) throw new Error("PILOT_ADMIN_PASSWORD must be at least 12 characters.");
  const password = fromEnv || randomBytes(12).toString("base64url");
  const resetPassword = process.env.PILOT_ADMIN_RESET_PASSWORD === "1";
  const hash = await bcrypt.hash(password, 10);
  let created = 0;

  for (const a of ACCOUNTS) {
    const existing = await prisma.user.findUnique({ where: { email: a.email }, select: { id: true, role: true, adminRole: true } });
    if (!existing) {
      await prisma.user.create({ data: { email: a.email, name: a.name, role: "ADMIN", adminRole: a.adminRole, passwordHash: hash } });
      created++;
      console.log(`created  ${a.email}  (${a.adminRole})`);
      continue;
    }
    if (existing.role !== "ADMIN") {
      console.warn(`SKIPPED  ${a.email}: exists with role ${existing.role}; not promoting a non-admin account.`);
      continue;
    }
    await prisma.user.update({
      where: { id: existing.id },
      data: { adminRole: a.adminRole, ...(resetPassword ? { passwordHash: hash } : {}) },
    });
    console.log(`updated  ${a.email}  (${existing.adminRole ?? "SUPER"} → ${a.adminRole})${resetPassword ? ", password reset" : ""}`);
  }

  if (!fromEnv && (created > 0 || resetPassword)) {
    console.log(`\nGenerated password for the accounts created/reset above (shown once): ${password}`);
  } else if (fromEnv) {
    console.log("\nPassword: the value of PILOT_ADMIN_PASSWORD.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
