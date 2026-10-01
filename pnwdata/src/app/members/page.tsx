"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchMembers, fetchDiscordLinks, fetchSyncStatus, Nation } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { Search, ArrowUpDown } from "lucide-react";
import { ExportButton } from "@/components/ExportButton";

type SortKey = keyof Nation | "spies";
type SortDir = "asc" | "desc";

const POSITIONS: Record<string, string> = {
  NOALLIANCE: "None", APPLICANT: "Applicant", MEMBER: "Member",
  OFFICER: "Officer", HEIR: "Heir", LEADER: "Leader",
};

function timeSince(dateStr: string) {
  const h = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3_600_000);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function SortableHeader({
  label,
  field,
  sortKey,
  onSort,
}: {
  label: string;
  field: SortKey;
  sortKey: SortKey;
  onSort: (field: SortKey) => void;
}) {
  const active = sortKey === field;
  return (
    <th className="px-3 py-3 text-right cursor-pointer select-none group" onClick={() => onSort(field)}>
      <span className={`flex items-center justify-end gap-1 text-xs font-medium ${active ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`}>
        {label}<ArrowUpDown size={10} className={active ? "opacity-100" : "opacity-30"} />
      </span>
    </th>
  );
}

export default function MembersPage() {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showVm, setShowVm] = useState(false);
  const [showBeigeOnly, setShowBeigeOnly] = useState(false);
  const [minSpies, setMinSpies] = useState("");
  const [maxSpies, setMaxSpies] = useState("");

  const { data: members = [], isLoading, error } = useQuery({
    queryKey: ["members"],
    queryFn: fetchMembers,
    refetchInterval: 10 * 60 * 1000,
  });

  const { data: discordLinks = {} } = useQuery({ queryKey: ["discordLinks"], queryFn: fetchDiscordLinks, refetchInterval: 10 * 60 * 1000 });
  const { data: status } = useQuery({ queryKey: ["syncStatus"], queryFn: fetchSyncStatus, refetchInterval: 15_000 });

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const filtered = members
    .filter(m => showVm || m.vacation_mode_turns === 0)
    .filter(m => !showBeigeOnly || m.beige_turns > 0)
    .filter(m => {
      const s = m.spies ?? null;
      if (minSpies !== "" && (s === null || s < Number(minSpies))) return false;
      if (maxSpies !== "" && (s === null || s > Number(maxSpies))) return false;
      return true;
    })
    .filter(m => {
      const q = search.toLowerCase();
      return (
        m.nation_name.toLowerCase().includes(q) ||
        m.leader_name.toLowerCase().includes(q) ||
        (discordLinks[String(m.id)]?.username ?? "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const av = sortKey === "spies" ? (a.spies ?? -1) : a[sortKey] as number | string;
      const bv = sortKey === "spies" ? (b.spies ?? -1) : b[sortKey] as number | string;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (members.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Members</h2>
            <p className="text-slate-400 text-sm">{filtered.length} of {members.length} members shown</p>
          </div>
          <div className="flex items-center gap-3">
            <ExportButton
              filename="members"
              getData={() => filtered.map(m => ({
                Nation: m.nation_name,
                Leader: m.leader_name,
                Discord: discordLinks[String(m.id)]?.username ?? "",
                Position: m.alliance_position,
                Score: m.score,
                Cities: m.num_cities,
                Soldiers: m.soldiers,
                Tanks: m.tanks,
                Aircraft: m.aircraft,
                Ships: m.ships,
                Missiles: m.missiles,
                Nukes: m.nukes,
                Spies: m.spies ?? "",
                "Off Wars": m.offensive_wars_count,
                "Def Wars": m.defensive_wars_count,
                "Last Active": m.last_active,
                Status: m.vacation_mode_turns > 0 ? "VM" : m.beige_turns > 0 ? "Beige" : "Active",
              }))}
            />
            <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
              <input type="checkbox" checked={showVm} onChange={e => setShowVm(e.target.checked)} className="accent-blue-500" />
              Show Vacation Mode
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
              <input type="checkbox" checked={showBeigeOnly} onChange={e => setShowBeigeOnly(e.target.checked)} className="accent-amber-500" />
              Beige Only
            </label>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              Spies
              <input
                type="number"
                min={0}
                max={60}
                placeholder="min"
                value={minSpies}
                onChange={e => setMinSpies(e.target.value)}
                className="w-16 bg-[#0f1117] border border-[#2a3150] rounded px-2 py-0.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-purple-500"
              />
              <span className="text-slate-600">–</span>
              <input
                type="number"
                min={0}
                max={60}
                placeholder="max"
                value={maxSpies}
                onChange={e => setMaxSpies(e.target.value)}
                className="w-16 bg-[#0f1117] border border-[#2a3150] rounded px-2 py-0.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input type="text" placeholder="Search nation, leader, or Discord…" value={search} onChange={e => setSearch(e.target.value)}
                className="bg-[#161b2e] border border-[#2a3150] rounded-lg pl-8 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-64" />
            </div>
          </div>
        </div>

        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-[#2a3150]">
                <th className="text-left px-3 py-3 text-xs font-medium text-slate-400 cursor-pointer" onClick={() => handleSort("nation_name")}>
                  <span className="flex items-center gap-1">Nation <ArrowUpDown size={10} /></span>
                </th>
                <SortableHeader label="Score" field="score" sortKey={sortKey} onSort={handleSort} />
                <SortableHeader label="Cities" field="num_cities" sortKey={sortKey} onSort={handleSort} />
                <SortableHeader label="Soldiers" field="soldiers" sortKey={sortKey} onSort={handleSort} />
                <SortableHeader label="Tanks" field="tanks" sortKey={sortKey} onSort={handleSort} />
                <SortableHeader label="Aircraft" field="aircraft" sortKey={sortKey} onSort={handleSort} />
                <SortableHeader label="Ships" field="ships" sortKey={sortKey} onSort={handleSort} />
                <SortableHeader label="Missiles" field="missiles" sortKey={sortKey} onSort={handleSort} />
                <SortableHeader label="Nukes" field="nukes" sortKey={sortKey} onSort={handleSort} />
                <SortableHeader label="Spies" field="spies" sortKey={sortKey} onSort={handleSort} />
                <SortableHeader label="Off Wars" field="offensive_wars_count" sortKey={sortKey} onSort={handleSort} />
                <SortableHeader label="Def Wars" field="defensive_wars_count" sortKey={sortKey} onSort={handleSort} />
                <SortableHeader label="Beige Turns" field="beige_turns" sortKey={sortKey} onSort={handleSort} />
                <th className="px-3 py-3 text-right text-xs font-medium text-slate-400">Last Active</th>
                <th className="px-3 py-3 text-right text-xs font-medium text-slate-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => {
                const isVm = m.vacation_mode_turns > 0;
                const isBeige = m.beige_turns > 0;
                return (
                  <tr key={m.id} className={`border-b border-[#1e2540] hover:bg-[#1a2035] transition-colors ${isVm ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2.5">
                      <a href={`https://politicsandwar.com/nation/id=${m.id}`} target="_blank" rel="noopener noreferrer"
                        className="text-white font-medium hover:text-blue-400 transition-colors block">{m.nation_name}</a>
                      <div className="text-xs text-slate-500">{m.leader_name} · {POSITIONS[m.alliance_position] ?? m.alliance_position}</div>
                      {discordLinks[String(m.id)] && (
                        <div className="text-xs text-indigo-400">{discordLinks[String(m.id)].username}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-blue-300">{Number(m.score).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{m.num_cities}</td>
                    <td className="px-3 py-2.5 text-right text-green-400">{m.soldiers?.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-orange-400">{m.tanks?.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-blue-400">{m.aircraft?.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-cyan-400">{m.ships?.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-red-400">{m.missiles}</td>
                    <td className="px-3 py-2.5 text-right text-purple-400">{m.nukes}</td>
                    <td className="px-3 py-2.5 text-right text-yellow-400">
                      {m.spies != null ? m.spies : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{m.offensive_wars_count}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{m.defensive_wars_count}</td>
                    <td className="px-3 py-2.5 text-right">
                      {m.beige_turns > 0
                        ? <span className="text-amber-400 font-semibold">{m.beige_turns}</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-400 text-xs">{timeSince(m.last_active)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {isVm
                        ? <span className="text-xs bg-yellow-900/40 text-yellow-400 border border-yellow-700/30 px-2 py-0.5 rounded">VM</span>
                        : isBeige
                          ? <span className="text-xs bg-amber-900/40 text-amber-400 border border-amber-700/30 px-2 py-0.5 rounded">Beige</span>
                          : <span className="text-xs bg-green-900/40 text-green-400 border border-green-700/30 px-2 py-0.5 rounded">Active</span>
                      }
                    </td>
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
