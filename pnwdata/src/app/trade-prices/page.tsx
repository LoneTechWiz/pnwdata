"use client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchTradePriceHistory, fetchSyncStatus, type TradePrice } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { ExportButton } from "@/components/ExportButton";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const RESOURCES = [
  "food", "coal", "oil", "uranium", "iron", "bauxite", "lead",
  "gasoline", "munitions", "steel", "aluminum", "credits",
] as const;
type Resource = (typeof RESOURCES)[number];

const RANGES = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
] as const;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function TradePricesPage() {
  const [selected, setSelected] = useState<Resource>("food");
  const [rangeHours, setRangeHours] = useState<number>(24 * 7);

  const { data: history = [], isLoading, error } = useQuery({
    queryKey: ["tradePriceHistory"],
    queryFn: fetchTradePriceHistory,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: status } = useQuery({ queryKey: ["syncStatus"], queryFn: fetchSyncStatus, refetchInterval: 15_000 });

  const latest: TradePrice | undefined = history[history.length - 1];

  const rows = useMemo(() => {
    if (!latest) return [];
    const latestTime = Date.parse(latest.date);
    // Compare against the snapshot closest to 24h before the latest one.
    const dayAgo = history.reduce<TradePrice | undefined>((best, p) => {
      const diff = Math.abs(Date.parse(p.date) - (latestTime - 24 * 3600 * 1000));
      return !best || diff < Math.abs(Date.parse(best.date) - (latestTime - 24 * 3600 * 1000)) ? p : best;
    }, undefined);
    return RESOURCES.map(r => {
      const price = Number(latest[r]);
      const prev = dayAgo && dayAgo !== latest ? Number(dayAgo[r]) : null;
      const change = prev && prev > 0 ? ((price - prev) / prev) * 100 : null;
      return { resource: r, price, change };
    });
  }, [history, latest]);

  const chartData = useMemo(() => {
    if (!latest) return [];
    const cutoff = Date.parse(latest.date) - rangeHours * 3600 * 1000;
    return history
      .filter(p => Date.parse(p.date) >= cutoff)
      .map(p => ({ time: Date.parse(p.date), price: Number(p[selected]) }));
  }, [history, latest, rangeHours, selected]);

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (history.length === 0) {
    if (status?.status === "never" || status?.status === "syncing") return <AppShell><SyncingPlaceholder /></AppShell>;
    return (
      <AppShell>
        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-8 text-center text-slate-400">
          No trade price history yet. It is recorded on each sync.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-white">Trade Prices</h2>
          <p className="text-slate-400 text-sm">
            24-hour average market price per resource · last updated {new Date(latest!.date).toLocaleString()}
          </p>
        </div>

        <div className="flex justify-end">
          <ExportButton
            filename="trade-price-history"
            getData={() => history.map(p => ({
              Date: p.date,
              ...Object.fromEntries(RESOURCES.map(r => [cap(r), Number(p[r])])),
            }))}
          />
        </div>

        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-[#2a3150] text-xs text-slate-400">
                <th className="px-3 py-3 text-left font-medium">Resource</th>
                <th className="px-3 py-3 text-right font-medium">24h Avg Price</th>
                <th className="px-3 py-3 text-right font-medium">Change vs 24h ago</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ resource, price, change }) => (
                <tr
                  key={resource}
                  onClick={() => setSelected(resource)}
                  className={`border-b border-[#1e2540] cursor-pointer hover:bg-[#1a2035] transition-colors ${selected === resource ? "bg-[#1a2035]" : ""}`}
                >
                  <td className="px-3 py-2.5 text-white font-medium">{cap(resource)}</td>
                  <td className="px-3 py-2.5 text-right text-amber-400 font-medium">{money(price)}</td>
                  <td className={`px-3 py-2.5 text-right ${change === null ? "text-slate-500" : change >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h3 className="text-white font-semibold">{cap(selected)} price history</h3>
            <div className="flex gap-1">
              {RANGES.map(r => (
                <button
                  key={r.label}
                  onClick={() => setRangeHours(r.hours)}
                  className={`px-3 py-1 rounded-lg text-xs transition-colors ${rangeHours === r.hours ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-[#1e2540] hover:text-white"}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid stroke="#2a3150" strokeDasharray="3 3" />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t: number) => new Date(t).toLocaleString(undefined, rangeHours <= 24 ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" })}
                stroke="#64748b"
                fontSize={11}
              />
              <YAxis domain={["auto", "auto"]} tickFormatter={(v: number) => money(v)} stroke="#64748b" fontSize={11} width={70} />
              <Tooltip
                contentStyle={{ background: "#161b2e", border: "1px solid #2a3150", borderRadius: 8 }}
                labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
                formatter={(v) => [money(Number(v)), cap(selected)]}
              />
              <Line type="monotone" dataKey="price" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </AppShell>
  );
}
