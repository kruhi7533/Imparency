import prisma from "../lib/prisma";
import bcrypt from "bcryptjs";

async function main() {
  console.log("Checking database for admin@impactbridge.com...");
  const user = await prisma.user.findUnique({
    where: { email: "admin@impactbridge.com" }
  });

  const password = "adminpassword123";
  const passwordHash = await bcrypt.hash(password, 10);

  if (user) {
    console.log(`User found! Current role: ${user.role}. Updating password...`);
    await prisma.user.update({
      where: { email: "admin@impactbridge.com" },
      data: {
        passwordHash,
        role: "ADMIN" // Ensure they are ADMIN
      }
    });
    console.log(`Password reset successfully for admin@impactbridge.com to: ${password}`);
  } else {
    console.log("User admin@impactbridge.com not found. Creating a new one...");
    const newUser = await prisma.user.create({
      data: {
        name: "System Admin",
        email: "admin@impactbridge.com",
        passwordHash,
        role: "ADMIN"
      }
    });
    console.log(`Admin user created successfully with password: ${password}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
