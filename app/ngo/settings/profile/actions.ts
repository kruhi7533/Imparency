"use server";

import prisma from "@/lib/prisma";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { uploadFile } from "@/lib/storage";

export async function updateUserProfile(formData: FormData) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.id) {
    return { error: "Not authorized" };
  }

  const name = formData.get("name")?.toString();
  const avatarFile = formData.get("avatar") as File | null;

  if (!name || name.trim().length === 0) {
    return { error: "Name is required" };
  }

  try {
    let avatarUrl = undefined;
    
    if (avatarFile && avatarFile.size > 0) {
      const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!validTypes.includes(avatarFile.type)) {
        return { error: "Invalid image format. Allowed formats: JPEG, PNG, WEBP, GIF." };
      }
      if (avatarFile.size > 5 * 1024 * 1024) {
        return { error: "Avatar image exceeds the 5MB limit." };
      }

      const arrayBuffer = await avatarFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      avatarUrl = await uploadFile(buffer, avatarFile.name, "avatars");
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { 
        name: name.trim(),
        ...(avatarUrl && { avatar: avatarUrl })
      },
    });

    revalidatePath("/ngo/settings/profile");
    return { success: true, avatarUrl };
  } catch (error) {
    console.error("Failed to update profile", error);
    return { error: "An unexpected error occurred" };
  }
}
