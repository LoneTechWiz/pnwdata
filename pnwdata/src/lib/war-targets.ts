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

export function warTargetScoreRange(yourScore: number): { minScore: number; maxScore: number } {
  return {
    minScore: Math.floor(yourScore * 0.75),
    maxScore: Math.ceil((yourScore * 4) / 3),
  };
}

export function attackLootValue(attacks: LootAttack[], prices: TradePrices | null): number {
  return attacks.reduce((sum, a) => {
    const resourceValue = !prices
      ? 0
      : a.coal_looted * prices.coal +
        a.oil_looted * prices.oil +
        a.uranium_looted * prices.uranium +
        a.iron_looted * prices.iron +
        a.bauxite_looted * prices.bauxite +
        a.lead_looted * prices.lead +
        a.gasoline_looted * prices.gasoline +
        a.munitions_looted * prices.munitions +
        a.steel_looted * prices.steel +
        a.aluminum_looted * prices.aluminum +
        a.food_looted * prices.food;
    return sum + a.money_looted + resourceValue;
  }, 0);
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