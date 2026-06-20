import prisma from "../lib/prisma";
import bcrypt from "bcryptjs";

async function main() {
  console.log("Checking for admin user...");
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" }
  });

  if (admin) {
    console.log(`Admin user already exists: ${admin.email}`);
  } else {
    console.log("No admin user found. Creating one...");
    const passwordHash = await bcrypt.hash("adminpassword123", 10);
    const newAdmin = await prisma.user.create({
      data: {
        name: "System Admin",
        email: "admin@impactbridge.com",
        passwordHash,
        role: "ADMIN"
      }
    });
    console.log(`Admin user created successfully!`);
    console.log(`Email: ${newAdmin.email}`);
    console.log(`Password: adminpassword123`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
