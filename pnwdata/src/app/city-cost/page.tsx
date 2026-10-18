"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ExportButton } from "@/components/ExportButton";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { MAX_TARGET_CITIES, costToReach, parseNationIds, policyDiscount } from "@/lib/city-cost";
import type { CityCostResponse } from "@/app/api/city-cost/route";

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${+(n * 100).toFixed(1)}%`;

async function fetchCityCost(ids: string, target: number): Promise<CityCostResponse> {
  const params = new URLSearchParams({ ids, target: String(target) });
  const res = await fetch(`/api/city-cost?${params}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Server error (${res.status})`);
  return data as CityCostResponse;
}

export default function CityCostPage() {
  const [idsInput, setIdsInput] = useState("");
  const [targetInput, setTargetInput] = useState("");
  const [submitted, setSubmitted] = useState<{ ids: string; target: number } | null>(null);

  const target = Number(targetInput);
  const targetValid = Number.isInteger(target) && target >= 2 && target <= MAX_TARGET_CITIES;
  const canSubmit = parseNationIds(idsInput).length > 0 && targetValid;

  const { data, isFetching, error } = useQuery({
    queryKey: ["cityCost", submitted],
    queryFn: () => fetchCityCost(submitted!.ids, submitted!.target),
    enabled: submitted !== null,
  });

  const results = useMemo(() => {
    if (!data || !submitted) return [];
    return data.nations.map((nation) => ({
      nation,
      ...costToReach(nation.cities, submitted.target, data.cityAverage, nation.mods),
    }));
  }, [data, submitted]);

  const grandTotal = results.reduce((sum, r) => sum + r.total, 0);
  // Matrix rows run from the lowest city anyone still has to buy up to the target.
  const firstCity = results.length > 0 ? Math.min(...results.map((r) => r.nation.cities)) + 1 : 0;
  const matrixCities = submitted ? Array.from({ length: Math.max(0, submitted.target - firstCity + 1) }, (_, i) => firstCity + i) : [];

  function submit() {
    if (canSubmit) setSubmitted({ ids: idsInput, target });
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Calculator size={20} className="text-blue-400" />
            City Cost Calculator
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Total cost to grow nations to a target city count, using the game&apos;s current city cost formula and each nation&apos;s Manifest Destiny policy and refund discount.
          </p>
        </div>

        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="city-cost-ids" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Nation IDs (commas, spaces or new lines)
              </label>
              <textarea
                id="city-cost-ids"
                value={idsInput}
                onChange={(e) => setIdsInput(e.target.value)}
                rows={3}
                placeholder="e.g. 12345, 67890"
                className="bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="city-cost-target" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Target cities
              </label>
              <input
                id="city-cost-target"
                type="number"
                min={2}
                max={MAX_TARGET_CITIES}
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="e.g. 30"
                className="bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={submit}
              disabled={!canSubmit || isFetching}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
            >
              <Calculator size={14} />
              Calculate
            </button>
            {results.length > 0 && submitted && (
              <ExportButton
                filename="city-cost"
                getData={() => matrixCities.map((city) => ({
                  City: city,
                  ...Object.fromEntries(results.map(({ nation, rows }) => [
                    `${nation.nationName} (${nation.id})`,
                    rows.find((r) => r.city === city)?.cost ?? "",
                  ])),
                }))}
              />
            )}
          </div>
        </div>

        {isFetching && <div className="flex justify-center py-12"><LoadingSpinner /></div>}
        {error && <ErrorMessage message={(error as Error).message} />}

        {!isFetching && data && data.notFound.length > 0 && (
          <p className="text-sm text-amber-400">No nation found for ID{data.notFound.length === 1 ? "" : "s"}: {data.notFound.join(", ")}</p>
        )}

        {!isFetching && submitted && results.length > 0 && (
          <>
            <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 flex items-baseline justify-between flex-wrap gap-2">
              <span className="text-slate-400 text-sm">
                Total to reach {submitted.target} cities across {results.length} nation{results.length === 1 ? "" : "s"}
              </span>
              <span className="text-2xl font-bold text-amber-400">{money(grandTotal)}</span>
            </div>

            <p className="text-xs text-slate-500">
              Game city average used in the formula: {data?.cityAverage}
            </p>

            <div className="overflow-x-auto rounded-xl border border-[#2a3150]">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-[#161b2e] border-b border-[#2a3150] text-xs text-slate-400 uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-3 text-left font-semibold">Nation</th>
                    <th className="px-3 py-3 text-right font-semibold">Cities</th>
                    <th className="px-3 py-3 text-left font-semibold">Discounts</th>
                    <th className="px-3 py-3 text-right font-semibold">Cities to buy</th>
                    <th className="px-3 py-3 text-right font-semibold">Total cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2a3150]">
                  {results.map(({ nation, rows, total }) => {
                    const refund = nation.mods.citiesDiscount;
                    const policy = policyDiscount(nation.mods);
                    return (
                      <tr key={nation.id} className="bg-[#161b2e] hover:bg-[#1e2540] transition-colors">
                        <td className="px-3 py-2.5">
                          <a
                            href={`https://politicsandwar.com/nation/id=${nation.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-white font-medium hover:text-blue-400 transition-colors"
                          >
                            {nation.nationName}
                          </a>
                          <div className="text-xs text-slate-500">{nation.leaderName}</div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-300">{nation.cities}</td>
                        <td className="px-3 py-2.5 text-slate-300">
                          {refund === 0 && policy === 0 ? (
                            <span className="text-slate-500">None</span>
                          ) : (
                            <>
                              {policy > 0 && <span>Manifest Destiny {pct(policy)}</span>}
                              {refund > 0 && policy > 0 && <span className="text-slate-500"> · </span>}
                              {refund > 0 && <span>{money(refund)} refund credit</span>}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-300">{rows.length}</td>
                        <td className="px-3 py-2.5 text-right text-amber-400 font-semibold">
                          {rows.length === 0 ? <span className="text-slate-500">At target</span> : money(total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {matrixCities.length > 0 && (
              <div>
                <h3 className="text-white font-semibold mb-2">Cost per city</h3>
                <div className="overflow-x-auto rounded-xl border border-[#2a3150]">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead className="bg-[#161b2e] border-b border-[#2a3150] text-xs text-slate-400 uppercase tracking-wide">
                      <tr>
                        <th className="px-3 py-3 text-left font-semibold">City</th>
                        {results.map(({ nation }) => (
                          <th key={nation.id} className="px-3 py-3 text-right font-semibold">{nation.nationName}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2a3150]">
                      {matrixCities.map((city) => (
                        <tr key={city} className="bg-[#161b2e] hover:bg-[#1e2540] transition-colors">
                          <td className="px-3 py-2 text-slate-200 font-medium">{city}</td>
                          {results.map(({ nation, rows }) => {
                            const row = rows.find((r) => r.city === city);
                            return (
                              <td key={nation.id} className={`px-3 py-2 text-right ${row ? "text-slate-300" : "text-slate-600"}`}>
                                {row ? money(row.cost) : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-[#1a1f35] border-t border-[#2a3150] font-semibold">
                        <td className="px-3 py-2 text-slate-200">Total</td>
                        {results.map(({ nation, total }) => (
                          <td key={nation.id} className="px-3 py-2 text-right text-amber-400">{money(total)}</td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {!isFetching && submitted && data && results.length === 0 && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center text-slate-400">
            None of those nation IDs were found.
          </div>
        )}
      </div>
    </AppShell>
  );
}
