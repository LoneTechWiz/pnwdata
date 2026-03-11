"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchBankrecs, fetchSyncStatus, BankRec } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { ArrowDownLeft, ArrowUpRight, Landmark } from "lucide-react";
import { ExportButton } from "@/components/ExportButton";

const RESOURCES = ["money", "coal", "oil", "uranium", "iron", "bauxite", "lead", "gasoline", "munitions", "steel", "aluminum", "food"] as const;
const RESOURCE_COLORS: Record<string, string> = {
  money: "text-yellow-400", coal: "text-slate-300", oil: "text-amber-700",
  uranium: "text-green-400", iron: "text-slate-400", bauxite: "text-orange-300",
  lead: "text-slate-500", gasoline: "text-orange-400", munitions: "text-red-400",
  steel: "text-blue-300", aluminum: "text-cyan-300", food: "text-emerald-400",
};
const ENTITY_TYPES: Record<number, string> = { 1: "Nation", 2: "Alliance", 3: "Treasure" };

function fmt(n: number) {
  if (!n) return null;
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

function ResourcePills({ rec }: { rec: BankRec }) {
  const items = RESOURCES.filter(r => (rec[r] ?? 0) !== 0);
  if (!items.length) return <span className="text-slate-600 text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(r => (
        <span key={r} className={`text-xs ${RESOURCE_COLORS[r]}`}>{r}: {fmt(rec[r] as number)}</span>
      ))}
    </div>
  );
}

export default function BankPage() {
  const { data: recs = [], isLoading, error } = useQuery<BankRec[]>({
    queryKey: ["bankrecs"],
    queryFn: fetchBankrecs,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: status } = useQuery({ queryKey: ["syncStatus"], queryFn: fetchSyncStatus, refetchInterval: 15_000 });

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (recs.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  const totals = RESOURCES.reduce<Record<string, { in: number; out: number }>>((acc, r) => {
    acc[r] = { in: 0, out: 0 }; return acc;
  }, {});
  for (const rec of recs) {
    for (const r of RESOURCES) {
      if (rec.receiver_type === 2) totals[r].in += (rec[r] as number) ?? 0;
      if (rec.sender_type === 2) totals[r].out += (rec[r] as number) ?? 0;
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white">Bank Records</h2>
          <p className="text-slate-400 text-sm">{recs.length} transactions stored</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: "Alliance Received", dir: "in" as const, icon: <ArrowDownLeft size={16} className="text-green-400" /> },
            { label: "Alliance Sent", dir: "out" as const, icon: <ArrowUpRight size={16} className="text-red-400" /> },
          ].map(({ label, dir, icon }) => (
            <div key={dir} className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">{icon}<span className="text-sm font-semibold text-slate-300">{label}</span></div>
              <div className="grid grid-cols-2 gap-1">
                {RESOURCES.filter(r => totals[r][dir] > 0).map(r => (
                  <div key={r} className="flex justify-between text-xs">
                    <span className="text-slate-500 capitalize">{r}</span>
                    <span className={RESOURCE_COLORS[r]}>{fmt(totals[r][dir])}</span>
                  </div>
                ))}
                {RESOURCES.every(r => totals[r][dir] === 0) && (
                  <span className="text-slate-600 text-xs">No transactions</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-x-auto">
          <div className="px-4 py-3 border-b border-[#2a3150] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Landmark size={16} className="text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-300">All Transactions</h3>
            </div>
            <ExportButton
              filename="bank-records"
              getData={() => recs.map(rec => ({
                Date: rec.date,
                From: rec.sender?.nation_name ?? `${ENTITY_TYPES[rec.sender_type] ?? "?"} #${rec.sender_id}`,
                "From Type": ENTITY_TYPES[rec.sender_type] ?? rec.sender_type,
                To: rec.receiver?.nation_name ?? `${ENTITY_TYPES[rec.receiver_type] ?? "?"} #${rec.receiver_id}`,
                "To Type": ENTITY_TYPES[rec.receiver_type] ?? rec.receiver_type,
                Note: rec.note,
                Money: rec.money,
                Coal: rec.coal,
                Oil: rec.oil,
                Uranium: rec.uranium,
                Iron: rec.iron,
                Bauxite: rec.bauxite,
                Lead: rec.lead,
                Gasoline: rec.gasoline,
                Munitions: rec.munitions,
                Steel: rec.steel,
                Aluminum: rec.aluminum,
                Food: rec.food,
              }))}
            />
          </div>
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-[#2a3150]">
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-400">Date</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-400">From</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-400">To</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-400">Resources</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-400">Note</th>
              </tr>
            </thead>
            <tbody>
              {recs.map(rec => (
                <tr key={rec.id} className="border-b border-[#1e2540] hover:bg-[#1a2035] transition-colors">
                  <td className="px-4 py-2 text-slate-400 text-xs">
                    {new Date(rec.date).toLocaleDateString()} {new Date(rec.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-2">
                    <div className="text-xs">
                      {rec.sender_type === 1
                        ? <a href={`https://politicsandwar.com/nation/id=${rec.sender_id}`} target="_blank" rel="noopener noreferrer" className="text-white hover:text-blue-400 transition-colors">{rec.sender?.nation_name ?? `Nation #${rec.sender_id}`}</a>
                        : <span className="text-white">{rec.sender?.nation_name ?? `${ENTITY_TYPES[rec.sender_type] ?? "?"} #${rec.sender_id}`}</span>
                      }
                    </div>
                    <div className="text-slate-600 text-xs">{ENTITY_TYPES[rec.sender_type]}</div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="text-xs">
                      {rec.receiver_type === 1
                        ? <a href={`https://politicsandwar.com/nation/id=${rec.receiver_id}`} target="_blank" rel="noopener noreferrer" className="text-white hover:text-blue-400 transition-colors">{rec.receiver?.nation_name ?? `Nation #${rec.receiver_id}`}</a>
                        : <span className="text-white">{rec.receiver?.nation_name ?? `${ENTITY_TYPES[rec.receiver_type] ?? "?"} #${rec.receiver_id}`}</span>
                      }
                    </div>
                    <div className="text-slate-600 text-xs">{ENTITY_TYPES[rec.receiver_type]}</div>
                  </td>
                  <td className="px-4 py-2"><ResourcePills rec={rec} /></td>
                  <td className="px-4 py-2 text-slate-500 text-xs max-w-xs truncate">{rec.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {recs.length === 0 && <div className="py-12 text-center text-slate-500 text-sm">No bank records found</div>}
        </div>
      </div>
    </AppShell>
  );
}
