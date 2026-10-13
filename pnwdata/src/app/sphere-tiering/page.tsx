"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Layers, Settings } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { AppShell } from "@/components/AppShell";
import { ExportButton } from "@/components/ExportButton";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import type { SphereTieringRow } from "@/lib/sphere-tiering";

interface SphereTieringResponse {
  spheres: string[];
  rows: SphereTieringRow[];
  totals: number[];
  hasAlliances: boolean;
}

const BUCKET_SIZES = [1, 5, 10] as const;
const COLORS = ["#60a5fa", "#f87171", "#4ade80", "#fbbf24", "#a78bfa", "#2dd4bf", "#fb923c", "#f472b6", "#a3e635", "#38bdf8", "#e879f9", "#94a3b8"];

const TOOLTIP_STYLE = {
  contentStyle: { background: "#1e2130", border: "1px solid #2a3150", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#e2e8f0" },
  itemStyle: { color: "#94a3b8" },
};

async function fetchSphereTiering(bucketSize: number): Promise<SphereTieringResponse> {
  const res = await fetch(`/api/sphere-tiering?bucketSize=${bucketSize}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Server error (${res.status})`);
  return data as SphereTieringResponse;
}

export default function SphereTieringPage() {
  const [bucketSize, setBucketSize] = useState<number>(5);
  const { data, isLoading, error } = useQuery({
    queryKey: ["sphereTiering", bucketSize],
    queryFn: () => fetchSphereTiering(bucketSize),
    refetchInterval: 10 * 60 * 1000,
  });

  const chartData = data?.rows.map((row) => ({
    tier: row.tier,
    ...Object.fromEntries(data.spheres.map((name, i) => [name, row.counts[i]])),
  }));

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Layers size={20} className="text-blue-400" />
              Sphere Tiering
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              City-count tiers of each sphere&apos;s members. Spheres and their alliances are set on the{" "}
              <Link href="/alliance-spheres-config" className="text-blue-400 hover:underline inline-flex items-center gap-1">
                <Settings size={12} />Spheres Config
              </Link>{" "}
              page.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="sphere-bucket-size" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Tier Size</label>
              <select
                id="sphere-bucket-size"
                value={bucketSize}
                onChange={(e) => setBucketSize(Number(e.target.value))}
                className="bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              >
                {BUCKET_SIZES.map((size) => (
                  <option key={size} value={size}>{size} {size === 1 ? "city" : "cities"}</option>
                ))}
              </select>
            </div>
            {data && data.rows.length > 0 && (
              <ExportButton
                filename="sphere-tiering"
                getData={() => data.rows.map((row) => ({
                  Tier: row.tier,
                  ...Object.fromEntries(data.spheres.map((name, i) => [name, row.counts[i]])),
                  Total: row.total,
                }))}
              />
            )}
          </div>
        </div>

        {isLoading && <div className="flex justify-center py-12"><LoadingSpinner /></div>}
        {error && <ErrorMessage message={(error as Error).message} />}

        {data && data.rows.length === 0 && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <Layers size={40} className="text-slate-600 mx-auto mb-3" />
            <p className="text-white font-medium">
              {data.hasAlliances ? "No members found in the configured alliances" : "No alliances assigned to any sphere yet"}
            </p>
            <p className="text-slate-400 text-sm mt-1">Add alliances to your spheres on the Spheres Config page.</p>
          </div>
        )}

        {data && chartData && data.rows.length > 0 && (
          <>
            <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData} margin={{ top: 20 }}>
                  <XAxis dataKey="tier" tick={{ fill: "#64748b", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
                  {data.spheres.map((name, i) => (
                    <Area key={name} type="step" dataKey={name} stroke={COLORS[i % COLORS.length]} strokeWidth={2}
                      fill={COLORS[i % COLORS.length]} fillOpacity={0.12} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#2a3150]">
              <table className="w-full text-sm">
                <thead className="bg-[#161b2e] border-b border-[#2a3150]">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">Tier</th>
                    {data.spheres.map((name, i) => (
                      <th key={name} className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide whitespace-nowrap" style={{ color: COLORS[i % COLORS.length] }}>
                        {name}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2a3150]">
                  {data.rows.map((row) => (
                    <tr key={row.tier} className="bg-[#161b2e] hover:bg-[#1e2540] transition-colors">
                      <td className="px-3 py-2 text-slate-200 font-medium whitespace-nowrap">{row.tier}</td>
                      {row.counts.map((count, i) => (
                        <td key={i} className="px-3 py-2 text-right text-slate-300">{count}</td>
                      ))}
                      <td className="px-3 py-2 text-right text-white font-semibold">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-[#1a1f35] border-t border-[#2a3150] font-semibold">
                    <td className="px-3 py-2 text-slate-200">Total</td>
                    {data.totals.map((total, i) => (
                      <td key={i} className="px-3 py-2 text-right text-slate-200">{total}</td>
                    ))}
                    <td className="px-3 py-2 text-right text-white">{data.totals.reduce((a, b) => a + b, 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
