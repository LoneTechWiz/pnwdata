import { NextResponse } from "next/server";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = db.prepare("SELECT status, last_synced_at FROM sync_status WHERE id = 1").get();
  return NextResponse.json({ ok: true, database: "sqlite", sync: status ?? null });
}
