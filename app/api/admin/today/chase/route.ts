import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { chaseExpiry, CHASE_WINDOW_DAYS } from "@/lib/today-inbox";

export const runtime = "nodejs";

/**
 * ADMIN-only. Record that someone chased whoever owes an inbox item, or undo
 * that.
 *
 * This is the only write the Today inbox makes. It deliberately does NOT touch
 * the underlying record: chasing an overdue milestone must not mark the
 * milestone as anything, because the NGO still has not delivered it. All this
 * does is stop the inbox asking for the same nudge every morning, for a week.
 *
 * Idempotent by design — the row is keyed on the item, so a double-click or a
 * retry re-dates the same chase rather than stacking duplicates.
 */

/** "overdue-<uuid>" -> ["overdue", "<uuid>"]. Split once; uuids contain dashes. */
function splitItemKey(itemKey: string): { prefix: string; entityId: string } | null {
  const dash = itemKey.indexOf("-");
  if (dash <= 0 || dash === itemKey.length - 1) return null;
  return { prefix: itemKey.slice(0, dash), entityId: itemKey.slice(dash + 1) };
}

/** Item kinds that may be chased — mirrors isChaseable() in lib/today-inbox. */
const CHASEABLE_PREFIXES: Record<string, "MILESTONE"> = {
  overdue: "MILESTONE",
};

export async function POST(request: Request) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;
  const adminId = session.user.id;

  let body: { itemKey?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const itemKey = body.itemKey?.trim();
  if (!itemKey) {
    return NextResponse.json({ error: "itemKey is required" }, { status: 400 });
  }

  const parts = splitItemKey(itemKey);
  const entityType = parts && CHASEABLE_PREFIXES[parts.prefix];
  if (!parts || !entityType) {
    // Refusing an unknown key keeps this from becoming a way to hide anything
    // on the page, including work the admin owes.
    return NextResponse.json({ error: "This kind of item cannot be chased." }, { status: 400 });
  }

  try {
    const expiresAt = chaseExpiry();
    await prisma.inboxChase.upsert({
      where: { itemKey },
      create: { itemKey, adminId, note: body.note?.trim() || null, expiresAt },
      update: { adminId, note: body.note?.trim() || null, expiresAt, createdAt: new Date() },
    });

    await logAdminAction({
      adminId,
      action: "INBOX_ITEM_CHASED",
      entityType,
      entityId: parts.entityId,
      newValue: { chasedUntil: expiresAt.toISOString() },
      note: `Chased; hidden from Today for ${CHASE_WINDOW_DAYS} days`,
      request,
    });

    return NextResponse.json({ itemKey, chasedUntil: expiresAt.toISOString() });
  } catch (err: any) {
    console.error("Failed to record inbox chase:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;
  const adminId = session.user.id;

  let body: { itemKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const itemKey = body.itemKey?.trim();
  if (!itemKey) {
    return NextResponse.json({ error: "itemKey is required" }, { status: 400 });
  }

  const parts = splitItemKey(itemKey);
  const entityType = parts && CHASEABLE_PREFIXES[parts.prefix];
  if (!parts || !entityType) {
    return NextResponse.json({ error: "This kind of item cannot be chased." }, { status: 400 });
  }

  try {
    // deleteMany, not delete: undoing a chase that already expired or was
    // already undone is a no-op, not a 404.
    const { count } = await prisma.inboxChase.deleteMany({ where: { itemKey } });

    if (count > 0) {
      await logAdminAction({
        adminId,
        action: "INBOX_CHASE_CLEARED",
        entityType,
        entityId: parts.entityId,
        note: "Chase undone; item returns to Today",
        request,
      });
    }

    return NextResponse.json({ itemKey, cleared: count > 0 });
  } catch (err: any) {
    console.error("Failed to clear inbox chase:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
