import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ personaSet: false }, { status: 200 });
    }

    const personaSet = !!session.user.donorPersona;
    return NextResponse.json({ personaSet });
  } catch (error: any) {
    console.error("Error checking donor persona:", error);
    return NextResponse.json({ personaSet: false }, { status: 200 });
  }
}
