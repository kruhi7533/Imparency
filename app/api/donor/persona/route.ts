import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { DonorPersona } from "@prisma/client";

const VALID_PERSONAS = new Set<string>([
  "INDIVIDUAL",
  "CSR_OFFICER",
  "HNI",
  "FOUNDATION",
  "GOVERNMENT",
]);

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "DONOR") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { persona } = body;

    if (!persona || !VALID_PERSONAS.has(persona)) {
      return NextResponse.json({ error: "Invalid persona value" }, { status: 400 });
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        donorPersona: persona as DonorPersona,
        personaSetAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, persona: updatedUser.donorPersona });
  } catch (error: any) {
    console.error("Error setting donor persona:", error);
    return NextResponse.json(
      { error: error.message || "Failed to set persona" },
      { status: 500 }
    );
  }
}

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
