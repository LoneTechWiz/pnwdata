import { NextRequest, NextResponse } from "next/server";
import { readJsonRows, readJsonSingleton, supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type");

  switch (type) {
    case "members": {
      return NextResponse.json(await readJsonRows("nations"));
    }
    case "wars": {
      return NextResponse.json(await readJsonRows("wars"));
    }
    case "bankrecs": {
      return NextResponse.json(await readJsonRows("bankrecs"));
    }
    case "alliance": {
      return NextResponse.json(await readJsonSingleton("alliance_meta"));
    }
    case "bknet_members": {
      return NextResponse.json(await readJsonRows("bknet_members"));
    }
    case "trade_prices": {
      return NextResponse.json(await readJsonSingleton("trade_prices"));
    }
    case "applicants": {
      return NextResponse.json(await readJsonRows("applicants"));
    }
    case "game_info": {
      return NextResponse.json(await readJsonSingleton("game_info"));
    }
    case "discord_resolved": {
      const { data: rows, error } = await supabase.from("discord_resolved").select("discord_id, username");
      if (error) throw new Error(error.message);
      return NextResponse.json(Object.fromEntries(rows.map(r => [r.discord_id, r.username])));
    }
    case "status": {
      const { data, error } = await supabase.from("sync_status").select("*").eq("id", 1).maybeSingle();
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    }
    default:
      return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  }
}
