"use client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { ExportButton } from "@/components/ExportButton";
import { ArrowUpDown, Info } from "lucide-react";

interface RetentionBucket {
  numerator: number;
  denominator: number;
  percent: number | null;
}

interface AllianceRecruitmentRow {
  id: number;
  name: string;
  acronym: string | null;
  score: number | null;
  color: string | null;
  rank: number | null;
  active_members: number;
  recruits_7d: number;
  recruits_30d: number;
  recruits_60d: number;
  recruits_90d: number;
  retention_30d: RetentionBucket;
  retention_60d: RetentionBucket;
  retention_90d: RetentionBucket;
}

interface RecruitmentResponse {
  meta: {
    last_synced_at: number | null;
    status: string;
    error: string | null;
    first_snapshot_at: number | null;
    nations_scanned: number;
    alliances_scanned: number;
    now: number;
  };
  alliances: AllianceRecruitmentRow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DENOMINATOR = 3;

type SortKey =
  | "rank"
  | "name"
  | "active_members"
  | "recruits_7d"
  | "recruits_30d"
  | "recruits_60d"
  | "recruits_90d"
  | "retention_30d"
  | "retention_60d"
  | "retention_90d";

function fmtDate(ms: number | null): string {
  if (!ms) return "never";
  const d = new Date(ms);
  return d.toLocaleString();
}

function pctText(b: RetentionBucket, label: string, dataReady: boolean): { text: string; tone: string; title: string } {
  if (!dataReady) {
    return { text: "—", tone: "text-slate-500", title: `Need ${label} of snapshots before retention is meaningful.` };
  }
  if (b.denominator < MIN_DENOMINATOR) {
    return {
      text: `n=${b.denominator}`,
      tone: "text-slate-500",
      title: `Only ${b.denominator} qualifying recruit${b.denominator === 1 ? "" : "s"} — too few to compute a meaningful percentage.`,
    };
  }
  const pct = b.percent ?? 0;
  const tone =
    pct >= 0.8 ? "text-emerald-400" : pct >= 0.5 ? "text-amber-400" : "text-rose-400";
  return {
    text: `${(pct * 100).toFixed(0)}%`,
    tone,
    title: `${b.numerator} of ${b.denominator} recruits still in alliance ${label} after joining`,
  };
}

export default function RecruitmentPage() {
  const [sortKey, setSortKey] = useState<SortKey>("recruits_30d");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data, isLoading, error } = useQuery<RecruitmentResponse>({
    queryKey: ["recruitment"],
    queryFn: () => fetch("/api/recruitment").then((r) => r.json()),
    refetchInterval: 60 * 60 * 1000,
  });

