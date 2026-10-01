import { NextRequest, NextResponse } from "next/server";
import { getNationRecord } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import type { AiPick } from "@/lib/aiTargets";

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

  const body = await request.json() as { nation_id: number; pick: AiPick; pick_type: string };
  const { nation_id, pick, pick_type } = body;

  if (!nation_id || !pick) {
    return NextResponse.json({ error: "Missing nation_id or pick" }, { status: 400 });
  }

  const row = await getNationRecord(nation_id);
  const discordUsername = row?.data.discord;
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
      { error: `Discord user "${discordUsername}" not found in server` },
      { status: 404 }
    );
  }

  type DmChannel = { id: string };
  const dmChannel = await discordFetch<DmChannel>("/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: member.user.id }),
  });

  const label = pick_type === "damage" ? "⚔️ Max Damage" : "💰 Max Loot";
  const stat = pick_type === "damage"
    ? `Avg Infra: ${pick.avg_infra.toLocaleString()}`
    : pick.beige_avg != null
      ? `Avg Beige Loot: $${(pick.beige_avg / 1_000_000).toFixed(1)}M`
      : "No beige history";

  const message = [
    `🎯 **Target Recommendation** (${label})`,
    `**${pick.nation_name}** | ${pick.alliance_name}`,
    `${stat} | ✈ ${pick.aircraft} aircraft | 🪖 ${pick.soldiers.toLocaleString()} soldiers | 🛡 ${pick.defensive_wars_count} def wars`,
    `💡 ${pick.reason}`,
    `<https://politicsandwar.com/nation/war/declare/id=${pick.nation_id}>`,
  ].join("\n");

  await discordFetch(`/channels/${dmChannel.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: message }),
  });

  return NextResponse.json({ ok: true });
}
