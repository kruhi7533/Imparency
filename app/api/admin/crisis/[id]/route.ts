import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";

const DISASTER_TYPES = [
  "FLOOD", "EARTHQUAKE", "CYCLONE", "WILDFIRE", "LANDSLIDE",
  "DROUGHT", "WAR_CONFLICT", "EPIDEMIC", "OTHER",
];
const SEVERITIES = ["LOW", "MODERATE", "HIGH", "CRITICAL"];
const STATUSES = ["UPCOMING", "ACTIVE", "CLOSED"];

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response } = await verifySessionRole("ADMIN");
    if (!authorized) return response;

    const event = await prisma.crisisEvent.findUnique({
      where: { id: params.id },
      include: {
        createdBy: { select: { name: true, email: true } },
        participants: { include: { ngo: { select: { orgName: true, id: true } } } },
        _count: { select: { initiatives: true, donations: true, updates: true } },
      },
    });

    if (!event) return NextResponse.json({ error: "Crisis event not found" }, { status: 404 });

    return NextResponse.json({ event });
  } catch (err: any) {
    console.error("Crisis Event detail error:", err);
    return NextResponse.json({ error: "Failed to load crisis event" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole("ADMIN");
    if (!authorized) return response;

    const existing = await prisma.crisisEvent.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Crisis event not found" }, { status: 404 });

    const contentType = request.headers.get("content-type") || "";
    const data: Record<string, unknown> = {};
    const oldValue: Record<string, unknown> = {};

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();

      const title = (formData.get("title") as string | null)?.trim();
      const disasterType = formData.get("disasterType") as string | null;
      const description = (formData.get("description") as string | null)?.trim();
      const affectedLocation = (formData.get("affectedLocation") as string | null)?.trim();
      const stateName = formData.get("stateName") as string | null;
      const city = formData.get("city") as string | null;
      const severity = formData.get("severity") as string | null;
      const status = formData.get("status") as string | null;
      const expectedEndDateStr = formData.get("expectedEndDate") as string | null;
      const coverImage = formData.get("coverImage") as File | null;

      if (title) data.title = title;
      if (disasterType) {
        if (!DISASTER_TYPES.includes(disasterType)) {
          return NextResponse.json({ error: "Invalid disasterType" }, { status: 400 });
        }
        data.disasterType = disasterType;
      }
      if (description) data.description = description;
      if (affectedLocation) data.affectedLocation = affectedLocation;
      if (stateName !== null) data.stateName = stateName || null;
      if (city !== null) data.city = city || null;
      if (severity) {
        if (!SEVERITIES.includes(severity)) {
          return NextResponse.json({ error: "Invalid severity" }, { status: 400 });
        }
        oldValue.severity = existing.severity;
        data.severity = severity;
      }
      if (status) {
        if (!STATUSES.includes(status)) {
          return NextResponse.json({ error: "Invalid status" }, { status: 400 });
        }
        // CLOSED and ACTIVE are meaningful transitions worth a note in the log.
        oldValue.status = existing.status;
        data.status = status;
        if (status === "CLOSED" && existing.status !== "CLOSED") {
          data.closedAt = new Date();
        }
      }
      if (expectedEndDateStr !== null) {
        if (expectedEndDateStr === "") {
          data.expectedEndDate = null;
        } else {
          const d = new Date(expectedEndDateStr);
          if (isNaN(d.getTime())) {
            return NextResponse.json({ error: "Invalid expectedEndDate" }, { status: 400 });
          }
          data.expectedEndDate = d;
        }
      }
      if (coverImage && coverImage.size > 0) {
        if (!coverImage.type.startsWith("image/")) {
          return NextResponse.json({ error: "Cover image must be a valid image file" }, { status: 400 });
        }
        if (coverImage.size > 3 * 1024 * 1024) {
          return NextResponse.json({ error: "Cover image must not exceed 3MB" }, { status: 400 });
        }
        data.coverImage = await uploadFile(Buffer.from(await coverImage.arrayBuffer()), coverImage.name, "crisis/covers");
      }
    } else {
      const body = await request.json();
      const allowed = ["title", "description", "affectedLocation", "stateName", "city", "severity", "status"] as const;
      for (const key of allowed) {
        if (body[key] !== undefined) {
          if (key === "severity" && !SEVERITIES.includes(body.severity)) {
            return NextResponse.json({ error: "Invalid severity" }, { status: 400 });
          }
          if (key === "status" && !STATUSES.includes(body.status)) {
            return NextResponse.json({ error: "Invalid status" }, { status: 400 });
          }
          if (key === "status" || key === "severity") oldValue[key] = (existing as any)[key];
          data[key] = body[key];
          if (key === "status" && body.status === "CLOSED" && existing.status !== "CLOSED") {
            data.closedAt = new Date();
          }
        }
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const updated = await prisma.crisisEvent.update({ where: { id: params.id }, data: data as any });

    await logAdminAction({
      adminId: session.user.id,
      action: "CRISIS_EVENT_UPDATED",
      entityType: "CRISIS_EVENT",
      entityId: updated.id,
      oldValue,
      newValue: Object.fromEntries(Object.keys(oldValue).map((k) => [k, (updated as any)[k]])),
      request,
    });

    // Notification fan-out fires exactly once, at the UPCOMING/CLOSED → ACTIVE
    // transition — never on routine edits. Best-effort: a fan-out failure must
    // not fail the status change itself (rows can be backfilled by re-running
    // this transition; the unique constraint makes that safe).
    if (data.status === "ACTIVE" && existing.status !== "ACTIVE") {
      try {
        const { fanOutCrisisNotifications } = await import("@/lib/crisis/notify");
        await fanOutCrisisNotifications(updated.id);
      } catch (notifyErr) {
        console.error(`[crisis] Notification fan-out failed for ${updated.id}:`, notifyErr);
      }
    }

    return NextResponse.json({ event: updated });
  } catch (err: any) {
    console.error("Crisis Event update error:", err);
    return NextResponse.json({ error: "We couldn't update this crisis event right now." }, { status: 500 });
  }
}
