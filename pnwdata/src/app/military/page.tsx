"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchMembers, fetchSyncStatus, Nation } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { StatCard } from "@/components/StatCard";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { Users, Shield, Plane, Anchor, Bomb, Zap } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";

const POLICY_COLORS: Record<string, string> = {
  ATTRITION: "#ef4444", TURTLE: "#22c55e", BLITZKRIEG: "#f97316",
  FORTRESS: "#3b82f6", MONEYBAGS: "#a855f7", PIRATE: "#ec4899",
  TACTICIAN: "#eab308", GUARDIAN: "#06b6d4", COVERT: "#8b5cf6", ARCANE: "#14b8a6",
};

function MilBar({ label, members, field, color }: { label: string; members: Nation[]; field: keyof Nation; color: string }) {
  const data = [...members].sort((a, b) => (b[field] as number) - (a[field] as number)).slice(0, 20)
    .map(m => ({ name: m.nation_name, value: m[field] as number }));
  return (
    <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
      <h3 className="text-sm font-semibold text-slate-300 mb-4">{label} — Top 20</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20 }}>
          <XAxis type="number" tick={{ fill: "#64748b", fontSize: 10 }} />
          <YAxis type="category" dataKey="name" width={100} tick={{ fill: "#94a3b8", fontSize: 10 }} />
          <Tooltip contentStyle={{ background: "#1e2130", border: "1px solid #2a3150", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "#e2e8f0" }} itemStyle={{ color }} formatter={(v) => (v != null ? Number(v).toLocaleString() : "")} />
          <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function MilitaryPage() {
  const { data: allMembers = [], isLoading, error } = useQuery({
    queryKey: ["members"],
    queryFn: fetchMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: status } = useQuery({ queryKey: ["syncStatus"], queryFn: fetchSyncStatus, refetchInterval: 15_000 });

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (allMembers.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  const members = allMembers.filter(m => m.vacation_mode_turns === 0);

  const totalSoldiers = members.reduce((s, m) => s + (m.soldiers ?? 0), 0);
  const totalTanks = members.reduce((s, m) => s + (m.tanks ?? 0), 0);
  const totalAircraft = members.reduce((s, m) => s + (m.aircraft ?? 0), 0);
  const totalShips = members.reduce((s, m) => s + (m.ships ?? 0), 0);
  const totalMissiles = members.reduce((s, m) => s + (m.missiles ?? 0), 0);
  const totalNukes = members.reduce((s, m) => s + (m.nukes ?? 0), 0);

  const maxSoldiers = members.reduce((s, m) => s + m.num_cities * 15000, 0);
  const maxTanks = members.reduce((s, m) => s + m.num_cities * 1250, 0);
  const maxAircraft = members.reduce((s, m) => s + m.num_cities * 75, 0);
  const maxShips = members.reduce((s, m) => s + m.num_cities * 15, 0);

  const pct = (val: number, max: number) => max > 0 ? `${Math.round(val / max * 100)}% of max` : "";

  // City tier chart — 5-city buckets
  const tierMap = new Map<number, { soldiers: number; maxSoldiers: number; tanks: number; maxTanks: number; aircraft: number; maxAircraft: number; ships: number; maxShips: number }>();
  for (const m of members) {
    const tier = Math.floor((m.num_cities - 1) / 5) * 5 + 1;
    const row = tierMap.get(tier) ?? { soldiers: 0, maxSoldiers: 0, tanks: 0, maxTanks: 0, aircraft: 0, maxAircraft: 0, ships: 0, maxShips: 0 };
    row.soldiers += m.soldiers ?? 0;
    row.maxSoldiers += m.num_cities * 15000;
    row.tanks += m.tanks ?? 0;
    row.maxTanks += m.num_cities * 1250;
    row.aircraft += m.aircraft ?? 0;
    row.maxAircraft += m.num_cities * 75;
    row.ships += m.ships ?? 0;
    row.maxShips += m.num_cities * 15;
    tierMap.set(tier, row);
  }
  const tierData = [...tierMap.entries()].sort((a, b) => a[0] - b[0]).map(([tier, row]) => ({
    tier: `C${tier}–${tier + 4}`,
    Soldiers: row.maxSoldiers > 0 ? Math.round(row.soldiers / row.maxSoldiers * 100) : 0,
    Tanks: row.maxTanks > 0 ? Math.round(row.tanks / row.maxTanks * 100) : 0,
    Aircraft: row.maxAircraft > 0 ? Math.round(row.aircraft / row.maxAircraft * 100) : 0,
    Ships: row.maxShips > 0 ? Math.round(row.ships / row.maxShips * 100) : 0,
  }));

  const policyDist = members.reduce<Record<string, number>>((acc, m) => {
    acc[m.war_policy] = (acc[m.war_policy] ?? 0) + 1; return acc;
  }, {});
  const policyData = Object.entries(policyDist).sort((a, b) => b[1] - a[1]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white">Military Overview</h2>
          <p className="text-slate-400 text-sm">Active members only (excludes vacation mode)</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Soldiers" value={totalSoldiers.toLocaleString()} icon={Users} color="text-green-400" sub={pct(totalSoldiers, maxSoldiers)} />
          <StatCard label="Tanks" value={totalTanks.toLocaleString()} icon={Shield} color="text-orange-400" sub={pct(totalTanks, maxTanks)} />
          <StatCard label="Aircraft" value={totalAircraft.toLocaleString()} icon={Plane} color="text-blue-400" sub={pct(totalAircraft, maxAircraft)} />
          <StatCard label="Ships" value={totalShips.toLocaleString()} icon={Anchor} color="text-cyan-400" sub={pct(totalShips, maxShips)} />
          <StatCard label="Missiles" value={totalMissiles} icon={Zap} color="text-red-400" />
          <StatCard label="Nukes" value={totalNukes} icon={Bomb} color="text-purple-400" />
        </div>

        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-300 mb-1">Militarization by City Tier</h3>
          <p className="text-xs text-slate-500 mb-4">% of maximum possible — grouped in 5-city increments</p>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={tierData} margin={{ left: 0, right: 16, top: 4, bottom: 0 }}>
              <XAxis dataKey="tier" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: "#64748b", fontSize: 11 }} width={38} />
              <Tooltip
                contentStyle={{ background: "#1e2130", border: "1px solid #2a3150", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#e2e8f0" }}
                formatter={(v, name) => [`${v}%`, name]}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
              <Line type="monotone" dataKey="Soldiers" stroke="#22c55e" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="Tanks" stroke="#f97316" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="Aircraft" stroke="#3b82f6" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="Ships" stroke="#06b6d4" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">War Policy Distribution</h3>
          <div className="flex flex-wrap gap-2">
            {policyData.map(([policy, count]) => (
              <div key={policy} className="flex items-center gap-2 bg-[#1e2540] rounded-lg px-3 py-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: POLICY_COLORS[policy] ?? "#6b7280" }} />
                <span className="text-sm text-slate-300">{policy}</span>
                <span className="text-xs text-slate-500">{count} ({Math.round(count / members.length * 100)}%)</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MilBar label="Soldiers" members={members} field="soldiers" color="#22c55e" />
          <MilBar label="Tanks" members={members} field="tanks" color="#f97316" />
          <MilBar label="Aircraft" members={members} field="aircraft" color="#3b82f6" />
          <MilBar label="Ships" members={members} field="ships" color="#06b6d4" />
        </div>

        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#2a3150]">
            <h3 className="text-sm font-semibold text-slate-300">WMDs (Nukes & Missiles)</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a3150]">
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-400">Nation</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-purple-400">Nukes</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-red-400">Missiles</th>
              </tr>
            </thead>
            <tbody>
              {[...members].filter(m => (m.nukes ?? 0) + (m.missiles ?? 0) > 0)
                .sort((a, b) => (b.nukes + b.missiles) - (a.nukes + a.missiles))
                .map(m => (
                  <tr key={m.id} className="border-b border-[#1e2540] hover:bg-[#1a2035]">
                    <td className="px-4 py-2"><a href={`https://politicsandwar.com/nation/id=${m.id}`} target="_blank" rel="noopener noreferrer" className="text-white hover:text-blue-400 transition-colors">{m.nation_name}</a></td>
                    <td className="px-4 py-2 text-right text-purple-400">{m.nukes}</td>
                    <td className="px-4 py-2 text-right text-red-400">{m.missiles}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
