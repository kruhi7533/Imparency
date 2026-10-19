import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * In-app notification inbox for the logged-in user (any role).
 * Notifications are created all over the API surface (proof reviews, admin
 * inquiries, project decisions…) — this is the single read side for the bell.
 */
export async function GET(request?: Request) {
  const auth = await verifySessionRole();
  if (!auth.authorized) return auth.response;

  try {
    const userId = auth.session.user.id;
    // Paging for the full /notifications page. With no parameters this is the
    // bell's original query: the latest 20.
    const params = request ? new URL(request.url).searchParams : new URLSearchParams();
    const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "20", 10) || 20, 1), 50);
    // Keyset cursor "<ISO createdAt>|<id>": a position, not a row lookup, so it
    // can never reach another user's notifications — every page is filtered
    // by userId first.
    const [cursorAt, cursorId] = (params.get("cursor") ?? "").split("|");
    const cursorDate = cursorAt ? new Date(cursorAt) : null;
    const validCursor = cursorDate && !Number.isNaN(cursorDate.getTime()) && cursorId;
    const unreadOnly = params.get("unread") === "1";
    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: {
          userId,
          ...(unreadOnly ? { read: false } : {}),
          ...(validCursor
            ? { OR: [{ createdAt: { lt: cursorDate! } }, { createdAt: cursorDate!, id: { lt: cursorId } }] }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: { id: true, type: true, title: true, body: true, read: true, createdAt: true },
      }),
      prisma.notification.count({ where: { userId, read: false } }),
    ]);
    const notifications = rows.slice(0, limit);
    const last = notifications[notifications.length - 1];
    const nextCursor = rows.length > limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null;

    return NextResponse.json({ notifications, unreadCount, nextCursor });
  } catch (err: any) {
    console.error("Error listing notifications:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}

/**
 * Mark notifications as read.
 * Body: { ids?: string[] } — specific notifications, or all unread when omitted.
 * Scoped to the session user; ids belonging to other users are silently ignored.
 */
export async function PATCH(request: Request) {
  const auth = await verifySessionRole();
  if (!auth.authorized) return auth.response;

  try {
    const userId = auth.session.user.id;
    const body = await request.json().catch(() => ({}));
    const ids: unknown = body.ids;

    const where =
      Array.isArray(ids) && ids.length > 0
        ? { userId, id: { in: ids.filter((i): i is string => typeof i === "string").slice(0, 100) } }
        : { userId, read: false };

    const result = await prisma.notification.updateMany({ where, data: { read: true } });
    return NextResponse.json({ success: true, updated: result.count });
  } catch (err: any) {
    console.error("Error marking notifications read:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
