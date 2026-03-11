"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchMembers, fetchBknetMembers, fetchSyncStatus, Nation } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { StatCard } from "@/components/StatCard";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { ArrowUpDown, Building2, TreePine, Search } from "lucide-react";
import { ExportButton } from "@/components/ExportButton";

type SortKey = "nation_name" | "num_cities" | "avg_infra" | "avg_land" | "total_infra" | "total_land" | "infra_cost" | "land_cost" | "total_cost";
type SortDir = "asc" | "desc";

interface NationInfra {
  id: number;
  nation_name: string;
  leader_name: string;
  num_cities: number;
  avg_infra: number;
  avg_land: number;
  total_infra: number;
  total_land: number;
  vacation_mode_turns: number;
  cities: { infrastructure: number; land: number }[];
  infraDiscount: number;
  landDiscount: number;
}

function computeDiscount(
  projects: Record<string, boolean> | undefined,
  type: "infra" | "land"
): number {
  const p = projects ?? {};
  // GSA and BDA amplify the domestic policy effect
  let policyBonus = 0.05; // Urbanization (infra) or Rapid Expansion (land)
  if (p.government_support_agency) policyBonus *= 1.5;
  if (p.bureau_of_domestic_affairs) policyBonus *= 1.25;

  if (type === "infra") {
    return policyBonus
      + (p.center_for_civil_engineering ? 0.05 : 0)
      + (p.advanced_engineering_corps   ? 0.05 : 0);
  } else {
    return policyBonus
      + (p.arable_land_agency         ? 0.05 : 0)
      + (p.advanced_engineering_corps ? 0.05 : 0);
  }
}

// P&W infrastructure purchase cost: price per unit = 300 + 0.15*level
// Max 100 units per purchase; price recalculates at each new level
function infraUpgradeCost(current: number, target: number, discount: number): number {
  if (target <= current) return 0;
  let cost = 0;
  let level = current;
  while (level < target) {
    const amount = Math.min(100, target - level);
    cost += amount * (300 + 0.15 * level);
    level += amount;
  }
  return cost * (1 - discount);
}

// P&W land purchase cost: price per unit = 0.002*(level-20)^2 + 50
// Max 500 units per purchase; price recalculates at each new level
function landUpgradeCost(current: number, target: number, discount: number): number {
  if (target <= current) return 0;
  let cost = 0;
  let level = current;
  while (level < target) {
    const amount = Math.min(500, target - level);
    cost += amount * (0.002 * Math.pow(level - 20, 2) + 50);
    level += amount;
  }
  return cost * (1 - discount);
}

function upgradeCosts(nation: NationInfra, targetInfra: number, targetLand: number) {
  let infra = 0, land = 0;
  for (const c of nation.cities) {
    infra += infraUpgradeCost(c.infrastructure, targetInfra, nation.infraDiscount);
    land  += landUpgradeCost(c.land, targetLand, nation.landDiscount);
  }
  return { infra, land, total: infra + land };
}

function fmtMoney(n: number): string {
  if (n === 0) return "$0";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function computeInfra(
  members: Nation[],
  projectMap: Map<string, Record<string, boolean>>
): NationInfra[] {
  return members.map(m => {
    const cities = m.cities ?? [];
    const total_infra = cities.reduce((s, c) => s + (c.infrastructure ?? 0), 0);
    const total_land = cities.reduce((s, c) => s + (c.land ?? 0), 0);
    const projects = projectMap.get(String(m.id));
    return {
      id: m.id,
      nation_name: m.nation_name,
      leader_name: m.leader_name,
      num_cities: m.num_cities,
      avg_infra: cities.length ? total_infra / cities.length : 0,
      avg_land: cities.length ? total_land / cities.length : 0,
      total_infra,
      total_land,
      vacation_mode_turns: m.vacation_mode_turns,
      cities,
      infraDiscount: computeDiscount(projects, "infra"),
      landDiscount:  computeDiscount(projects, "land"),
    };
  });
}

function InfraBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 bg-[#2a3150] rounded-full h-1.5">
        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums w-16 text-right">{value.toFixed(0)}</span>
    </div>
  );
}

