"use client";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { fetchMembers, fetchBknetMembers, fetchSyncStatus } from "@/lib/pnw";
import { ArrowUpDown } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { ExportButton } from "@/components/ExportButton";

type SortKey = "nation_name" | "num_cities" | "credits";

export default function CreditsPage() {
  const [sortKey, setSortKey] = useState<SortKey>("credits");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const { data: members = [], isLoading, error } = useQuery({
    queryKey: ["members"],
    queryFn: fetchMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: bknetMembers = [] } = useQuery({
    queryKey: ["bknet_members"],
    queryFn: fetchBknetMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: status } = useQuery({ queryKey: ["syncStatus"], queryFn: fetchSyncStatus, refetchInterval: 15_000 });

  const bknetDiscord = useMemo(() => new Map(
    bknetMembers
      .filter(m => m.discord?.account?.discord_username)
      .map(m => [String(m.nation.id), m.discord!.account!.discord_username] as [string, string])
  ), [bknetMembers]);

  const sorted = useMemo(() => {
    return members
      .filter(m => (m.credits ?? 0) >= 1)
      .sort((a, b) => {
        let av: number | string;
        let bv: number | string;
        if (sortKey === "nation_name") { av = a.nation_name; bv = b.nation_name; }
        else if (sortKey === "num_cities") { av = a.num_cities; bv = b.num_cities; }
        else { av = a.credits ?? 0; bv = b.credits ?? 0; }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [members, sortKey, sortDir]);

  const totalCredits = useMemo(() => sorted.reduce((acc, m) => acc + (m.credits ?? 0), 0), [sorted]);

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (members.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  const columns: { key: SortKey; label: string; align: "left" | "right" }[] = [
    { key: "nation_name", label: "Nation", align: "left" },
    { key: "num_cities", label: "Cities", align: "right" },
    { key: "credits", label: "Credits", align: "right" },
  ];

  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-white">Credit Holders</h2>
          <p className="text-slate-400 text-sm">Alliance members with 1 or more credits on their nation</p>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-slate-400 text-sm">
            {sorted.length} nation{sorted.length !== 1 ? "s" : ""} · {totalCredits.toLocaleString()} total credit{totalCredits !== 1 ? "s" : ""}
          </p>
          <ExportButton
            filename="credit-holders"
            getData={() => sorted.map(m => ({
              Nation: m.nation_name,
              Leader: m.leader_name,
              Discord: bknetDiscord.get(String(m.id)) ?? "",
              Cities: m.num_cities,
              Credits: m.credits ?? 0,
            }))}
          />
        </div>

        {sorted.length === 0 ? (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-8 text-center text-slate-400">
            No alliance members currently hold any credits.
          </div>
        ) : (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#2a3150]">
                  {columns.map(({ key, label, align }) => {
                    const active = sortKey === key;
                    const isLeft = align === "left";
                    return (
                      <th
                        key={key}
                        onClick={() => handleSort(key)}
                        className={`px-3 py-3 text-xs font-medium cursor-pointer select-none group ${isLeft ? "text-left" : "text-right"}`}
                      >
                        <span className={`flex items-center ${isLeft ? "" : "justify-end"} gap-1 ${active ? "text-amber-400" : "text-slate-400 group-hover:text-slate-200"}`}>
                          {!isLeft && <ArrowUpDown size={10} className={active ? "opacity-100" : "opacity-30"} />}
                          {label}
                          {isLeft && <ArrowUpDown size={10} className={active ? "opacity-100" : "opacity-30"} />}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map(m => (
                  <tr key={m.id} className="border-b border-[#1e2540] hover:bg-[#1a2035] transition-colors">
                    <td className="px-3 py-2.5">
                      <a
                        href={`https://politicsandwar.com/nation/id=${m.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white font-medium hover:text-blue-400 transition-colors block"
                      >
                        {m.nation_name}
                      </a>
                      <div className="text-xs text-slate-500">{m.leader_name}</div>
                      {bknetDiscord.has(String(m.id)) && (
                        <div className="text-xs text-indigo-400">{bknetDiscord.get(String(m.id))}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{m.num_cities}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-amber-400">
                      {(m.credits ?? 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
