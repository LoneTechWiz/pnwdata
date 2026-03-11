"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchMembers, fetchBknetMembers, fetchSyncStatus } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { Clock } from "lucide-react";
import { ExportButton } from "@/components/ExportButton";

const THRESHOLD_HOURS = 36;

function hoursAgo(dateStr: string): number {
  return (Date.now() - new Date(dateStr).getTime()) / 3_600_000;
}

function formatInactive(hours: number): string {
  if (hours < 48) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function InactivePage() {
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

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (members.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  // BK Net discord map: nation_id -> discord username
  const bknetDiscord = new Map(
    bknetMembers
      .filter(m => m.discord?.account?.discord_username)
      .map(m => [String(m.nation.id), m.discord!.account!.discord_username])
  );

  const inactive = members
    .filter(m => m.vacation_mode_turns === 0 && hoursAgo(m.last_active) > THRESHOLD_HOURS)
    .sort((a, b) => new Date(a.last_active).getTime() - new Date(b.last_active).getTime());

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Inactive Nations</h2>
            <p className="text-slate-400 text-sm">
              {inactive.length} nation{inactive.length !== 1 ? "s" : ""} inactive for more than {THRESHOLD_HOURS} hours
              {" "}(excluding vacation mode)
            </p>
          </div>
          <ExportButton
            filename="inactive-nations"
            getData={() => inactive.map(m => ({
              Nation: m.nation_name,
              Leader: m.leader_name,
              Position: m.alliance_position,
              Discord: bknetDiscord.get(String(m.id)) ?? "",
              Cities: m.num_cities,
              Score: m.score,
              "Last Active": m.last_active,
              "Hours Inactive": Math.floor(hoursAgo(m.last_active)),
            }))}
          />
        </div>

        {inactive.length === 0 ? (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <Clock size={32} className="text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No inactive nations — everyone has logged in within the last {THRESHOLD_HOURS} hours</p>
          </div>
        ) : (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#2a3150]">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">#</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Nation</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Position</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-400">Discord</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Cities</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Score</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-400">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {inactive.map((m, i) => {
                  const hours = hoursAgo(m.last_active);
                  const veryInactive = hours > 72;
                  return (
                    <tr key={m.id} className="border-b border-[#1e2540] hover:bg-[#1a2035] transition-colors">
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{i + 1}</td>
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
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs bg-[#2a3150] text-slate-300 px-2 py-0.5 rounded">
                          {m.alliance_position}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {bknetDiscord.has(String(m.id))
                          ? <span className="text-indigo-400 text-xs">{bknetDiscord.get(String(m.id))}</span>
                          : <span className="text-slate-600 text-xs">—</span>
                        }
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-300">{m.num_cities}</td>
                      <td className="px-4 py-2.5 text-right text-slate-300 tabular-nums">
                        {Number(m.score).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`font-medium tabular-nums ${veryInactive ? "text-red-400" : "text-yellow-400"}`}>
                          {formatInactive(hours)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
