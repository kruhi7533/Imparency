"use server";

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function addTeamMember(formData: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.ngoProfileId) {
    return { error: "Not authorized" };
  }

  // Check if current user is OWNER or ADMIN
  const currentMembership = await prisma.nGOTeamMember.findUnique({
    where: {
      userId_ngoId: {
        userId: session.user.id,
        ngoId: session.user.ngoProfileId,
      }
    }
  });

  if (!currentMembership || (currentMembership.role !== "OWNER" && currentMembership.role !== "ADMIN")) {
    return { error: "You do not have permission to add team members." };
  }

  const email = formData.get("email")?.toString();
  const role = formData.get("role")?.toString() as any;

  if (!email || !role) {
    return { error: "Email and role are required." };
  }

  // Find user by email
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { error: "No user found with that email address. They must create an account first." };
  }

  // Check if already a member
  const existing = await prisma.nGOTeamMember.findUnique({
    where: {
      userId_ngoId: {
        userId: user.id,
        ngoId: session.user.ngoProfileId,
      }
    }
  });

  if (existing) {
    return { error: "User is already a team member of this NGO." };
  }

  // Add them
  await prisma.nGOTeamMember.create({
    data: {
      userId: user.id,
      ngoId: session.user.ngoProfileId,
      role: role,
    }
  });

  revalidatePath("/ngo/settings/team");
  return { success: true };
}

export async function removeTeamMember(userId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.ngoProfileId) {
    return { error: "Not authorized" };
  }

  const currentMembership = await prisma.nGOTeamMember.findUnique({
    where: {
      userId_ngoId: {
        userId: session.user.id,
        ngoId: session.user.ngoProfileId,
      }
    }
  });

  if (!currentMembership || (currentMembership.role !== "OWNER" && currentMembership.role !== "ADMIN")) {
    return { error: "You do not have permission to remove team members." };
  }

  // Prevent removing the owner
  const targetMembership = await prisma.nGOTeamMember.findUnique({
    where: {
      userId_ngoId: {
        userId,
        ngoId: session.user.ngoProfileId,
      }
    }
  });

  if (targetMembership?.role === "OWNER" && currentMembership.role !== "OWNER") {
      return { error: "Only the Owner can remove other Owners." };
  }
  
  if (targetMembership?.role === "OWNER" && currentMembership.id === targetMembership.id) {
    // Check if there are other owners
    const owners = await prisma.nGOTeamMember.count({
        where: { ngoId: session.user.ngoProfileId, role: "OWNER" }
    });
    if (owners <= 1) {
        return { error: "You cannot remove the only Owner. Reassign ownership first." };
    }
  }

  await prisma.nGOTeamMember.delete({
    where: {
      userId_ngoId: {
        userId,
        ngoId: session.user.ngoProfileId,
      }
    }
  });

  revalidatePath("/ngo/settings/team");
  return { success: true };
}
