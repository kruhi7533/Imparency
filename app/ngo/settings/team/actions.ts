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
    // User doesn't have an account yet — send them an invite email
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: session.user.ngoProfileId },
      select: { orgName: true }
    });

    // Upsert invite (reset token if re-invited)
    const invite = await prisma.teamInvite.upsert({
      where: { email_ngoId: { email, ngoId: session.user.ngoProfileId } },
      update: { role, expiresAt, accepted: false },
      create: { email, role, ngoId: session.user.ngoProfileId, expiresAt }
    });

    const signupUrl = `${process.env.NEXTAUTH_URL}/login?invite=${invite.token}&email=${encodeURIComponent(email)}`;

    try {
      const { sendTeamInviteEmail } = await import("@/lib/email");
      await sendTeamInviteEmail({
        to: email,
        recipientName: email,
        ngoName: ngo?.orgName || "your NGO",
        role,
        dashboardUrl: signupUrl,
      });
    } catch (emailErr) {
      console.warn("[Team] Invite email failed:", emailErr);
    }

    revalidatePath("/ngo/settings/team");
    return { success: true, invited: true, message: `${email} doesn't have an account yet. An invite email has been sent!` };
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

  // Send invitation email
  try {
    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: session.user.ngoProfileId },
      select: { orgName: true }
    });

    const { sendTeamInviteEmail } = await import("@/lib/email");
    await sendTeamInviteEmail({
      to: user.email!,
      recipientName: user.name || email,
      ngoName: ngo?.orgName || "your NGO",
      role: role,
      dashboardUrl: `${process.env.NEXTAUTH_URL}/ngo/dashboard`,
    });
  } catch (emailErr) {
    console.warn("[Team] Email notification failed (non-fatal):", emailErr);
  }

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