export default function InfraPage() {
  const [sortKey, setSortKey] = useState<SortKey>("avg_infra");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showVm, setShowVm] = useState(false);
  const [search, setSearch] = useState("");
  const [targetInfra, setTargetInfra] = useState("2500");
  const [targetLand, setTargetLand] = useState("5000");

  const { data: members = [], isLoading, error } = useQuery({
    queryKey: ["members"],
    queryFn: fetchMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: bknetMembers = [] } = useQuery({
    queryKey: ["bknet_members"],
    queryFn: fetchBknetMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: status } = useQuery({ queryKey: ["syncStatus"], queryFn: fetchSyncStatus, refetchInterval: 15_000 });

  const bknetDiscord = new Map(
    bknetMembers
      .filter(m => m.discord?.account?.discord_username)
      .map(m => [String(m.nation.id), m.discord!.account!.discord_username])
  );

  const projectMap = new Map(
    bknetMembers.map(m => [String(m.nation.id), m.nation.projects])
  );

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (members.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  const hasCityData = members.some(m => m.cities && m.cities.length > 0);
  const parsedTargetInfra = parseFloat(targetInfra) || 0;
  const parsedTargetLand = parseFloat(targetLand) || 0;
  const showCost = hasCityData && (parsedTargetInfra > 0 || parsedTargetLand > 0);

  const allRows = computeInfra(members, projectMap);
  const searchLower = search.toLowerCase();
  const rows = allRows
    .filter(r => showVm || r.vacation_mode_turns === 0)
    .filter(r => !searchLower || r.nation_name.toLowerCase().includes(searchLower) || r.leader_name.toLowerCase().includes(searchLower) || (bknetDiscord.get(String(r.id)) ?? "").toLowerCase().includes(searchLower))
    .sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sortKey === "infra_cost") {
        av = upgradeCosts(a, parsedTargetInfra, parsedTargetLand).infra;
        bv = upgradeCosts(b, parsedTargetInfra, parsedTargetLand).infra;
      } else if (sortKey === "land_cost") {
        av = upgradeCosts(a, parsedTargetInfra, parsedTargetLand).land;
        bv = upgradeCosts(b, parsedTargetInfra, parsedTargetLand).land;
      } else if (sortKey === "total_cost") {
        av = upgradeCosts(a, parsedTargetInfra, parsedTargetLand).total;
        bv = upgradeCosts(b, parsedTargetInfra, parsedTargetLand).total;
      } else {
        av = a[sortKey] as number | string;
        bv = b[sortKey] as number | string;
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });

  const activeRows = allRows.filter(r => r.vacation_mode_turns === 0);
  const allianceAvgInfra = activeRows.length ? activeRows.reduce((s, r) => s + r.avg_infra, 0) / activeRows.length : 0;
  const allianceAvgLand = activeRows.length ? activeRows.reduce((s, r) => s + r.avg_land, 0) / activeRows.length : 0;
  const totalInfra = activeRows.reduce((s, r) => s + r.total_infra, 0);
  const maxAvgInfra = Math.max(...rows.map(r => r.avg_infra), 1);
  const maxAvgLand = Math.max(...rows.map(r => r.avg_land), 1);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  function Th({ label, field, className = "" }: { label: string; field: SortKey; className?: string }) {
    const active = sortKey === field;
    return (
      <th className={`px-4 py-3 cursor-pointer select-none group ${className}`} onClick={() => handleSort(field)}>
        <span className={`flex items-center gap-1 text-xs font-medium ${active ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`}>
          {label}
          <ArrowUpDown size={10} className={active ? "opacity-100" : "opacity-30"} />
        </span>
      </th>
    );
  }

  const inputCls = "bg-[#1e2540] border border-[#2a3150] rounded-lg text-sm text-white px-3 py-1.5 w-36 focus:outline-none focus:border-blue-500 placeholder-slate-600";

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Infrastructure & Land</h2>
            <p className="text-slate-400 text-sm">
              Average infrastructure and land per city for each nation
              {!hasCityData && (
                <span className="ml-2 text-yellow-400 text-xs">— city data not yet synced, trigger a manual sync</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <ExportButton
              filename="infra-land"
              getData={() => rows.map(r => {
                const costs = showCost ? upgradeCosts(r, parsedTargetInfra, parsedTargetLand) : null;
                const row: Record<string, unknown> = {
                  Nation: r.nation_name,
                  Leader: r.leader_name,
                  Discord: bknetDiscord.get(String(r.id)) ?? "",
                  Cities: r.num_cities,
                  "Avg Infra/City": Math.round(r.avg_infra),
                  "Avg Land/City": Math.round(r.avg_land),
                  "Total Infra": Math.round(r.total_infra),
                  "Total Land": Math.round(r.total_land),
                };
                if (costs) {
                  row["Infra Cost"] = Math.round(costs.infra);
                  row["Land Cost"] = Math.round(costs.land);
                  row["Total Cost"] = Math.round(costs.total);
                }
                return row;
              })}
            />
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search nation, leader, discord…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-[#161b2e] border border-[#2a3150] rounded-lg pl-8 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-56"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
              <input type="checkbox" checked={showVm} onChange={e => setShowVm(e.target.checked)} className="accent-blue-500" />
              Show Vacation Mode
            </label>
          </div>
        </div>

        {/* Target inputs */}
        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400 font-medium">Target Infra / City</label>
            <input
              type="number"
              min={0}
              placeholder="e.g. 2000"
              value={targetInfra}
              onChange={e => setTargetInfra(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400 font-medium">Target Land / City</label>
            <input
              type="number"
              min={0}
              placeholder="e.g. 3000"
              value={targetLand}
              onChange={e => setTargetLand(e.target.value)}
              className={inputCls}
            />
          </div>
          {showCost && (() => {
            const totals = rows.reduce((acc, r) => {
              const c = upgradeCosts(r, parsedTargetInfra, parsedTargetLand);
              return { infra: acc.infra + c.infra, land: acc.land + c.land };
            }, { infra: 0, land: 0 });
            return (
              <p className="text-xs text-slate-500 self-end pb-1.5 space-x-3">
                <span>Alliance total — Infra: <span className="text-blue-300 font-medium">{fmtMoney(totals.infra)}</span></span>
                <span>Land: <span className="text-green-300 font-medium">{fmtMoney(totals.land)}</span></span>
                <span>Combined: <span className="text-yellow-300 font-medium">{fmtMoney(totals.infra + totals.land)}</span></span>
              </p>
            );
          })()}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Alliance Avg Infra/City" value={allianceAvgInfra.toFixed(0)} icon={Building2} color="text-blue-400" sub="active members" />
          <StatCard label="Alliance Avg Land/City" value={allianceAvgLand.toFixed(0)} icon={TreePine} color="text-green-400" sub="active members" />
          <StatCard label="Total Alliance Infra" value={totalInfra >= 1_000_000 ? `${(totalInfra / 1_000_000).toFixed(1)}M` : `${(totalInfra / 1_000).toFixed(0)}K`} icon={Building2} color="text-cyan-400" sub="active members" />
          <StatCard label="Nations Shown" value={rows.length} icon={Building2} color="text-slate-400" sub={`of ${members.length} total`} />
        </div>

        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-[#2a3150]">
                <Th label="Nation" field="nation_name" className="text-left" />
                <Th label="Cities" field="num_cities" className="text-right" />
                <Th label="Avg Infra / City" field="avg_infra" className="text-left" />
                <Th label="Avg Land / City" field="avg_land" className="text-left" />
                <Th label="Total Infra" field="total_infra" className="text-right" />
                <Th label="Total Land" field="total_land" className="text-right" />
                {showCost && <Th label="Infra Cost" field="infra_cost" className="text-right" />}
                {showCost && <Th label="Land Cost" field="land_cost" className="text-right" />}
                {showCost && <Th label="Total Cost" field="total_cost" className="text-right" />}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const costs = showCost ? upgradeCosts(r, parsedTargetInfra, parsedTargetLand) : null;
                return (
                  <tr key={r.id} className={`border-b border-[#1e2540] hover:bg-[#1a2035] transition-colors ${r.vacation_mode_turns > 0 ? "opacity-50" : ""}`}>
                    <td className="px-4 py-2.5">
                      <a href={`https://politicsandwar.com/nation/id=${r.id}`} target="_blank" rel="noopener noreferrer"
                        className="text-white font-medium hover:text-blue-400 transition-colors">
                        {r.nation_name}
                      </a>
                      <div className="text-xs text-slate-500">{r.leader_name}</div>
                      {bknetDiscord.has(String(r.id)) && (
                        <div className="text-xs text-indigo-400">{bknetDiscord.get(String(r.id))}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-300 font-medium">{r.num_cities}</td>
                    <td className="px-4 py-2.5">
                      {hasCityData ? <InfraBar value={r.avg_infra} max={maxAvgInfra} color="bg-blue-500" /> : <span className="text-slate-600 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {hasCityData ? <InfraBar value={r.avg_land} max={maxAvgLand} color="bg-green-500" /> : <span className="text-slate-600 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right text-blue-300 tabular-nums">
                      {hasCityData ? r.total_infra.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-green-300 tabular-nums">
                      {hasCityData ? r.total_land.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                    </td>
                    {showCost && (
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span className={costs!.infra === 0 ? "text-slate-600 text-xs" : "text-blue-300"}>
                          {fmtMoney(costs!.infra)}
                        </span>
                      </td>
                    )}
                    {showCost && (
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span className={costs!.land === 0 ? "text-slate-600 text-xs" : "text-green-300"}>
                          {fmtMoney(costs!.land)}
                        </span>
                      </td>
                    )}
                    {showCost && (
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span className={costs!.total === 0 ? "text-slate-600 text-xs" : "text-yellow-300 font-medium"}>
                          {fmtMoney(costs!.total)}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
