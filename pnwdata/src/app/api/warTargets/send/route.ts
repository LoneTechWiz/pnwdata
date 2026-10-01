import { NextRequest, NextResponse } from "next/server";
import { sendDiscordDm } from "@/lib/darth-protocol";
import { getSession } from "@/lib/session";
import type { WarTarget } from "@/app/api/warTargets/route";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as { nation_id: number; target: WarTarget };
  const { nation_id, target } = body;

  if (!nation_id || !target) {
    return NextResponse.json({ error: "Missing nation_id or target" }, { status: 400 });
  }

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

  try {
    await sendDiscordDm(nation_id, message);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const status = details.includes("not found") ? 404 : 502;
    return NextResponse.json({ error: details }, { status });
  }

  return NextResponse.json({ ok: true });
}
