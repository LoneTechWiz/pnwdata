"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ExportButton } from "@/components/ExportButton";
import { ErrorMessage, LoadingSpinner } from "@/components/LoadingSpinner";
import { DEFAULT_TRADER_WINDOW_DAYS, TRADER_WINDOWS_DAYS } from "@/lib/trader-profit";
import type { TopTradersResponse } from "@/app/api/top-traders/route";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.round(Math.abs(n)).toLocaleString()}`;
const windowLabel = (days: number) => (days === 1 ? "24 hours" : days === 365 ? "1 year" : `${days} days`);

async function fetchTopTraders(days: number): Promise<TopTradersResponse> {
  const res = await fetch(`/api/top-traders?days=${days}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Server error (${res.status})`);
  return data as TopTradersResponse;
}

export default function TopTradersPage() {
  const [days, setDays] = useState<number>(DEFAULT_TRADER_WINDOW_DAYS);
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["topTraders", days],
    queryFn: () => fetchTopTraders(days),
    refetchInterval: 10 * 60 * 1000,
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <TrendingUp size={20} className="text-emerald-400" />
              Top Traders
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              The 100 nations that made the most profit trading on the global market. For each resource, profit is the units a nation both bought and sold in the window times the gap between its average sell price and average buy price. Units that were only sold (produced) or only bought (consumed) aren&apos;t counted.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-[#2a3150] overflow-hidden">
              {TRADER_WINDOWS_DAYS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${d === days ? "bg-blue-600 text-white" : "bg-[#161b2e] text-slate-300 hover:bg-[#1e2540]"}`}
                >
                  {windowLabel(d)}
                </button>
              ))}
            </div>
            {data && data.traders.length > 0 && (
              <ExportButton
                filename={`top-traders-${days}d`}
                getData={() => data.traders.map((t, i) => ({
                  Rank: i + 1,
                  "Nation ID": t.nationId,
                  Nation: t.nationName ?? "",
                  Leader: t.leaderName ?? "",
                  Alliance: t.allianceName ?? "",
                  "Trading profit": Math.round(t.profit),
                  "Net cash flow": Math.round(t.netCashFlow),
                  "Value traded": Math.round(t.tradedValue),
                  Trades: t.trades,
                  "Best resource": t.bestResource ?? "",
                }))}
              />
            )}
          </div>
        </div>

        {isLoading && <div className="flex justify-center py-12"><LoadingSpinner /></div>}
        {error && <ErrorMessage message={(error as Error).message} />}

        {data && (
          <>
            <p className={`text-xs text-slate-500 ${isFetching ? "opacity-60" : ""}`}>
              {data.tradesInWindow.toLocaleString()} accepted global trades in the last {windowLabel(data.days)}
              {data.oldestTradeAt !== null && <> · trade history starts {new Date(data.oldestTradeAt).toLocaleDateString()}</>}
            </p>

            {data.traders.length === 0 ? (
              <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center text-slate-400">
                No profitable traders in this window yet. Trade history fills in over the first few syncs after trade tracking starts.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#2a3150]">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="bg-[#161b2e] border-b border-[#2a3150] text-xs text-slate-400 uppercase tracking-wide">
                    <tr>
                      <th className="px-3 py-3 text-right font-semibold">#</th>
                      <th className="px-3 py-3 text-left font-semibold">Nation</th>
                      <th className="px-3 py-3 text-left font-semibold">Alliance</th>
                      <th className="px-3 py-3 text-right font-semibold">Trading profit</th>
                      <th className="px-3 py-3 text-right font-semibold">Net cash flow</th>
                      <th className="px-3 py-3 text-right font-semibold">Value traded</th>
                      <th className="px-3 py-3 text-right font-semibold">Trades</th>
                      <th className="px-3 py-3 text-left font-semibold">Best resource</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2a3150]">
                    {data.traders.map((t, i) => (
                      <tr key={t.nationId} className="bg-[#161b2e] hover:bg-[#1e2540] transition-colors">
                        <td className="px-3 py-2.5 text-right text-slate-500">{i + 1}</td>
                        <td className="px-3 py-2.5">
                          <a
                            href={`https://politicsandwar.com/nation/id=${t.nationId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-white font-medium hover:text-blue-400 transition-colors"
                          >
                            {t.nationName ?? `Nation ${t.nationId}`}
                          </a>
                          {t.leaderName && <div className="text-xs text-slate-500">{t.leaderName}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-slate-300">{t.allianceName ?? <span className="text-slate-500">None</span>}</td>
                        <td className="px-3 py-2.5 text-right text-emerald-400 font-semibold">{money(t.profit)}</td>
                        <td className={`px-3 py-2.5 text-right ${t.netCashFlow < 0 ? "text-red-400" : "text-slate-300"}`}>{money(t.netCashFlow)}</td>
                        <td className="px-3 py-2.5 text-right text-slate-300">{money(t.tradedValue)}</td>
                        <td className="px-3 py-2.5 text-right text-slate-300">{t.trades.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-slate-300 capitalize">{t.bestResource ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
