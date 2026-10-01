import { NextRequest, NextResponse } from "next/server";
import db, { readJsonRows, readJsonSingleton } from "@/lib/db";

export const dynamic = "force-dynamic";

interface DiscordLinkRow {
  nation_id: number;
  discord_id: string;
  username: string;
}

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type");

  switch (type) {
    case "members":
      return NextResponse.json(readJsonRows("nations"));
    case "applicants":
      return NextResponse.json(readJsonRows("applicants"));
    case "wars":
      return NextResponse.json(readJsonRows("wars"));
    case "bankrecs":
      return NextResponse.json(readJsonRows("bankrecs"));
    case "alliance":
      return NextResponse.json(readJsonSingleton("alliance_meta"));
    case "trade_prices":
      return NextResponse.json(readJsonSingleton("trade_prices"));
    case "game_info":
      return NextResponse.json(readJsonSingleton("game_info"));
    case "status": {
      const row = db.prepare("SELECT * FROM sync_status WHERE id = 1").get();
      return NextResponse.json(row ?? null);
    }
    case "discord_links": {
      const rows = db.prepare("SELECT nation_id, discord_id, username FROM discord_nation_links").all() as DiscordLinkRow[];
      const links = Object.fromEntries(
        rows.map((row) => [row.nation_id, { discordId: row.discord_id, username: row.username }]),
      );
      return NextResponse.json(links);
    }
    default:
      return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  }
}
