"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Hammer, RotateCcw, Settings } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ExportButton } from "@/components/ExportButton";
import { ErrorMessage, LoadingSpinner } from "@/components/LoadingSpinner";
import { fetchMembers, fetchRebuildConfig } from "@/lib/pnw";
import { MAX_INFRA, REBUILD_DEFAULTS, REBUILD_TIER_RANGES, estimateRebuild, type RebuildConfig } from "@/lib/rebuild-cost";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (n: number) => `${+(n * 100).toFixed(2)}%`;

type Overrides = Record<number, { start?: string; target?: string }>;

const infraInputClass = "w-24 rounded-lg border border-[#2a3150] bg-[#0f1117] px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none";

/** A typed value only counts when it is a whole number in range; anything else falls back to the saved one. */
function infraOr(text: string | undefined, fallback: number): number {
  if (text === undefined || text.trim() === "") return fallback;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 && n <= MAX_INFRA ? n : fallback;
}

export default function RebuildCostPage() {
  // Adjustments made here only last for this visit; the saved defaults live on /rebuild-config.
  const [overrides, setOverrides] = useState<Overrides>({});
  const { data: savedConfig = REBUILD_DEFAULTS } = useQuery({ queryKey: ["rebuildConfig"], queryFn: fetchRebuildConfig });
  const { data: members = [], isLoading, error } = useQuery({
    queryKey: ["members"],
    queryFn: fetchMembers,
    refetchInterval: 10 * 60 * 1000,
  });

  const config = useMemo<RebuildConfig>(() => ({
    tiers: savedConfig.tiers.map((tier, i) => {
      const start = infraOr(overrides[i]?.start, tier.start_infra);
      return { ...tier, start_infra: start, target_infra: Math.max(start, infraOr(overrides[i]?.target, tier.target_infra)) };
    }),
  }), [savedConfig, overrides]);

  const rows = useMemo(
    () => members.map((nation) => ({ nation, ...estimateRebuild(config, nation) })).sort((a, b) => b.total - a.total),
    [members, config],
  );

  const tierSummaries = useMemo(
    () => config.tiers.map((tier, i) => {
      const inTier = rows.filter((r) => r.tier === tier);
      return { label: REBUILD_TIER_RANGES[i].label, tier, nations: inTier.length, total: inTier.reduce((s, r) => s + r.total, 0) };
    }),
    [rows, config],
  );
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Hammer size={20} className="text-amber-400" />
              Rebuild Cost Estimate
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Cost for every city of every member to go from the starting to the target infrastructure for their city tier, after their Center for Civil Engineering and Advanced Engineering Corps discounts, assuming everyone is on the Urbanization domestic policy.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {Object.keys(overrides).length > 0 && (
              <button onClick={() => setOverrides({})} className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300">
                <RotateCcw size={13} /> Reset to saved
              </button>
            )}
            <Link href="/rebuild-config" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white">
              <Settings size={13} /> Settings
            </Link>
            <ExportButton
              filename="rebuild-cost"
              getData={() => rows.map(({ nation, tier, discount, perCity, total }) => ({
                Nation: nation.nation_name,
                Leader: nation.leader_name,
                Cities: nation.num_cities,
                "Start infra": tier.start_infra,
                "Target infra": tier.target_infra,
                Discount: pct(discount),
                "Cost per city": Math.round(perCity),
                "Total cost": Math.round(total),
              }))}
            />
          </div>
        </div>

        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 flex items-baseline justify-between flex-wrap gap-2">
          <span className="text-slate-400 text-sm">Total rebuild cost across {rows.length} nation{rows.length === 1 ? "" : "s"}</span>
          <span className="text-2xl font-bold text-amber-400">{money(grandTotal)}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {tierSummaries.map(({ label, nations, total }, i) => {
            const saved = savedConfig.tiers[i];
            const edit = (patch: { start?: string; target?: string }) =>
              setOverrides((o) => ({ ...o, [i]: { ...o[i], ...patch } }));
            return (
              <div key={label} className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
                <div className="text-lg font-bold text-white mt-1">{money(total)}</div>
                <div className="text-xs text-slate-500 mt-1">{nations} nation{nations === 1 ? "" : "s"}</div>
                <div className="flex gap-3 mt-3">
                  <div>
                    <label htmlFor={`start-${i}`} className="block text-xs text-slate-400">Start infra</label>
                    <input id={`start-${i}`} type="number" min={0} max={MAX_INFRA} step={1}
                      value={overrides[i]?.start ?? String(saved.start_infra)}
                      onChange={(e) => edit({ start: e.target.value })} className={infraInputClass} />
                  </div>
                  <div>
                    <label htmlFor={`target-${i}`} className="block text-xs text-slate-400">Target infra</label>
                    <input id={`target-${i}`} type="number" min={0} max={MAX_INFRA} step={1}
                      value={overrides[i]?.target ?? String(saved.target_infra)}
                      onChange={(e) => edit({ target: e.target.value })} className={infraInputClass} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#2a3150]">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-[#161b2e] border-b border-[#2a3150] text-xs text-slate-400 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-3 text-left font-semibold">Nation</th>
                <th className="px-3 py-3 text-right font-semibold">Cities</th>
                <th className="px-3 py-3 text-right font-semibold">Infra</th>
                <th className="px-3 py-3 text-right font-semibold">Discount</th>
                <th className="px-3 py-3 text-right font-semibold">Per city</th>
                <th className="px-3 py-3 text-right font-semibold">Total cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a3150]">
              {rows.map(({ nation, tier, discount, perCity, total }) => (
                <tr key={nation.id} className="bg-[#161b2e] hover:bg-[#1e2540] transition-colors">
                  <td className="px-3 py-2.5">
                    <a
                      href={`https://politicsandwar.com/nation/id=${nation.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white font-medium hover:text-blue-400 transition-colors"
                    >
                      {nation.nation_name}
                    </a>
                    <div className="text-xs text-slate-500">{nation.leader_name}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-300">{nation.num_cities}</td>
                  <td className="px-3 py-2.5 text-right text-slate-300">
                    {tier.start_infra.toLocaleString()} → {tier.target_infra.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-300">
                    {discount === 0 ? <span className="text-slate-500">None</span> : pct(discount)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-300">{money(perCity)}</td>
                  <td className="px-3 py-2.5 text-right text-amber-400 font-semibold">{money(total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
