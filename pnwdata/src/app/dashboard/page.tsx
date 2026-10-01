"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchMembers, fetchWars, fetchSyncStatus, Nation, War } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { StatCard } from "@/components/StatCard";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { Users, Shield, Swords, Plane, Anchor, Bomb, Zap, TrendingUp, Activity, AlertTriangle } from "lucide-react";

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

export default function DashboardPage() {
  const { data: members = [], isLoading: mLoading, error: mErr } = useQuery({
    queryKey: ["members"],
    queryFn: fetchMembers,
    refetchInterval: 10 * 60 * 1000,
  });

  const { data: wars = [] } = useQuery<War[]>({
    queryKey: ["wars"],
    queryFn: fetchWars,
    refetchInterval: 10 * 60 * 1000,
  });

  const { data: status } = useQuery({
    queryKey: ["syncStatus"],
    queryFn: fetchSyncStatus,
    refetchInterval: 15_000,
  });

  if (mLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (mErr) return <AppShell><ErrorMessage message={(mErr as Error).message} /></AppShell>;
  if (members.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  const vmCount = members.filter(m => m.vacation_mode_turns > 0).length;
  const beigeCount = members.filter(m => m.beige_turns > 0).length;
  const active = members.filter(m => m.vacation_mode_turns === 0);

  const totalSoldiers = active.reduce((s, m) => s + (m.soldiers ?? 0), 0);
  const totalTanks = active.reduce((s, m) => s + (m.tanks ?? 0), 0);
  const totalAircraft = active.reduce((s, m) => s + (m.aircraft ?? 0), 0);
  const totalShips = active.reduce((s, m) => s + (m.ships ?? 0), 0);
  const totalMissiles = active.reduce((s, m) => s + (m.missiles ?? 0), 0);
  const totalNukes = active.reduce((s, m) => s + (m.nukes ?? 0), 0);
  const totalScore = active.reduce((s, m) => s + (m.score ?? 0), 0);
  const totalCities = active.reduce((s, m) => s + (m.num_cities ?? 0), 0);

  const activeIds = new Set(active.map(m => m.id));
  const offWars = wars.filter(w => activeIds.has(w.att_id)).length;
  const defWars = wars.filter(w => activeIds.has(w.def_id)).length;
  const totalWars = wars.filter(w => activeIds.has(w.att_id) || activeIds.has(w.def_id)).length;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Dashboard</h2>
          <p className="text-slate-400 text-sm">Alliance overview — data refreshes every 10 minutes</p>
        </div>

        <section>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Members</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total Members" value={members.length} icon={Users} sub={`${active.length} active`} />
            <StatCard label="Total Score" value={fmt(totalScore)} icon={TrendingUp} color="text-purple-400" sub="Active members only" />
            <StatCard label="Total Cities" value={totalCities} icon={Activity} color="text-cyan-400" sub={`Avg ${(totalCities / Math.max(active.length, 1)).toFixed(1)}/active member`} />
            <StatCard label="Vacation / Beige" value={vmCount} icon={AlertTriangle} color="text-yellow-400" sub={`${beigeCount} in beige`} />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Military</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Soldiers" value={fmt(totalSoldiers)} icon={Users} color="text-green-400" />
            <StatCard label="Tanks" value={fmt(totalTanks)} icon={Shield} color="text-orange-400" />
            <StatCard label="Aircraft" value={fmt(totalAircraft)} icon={Plane} color="text-blue-400" />
            <StatCard label="Ships" value={fmt(totalShips)} icon={Anchor} color="text-cyan-400" />
            <StatCard label="Missiles" value={fmt(totalMissiles)} icon={Zap} color="text-red-400" />
            <StatCard label="Nukes" value={fmt(totalNukes)} icon={Bomb} color="text-purple-400" />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Active Wars</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Total Active Wars" value={totalWars} icon={Swords} color="text-red-400" />
            <StatCard label="Offensive Wars" value={offWars} icon={Swords} color="text-orange-400" sub="We attacked" />
            <StatCard label="Defensive Wars" value={defWars} icon={Shield} color="text-yellow-400" sub="Defending against" />
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Top Members by Score</h3>
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a3150]">
                  <th className="text-left px-4 py-3 text-slate-400 font-medium w-8">#</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Nation</th>
                  <th className="text-right px-4 py-3 text-slate-400 font-medium">Cities</th>
                  <th className="text-right px-4 py-3 text-slate-400 font-medium">Score</th>
                  <th className="text-right px-4 py-3 text-slate-400 font-medium">Position</th>
                </tr>
              </thead>
              <tbody>
                {[...active].sort((a, b) => b.score - a.score).slice(0, 10).map((m, i) => (
                  <tr key={m.id} className="border-b border-[#1e2540] hover:bg-[#1a2035] transition-colors">
                    <td className="px-4 py-3 text-slate-500 text-xs">{i + 1}</td>
                    <td className="px-4 py-3">
                      <a href={`https://politicsandwar.com/nation/id=${m.id}`} target="_blank" rel="noopener noreferrer"
                        className="text-white font-medium hover:text-blue-400 transition-colors">{m.nation_name}</a>
                      <span className="text-slate-500 text-xs ml-2">({m.leader_name})</span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-300">{m.num_cities}</td>
                    <td className="px-4 py-3 text-right text-blue-300">{Number(m.score).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs bg-[#2a3150] text-slate-300 px-2 py-0.5 rounded">{m.alliance_position}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
