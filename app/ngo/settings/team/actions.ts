"use server";

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";

// addTeamMember was removed (NGO-003): it attached an EXISTING account to the
// NGO with no consent and stored invite tokens in plaintext. Invitations now go
// through POST /api/ngo/team/invites (lib/ngo-team-invites.ts).

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

export async function updateMemberRole(userId: string, newRole: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.ngoProfileId) {
    return { error: "Not authorized" };
  }

  const currentMembership = await prisma.nGOTeamMember.findUnique({
    where: {
      userId_ngoId: {
        userId: session.user.id,
        ngoId: session.user.ngoProfileId,
      },
    },
  });

  if (!currentMembership || (currentMembership.role !== "OWNER" && currentMembership.role !== "ADMIN")) {
    return { error: "You do not have permission to update team member roles." };
  }

  const validRoles = ["OWNER", "ADMIN", "PROGRAM_MANAGER", "FINANCE", "FIELD_STAFF"];
  if (!validRoles.includes(newRole)) {
    return { error: "Invalid role specified." };
  }

  const targetMembership = await prisma.nGOTeamMember.findUnique({
    where: {
      userId_ngoId: {
        userId,
        ngoId: session.user.ngoProfileId,
      },
    },
  });

  if (!targetMembership) {
    return { error: "Team member not found." };
  }

  if (targetMembership.role === "OWNER" && currentMembership.role !== "OWNER") {
    return { error: "Only an Owner can modify an Owner's role." };
  }

  if (newRole === "OWNER" && currentMembership.role !== "OWNER") {
    return { error: "Only an Owner can promote a member to Owner." };
  }

  await prisma.nGOTeamMember.update({
    where: {
      userId_ngoId: {
        userId,
        ngoId: session.user.ngoProfileId,
      },
    },
    data: {
      role: newRole as any,
    },
  });

  revalidatePath("/ngo/settings/team");
  return { success: true };
}

