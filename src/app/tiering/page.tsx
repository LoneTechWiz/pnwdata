"use client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ExportButton } from "@/components/ExportButton";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { Layers } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { GroupTieringResponse } from "@/app/api/tiering/route";
import type { TieringDefaults } from "@/app/api/tiering/defaults/route";

const BUCKET_SIZES = [1, 5, 10] as const;

const TOOLTIP_STYLE = {
  contentStyle: { background: "#1e2130", border: "1px solid #2a3150", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#e2e8f0" },
  itemStyle: { color: "#94a3b8" },
};

export default function TieringPage() {
  const [groupAIds, setGroupAIds] = useState("");
  const [groupBIds, setGroupBIds] = useState("");
  const [labelA, setLabelA] = useState("Ally Alliances");
  const [labelB, setLabelB] = useState("Enemy Alliances");
  const [bucketSize, setBucketSize] = useState<number>(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GroupTieringResponse | null>(null);

  useEffect(() => {
    fetch("/api/tiering/defaults")
      .then(r => r.ok ? r.json() : null)
      .then((defaults: TieringDefaults | null) => {
        if (!defaults) return;
        const aIds = defaults.allyIds.join(", ");
        const bIds = defaults.enemyIds.join(", ");
        setGroupAIds(aIds);
        setGroupBIds(bIds);
        if (aIds || bIds) runCompare(aIds, bIds, bucketSize);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runCompare(aIds: string, bIds: string, bucket: number) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({
        groupAIds: aIds,
        groupBIds: bIds,
        bucketSize: String(bucket),
      });
      const res = await fetch(`/api/tiering?${params}`);
      const ct = res.headers.get("content-type") ?? "";
      const data = ct.includes("application/json") ? await res.json() : null;
      if (!res.ok) {
        setError(data?.error ?? `Server error (${res.status})`);
      } else {
        setResult(data as GroupTieringResponse);
      }
    } catch {
      setError("Network error — check your connection");
    } finally {
      setLoading(false);
    }
  }

  function handleCompare() {
    runCompare(groupAIds, groupBIds, bucketSize);
  }

  const displayLabelA = labelA.trim() || "Group A";
  const displayLabelB = labelB.trim() || "Group B";

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Layers size={20} className="text-blue-400" />
            Alliance Tiering
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Compare two groups of alliances by their members&apos; city-count tiers
          </p>
        </div>

        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={labelA}
                onChange={e => setLabelA(e.target.value)}
                placeholder="Group A"
                className="bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-1.5 text-sm font-semibold focus:outline-none focus:border-blue-500"
              />
              <label htmlFor="group-a-input" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Alliance IDs (comma-separated)
              </label>
              <input
                id="group-a-input"
                type="text"
                value={groupAIds}
                onChange={e => setGroupAIds(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCompare()}
                placeholder="e.g. 1234, 5678"
                className="bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={labelB}
                onChange={e => setLabelB(e.target.value)}
                placeholder="Group B"
                className="bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-1.5 text-sm font-semibold focus:outline-none focus:border-blue-500"
              />
              <label htmlFor="group-b-input" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Alliance IDs (comma-separated)
              </label>
              <input
                id="group-b-input"
                type="text"
                value={groupBIds}
                onChange={e => setGroupBIds(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCompare()}
                placeholder="e.g. 4321, 8765"
                className="bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex flex-col gap-1">
              <label htmlFor="bucket-size-select" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Tier Size
              </label>
              <select
                id="bucket-size-select"
                value={bucketSize}
                onChange={e => setBucketSize(Number(e.target.value))}
                className="bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              >
                {BUCKET_SIZES.map(size => (
                  <option key={size} value={size}>{size} {size === 1 ? "city" : "cities"}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleCompare}
              disabled={loading || (!groupAIds.trim() && !groupBIds.trim())}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
            >
              <Layers size={14} />
              Compare
            </button>
            {result && (
              <ExportButton
                filename="alliance-tiering"
                getData={() => result.rows.map(row => ({
                  Tier: row.tier,
                  [displayLabelA]: row.groupA,
                  [displayLabelB]: row.groupB,
                  Total: row.total,
                }))}
              />
            )}
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        )}

        {error && <ErrorMessage message={error} />}

        {!loading && !result && !error && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <Layers size={40} className="text-slate-600 mx-auto mb-3" />
            <p className="text-white font-medium">Enter alliance IDs for each group to compare tiering</p>
            <p className="text-slate-400 text-sm mt-1">
              Shows member counts for each group, grouped by city-count tier
            </p>
          </div>
        )}

        {!loading && result && result.rows.length === 0 && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <Layers size={40} className="text-slate-600 mx-auto mb-3" />
            <p className="text-white font-medium">No members found</p>
          </div>
        )}

        {!loading && result && result.rows.length > 0 && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={result.rows}>
                <XAxis dataKey="tier" tick={{ fill: "#64748b", fontSize: 11 }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 11 }} allowDecimals={false} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
                <Bar dataKey="groupA" name={displayLabelA} fill="#60a5fa" radius={[4, 4, 0, 0]} />
                <Bar dataKey="groupB" name={displayLabelB} fill="#f87171" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {!loading && result && result.rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-[#2a3150]">
            <table className="w-full text-sm">
              <thead className="bg-[#161b2e] border-b border-[#2a3150]">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">
                    Tier
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">
                    {displayLabelA}
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">
                    {displayLabelB}
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a3150]">
                {result.rows.map(row => (
                  <tr key={row.tier} className="bg-[#161b2e] hover:bg-[#1e2540] transition-colors">
                    <td className="px-3 py-2 text-slate-200 font-medium whitespace-nowrap">{row.tier}</td>
                    <td className="px-3 py-2 text-right text-blue-300">{row.groupA}</td>
                    <td className="px-3 py-2 text-right text-red-300">{row.groupB}</td>
                    <td className="px-3 py-2 text-right text-white font-semibold">{row.total}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#1a1f35] border-t border-[#2a3150] font-semibold">
                  <td className="px-3 py-2 text-slate-200">Total</td>
                  <td className="px-3 py-2 text-right text-blue-300">{result.groupATotal}</td>
                  <td className="px-3 py-2 text-right text-red-300">{result.groupBTotal}</td>
                  <td className="px-3 py-2 text-right text-white">{result.groupATotal + result.groupBTotal}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
