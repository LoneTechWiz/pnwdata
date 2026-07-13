import { NextResponse } from "next/server";
import { sync } from "@/lib/sync";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST() {
  const { data: status, error } = await supabase.from("sync_status").select("status").eq("id", 1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (status?.status === "syncing") {
    return NextResponse.json({ message: "Sync already in progress" }, { status: 409 });
  }
  sync().catch(console.error);
  return NextResponse.json({ message: "Sync triggered" });
}

export async function GET() {
  const { data: status, error } = await supabase.from("sync_status").select("*").eq("id", 1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(status);
}
