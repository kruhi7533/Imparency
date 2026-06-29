import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, email, organization } = body;

    if (!name || !email) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    // Upsert the lead
    const lead = await prisma.pitchLead.upsert({
      where: { email },
      update: {
        name,
        organization: organization || null,
        downloaded: true
      },
      create: {
        name,
        email,
        organization: organization || null,
        downloaded: true
      }
    });

    return NextResponse.json({ success: true, lead });
  } catch (error: any) {
    console.error('[PitchLead API] Error:', error);
    return NextResponse.json({ error: 'Failed to process lead' }, { status: 500 });
  }
}
