"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchApplicants, fetchBknetMembers, fetchSyncStatus, fetchDiscordResolved } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { ExportButton } from "@/components/ExportButton";
import { UserPlus } from "lucide-react";

function timeSince(dateStr: string) {
  const h = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3_600_000);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ApplicantsPage() {
  const { data: applicants = [], isLoading, error } = useQuery({
    queryKey: ["applicants"],
    queryFn: fetchApplicants,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: bknetMembers = [] } = useQuery({
    queryKey: ["bknet_members"],
    queryFn: fetchBknetMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: status } = useQuery({ queryKey: ["syncStatus"], queryFn: fetchSyncStatus, refetchInterval: 15_000 });
  const { data: discordResolved = {} } = useQuery({ queryKey: ["discordResolved"], queryFn: fetchDiscordResolved, staleTime: Infinity });

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (applicants.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  const bknetDiscord = new Map(
    bknetMembers
      .filter(m => m.discord?.account?.discord_id || m.discord?.account?.discord_username)
      .map(m => {
        const id = m.discord?.account?.discord_id;
        const name = (id && discordResolved[id]) || m.discord?.account?.discord_username || "";
        return [String(m.nation.id), name] as [string, string];
      })
      .filter(([, name]) => name)
  );

  const sorted = [...applicants].sort((a, b) =>
    new Date(b.last_active).getTime() - new Date(a.last_active).getTime()
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Applicants</h2>
            <p className="text-slate-400 text-sm">
              {applicants.length} pending applicant{applicants.length !== 1 ? "s" : ""}
            </p>
          </div>
          <ExportButton
            filename="applicants"
            getData={() => sorted.map(m => ({
              Nation: m.nation_name,
              Leader: m.leader_name,
              Discord: bknetDiscord.get(String(m.id)) ?? "",
              Score: m.score,
              Cities: m.num_cities,
              Color: m.color,
              Soldiers: m.soldiers,
              Tanks: m.tanks,
              Aircraft: m.aircraft,
              Ships: m.ships,
              Missiles: m.missiles,
              Nukes: m.nukes,
              "Off Wars": m.offensive_wars_count,
              "Def Wars": m.defensive_wars_count,
              "War Policy": m.war_policy,
              "Last Active": m.last_active,
            }))}
          />
        </div>

        {applicants.length === 0 ? (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <UserPlus size={32} className="text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No pending applicants</p>
          </div>
        ) : (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#2a3150]">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Nation</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Score</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Cities</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-green-400">Soldiers</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-orange-400">Tanks</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-blue-400">Aircraft</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-cyan-400">Ships</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-red-400">Missiles</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-purple-400">Nukes</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Wars</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">War Policy</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(m => (
                  <tr key={m.id} className="border-b border-[#1e2540] hover:bg-[#1a2035] transition-colors">
                    <td className="px-4 py-2.5">
                      <a
                        href={`https://politicsandwar.com/nation/id=${m.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white font-medium hover:text-blue-400 transition-colors"
                      >
                        {m.nation_name}
                      </a>
                      <div className="text-xs text-slate-500">{m.leader_name}</div>
                      {bknetDiscord.has(String(m.id)) && (
                        <div className="text-xs text-indigo-400">{bknetDiscord.get(String(m.id))}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-blue-300 tabular-nums">{Number(m.score).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{m.num_cities}</td>
                    <td className="px-4 py-2.5 text-right text-green-400 tabular-nums">{m.soldiers?.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-orange-400 tabular-nums">{m.tanks?.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-blue-400 tabular-nums">{m.aircraft?.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-cyan-400 tabular-nums">{m.ships?.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-red-400">{m.missiles}</td>
                    <td className="px-4 py-2.5 text-right text-purple-400">{m.nukes}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400 text-xs">
                      <span className="text-orange-400">{m.offensive_wars_count}↑</span>
                      {" / "}
                      <span className="text-yellow-400">{m.defensive_wars_count}↓</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-xs bg-[#1e2540] text-slate-300 px-2 py-0.5 rounded">{m.war_policy}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-400 text-xs">{timeSince(m.last_active)}</td>
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
