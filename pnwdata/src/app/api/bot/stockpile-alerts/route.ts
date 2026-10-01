import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { isBotRequestAuthorized } from "@/lib/bot-api-auth";

export async function GET(request: NextRequest) {
  if (!isBotRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const alerts = db.prepare(`
    SELECT id, nation_id, nation_name, discord_username, discord_id,
           resource, amount, num_cities, threshold, created_at
    FROM stockpile_alert_queue
    WHERE sent = 0
    ORDER BY created_at, id
    LIMIT 1000
  `).all();
  return NextResponse.json({ alerts });
}

export async function PATCH(request: NextRequest) {
  if (!isBotRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { ids?: unknown[] } | null;
  const ids = body?.ids?.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) ?? [];
  if (!Array.isArray(body?.ids) || ids.length !== body.ids.length || ids.length > 1000) {
    return NextResponse.json({ error: "Expected up to 1000 positive integer ids" }, { status: 400 });
  }
  if (ids.length === 0) return NextResponse.json({ ok: true, count: 0 });

  const placeholders = ids.map(() => "?").join(",");
  const result = db.prepare(`
    UPDATE stockpile_alert_queue SET sent = 1, sent_at = ?
    WHERE sent = 0 AND id IN (${placeholders})
  `).run(Date.now(), ...ids);
  return NextResponse.json({ ok: true, count: result.changes });
}
