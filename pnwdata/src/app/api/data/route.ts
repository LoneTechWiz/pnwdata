import { NextRequest, NextResponse } from "next/server";
import db, { readJsonRows, readJsonSingleton } from "@/lib/db";
import { readAllNations, readAllWars, readAllBankrecs } from "@/lib/merged-data";

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
      return NextResponse.json(readAllNations());
    case "applicants":
      return NextResponse.json(readJsonRows("applicants"));
    case "wars":
      return NextResponse.json(readAllWars());
    case "bankrecs":
      return NextResponse.json(readAllBankrecs());
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
    case "tax_brackets": {
      const rows = db.prepare("SELECT alliance_id, bracket_id, bracket_name FROM tax_bracket_config").all() as Array<{ alliance_id: number; bracket_id: number; bracket_name: string }>;
      return NextResponse.json(Object.fromEntries(rows.map((row) => [`${row.alliance_id}:${row.bracket_id}`, row.bracket_name])));
    }
    default:
      return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  }
}
