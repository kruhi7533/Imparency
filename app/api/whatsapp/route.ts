import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { processProofInBackground } from '@/lib/whatsapp/worker';
import twilio from 'twilio';
import crypto from 'crypto';

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    // 1. Twilio signature validation
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN!;
    const twilioSignature = req.headers.get('x-twilio-signature') ?? '';
    const webhookUrl = process.env.TWILIO_WEBHOOK_URL!;

    const rawBody = await req.text();
    const params: Record<string, string> = {};
    new URLSearchParams(rawBody).forEach((v, k) => { params[k] = v });

    if (process.env.NODE_ENV !== 'development') {
      const isValid = twilio.validateRequest(twilioAuthToken, twilioSignature, webhookUrl, params);
      if (!isValid) {
        console.warn('[webhook] Rejected: invalid Twilio signature');
        return new NextResponse('Forbidden', { status: 403 });
      }
    }

    const body = (params['Body'] || '').trim();
    const from = params['From'] || '';
    const numMediaStr = params['NumMedia'] || '0';
    const numMedia = parseInt(numMediaStr, 10);
    const latitudeStr = params['Latitude'];
    const longitudeStr = params['Longitude'];
    const profileName = params['ProfileName'] || 'Unknown';

    const rawGpsLat = latitudeStr ? parseFloat(latitudeStr) : null;
    const rawGpsLng = longitudeStr ? parseFloat(longitudeStr) : null;

    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = params[`MediaUrl${i}`];
      if (url) mediaUrls.push(url);
    }

    const senderPhone = from.replace('whatsapp:', '');

    const twimlResponse = (msg: string) => {
      const xml = `<Response><Message>${msg}</Message></Response>`;
      return new NextResponse(xml.trim(), {
        headers: { 'Content-Type': 'text/xml' }
      });
    };

    // 2. Look up the FieldWorker by phone number
    let worker = await prisma.fieldWorker.findUnique({
      where: { phone: senderPhone },
      include: { ngo: true }
    });

    // ─── SELF-REGISTRATION FLOW ─────────────────────────────────────────────

    // Case A: Brand new number — never seen before
    if (!worker) {
      // Check if they are sending a join code
      const joinCodeInput = body.toUpperCase().trim();
      const ngo = await prisma.nGOProfile.findUnique({
        where: { joinCode: joinCodeInput }
      });

      if (ngo) {
        // Valid join code — register the worker
        await prisma.fieldWorker.create({
          data: {
            phone: senderPhone,
            name: profileName,
            reliabilityScore: 100,
            isPending: false,
            ngoId: ngo.id
          }
        });
        return twimlResponse(
          `✅ Welcome ${profileName}! You have been registered as a field worker for *${ngo.orgName}*.\n\nYou can now send field updates, photos, and your GPS location directly in this chat. Our AI will review each submission and forward it to the NGO team!`
        );
      } else {
        // Unknown number, no valid join code — ask them to register
        return twimlResponse(
          `👋 Hello! I'm the Imparency field reporting bot.\n\nI don't recognise your number yet. Please send your *NGO Join Code* to get registered.\n\nYour NGO coordinator will share this code with you. It looks like: *ANANDA-2026*`
        );
      }
    }

    // Case B: Worker exists but is pending (shouldn't happen with new flow, safety net)
    if (worker.isPending) {
      const joinCodeInput = body.toUpperCase().trim();
      const ngo = await prisma.nGOProfile.findUnique({
        where: { joinCode: joinCodeInput }
      });
      if (ngo) {
        await prisma.fieldWorker.update({
          where: { id: worker.id },
          data: { ngoId: ngo.id, isPending: false }
        });
        return twimlResponse(
          `✅ You are now registered with *${ngo.orgName}*! You can start sending field updates.`
        );
      } else {
        return twimlResponse(
          `⚠️ That join code doesn't match any NGO. Please check with your coordinator and try again.`
        );
      }
    }

    // ─── NORMAL PROOF SUBMISSION FLOW ───────────────────────────────────────

    // 3. Content-based fingerprint for idempotency
    const fingerprintRaw = `${senderPhone}|${body}|${rawGpsLat ?? ''}|${rawGpsLng ?? ''}`;
    const fingerprint = crypto.createHash('sha256').update(fingerprintRaw).digest('hex');

    let draft;
    try {
      draft = await prisma.draftProof.create({
        data: {
          ngoId: worker.ngoId,
          fieldWorkerId: worker.id,
          senderPhone: senderPhone,
          rawMessage: body,
          rawGpsLat,
          rawGpsLng,
          photoCount: numMedia,
          mediaUrls: mediaUrls,
          status: "PENDING_REVIEW",
          workerStatus: "PENDING",
          fingerprint
        }
      });
    } catch (err: any) {
      if (err.code === 'P2002' && err.meta?.target?.includes('fingerprint')) {
        console.log('[webhook] Duplicate fingerprint — discarding silently');
        return twimlResponse('✅ Update received! Your submission is being reviewed. You\'ll hear back shortly.');
      }
      throw err;
    }

    // 4. Fire-and-forget background worker
    processProofInBackground(draft.id, worker.ngoId).catch((err) =>
      console.error("[webhook] background worker failed:", err)
    );

    return twimlResponse('✅ Update received! Your submission is being reviewed. You\'ll hear back shortly.');

  } catch (error) {
    console.error("[webhook] Error processing Twilio webhook:", error);

    const errorTwiML = `<Response><Message>⚠️ Something went wrong. Please try again in a moment.</Message></Response>`;
    return new NextResponse(errorTwiML.trim(), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' }
    });
  }
}
