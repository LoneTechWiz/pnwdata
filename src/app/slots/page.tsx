"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMembers, fetchWars, fetchSyncStatus, Nation, War } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { ExportButton } from "@/components/ExportButton";
import { Crosshair, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import Link from "next/link";

type SortKey = "nation_name" | "num_cities" | "offensive_wars_count" | "defensive_wars_count" | "beige_turns" | "last_active" | "full_maps_wars";
type SortDir = "asc" | "desc";

function timeSince(dateStr: string) {
  const h = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3_600_000);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={12} className="text-slate-600" />;
  return sortDir === "asc" ? <ChevronUp size={12} className="text-blue-400" /> : <ChevronDown size={12} className="text-blue-400" />;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "nation_name", label: "Nation" },
  { key: "num_cities", label: "Cities" },
  { key: "offensive_wars_count", label: "Off Wars" },
  { key: "defensive_wars_count", label: "Def Wars" },
  { key: "full_maps_wars", label: "Full MAPs" },
  { key: "beige_turns", label: "Beige" },
  { key: "last_active", label: "Last Active" },
];

export default function SlotsPage() {
  const [sortKey, setSortKey] = useState<SortKey>("offensive_wars_count");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [minCities, setMinCities] = useState("");
  const [maxCities, setMaxCities] = useState("");
  const [maxOffWars, setMaxOffWars] = useState(5);

  const { data: members = [], isLoading: mLoading, error: mErr } = useQuery<Nation[]>({
    queryKey: ["members"],
    queryFn: fetchMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: wars = [], isLoading: wLoading } = useQuery<War[]>({
    queryKey: ["wars"],
    queryFn: fetchWars,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: status } = useQuery({ queryKey: ["syncStatus"], queryFn: fetchSyncStatus, refetchInterval: 15_000 });

  const memberIdSet = useMemo(() => new Set(members.map(m => m.id)), [members]);

  // Count wars per BK member where their MAPs >= 11 (need to use attacks)
  const fullMapsCount = useMemo(() => {
    const counts = new Map<number, number>();
    for (const war of wars) {
      const attId = Number(war.att_id);
      const defId = Number(war.def_id);
      if (memberIdSet.has(attId) && war.att_points >= 11) {
        counts.set(attId, (counts.get(attId) ?? 0) + 1);
      }
      if (memberIdSet.has(defId) && war.def_points >= 11) {
        counts.set(defId, (counts.get(defId) ?? 0) + 1);
      }
    }
    return counts;
  }, [wars, memberIdSet]);

  const filtered = useMemo(() => {
    const min = minCities !== "" ? Number(minCities) : null;
    const max = maxCities !== "" ? Number(maxCities) : null;
    return members
      .filter(m => m.offensive_wars_count < maxOffWars)
      .filter(m => m.vacation_mode_turns === 0)
      .filter(m => (Date.now() - new Date(m.last_active).getTime()) < 72 * 3_600_000)
      .filter(m => (min === null || m.num_cities >= min) && (max === null || m.num_cities <= max));
  }, [members, minCities, maxCities, maxOffWars]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      if (sortKey === "full_maps_wars") {
        av = fullMapsCount.get(a.id) ?? 0;
        bv = fullMapsCount.get(b.id) ?? 0;
      } else {
        av = a[sortKey];
        bv = b[sortKey];
      }
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir, fullMapsCount]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const isLoading = mLoading || wLoading;
  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (mErr) return <AppShell><ErrorMessage message={(mErr as Error).message} /></AppShell>;
  if (members.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Need to Declare</h2>
            <p className="text-slate-400 text-sm mt-1">{sorted.length} members with fewer than {maxOffWars} offensive wars</p>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Max Off Wars</label>
              <input
                type="number"
                min={1}
                max={7}
                value={maxOffWars}
                onChange={e => {
                  const v = Math.min(7, Math.max(1, Number(e.target.value)));
                  setMaxOffWars(v);
                }}
                className="w-20 bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Min Cities</label>
              <input
                type="number"
                min={1}
                value={minCities}
                onChange={e => setMinCities(e.target.value)}
                placeholder="Any"
                className="w-24 bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Max Cities</label>
              <input
                type="number"
                min={1}
                value={maxCities}
                onChange={e => setMaxCities(e.target.value)}
                placeholder="Any"
                className="w-24 bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <ExportButton
            filename="need-to-declare"
            getData={() => sorted.map(m => ({
              Nation: m.nation_name,
              Ruler: m.leader_name,
              Discord: m.discord ?? "",
              Cities: m.num_cities,
              "Off Wars": m.offensive_wars_count,
              "Def Wars": m.defensive_wars_count,
              "Full MAPs Wars": fullMapsCount.get(m.id) ?? 0,
              "Beige Turns": m.beige_turns || "",
              "Last Active": timeSince(m.last_active),
            }))}
          />
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#2a3150]">
          <table className="w-full text-sm">
            <thead className="bg-[#161b2e] border-b border-[#2a3150]">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide"></th>
                {COLUMNS.map(({ key, label }) => (
                  <th
                    key={key}
                    onClick={() => handleSort(key)}
                    onKeyDown={e => (e.key === "Enter" || e.key === " ") && handleSort(key)}
                    tabIndex={0}
                    className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-white whitespace-nowrap select-none"
                  >
                    <span className="flex items-center gap-1">
                      {label}
                      <SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a3150]">
              {sorted.map(m => {
                const fullMaps = fullMapsCount.get(m.id) ?? 0;
                return (
                  <tr key={m.id} className="bg-[#161b2e] hover:bg-[#1e2540] transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        href={`/war-targets?nationId=${m.id}`}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-red-700/80 hover:bg-red-600 text-white text-xs font-semibold rounded transition-colors"
                      >
                        <Crosshair size={11} />
                        Targets
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={`https://politicsandwar.com/nation/id=${m.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 font-medium"
                      >
                        {m.nation_name}
                      </a>
                      <div className="text-slate-400 text-xs">{m.leader_name}</div>
                      {m.discord && <div className="text-slate-500 text-xs">{m.discord}</div>}
                    </td>
                    <td className="px-3 py-2 text-slate-200">{m.num_cities}</td>
                    <td className="px-3 py-2">
                      <span className={`font-medium ${m.offensive_wars_count === 0 ? "text-green-400" : "text-slate-200"}`}>
                        {m.offensive_wars_count}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-200">{m.defensive_wars_count}</td>
                    <td className="px-3 py-2">
                      {fullMaps > 0 ? (
                        <span className="font-semibold text-orange-400">{fullMaps}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {m.beige_turns > 0 ? (
                        <span className={`font-semibold ${m.beige_turns <= 6 ? "text-red-400" : "text-amber-400"}`}>
                          {m.beige_turns}
                        </span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-400 text-xs">{timeSince(m.last_active)}</td>
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
