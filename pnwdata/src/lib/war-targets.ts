export interface TradePrices {
  coal: number;
  oil: number;
  uranium: number;
  iron: number;
  bauxite: number;
  lead: number;
  gasoline: number;
  munitions: number;
  steel: number;
  aluminum: number;
  food: number;
}

export interface LootAttack {
  type?: string;
  money_looted: number;
  coal_looted: number;
  oil_looted: number;
  uranium_looted: number;
  iron_looted: number;
  bauxite_looted: number;
  lead_looted: number;
  gasoline_looted: number;
  munitions_looted: number;
  steel_looted: number;
  aluminum_looted: number;
  food_looted: number;
}

export interface AttackLootBreakdown {
  nationLoot: number;
  allianceLoot: number;
}

export function warTargetScoreRange(yourScore: number): { minScore: number; maxScore: number } {
  return {
    minScore: Math.floor(yourScore * 0.75),
    maxScore: Math.ceil((yourScore * 4) / 3),
  };
}

export function attackLootValue(attacks: LootAttack[], prices: TradePrices | null): number {
  return attacks.reduce((sum, attack) => sum + singleAttackLootValue(attack, prices), 0);
}

function singleAttackLootValue(attack: LootAttack, prices: TradePrices | null): number {
  const resourceValue = !prices
      ? 0
      : attack.coal_looted * prices.coal +
        attack.oil_looted * prices.oil +
        attack.uranium_looted * prices.uranium +
        attack.iron_looted * prices.iron +
        attack.bauxite_looted * prices.bauxite +
        attack.lead_looted * prices.lead +
        attack.gasoline_looted * prices.gasoline +
        attack.munitions_looted * prices.munitions +
        attack.steel_looted * prices.steel +
        attack.aluminum_looted * prices.aluminum +
        attack.food_looted * prices.food;
  return attack.money_looted + resourceValue;
}

export function attackLootBreakdown(
  attacks: LootAttack[],
  prices: TradePrices | null,
): AttackLootBreakdown {
  return attacks.reduce<AttackLootBreakdown>((totals, attack) => {
    const value = singleAttackLootValue(attack, prices);
    if (attack.type === "VICTORY") totals.nationLoot += value;
    if (attack.type === "ALLIANCELOOT") totals.allianceLoot += value;
    return totals;
  }, { nationLoot: 0, allianceLoot: 0 });
}

export function avgInfraPerCity(cities: { infrastructure: number }[]): number {
  if (cities.length === 0) return 0;
  return Math.round(cities.reduce((s, c) => s + c.infrastructure, 0) / cities.length);
}

export interface BeigeLossInput {
  date: string;
  att_id: string | number;
  def_id: string | number;
  winner_id: string | number;
  attacks: LootAttack[];
}

export interface BeigeLossRecord {
  loot: number;
  date: string;
  allLoots: number[];
}

/** Updates beige map when a target nation lost a war (winner is the other side). */
export function recordBeigeLoss(
  map: Map<number, BeigeLossRecord>,
  war: BeigeLossInput,
  targetIdSet: Set<number>,
  prices: TradePrices | null
): void {
  if (String(war.winner_id) === "0") return;
  const attId = Number(war.att_id);
  const defId = Number(war.def_id);
  const winnerId = Number(war.winner_id);
  const loserId = winnerId === attId ? defId : attId;
  if (!targetIdSet.has(loserId)) return;

  const loot = attackLootValue(war.attacks, prices);
  const existing = map.get(loserId);
  if (!existing) {
    map.set(loserId, { loot, date: war.date, allLoots: [loot] });
  } else {
    existing.allLoots.push(loot);
    if (war.date > existing.date) {
      existing.loot = loot;
      existing.date = war.date;
    }
  }
}

export function beigeAverage(allLoots: number[]): number {
  return Math.round(allLoots.reduce((s, v) => s + v, 0) / allLoots.length);
}
