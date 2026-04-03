import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { getSession } from "@/lib/session";
import type { WarTarget } from "@/app/api/warTargets/route";

export const dynamic = "force-dynamic";

const DISCORD_API = "https://discord.com/api/v10";

async function discordFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) {
    return NextResponse.json({ error: "Discord bot not configured" }, { status: 500 });
  }

  const body = await request.json() as { nation_id: number; target: WarTarget };
  const { nation_id, target } = body;

  if (!nation_id || !target) {
    return NextResponse.json({ error: "Missing nation_id or target" }, { status: 400 });
  }

  const row = db.prepare(`
    SELECT json_extract(data, '$.discord') as discord FROM nations WHERE id = ?
    UNION
    SELECT json_extract(data, '$.discord') as discord FROM applicants WHERE id = ?
    LIMIT 1
  `).get(nation_id, nation_id) as { discord: string | null } | undefined;

  const discordUsername = row?.discord;
  if (!discordUsername) {
    return NextResponse.json({ error: "No Discord username linked to this nation" }, { status: 404 });
  }

  // Strip legacy discriminator (e.g. "user#0" → "user")
  const discordBase = discordUsername.includes("#") ? discordUsername.split("#")[0] : discordUsername;

  type GuildMember = { user: { id: string; username: string } };
  const members = await discordFetch<GuildMember[]>(
    `/guilds/${process.env.DISCORD_GUILD_ID}/members/search?query=${encodeURIComponent(discordBase)}&limit=10`
  );

  const member = members.find(m => m.user.username.toLowerCase() === discordBase.toLowerCase());
  if (!member) {
    return NextResponse.json(
      { error: `Discord user "${discordBase}" not found in server` },
      { status: 404 }
    );
  }

  type DmChannel = { id: string };
  const dmChannel = await discordFetch<DmChannel>("/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: member.user.id }),
  });

  const beigeStr = target.beige_avg != null
    ? `Avg Beige Loot: $${(target.beige_avg / 1_000_000).toFixed(1)}M (${target.beige_count} war${target.beige_count === 1 ? "" : "s"})`
    : "No beige history";

  const message = [
    `🎯 **War Target**`,
    `**${target.nation_name}** (${target.leader_name}) | ${target.alliance_name}`,
    `Score: ${Math.round(target.score).toLocaleString()} | Cities: ${target.num_cities} | Avg Infra: ${target.avg_infra.toLocaleString()}`,
    `✈ ${target.aircraft} aircraft | 🛡 ${target.defensive_wars_count} def wars | 🪖 ${target.soldiers.toLocaleString()} soldiers`,
    beigeStr,
    `<https://politicsandwar.com/nation/war/declare/id=${target.id}>`,
  ].join("\n");

  await discordFetch(`/channels/${dmChannel.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: message }),
  });

  return NextResponse.json({ ok: true });
}
