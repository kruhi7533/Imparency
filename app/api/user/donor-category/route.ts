import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { donorCategory } = body;

  const validCategories = ["INDIAN_RESIDENT", "NRI_OCI", "FOREIGN_NATIONAL"];
  if (!validCategories.includes(donorCategory)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      donorCategory: donorCategory as any,
      donorCategorySetAt: new Date(),
    },
  });

  return NextResponse.json({ success: true, donorCategory });
}

// GET handler — returns current donor's category (for client-side check)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { donorCategory: true, donorCategorySetAt: true },
  });

  return NextResponse.json({
    donorCategory: user?.donorCategory ?? null,
    isSet: !!user?.donorCategory,
  });
}
