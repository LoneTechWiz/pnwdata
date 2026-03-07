import { NextResponse } from "next/server";
import { sync } from "@/lib/sync";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const status = db.prepare("SELECT status FROM sync_status WHERE id = 1").get() as { status: string } | undefined;
  if (status?.status === "syncing") {
    return NextResponse.json({ message: "Sync already in progress" }, { status: 409 });
  }
  sync().catch(console.error);
  return NextResponse.json({ message: "Sync triggered" });
}

export async function GET() {
  const status = db.prepare("SELECT * FROM sync_status WHERE id = 1").get();
  return NextResponse.json(status);
}
