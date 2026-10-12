import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

// Twilio Media subresource pattern: /Accounts/{AccountSid}/Messages/{MessageSid}/Media/{MediaSid}
const TWILIO_MEDIA_REGEX = /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/[a-zA-Z0-9_]+\/Messages\/[a-zA-Z0-9_]+\/Media\/[a-zA-Z0-9_]+$/;

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const targetUrl = searchParams.get('url');

    if (!targetUrl) {
      return new NextResponse('Missing url parameter', { status: 400 });
    }

    // Only allow Twilio media API endpoints; redirect non-Twilio external media
    if (!targetUrl.startsWith('https://api.twilio.com/')) {
      // Disallow localhost / private network redirects (SSRF protection)
      try {
        const parsed = new URL(targetUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return new NextResponse('Invalid protocol', { status: 400 });
        }
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname.startsWith('10.') || parsed.hostname.startsWith('192.168.')) {
          return new NextResponse('Invalid host', { status: 400 });
        }
      } catch {
        return new NextResponse('Invalid url', { status: 400 });
      }
      return NextResponse.redirect(targetUrl);
    }

    // Strictly enforce Twilio Media endpoint structure to prevent credential-leaking SSRF
    if (!TWILIO_MEDIA_REGEX.test(targetUrl)) {
      return new NextResponse('Invalid Twilio media resource URL', { status: 400 });
    }

    const userId = session.user.id;
    const role = session.user.role;

    // For non-admin callers, verify that this media URL actually belongs to their NGO's drafts
    if (role !== 'ADMIN') {
      let callerNgoId: string | undefined = session.user.ngoProfileId ?? undefined;
      if (!callerNgoId && role === 'NGO') {
        const profile = await prisma.nGOProfile.findFirst({
          where: { userId },
          select: { id: true },
        });
        callerNgoId = profile?.id ?? undefined;
      }

      if (!callerNgoId) {
        return new NextResponse('Forbidden: No associated NGO profile', { status: 403 });
      }

      // Check if this mediaUrl belongs to caller's NGO draft proofs
      const draftWithMedia = await prisma.draftProof.findFirst({
        where: {
          ngoId: callerNgoId,
          mediaUrls: { has: targetUrl },
        },
        select: { id: true },
      });

      if (!draftWithMedia) {
        return new NextResponse('Forbidden: Media does not belong to your organization', { status: 403 });
      }
    }

    // Try multiple possible twilio env variable names for robust fallback
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_API_KEY;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN || process.env.TWILIO_API_SECRET;

    if (!twilioAccountSid || !twilioAuthToken) {
      console.warn("Twilio credentials not found for media proxy");
      return new NextResponse('Twilio credentials not configured', { status: 500 });
    }

    const auth = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');

    const response = await fetch(targetUrl, {
      headers: {
        'Authorization': `Basic ${auth}`
      }
    });

    if (!response.ok) {
      console.error(`Twilio Media Fetch Error: ${response.status} ${response.statusText}`);
      return new NextResponse(`Failed to fetch media: ${response.statusText}`, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400'
      }
    });

  } catch (error) {
    console.error('Media proxy error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
