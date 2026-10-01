import { NextRequest, NextResponse } from "next/server";
import { isBotRequestAuthorized } from "@/lib/bot-api-auth";
import db from "@/lib/db";

interface DiscordNationLinkInput {
  nationId: number;
  discordId: string;
  username: string;
}

export async function POST(request: NextRequest) {
  if (!isBotRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json() as { links?: DiscordNationLinkInput[] };
  if (!Array.isArray(payload.links)) {
    return NextResponse.json({ error: "links must be an array" }, { status: 400 });
  }

  const links = payload.links.filter((link) =>
    Number.isSafeInteger(link.nationId) && link.nationId > 0 &&
    typeof link.discordId === "string" && /^\d+$/.test(link.discordId) &&
    typeof link.username === "string" && link.username.trim().length > 0,
  );
  if (links.length !== payload.links.length) {
    return NextResponse.json({ error: "Each link requires a positive nationId, Discord ID, and username" }, { status: 400 });
  }

  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO discord_nation_links (nation_id, discord_id, username, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  db.transaction(() => {
    db.prepare("DELETE FROM discord_nation_links").run();
    for (const link of links) insert.run(link.nationId, link.discordId, link.username.trim(), now);
  })();

  return NextResponse.json({ count: links.length });
}
