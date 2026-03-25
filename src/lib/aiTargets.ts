// src/lib/aiTargets.ts
export interface AiPick {
  nation_id: number;
  nation_name: string;
  alliance_name: string;
  avg_infra: number;
  soldiers: number;
  tanks: number;
  aircraft: number;
  ships: number;
  defensive_wars_count: number;
  beige_avg: number | null;
  beige_count: number | null;
  reason: string;
}

export interface AiTargetsResponse {
  damage_picks: AiPick[];
  loot_picks: AiPick[];
  summary: string;
  target_count: number;
}
