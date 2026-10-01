"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { Save, Receipt } from "lucide-react";

interface TaxBracketConfig {
  allianceId: number;
  allianceName: string;
  bracketId: number;
  bracketName: string;
  nominalMoneyRate: number;
  nominalResourceRate: number;
  realMoneyRate: number;
  realResourceRate: number;
}

function bracketKey(b: { allianceId: number; bracketId: number }) {
  return `${b.allianceId}:${b.bracketId}`;
}

function BracketRow({
  bracket,
  onSaved,
}: {
  bracket: TaxBracketConfig;
  onSaved: () => void;
}) {
  const [moneyRate, setMoneyRate] = useState(String(bracket.realMoneyRate));
  const [resourceRate, setResourceRate] = useState(String(bracket.realResourceRate));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tax-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allianceId: bracket.allianceId,
          bracketId: bracket.bracketId,
          realMoneyRate: Number(moneyRate),
          realResourceRate: Number(resourceRate),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to save");
      return body;
    },
    onSuccess: onSaved,
  });

  const isDirty = Number(moneyRate) !== bracket.realMoneyRate || Number(resourceRate) !== bracket.realResourceRate;

  return (
    <tr className="border-b border-[#1e2540] hover:bg-[#1a2035] transition-colors">
      <td className="px-4 py-2.5">
        <p className="text-white font-medium">{bracket.bracketName}</p>
        <p className="text-slate-500 text-xs">#{bracket.bracketId}</p>
      </td>
      <td className="px-4 py-2.5 text-right text-slate-400 font-mono text-sm">
        {bracket.nominalMoneyRate}% / {bracket.nominalResourceRate}%
      </td>
      <td className="px-4 py-2.5 text-right">
        <input
          type="number"
          min={0}
          max={bracket.nominalMoneyRate}
          value={moneyRate}
          onChange={(e) => setMoneyRate(e.target.value)}
          className="w-20 bg-[#0f1117] border border-[#2a3150] rounded px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-blue-500"
        />
      </td>
      <td className="px-4 py-2.5 text-right">
        <input
          type="number"
          min={0}
          max={bracket.nominalResourceRate}
          value={resourceRate}
          onChange={(e) => setResourceRate(e.target.value)}
          className="w-20 bg-[#0f1117] border border-[#2a3150] rounded px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-blue-500"
        />
      </td>
      <td className="px-4 py-2.5 text-right">
        <button
          onClick={() => mutation.mutate()}
          disabled={!isDirty || mutation.isPending}
          className="inline-flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed text-white px-2 py-1 rounded transition-colors"
        >
          <Save size={10} /> {mutation.isPending ? "Saving…" : "Save"}
        </button>
        {mutation.isError && (
          <p className="text-red-400 text-xs mt-1 max-w-[12rem]">{(mutation.error as Error).message}</p>
        )}
      </td>
    </tr>
  );
}

export default function TaxConfigPage() {
  const queryClient = useQueryClient();

  const { data: brackets, isLoading, error } = useQuery<TaxBracketConfig[]>({
    queryKey: ["taxConfig"],
    queryFn: () => fetch("/api/tax-config").then((r) => {
      if (!r.ok) throw new Error("Access denied or failed to load");
      return r.json();
    }),
  });

  const grouped = useMemo(() => {
    const byAlliance = new Map<string, TaxBracketConfig[]>();
    for (const bracket of brackets ?? []) {
      const list = byAlliance.get(bracket.allianceName) ?? [];
      list.push(bracket);
      byAlliance.set(bracket.allianceName, list);
    }
    return [...byAlliance.entries()];
  }, [brackets]);

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Receipt size={20} className="text-emerald-400" />
          <div>
            <h1 className="text-xl font-bold text-white">Tax Configuration</h1>
            <p className="text-slate-400 text-sm mt-1">
              Set the real tax rate per bracket — the portion of a nominal in-game rate that&apos;s actually
              alliance revenue. Anything below the nominal rate is treated as the member&apos;s safekeep.
            </p>
          </div>
        </div>

        {grouped.length === 0 ? (
          <div className="rounded-xl border border-[#2a3150] bg-[#161b2e] p-8 text-center text-slate-400">
            No tax brackets synced yet.
          </div>
        ) : (
          grouped.map(([allianceName, list]) => (
            <div key={allianceName} className="rounded-xl border border-[#2a3150] overflow-hidden">
              {grouped.length > 1 && (
                <div className="px-4 py-2 bg-[#1a1f35] border-b border-[#2a3150] text-sm font-semibold text-sky-400">
                  {allianceName}
                </div>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#1a1f35] text-slate-400 text-xs uppercase tracking-wide">
                    <th className="text-left px-4 py-2 font-medium">Bracket</th>
                    <th className="text-right px-4 py-2 font-medium">Nominal (Money / Resource)</th>
                    <th className="text-right px-4 py-2 font-medium">Real Money %</th>
                    <th className="text-right px-4 py-2 font-medium">Real Resource %</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((bracket) => (
                    <BracketRow
                      key={bracketKey(bracket)}
                      bracket={bracket}
                      onSaved={() => queryClient.invalidateQueries({ queryKey: ["taxConfig"] })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
