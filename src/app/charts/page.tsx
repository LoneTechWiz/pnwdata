"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchMembers, fetchSyncStatus, Nation } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, ScatterChart, Scatter, CartesianGrid } from "recharts";

const PIE_COLORS = ["#3b82f6", "#22c55e", "#f97316", "#a855f7", "#ec4899", "#14b8a6", "#eab308", "#ef4444"];

const POSITION_LABELS: Record<string, string> = {
  NOALLIANCE: "None", APPLICANT: "Applicant", MEMBER: "Member",
  OFFICER: "Officer", HEIR: "Heir", LEADER: "Leader",
};

function scoreRange(score: number): string {
  if (score < 500) return "0-500";
  if (score < 1000) return "500-1K";
  if (score < 2000) return "1K-2K";
  if (score < 3000) return "2K-3K";
  if (score < 5000) return "3K-5K";
  if (score < 10000) return "5K-10K";
  return "10K+";
}
const SCORE_RANGES = ["0-500", "500-1K", "1K-2K", "2K-3K", "3K-5K", "5K-10K", "10K+"];

const TS = {
  contentStyle: { background: "#1e2130", border: "1px solid #2a3150", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#e2e8f0" },
  itemStyle: { color: "#94a3b8" },
};

export default function ChartsPage() {
  const { data: members = [], isLoading, error } = useQuery<Nation[]>({
    queryKey: ["members"],
    queryFn: fetchMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: status } = useQuery({ queryKey: ["syncStatus"], queryFn: fetchSyncStatus, refetchInterval: 15_000 });

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (members.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  const active = members.filter(m => m.vacation_mode_turns === 0);

  const scoreDist = SCORE_RANGES.map(range => ({
    range, count: members.filter(m => scoreRange(m.score) === range).length,
  }));

  const cityDist: Record<number, number> = {};
  for (const m of members) cityDist[m.num_cities] = (cityDist[m.num_cities] ?? 0) + 1;
  const cityData = Object.entries(cityDist).map(([c, n]) => ({ cities: Number(c), count: n })).sort((a, b) => a.cities - b.cities);

  const colorDist: Record<string, number> = {};
  for (const m of members) colorDist[m.color] = (colorDist[m.color] ?? 0) + 1;
  const colorData = Object.entries(colorDist).map(([color, count]) => ({ name: color, count })).sort((a, b) => b.count - a.count);

  const posDist: Record<string, number> = {};
  for (const m of members) posDist[m.alliance_position] = (posDist[m.alliance_position] ?? 0) + 1;
  const posData = Object.entries(posDist).map(([pos, count]) => ({ name: POSITION_LABELS[pos] ?? pos, count }));

  const scatterData = active.map(m => ({ cities: m.num_cities, score: Math.round(m.score), name: m.nation_name }));

  const milData = [
    { name: "Soldiers", value: active.reduce((s, m) => s + m.soldiers, 0) },
    { name: "Tanks", value: active.reduce((s, m) => s + m.tanks, 0) },
    { name: "Aircraft", value: active.reduce((s, m) => s + m.aircraft, 0) },
    { name: "Ships", value: active.reduce((s, m) => s + m.ships, 0) },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white">Charts & Analytics</h2>
          <p className="text-slate-400 text-sm">Visual breakdowns of your alliance data</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-4">Score Distribution</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={scoreDist}>
                <XAxis dataKey="range" tick={{ fill: "#64748b", fontSize: 10 }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 10 }} />
                <Tooltip {...TS} />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Members" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-4">City Count Distribution</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={cityData}>
                <XAxis dataKey="cities" tick={{ fill: "#64748b", fontSize: 10 }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 10 }} />
                <Tooltip {...TS} />
                <Bar dataKey="count" fill="#22c55e" radius={[4, 4, 0, 0]} name="Members" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-4">Color Bloc Distribution</h3>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={colorData} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                  label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={{ stroke: "#2a3150" }}>
                  {colorData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip {...TS} formatter={(v) => `${v} members`} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-4">Alliance Position Distribution</h3>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={posData} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                  label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={{ stroke: "#2a3150" }}>
                  {posData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip {...TS} formatter={(v) => `${v} members`} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold text-slate-300 mb-4">Score vs. City Count (Active Members)</h3>
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2540" />
                <XAxis dataKey="cities" type="number" name="Cities" tick={{ fill: "#64748b", fontSize: 10 }} label={{ value: "Cities", position: "insideBottom", offset: -10, fill: "#64748b", fontSize: 11 }} />
                <YAxis dataKey="score" type="number" name="Score" tick={{ fill: "#64748b", fontSize: 10 }} label={{ value: "Score", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#1e2130", border: "1px solid #2a3150", borderRadius: 8, fontSize: 12 }}
                  cursor={{ strokeDasharray: "3 3", stroke: "#2a3150" }}
                  content={({ payload }) => {
                    if (!payload?.length) return null;
                    const d = payload[0]?.payload;
                    return (
                      <div className="bg-[#1e2130] border border-[#2a3150] rounded-lg p-2 text-xs">
                        <p className="text-white font-medium">{d.name}</p>
                        <p className="text-slate-400">Cities: {d.cities} · Score: {d.score.toLocaleString()}</p>
                      </div>
                    );
                  }} />
                <Scatter data={scatterData} fill="#3b82f6" fillOpacity={0.7} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold text-slate-300 mb-4">Military Totals (Active Members)</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={milData}>
                <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={v => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                <Tooltip {...TS} formatter={(v) => (v != null ? Number(v).toLocaleString() : "")} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {milData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
