type HasCities = { cities?: { date?: string }[] };

export const TURN_MS = 2 * 60 * 60 * 1000;
export const STAGNANT_TURNS = 120;

/** Turns since the nation's newest city was founded, or null if no city dates are known. */
export function turnsSinceLastCity(
  nation: HasCities,
  now = Date.now(),
): number | null {
  const times = (nation.cities ?? [])
    .map((c) => (c.date ? new Date(c.date).getTime() : NaN))
    .filter((t) => !Number.isNaN(t));
  if (times.length === 0) return null;
  return Math.max(0, Math.floor((now - Math.max(...times)) / TURN_MS));
}

export function findStagnantNations<T extends HasCities>(
  nations: T[],
  minTurns = STAGNANT_TURNS,
  now = Date.now(),
): (T & { turnsSinceCity: number })[] {
  return nations.flatMap((n) => {
    const turns = turnsSinceLastCity(n, now);
    return turns !== null && turns > minTurns ? [{ ...n, turnsSinceCity: turns }] : [];
  });
}

/** A nation's tax bracket ID, or null when it has none or hasn't synced one yet. */
export function taxBracketId(nation: { tax_id?: string | number }): number | null {
  const id = Number(nation.tax_id);
  return id > 0 ? id : null;
}
