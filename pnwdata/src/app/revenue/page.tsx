"use client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { StatCard } from "@/components/StatCard";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { ExportButton } from "@/components/ExportButton";
import { Wallet, PiggyBank, Clock, CalendarDays } from "lucide-react";

interface BracketRevenue {
  allianceId: number;
  allianceName: string;
  bracketId: number;
  bracketName: string;
  nominalMoneyRate: number;
  nominalResourceRate: number;
  realMoneyRate: number;
  realResourceRate: number;
  actualMoney: number;
  realMoney: number;
  safekeptMoney: number;
  recordCount: number;
}

interface TaxMoneyTotals {
  actualMoney: number;
  realMoney: number;
  safekeptMoney: number;
}

interface TaxRevenueOverview {
  brackets: BracketRevenue[];
  last24h: TaxMoneyTotals;
  dailyAverage30d: TaxMoneyTotals;
}

function fmt(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

function TimeWindowCards({ label, icon, totals }: { label: string; icon: typeof Clock; totals: TaxMoneyTotals }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">{label}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Actual Collected" value={fmt(totals.actualMoney)} icon={icon} color="text-slate-300" />
        <StatCard label="Real Revenue" value={fmt(totals.realMoney)} icon={Wallet} color="text-green-400" />
        <StatCard label="Member Safekept" value={fmt(totals.safekeptMoney)} icon={PiggyBank} color="text-yellow-400" />
      </div>
    </section>
  );
}

export default function RevenuePage() {
  const { data, isLoading, error } = useQuery<TaxRevenueOverview>({
    queryKey: ["taxRevenue"],
    queryFn: () => fetch("/api/tax-revenue").then((r) => {
      if (!r.ok) throw new Error("Access denied or failed to load");
      return r.json();
    }),
    refetchInterval: 10 * 60 * 1000,
  });

  const brackets = useMemo(() => data?.brackets ?? [], [data]);

  const byAlliance = useMemo(() => {
    const map = new Map<string, { actual: number; real: number; safekept: number }>();
    for (const b of brackets) {
      const entry = map.get(b.allianceName) ?? { actual: 0, real: 0, safekept: 0 };
      entry.actual += b.actualMoney;
      entry.real += b.realMoney;
      entry.safekept += b.safekeptMoney;
      map.set(b.allianceName, entry);
    }
    return [...map.entries()];
  }, [brackets]);

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">Revenue &amp; Taxes</h1>
            <p className="text-slate-400 text-sm mt-1">
              Actual tax collection vs. real alliance revenue, based on each bracket&apos;s configured real rate.
            </p>
          </div>
          <ExportButton
            filename="tax-revenue"
            getData={() => brackets.map((b) => ({
              Alliance: b.allianceName,
              Bracket: b.bracketName,
              "Nominal Money %": b.nominalMoneyRate,
              "Nominal Resource %": b.nominalResourceRate,
              "Real Money %": b.realMoneyRate,
              "Real Resource %": b.realResourceRate,
              "Actual Collected": b.actualMoney,
              "Real Revenue": b.realMoney,
              Safekept: b.safekeptMoney,
              "Tax Records": b.recordCount,
            }))}
          />
        </div>

        {data && (
          <>
            <TimeWindowCards label="Last 24 Hours" icon={Clock} totals={data.last24h} />
            <TimeWindowCards label="30-Day Daily Average" icon={CalendarDays} totals={data.dailyAverage30d} />
          </>
        )}

        {byAlliance.length > 1 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {byAlliance.map(([name, t]) => (
              <div key={name} className="rounded-xl border border-[#2a3150] bg-[#161b2e] p-4">
                <p className="text-sm font-semibold text-sky-400 mb-2">{name}</p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><p className="text-slate-500">Actual</p><p className="text-slate-200 font-medium">{fmt(t.actual)}</p></div>
                  <div><p className="text-slate-500">Real</p><p className="text-green-400 font-medium">{fmt(t.real)}</p></div>
                  <div><p className="text-slate-500">Safekept</p><p className="text-yellow-400 font-medium">{fmt(t.safekept)}</p></div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-[#2a3150] overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-[#1a1f35] text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2 font-medium">Bracket</th>
                <th className="text-right px-4 py-2 font-medium">Nominal</th>
                <th className="text-right px-4 py-2 font-medium">Real</th>
                <th className="text-right px-4 py-2 font-medium">Actual Collected</th>
                <th className="text-right px-4 py-2 font-medium">Real Revenue</th>
                <th className="text-right px-4 py-2 font-medium">Safekept</th>
                <th className="text-right px-4 py-2 font-medium">Tax Records</th>
              </tr>
            </thead>
            <tbody>
              {brackets.map((b) => (
                <tr key={`${b.allianceId}:${b.bracketId}`} className="border-t border-[#2a3150] hover:bg-[#1a1f35] transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{b.bracketName}</p>
                    {byAlliance.length > 1 && <p className="text-slate-500 text-xs">{b.allianceName}</p>}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-400 font-mono text-xs">{b.nominalMoneyRate}% / {b.nominalResourceRate}%</td>
                  <td className="px-4 py-3 text-right text-slate-400 font-mono text-xs">{b.realMoneyRate}% / {b.realResourceRate}%</td>
                  <td className="px-4 py-3 text-right text-slate-200">{fmt(b.actualMoney)}</td>
                  <td className="px-4 py-3 text-right text-green-400 font-medium">{fmt(b.realMoney)}</td>
                  <td className="px-4 py-3 text-right text-yellow-400">{fmt(b.safekeptMoney)}</td>
                  <td className="px-4 py-3 text-right text-slate-500 text-xs">{b.recordCount}</td>
                </tr>
              ))}
              {brackets.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500 text-sm italic">
                    No tax records synced yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
