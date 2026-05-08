"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchMembers, fetchBknetMembers, fetchSyncStatus, fetchDiscordResolved } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { ExportButton } from "@/components/ExportButton";
import { AlertTriangle } from "lucide-react";

function timeSince(dateStr: string) {
  const h = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3_600_000);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function RelinkPage() {
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

  const { data: status } = useQuery({
    queryKey: ["syncStatus"],
    queryFn: fetchSyncStatus,
    refetchInterval: 15_000,
  });

  const { data: discordResolved = {} } = useQuery({ queryKey: ["discordResolved"], queryFn: fetchDiscordResolved, staleTime: Infinity });

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

  const unlinked = members.filter(m => !bknetDiscord.get(String(m.id)));

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
            <h2 className="text-xl font-bold text-white">Relink</h2>
            <p className="text-slate-400 text-sm">
              {unlinked.length} member{unlinked.length !== 1 ? "s" : ""} with no Discord linked in BK Net
            </p>
          </div>
          <ExportButton
            filename="relink"
            getData={() => unlinked.map(m => ({
              Nation: m.nation_name,
              Leader: m.leader_name,
              "PnW Discord": m.discord || "",
              Position: m.alliance_position,
              Score: m.score,
              Cities: m.num_cities,
              "Last Active": m.last_active,
              Status: m.vacation_mode_turns > 0 ? "VM" : m.beige_turns > 0 ? "Beige" : "Active",
            }))}
          />
        </div>

        {unlinked.length === 0 ? (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <p className="text-slate-400">All members have Discord linked in BK Net.</p>
          </div>
        ) : (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#2a3150]">
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Nation</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Leader</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">PnW Discord</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-slate-400">Score</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-slate-400">Cities</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-slate-400">Last Active</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-slate-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {unlinked.map((m, i) => (
                  <tr key={m.id} className={`${i !== unlinked.length - 1 ? "border-b border-[#2a3150]" : ""} hover:bg-[#1e2540] transition-colors`}>
                    <td className="px-4 py-3">
                      <a
                        href={`https://politicsandwar.com/nation/id=${m.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:underline font-medium"
                      >
                        {m.nation_name}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{m.leader_name}</td>
                    <td className="px-4 py-3">
                      {m.discord ? (
                        <span className="text-amber-400">{m.discord}</span>
                      ) : (
                        <span className="flex items-center gap-1 text-slate-600">
                          <AlertTriangle size={12} className="text-slate-600" />
                          Not set
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-300">{m.score.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right text-slate-300">{m.num_cities}</td>
                    <td className="px-3 py-3 text-right text-slate-400">{timeSince(m.last_active)}</td>
                    <td className="px-3 py-3 text-right">
                      {m.vacation_mode_turns > 0 ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/40 text-purple-300 border border-purple-700/50">VM</span>
                      ) : m.beige_turns > 0 ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-300 border border-amber-700/50">Beige</span>
                      ) : (
                        <span className="text-xs text-slate-500">Active</span>
                      )}
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
