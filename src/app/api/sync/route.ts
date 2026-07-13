import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { enqueueSyncRequest } from "@/lib/sync-request";

export const dynamic = "force-dynamic";

export async function POST() {
  const { data: status, error } = await supabase.from("sync_status").select("status").eq("id", 1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (status?.status === "syncing") {
    return NextResponse.json({ message: "Sync already in progress" }, { status: 409 });
  }

  try {
    const { request, created } = await enqueueSyncRequest();
    if (!created) {
      return NextResponse.json({ message: "Sync already queued", requestId: request.id }, { status: 409 });
    }
    return NextResponse.json({ message: "Sync queued for local worker", requestId: request.id }, { status: 202 });
  } catch (syncError) {
    console.error("[Sync API] Failed to queue local sync:", syncError);
    return NextResponse.json({ error: String(syncError) }, { status: 500 });
  }
}

export async function GET() {
  const { data: status, error } = await supabase.from("sync_status").select("*").eq("id", 1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(status);
}
