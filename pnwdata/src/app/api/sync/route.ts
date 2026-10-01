import { NextResponse } from "next/server";
import db from "@/lib/db";
import { enqueueSyncRequest } from "@/lib/sync-request";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const status = db.prepare("SELECT status FROM sync_status WHERE id = 1").get() as { status: string } | undefined;
  if (status?.status === "syncing") {
    return NextResponse.json({ message: "Sync already in progress" }, { status: 409 });
  }

  try {
    const { request, created } = await enqueueSyncRequest();
    if (!created) {
      return NextResponse.json({ message: "Sync already queued", requestId: request.id }, { status: 409 });
    }
    return NextResponse.json({ message: "Sync queued for local worker", requestId: request.id }, { status: 202 });
  } catch (error) {
    console.error("[Sync API] Failed to queue local sync:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function GET() {
  const status = db.prepare("SELECT * FROM sync_status WHERE id = 1").get();
  return NextResponse.json(status ?? null);
}
