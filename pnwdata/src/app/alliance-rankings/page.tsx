"use client";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import { fetchAllianceRankings } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { ExportButton } from "@/components/ExportButton";

const fmt = (n: number) => Math.round(n).toLocaleString();

export default function AllianceRankingsPage() {
  const [expanded, setExpanded] = useState<number[]>([]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["allianceRankings"],
    queryFn: fetchAllianceRankings,
    refetchInterval: 10 * 60 * 1000,
  });

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;

  const groups = data?.groups ?? [];

  function toggle(mainId: number) {
    setExpanded(prev => prev.includes(mainId) ? prev.filter(id => id !== mainId) : [...prev, mainId]);
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-white">Alliance Rankings</h2>
          <p className="text-slate-400 text-sm">
            Top 20 by combined score. Alliances with an Extension or Offshore treaty are counted together with the larger alliance they&apos;re linked to.
          </p>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-slate-400 text-sm">
            {data ? `Updated ${new Date(data.fetchedAt).toLocaleTimeString()}` : ""}
          </p>
          <ExportButton
            filename="alliance-rankings"
            label="Export Excel"
            getData={() => groups.map(g => ({
              Rank: g.rank,
              Alliance: g.mainName,
              "Combined Score": Math.round(g.totalScore),
              "Combined Nations": g.totalNations,
              "Alliances in Group": g.members.length,
              "Main Alliance Score": Math.round(g.members[0].score),
              "In-Game Rank": g.mainGameRank,
              "Linked Alliances": g.members.slice(1).map(m => `${m.name} (${m.linkType}, ${fmt(m.score)})`).join("; "),
            }))}
          />
        </div>

        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-[#2a3150] text-xs font-medium text-slate-400">
                <th className="px-3 py-3 text-right w-12">#</th>
                <th className="px-3 py-3 text-left">Alliance</th>
                <th className="px-3 py-3 text-right">Combined Score</th>
                <th className="px-3 py-3 text-right">Nations</th>
                <th className="px-3 py-3 text-right">Alliances</th>
                <th className="px-3 py-3 text-right">In-Game Rank</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const open = expanded.includes(g.mainId);
                const linked = g.members.length > 1;
                return (
                  <Fragment key={g.mainId}>
                    <tr
                      onClick={linked ? () => toggle(g.mainId) : undefined}
                      className={`border-b border-[#1e2540] hover:bg-[#1a2035] transition-colors ${linked ? "cursor-pointer" : ""}`}
                    >
                      <td className="px-3 py-2.5 text-right text-slate-400">{g.rank}</td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1.5">
                          <ChevronRight
                            size={14}
                            className={`text-slate-500 transition-transform ${open ? "rotate-90" : ""} ${linked ? "" : "invisible"}`}
                          />
                          <a
                            href={`https://politicsandwar.com/alliance/id=${g.mainId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-white font-medium hover:text-blue-400 transition-colors"
                          >
                            {g.mainName}
                          </a>
                          {linked && <span className="text-xs text-sky-400">+{g.members.length - 1} linked</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium text-amber-400">{fmt(g.totalScore)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-300">{g.totalNations.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right text-slate-300">{g.members.length}</td>
                      <td className="px-3 py-2.5 text-right text-slate-300">{g.mainGameRank}</td>
                    </tr>
                    {open && g.members.map(m => (
                      <tr key={m.id} className="border-b border-[#1e2540] bg-[#12172a] text-xs">
                        <td />
                        <td className="px-3 py-2 pl-10">
                          <a
                            href={`https://politicsandwar.com/alliance/id=${m.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-300 hover:text-blue-400 transition-colors"
                          >
                            {m.name}
                          </a>
                          <span className="ml-2 text-slate-500">{m.linkType ?? "Main alliance"}</span>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-400">{fmt(m.score)}</td>
                        <td className="px-3 py-2 text-right text-slate-400">{m.nations.toLocaleString()}</td>
                        <td />
                        <td />
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
