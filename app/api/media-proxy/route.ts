import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const targetUrl = searchParams.get('url');

    if (!targetUrl) {
      return new NextResponse('Missing url parameter', { status: 400 });
    }

    // Proxy Twilio URLs for security
    if (!targetUrl.startsWith('https://api.twilio.com/')) {
      // Just redirect if it's not Twilio (like unsplash)
      return NextResponse.redirect(targetUrl);
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
