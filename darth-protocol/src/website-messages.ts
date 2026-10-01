import type { StockpileAlert, WarTarget } from "./pnwdata.js";

const RESOURCE_LABELS: Record<string, string> = {
  money: "Cash",
  coal: "Coal",
  oil: "Oil",
  uranium: "Uranium",
  iron: "Iron",
  bauxite: "Bauxite",
  lead: "Lead",
  gasoline: "Gasoline",
  munitions: "Munitions",
  steel: "Steel",
  aluminum: "Aluminum",
  food: "Food",
};

function amount(value: number, money: boolean): string {
  const rounded = Math.round(value).toLocaleString("en-US");
  return money ? `$${rounded}` : rounded;
}

export function formatStockpileAlert(alerts: StockpileAlert[]): string {
  if (alerts.length === 0) throw new Error("At least one stockpile alert is required.");
  const lines = alerts.map((alert) => {
    const isMoney = alert.resource === "money";
    const limit = alert.resource === "uranium" ? alert.threshold : alert.threshold * alert.num_cities;
    const excess = alert.amount - limit;
    return `• **${RESOURCE_LABELS[alert.resource] ?? alert.resource}**: ${amount(alert.amount, isMoney)} — limit ${amount(limit, isMoney)} (${amount(excess, isMoney)} over)`;
  });
  return [
    `⚠️ **Stockpile Alert** — ${alerts[0].nation_name}`,
    "",
    "You're holding more than the per-city limits:",
    ...lines,
    "",
    "Consider depositing the excess to the alliance bank.",
  ].join("\n");
}

export type TargetSort = "infra" | "soldiers" | "loot";

export function sortWarTargets(targets: WarTarget[], sort: TargetSort): WarTarget[] {
  return [...targets].sort((left, right) => {
    if (sort === "soldiers") return left.soldiers - right.soldiers;
    if (sort === "loot") return (right.beige_avg ?? -1) - (left.beige_avg ?? -1);
    if (right.avg_infra !== left.avg_infra) return right.avg_infra - left.avg_infra;
    return left.soldiers - right.soldiers;
  });
}
