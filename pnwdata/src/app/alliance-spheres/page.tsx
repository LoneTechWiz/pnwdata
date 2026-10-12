"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { fetchAllianceSpheres } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { ExportButton } from "@/components/ExportButton";

const fmt = (n: number) => Math.round(n).toLocaleString();
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const BAR_COLORS = ["bg-blue-500", "bg-rose-500", "bg-emerald-500", "bg-amber-500", "bg-violet-500", "bg-cyan-500", "bg-pink-500", "bg-lime-500", "bg-orange-500", "bg-teal-500", "bg-indigo-500", "bg-fuchsia-500"];

export default function AllianceSpheresPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["allianceSpheres"],
    queryFn: fetchAllianceSpheres,
    refetchInterval: 10 * 60 * 1000,
  });

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;

  // Keep each sphere's color tied to its configured position, then show the biggest first.
  const spheres = (data?.spheres ?? [])
    .map((sphere, index) => ({ sphere, color: BAR_COLORS[index % BAR_COLORS.length] }))
    .sort((a, b) => b.sphere.totalScore - a.sphere.totalScore);
  const assigned = spheres.reduce((sum, { sphere }) => sum + sphere.alliances.length, 0);
  const maxShare = Math.max(0.0001, ...spheres.map(({ sphere }) => sphere.shareOfWorld));

  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-white">Alliance Spheres</h2>
          <p className="text-slate-400 text-sm">Combined score and nations for each sphere of alliances. Share is of all alliances&apos; combined score.</p>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-slate-400 text-sm">{data ? `Updated ${new Date(data.fetchedAt).toLocaleTimeString()}` : ""}</p>
          <ExportButton
            filename="alliance-spheres"
            label="Export Excel"
            getData={() => spheres.flatMap(({ sphere }, index) => sphere.alliances.map(a => ({
              Sphere: sphere.name,
              "Sphere Rank": index + 1,
              "Sphere Score": Math.round(sphere.totalScore),
              Alliance: a.name,
              "Alliance Score": Math.round(a.score),
              "Alliance Nations": a.nations,
              "In-Game Rank": a.rank,
            })))}
          />
        </div>

        {assigned === 0 ? (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-8 text-center text-slate-400">
            No alliances are assigned to a sphere yet.{" "}
            <Link href="/alliance-spheres-config" className="text-blue-400 hover:text-blue-300">Set up spheres</Link>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {spheres.map(({ sphere, color }, index) => (
              <div key={sphere.name} className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-slate-500">#{index + 1}</div>
                    <h3 className="text-lg font-semibold text-white">{sphere.name}</h3>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-amber-400">{fmt(sphere.totalScore)}</div>
                    <div className="text-xs text-slate-500">combined score</div>
                  </div>
                </div>

                <div>
                  <div className="h-2 rounded-full bg-[#0f1117] overflow-hidden">
                    <div className={`h-full ${color}`} style={{ width: `${(sphere.shareOfWorld / maxShare) * 100}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{pct(sphere.shareOfWorld)} of all alliance score</div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-[#0f1117] py-2">
                    <div className="text-sm font-semibold text-white">{sphere.totalNations.toLocaleString()}</div>
                    <div className="text-xs text-slate-500">nations</div>
                  </div>
                  <div className="rounded-lg bg-[#0f1117] py-2">
                    <div className="text-sm font-semibold text-white">{sphere.alliances.length}</div>
                    <div className="text-xs text-slate-500">alliances</div>
                  </div>
                  <div className="rounded-lg bg-[#0f1117] py-2">
                    <div className="text-sm font-semibold text-white">{fmt(sphere.avgScorePerNation)}</div>
                    <div className="text-xs text-slate-500">avg score / nation</div>
                  </div>
                </div>

                {sphere.alliances.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#2a3150] text-xs text-slate-400">
                        <th className="py-2 text-left font-medium">Alliance</th>
                        <th className="py-2 text-right font-medium">Score</th>
                        <th className="py-2 text-right font-medium">Nations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sphere.alliances.map(a => (
                        <tr key={a.id} className="border-b border-[#1e2540] last:border-0">
                          <td className="py-1.5">
                            <a
                              href={`https://politicsandwar.com/alliance/id=${a.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-slate-200 hover:text-blue-400 transition-colors"
                            >
                              {a.name}
                            </a>
                          </td>
                          <td className="py-1.5 text-right text-slate-300">{fmt(a.score)}</td>
                          <td className="py-1.5 text-right text-slate-300">{a.nations.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-slate-500">No alliances in this sphere.</p>
                )}

                {sphere.missingIds.length > 0 && (
                  <p className="text-xs text-amber-400">
                    {sphere.missingIds.length} configured alliance{sphere.missingIds.length === 1 ? "" : "s"} no longer exist
                    ({sphere.missingIds.join(", ")}).
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
