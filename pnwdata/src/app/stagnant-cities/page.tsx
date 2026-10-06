"use client";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { fetchMembers, fetchDiscordLinks, fetchSyncStatus } from "@/lib/pnw";
import { findStagnantNations, STAGNANT_TURNS } from "@/lib/city-stagnation";
import { ArrowUpDown } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { ExportButton } from "@/components/ExportButton";

type SortKey = "nation_name" | "num_cities" | "turnsSinceCity";

export default function StagnantCitiesPage() {
  const [minTurns, setMinTurns] = useState(String(STAGNANT_TURNS));
  const [sortKey, setSortKey] = useState<SortKey>("num_cities");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const { data: members = [], isLoading, error } = useQuery({
    queryKey: ["members"],
    queryFn: fetchMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: discordLinks = {} } = useQuery({ queryKey: ["discordLinks"], queryFn: fetchDiscordLinks, refetchInterval: 10 * 60 * 1000 });
  const { data: status } = useQuery({ queryKey: ["syncStatus"], queryFn: fetchSyncStatus, refetchInterval: 15_000 });

  const showAllianceTag = new Set(members.map(m => m.alliance_name).filter(Boolean)).size > 1;

  const rows = useMemo(() => {
    const threshold = parseInt(minTurns, 10);
    const found = findStagnantNations(members, Number.isNaN(threshold) ? STAGNANT_TURNS : threshold);
    return found.sort((a, b) => {
      const av = sortKey === "nation_name" ? a.nation_name : a[sortKey];
      const bv = sortKey === "nation_name" ? b.nation_name : b[sortKey];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      const dir = sortDir === "asc" ? cmp : -cmp;
      return dir || b.turnsSinceCity - a.turnsSinceCity;
    });
  }, [members, minTurns, sortKey, sortDir]);

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (members.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  const columns: { key: SortKey; label: string }[] = [
    { key: "nation_name", label: "Nation" },
    { key: "num_cities", label: "Cities" },
    { key: "turnsSinceCity", label: "Turns Since Last City" },
  ];

  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-white">Stagnant Cities</h2>
          <p className="text-slate-400 text-sm">Nations that have gone more than the set number of turns (2 hours each) without building a city</p>
        </div>

        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 max-w-xs">
          <label className="block text-xs font-medium mb-1 text-slate-400">Minimum turns since last city</label>
          <input
            type="number"
            min="0"
            value={minTurns}
            onChange={e => setMinTurns(e.target.value)}
            className="w-full bg-[#0f1117] border border-[#2a3150] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-slate-400 text-sm">{rows.length} nation{rows.length !== 1 ? "s" : ""} matched</p>
          <ExportButton
            filename="stagnant-cities"
            label="Export Excel"
            getData={() => rows.map(m => ({
              Nation: m.nation_name,
              Alliance: m.alliance_name ?? "",
              Leader: m.leader_name,
              Discord: discordLinks[String(m.id)]?.username ?? "",
              Cities: m.num_cities,
              "Turns Since Last City": m.turnsSinceCity,
              "Days Since Last City": Math.floor(m.turnsSinceCity / 12),
            }))}
          />
        </div>

        {rows.length === 0 ? (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-8 text-center text-slate-400">
            No nations match.
          </div>
        ) : (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#2a3150]">
                  {columns.map(({ key, label }) => {
                    const isLeft = key === "nation_name";
                    const active = sortKey === key;
                    return (
                      <th
                        key={key}
                        onClick={() => handleSort(key)}
                        className={`px-3 py-3 text-xs font-medium cursor-pointer select-none group ${isLeft ? "text-left" : "text-right"}`}
                      >
                        <span className={`flex items-center ${isLeft ? "" : "justify-end"} gap-1 ${active ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`}>
                          {!isLeft && <ArrowUpDown size={10} className={active ? "opacity-100" : "opacity-30"} />}
                          {label}
                          {isLeft && <ArrowUpDown size={10} className={active ? "opacity-100" : "opacity-30"} />}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map(m => (
                  <tr key={m.id} className="border-b border-[#1e2540] hover:bg-[#1a2035] transition-colors">
                    <td className="px-3 py-2.5">
                      <a
                        href={`https://politicsandwar.com/nation/id=${m.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white font-medium hover:text-blue-400 transition-colors block"
                      >
                        {m.nation_name}
                      </a>
                      <div className="text-xs text-slate-500">{m.leader_name}</div>
                      {showAllianceTag && m.alliance_name && (
                        <div className="text-xs text-sky-400">{m.alliance_name}</div>
                      )}
                      {discordLinks[String(m.id)] && (
                        <div className="text-xs text-indigo-400">{discordLinks[String(m.id)].username}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{m.num_cities}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-amber-400">
                      {m.turnsSinceCity.toLocaleString()}
                      <span className="text-xs text-slate-500 ml-1">({Math.floor(m.turnsSinceCity / 12)}d)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
