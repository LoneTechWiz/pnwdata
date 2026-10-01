/** Uranium uses a flat threshold; all other resources are per-city. */
export function stockpileLimit(
  threshold: number,
  resource: string,
  numCities: number
): number {
  return resource === "uranium" ? threshold : threshold * numCities;
}

export function exceedsStockpileThreshold(
  amount: number,
  threshold: number,
  resource: string,
  numCities: number
): boolean {
  if (threshold <= 0) return false;
  return amount > stockpileLimit(threshold, resource, numCities);
}