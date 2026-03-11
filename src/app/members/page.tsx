"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchMembers, fetchBknetMembers, fetchSyncStatus, Nation } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { Search, ArrowUpDown } from "lucide-react";
import { ExportButton } from "@/components/ExportButton";

type SortKey = keyof Nation;
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

export default function MembersPage() {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showVm, setShowVm] = useState(true);

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

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const filtered = members
    .filter(m => showVm || m.vacation_mode_turns === 0)
    .filter(m => {
      const q = search.toLowerCase();
      return (
        m.nation_name.toLowerCase().includes(q) ||
        m.leader_name.toLowerCase().includes(q) ||
        (bknetDiscord.get(String(m.id)) ?? "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const av = a[sortKey] as number | string;
      const bv = b[sortKey] as number | string;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });

  function Th({ label, field }: { label: string; field: SortKey }) {
    const active = sortKey === field;
    return (
      <th className="px-3 py-3 text-right cursor-pointer select-none group" onClick={() => handleSort(field)}>
        <span className={`flex items-center justify-end gap-1 text-xs font-medium ${active ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`}>
          {label}<ArrowUpDown size={10} className={active ? "opacity-100" : "opacity-30"} />
        </span>
      </th>
    );
  }

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
                Discord: bknetDiscord.get(String(m.id)) ?? "",
                Position: m.alliance_position,
                Score: m.score,
                Cities: m.num_cities,
                Soldiers: m.soldiers,
                Tanks: m.tanks,
                Aircraft: m.aircraft,
                Ships: m.ships,
                Missiles: m.missiles,
                Nukes: m.nukes,
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
                <Th label="Score" field="score" />
                <Th label="Cities" field="num_cities" />
                <Th label="Soldiers" field="soldiers" />
                <Th label="Tanks" field="tanks" />
                <Th label="Aircraft" field="aircraft" />
                <Th label="Ships" field="ships" />
                <Th label="Missiles" field="missiles" />
                <Th label="Nukes" field="nukes" />
                <Th label="Off Wars" field="offensive_wars_count" />
                <Th label="Def Wars" field="defensive_wars_count" />
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
                      {bknetDiscord.has(String(m.id)) && (
                        <div className="text-xs text-indigo-400">{bknetDiscord.get(String(m.id))}</div>
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
                    <td className="px-3 py-2.5 text-right text-slate-300">{m.offensive_wars_count}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{m.defensive_wars_count}</td>
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
