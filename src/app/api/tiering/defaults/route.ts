import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export interface TieringDefaults {
  allyIds: number[];
  enemyIds: number[];
}

export async function GET() {
  try {
    const configPath = join(process.cwd(), "data", "war-config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as {
      enemy_alliance_ids?: unknown;
      ally_alliance_ids?: unknown;
    };
    const allyIds = Array.isArray(config.ally_alliance_ids) ? config.ally_alliance_ids.map(Number) : [];
    const enemyIds = Array.isArray(config.enemy_alliance_ids) ? config.enemy_alliance_ids.map(Number) : [];
    return NextResponse.json({ allyIds, enemyIds } satisfies TieringDefaults);
  } catch {
    return NextResponse.json({ allyIds: [], enemyIds: [] } satisfies TieringDefaults);
  }
}
