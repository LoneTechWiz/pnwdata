"use client";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { fetchMembers, fetchBknetMembers, fetchSyncStatus, Nation } from "@/lib/pnw";
import { ArrowUpDown } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { ExportButton } from "@/components/ExportButton";

interface ResourceConfig {
  key: keyof Nation;
  label: string;
  color: string;
  unit: string;
}

const RESOURCES: ResourceConfig[] = [
  { key: "money",     label: "Cash",       color: "text-yellow-400", unit: "$" },
  { key: "gasoline",  label: "Gasoline",   color: "text-orange-400", unit: ""  },
  { key: "munitions", label: "Munitions",  color: "text-red-400",    unit: ""  },
  { key: "steel",     label: "Steel",      color: "text-slate-300",  unit: ""  },
  { key: "aluminum",  label: "Aluminum",   color: "text-cyan-400",   unit: ""  },
];

type SortKey = "nation_name" | "num_cities" | "money" | "gasoline" | "munitions" | "steel" | "aluminum";

const DEFAULT_THRESHOLDS: Record<string, string> = {
  money: "2000000",
  gasoline: "",
  munitions: "",
  steel: "",
  aluminum: "",
};

function fmt(value: number, unit: string) {
  const s = Math.round(value).toLocaleString();
  return unit === "$" ? `$${s}` : s;
}

export default function CashHoldersPage() {
  const [thresholds, setThresholds] = useState<Record<string, string>>(DEFAULT_THRESHOLDS);
  const [sortKey, setSortKey] = useState<SortKey>("money");
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
  const { data: bknetMembers = [] } = useQuery({
    queryKey: ["bknet_members"],
    queryFn: fetchBknetMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: status } = useQuery({ queryKey: ["syncStatus"], queryFn: fetchSyncStatus, refetchInterval: 15_000 });

  const bknetDiscord = useMemo(() => new Map(
    bknetMembers
      .filter(m => m.discord?.account?.discord_username)
      .map(m => [String(m.nation.id), m.discord!.account!.discord_username])
  ), [bknetMembers]);

  const filtered = useMemo(() => {
    const active = RESOURCES.filter(r => {
      const v = parseFloat(thresholds[r.key as string]);
      return !isNaN(v) && v >= 0;
    });
    if (active.length === 0) return [];

    return members
      .filter(m => m.vacation_mode_turns === 0)
      .filter(m => active.some(r => {
        const threshold = parseFloat(thresholds[r.key as string]) * m.num_cities;
        return (m[r.key] as number ?? 0) > threshold;
      }))
      .sort((a, b) => {
        const av = sortKey === "nation_name" ? a.nation_name : (a[sortKey] ?? 0) as number | string;
        const bv = sortKey === "nation_name" ? b.nation_name : (b[sortKey] ?? 0) as number | string;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [members, thresholds, sortKey, sortDir]);

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (members.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-white">Stockpile</h2>
          <p className="text-slate-400 text-sm">Nations exceeding any threshold — thresholds are per city</p>
        </div>

        {/* Threshold inputs */}
        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {RESOURCES.map(r => (
              <div key={r.key as string}>
                <label className={`block text-xs font-medium mb-1 ${r.color}`}>{r.label} / city</label>
                <input
                  type="number"
                  min="0"
                  placeholder="disabled"
                  value={thresholds[r.key as string]}
                  onChange={e => setThresholds(prev => ({ ...prev, [r.key as string]: e.target.value }))}
                  className="w-full bg-[#0f1117] border border-[#2a3150] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-slate-400 text-sm">{filtered.length} nation{filtered.length !== 1 ? "s" : ""} matched</p>
          <ExportButton
            filename="resource-holders"
            getData={() => filtered.map(m => ({
              Nation: m.nation_name,
              Leader: m.leader_name,
              Discord: bknetDiscord.get(String(m.id)) ?? "",
              Cities: m.num_cities,
              Cash: m.money ?? 0,
              Gasoline: m.gasoline ?? 0,
              Munitions: m.munitions ?? 0,
              Steel: m.steel ?? 0,
              Aluminum: m.aluminum ?? 0,
            }))}
          />
        </div>

        {filtered.length === 0 ? (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-8 text-center text-slate-400">
            No nations match the current thresholds.
          </div>
        ) : (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#2a3150]">
                  {(["nation_name", "num_cities", ...RESOURCES.map(r => r.key)] as SortKey[]).map((key, i) => {
                    const res = RESOURCES.find(r => r.key === key);
                    const label = key === "nation_name" ? "Nation" : key === "num_cities" ? "Cities" : res!.label;
                    const color = res ? res.color : "text-slate-400";
                    const active = sortKey === key;
                    const isLeft = key === "nation_name";
                    return (
                      <th
                        key={key}
                        onClick={() => handleSort(key)}
                        className={`px-3 py-3 text-xs font-medium cursor-pointer select-none group ${isLeft ? "text-left" : "text-right"}`}
                      >
                        <span className={`flex items-center ${isLeft ? "" : "justify-end"} gap-1 ${active ? color : "text-slate-400 group-hover:text-slate-200"}`}>
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
                {filtered.map(m => (
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
                      {bknetDiscord.has(String(m.id)) && (
                        <div className="text-xs text-indigo-400">{bknetDiscord.get(String(m.id))}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{m.num_cities}</td>
                    {RESOURCES.map(r => {
                      const val = m[r.key] as number ?? 0;
                      const threshold = parseFloat(thresholds[r.key as string]);
                      const over = !isNaN(threshold) && threshold >= 0 && val > threshold * m.num_cities;
                      return (
                        <td key={r.key as string} className={`px-3 py-2.5 text-right font-medium ${over ? r.color : "text-slate-500"}`}>
                          {fmt(val, r.unit)}
                        </td>
                      );
                    })}
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
