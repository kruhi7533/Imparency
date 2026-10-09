import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withRouteContext, setContextUser } from "@/lib/request-context";
import { captureError } from "@/lib/observability";
import { log } from "@/lib/logger";

/**
 * SPEC-1 worked example: an API route that opens its own correlation context.
 *
 * `middleware.ts` cannot mint the id for `/api/*` (its matcher excludes those
 * paths so `withAuth` does not lock out the Razorpay webhook and the cron
 * endpoints), so routes opt in with `withRouteContext`. Every `log.*` call and
 * every `captureError` inside the callback now carries one id, including the
 * ones raised deep inside `lib/` helpers that never see this request.
 *
 * KNOWN DEFECT, deliberately left for SPEC-3: the non-Twilio branch below is an
 * **open redirect** — any authenticated caller can pass `?url=https://evil...`
 * and be forwarded there on our domain's reputation. Two lesser problems sit
 * with it: `Cache-Control: public` on media fetched with Twilio credentials
 * puts private beneficiary content in shared caches, and `arrayBuffer()` is
 * unbounded. See docs/WEEK9-BLUEPRINT.md §SPEC-3. This change touches logging
 * only — mixing a security fix into the observability spec would make both
 * harder to review, and the defect is documented rather than forgotten.
 */
export async function GET(req: Request) {
  return withRouteContext(req, "api/media-proxy", async () => {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user) {
        log.warn("media_proxy.unauthenticated");
        return new NextResponse('Unauthorized', { status: 401 });
      }
      // Ids only, never the email or name (CLAUDE.md §Privacy).
      if ((session.user as { id?: string }).id) {
        setContextUser((session.user as { id: string }).id);
      }

      const { searchParams } = new URL(req.url);
      const targetUrl = searchParams.get('url');

      if (!targetUrl) {
        return new NextResponse('Missing url parameter', { status: 400 });
      }

      // Proxy Twilio URLs for security
      if (!targetUrl.startsWith('https://api.twilio.com/')) {
        // Just redirect if it's not Twilio (like unsplash)
        //
        // The URL is NOT logged: it is attacker-controlled and may carry a
        // token in its query string, and log lines reach a collector.
        log.warn("media_proxy.offsite_redirect", { host: safeHost(targetUrl) });
        return NextResponse.redirect(targetUrl);
      }

      // Try multiple possible twilio env variable names for robust fallback
      const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_API_KEY;
      const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN || process.env.TWILIO_API_SECRET;

      if (!twilioAccountSid || !twilioAuthToken) {
        log.error("media_proxy.twilio_credentials_missing");
        return new NextResponse('Twilio credentials not configured', { status: 500 });
      }

      const auth = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');

      const response = await fetch(targetUrl, {
        headers: {
          'Authorization': `Basic ${auth}`
        }
      });

      if (!response.ok) {
        log.error("media_proxy.twilio_fetch_failed", { status: response.status });
        return new NextResponse(`Failed to fetch media: ${response.statusText}`, { status: response.status });
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const buffer = await response.arrayBuffer();

      log.info("media_proxy.served", { bytes: buffer.byteLength, contentType });

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400'
        }
      });

    } catch (error) {
      captureError(error, { scope: "api/media-proxy", operation: "proxy_media" });
      return new NextResponse('Internal server error', { status: 500 });
    }
  });
}

/** Host only — never the path or query, which can carry tokens. */
function safeHost(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return "unparseable";
  }
}