  const sorted = useMemo(() => {
    if (!data) return [];
    const rows = [...data.alliances];
    rows.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sortKey === "name") {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (sortKey === "rank") {
        av = a.rank ?? Number.MAX_SAFE_INTEGER;
        bv = b.rank ?? Number.MAX_SAFE_INTEGER;
      } else if (sortKey.startsWith("retention_")) {
        const ka = a[sortKey as "retention_30d" | "retention_60d" | "retention_90d"];
        const kb = b[sortKey as "retention_30d" | "retention_60d" | "retention_90d"];
        av = ka.denominator >= MIN_DENOMINATOR && ka.percent != null ? ka.percent : -1;
        bv = kb.denominator >= MIN_DENOMINATOR && kb.percent != null ? kb.percent : -1;
      } else {
        av = a[sortKey] as number;
        bv = b[sortKey] as number;
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" || key === "rank" ? "asc" : "desc");
    }
  }

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (!data) return <AppShell><ErrorMessage message="No data" /></AppShell>;

  const meta = data.meta;
  const snapshotAgeDays = meta.first_snapshot_at
    ? Math.floor((meta.now - meta.first_snapshot_at) / DAY_MS)
    : 0;
  const ready30 = snapshotAgeDays >= 30;
  const ready60 = snapshotAgeDays >= 60;
  const ready90 = snapshotAgeDays >= 90;

  const columns: Array<{
    key: SortKey;
    label: string;
    align: "left" | "right";
    tooltip?: string;
  }> = [
    { key: "rank", label: "#", align: "right", tooltip: "Game rank" },
    { key: "name", label: "Alliance", align: "left" },
    { key: "active_members", label: "Active", align: "right", tooltip: "Currently observed members" },
    { key: "recruits_7d", label: "7d", align: "right", tooltip: "Joined in last 7 days" },
    { key: "recruits_30d", label: "30d", align: "right", tooltip: "Joined in last 30 days" },
    { key: "recruits_60d", label: "60d", align: "right", tooltip: "Joined in last 60 days" },
    { key: "recruits_90d", label: "90d", align: "right", tooltip: "Joined in last 90 days" },
    { key: "retention_30d", label: "Ret 30d", align: "right", tooltip: "% of recruits still in alliance 30 days after joining" },
    { key: "retention_60d", label: "Ret 60d", align: "right", tooltip: "% of recruits still in alliance 60 days after joining" },
    { key: "retention_90d", label: "Ret 90d", align: "right", tooltip: "% of recruits still in alliance 90 days after joining" },
  ];

  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-white">Recruitment Leaderboard</h2>
          <p className="text-slate-400 text-sm">
            Alliances ranked by recent recruitment. Retention shows the share of recruits still in the alliance 30/60/90 days after joining.
          </p>
        </div>

        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-3 text-xs text-slate-400 flex items-start gap-2">
          <Info size={14} className="text-blue-400 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <div>
              Last sync: <span className="text-slate-200">{fmtDate(meta.last_synced_at)}</span>
              {meta.status === "syncing" && <span className="ml-2 text-amber-400">(syncing…)</span>}
              {meta.status === "error" && <span className="ml-2 text-rose-400">(error: {meta.error})</span>}
              {" · "}Tracking since <span className="text-slate-200">{fmtDate(meta.first_snapshot_at)}</span>
              {" · "}<span className="text-slate-200">{meta.nations_scanned.toLocaleString()}</span> alliance members observed across <span className="text-slate-200">{meta.alliances_scanned.toLocaleString()}</span> alliances
            </div>
            {(!ready30 || !ready60 || !ready90) && (
              <div className="text-amber-400/80">
                Retention data is still accumulating ({snapshotAgeDays} day{snapshotAgeDays === 1 ? "" : "s"} of snapshots).
                {!ready30 && " 30d retention available in " + (30 - snapshotAgeDays) + " day(s)."}
                {!ready60 && " 60d retention in " + (60 - snapshotAgeDays) + " day(s)."}
                {!ready90 && " 90d retention in " + (90 - snapshotAgeDays) + " day(s)."}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-slate-400 text-sm">
            {sorted.length} alliance{sorted.length === 1 ? "" : "s"} with recruitment activity
          </p>
          <ExportButton
            filename="recruitment-leaderboard"
            getData={() =>
              sorted.map((r) => ({
                Rank: r.rank ?? "",
                Alliance: r.name,
                Acronym: r.acronym ?? "",
                "Active Members": r.active_members,
                "Recruits 7d": r.recruits_7d,
                "Recruits 30d": r.recruits_30d,
                "Recruits 60d": r.recruits_60d,
                "Recruits 90d": r.recruits_90d,
                "Retention 30d": r.retention_30d.percent != null ? `${(r.retention_30d.percent * 100).toFixed(1)}%` : "",
                "Retention 30d (n)": r.retention_30d.denominator,
                "Retention 60d": r.retention_60d.percent != null ? `${(r.retention_60d.percent * 100).toFixed(1)}%` : "",
                "Retention 60d (n)": r.retention_60d.denominator,
                "Retention 90d": r.retention_90d.percent != null ? `${(r.retention_90d.percent * 100).toFixed(1)}%` : "",
                "Retention 90d (n)": r.retention_90d.denominator,
              }))
            }
          />
        </div>

        {sorted.length === 0 ? (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-8 text-center text-slate-400">
            No recruitment data yet. The first daily snapshot will populate this page.
          </div>
        ) : (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#2a3150]">
                  {columns.map(({ key, label, align, tooltip }) => {
                    const active = sortKey === key;
                    const isLeft = align === "left";
                    return (
                      <th
                        key={key}
                        onClick={() => handleSort(key)}
                        title={tooltip}
                        className={`px-3 py-3 text-xs font-medium cursor-pointer select-none group ${isLeft ? "text-left" : "text-right"}`}
                      >
                        <span
                          className={`flex items-center ${isLeft ? "" : "justify-end"} gap-1 ${
                            active ? "text-amber-400" : "text-slate-400 group-hover:text-slate-200"
                          }`}
                        >
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
                {sorted.map((r) => {
                  const r30 = pctText(r.retention_30d, "30 days", ready30);
                  const r60 = pctText(r.retention_60d, "60 days", ready60);
                  const r90 = pctText(r.retention_90d, "90 days", ready90);
                  return (
                    <tr key={r.id} className="border-b border-[#1e2540] hover:bg-[#1a2035] transition-colors">
                      <td className="px-3 py-2.5 text-right text-slate-500 text-xs">{r.rank ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <a
                          href={`https://politicsandwar.com/alliance/id=${r.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-white font-medium hover:text-blue-400 transition-colors block"
                        >
                          {r.name}
                        </a>
                        {r.acronym && <div className="text-xs text-slate-500">{r.acronym}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-300">{r.active_members.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right text-slate-300">{r.recruits_7d.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right text-slate-200 font-medium">{r.recruits_30d.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right text-slate-300">{r.recruits_60d.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right text-slate-300">{r.recruits_90d.toLocaleString()}</td>
                      <td className={`px-3 py-2.5 text-right font-medium ${r30.tone}`} title={r30.title}>{r30.text}</td>
                      <td className={`px-3 py-2.5 text-right font-medium ${r60.tone}`} title={r60.title}>{r60.text}</td>
                      <td className={`px-3 py-2.5 text-right font-medium ${r90.tone}`} title={r90.title}>{r90.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
