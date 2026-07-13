import { NextResponse } from "next/server";
import { readAppConfig } from "@/lib/app-config";

export interface TieringDefaults {
  allyIds: number[];
  enemyIds: number[];
}

export async function GET() {
  try {
    const config = await readAppConfig<{
      enemy_alliance_ids?: unknown;
      ally_alliance_ids?: unknown;
    }>("war-config");
    const allyIds = Array.isArray(config.ally_alliance_ids) ? config.ally_alliance_ids.map(Number) : [];
    const enemyIds = Array.isArray(config.enemy_alliance_ids) ? config.enemy_alliance_ids.map(Number) : [];
    return NextResponse.json({ allyIds, enemyIds } satisfies TieringDefaults);
  } catch {
    return NextResponse.json({ allyIds: [], enemyIds: [] } satisfies TieringDefaults);
  }
}
