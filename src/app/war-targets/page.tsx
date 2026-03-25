"use client";
import { useState, useMemo, useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Crosshair, ChevronUp, ChevronDown, ChevronsUpDown, Swords, Send } from "lucide-react";
import type { WarTarget, WarTargetsResponse } from "@/app/api/warTargets/route";

type SendStatus = "idle" | "sending" | "sent" | "error";

type SortKey = keyof WarTarget;
type SortDir = "asc" | "desc";

function fmt(n: number) {
  return n.toLocaleString();
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={12} className="text-slate-600" />;
  return sortDir === "asc"
    ? <ChevronUp size={12} className="text-blue-400" />
    : <ChevronDown size={12} className="text-blue-400" />;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "nation_name", label: "Nation" },
  { key: "alliance_name", label: "Alliance" },
  { key: "score", label: "Score" },
  { key: "num_cities", label: "Cities" },
  { key: "avg_infra", label: "Avg Infra" },
  { key: "soldiers", label: "Soldiers" },
  { key: "tanks", label: "Tanks" },
  { key: "aircraft", label: "Aircraft" },
  { key: "ships", label: "Ships" },
  { key: "offensive_wars_count", label: "Off Wars" },
  { key: "defensive_wars_count", label: "Def Wars" },
  { key: "beige_loot", label: "Beige Loot" },
  { key: "beige_avg", label: "Avg Beige" },
];

export default function WarTargetsPage() {
  const [nationIdInput, setNationIdInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WarTargetsResponse | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("avg_infra");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [canSendWarTargets, setCanSendWarTargets] = useState(false);
  const [sendStatuses, setSendStatuses] = useState<Record<number, SendStatus>>({});

  useEffect(() => {
    const urlId = new URLSearchParams(window.location.search).get("nationId");
    fetch("/api/auth/me")
      .then(r => r.ok ? r.json() : null)
      .then((me: { nationId?: number | null; canSendWarTargets?: boolean } | null) => {
        if (me?.canSendWarTargets) setCanSendWarTargets(true);
        if (urlId && Number.isInteger(Number(urlId)) && Number(urlId) > 0) {
          setNationIdInput(urlId);
          fetchTargets(Number(urlId));
          return;
        }
        if (me?.nationId) {
          setNationIdInput(String(me.nationId));
          fetchTargets(me.nationId);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // All useMemo calls before any conditional returns (Rules of Hooks)
  const sorted = useMemo(() => {
    if (!result) return [];
    return [...result.targets].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "string"
        ? (av as string).localeCompare(bv as string)
        : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [result, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  async function handleSend(target: WarTarget) {
    const nationId = Number(nationIdInput);
    setSendStatuses(s => ({ ...s, [target.id]: "sending" }));
    try {
      const res = await fetch("/api/warTargets/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nation_id: nationId, target }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      setSendStatuses(s => ({ ...s, [target.id]: "sent" }));
    } catch {
      setSendStatuses(s => ({ ...s, [target.id]: "error" }));
    }
  }

  async function fetchTargets(id: number) {
    setLoading(true);
    setError(null);
    setResult(null);
    setSendStatuses({});
    try {
      const res = await fetch(`/api/warTargets?nationId=${id}`);
      if (!res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        const data = ct.includes("application/json") ? await res.json() : null;
        setError(data?.error ?? `Server error (${res.status})`);
      } else {
        setResult(await res.json() as WarTargetsResponse);
      }
    } catch {
      setError("Network error — check your connection");
    } finally {
      setLoading(false);
    }
  }

  function handleFind() {
    const id = Number(nationIdInput);
    if (!Number.isInteger(id) || id <= 0) {
      setError("Please enter a valid nation ID");
      return;
    }
    fetchTargets(id);
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Crosshair size={20} className="text-red-400" />
            War Target Finder
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Find attackable nations in enemy alliances within your score range
          </p>
        </div>

        {/* Input */}
        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <label htmlFor="nation-id-input" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Your Nation ID
              </label>
              {result && (
                <span className="text-xs text-slate-300 font-medium">
                  {result.yourLeader}{result.yourDiscord ? <span className="text-slate-500 ml-1">{result.yourDiscord}</span> : null}
                </span>
              )}
            </div>
            <input
              id="nation-id-input"
              type="number"
              min={1}
              value={nationIdInput}
              onChange={e => setNationIdInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleFind()}
              placeholder="e.g. 12345"
              className="w-40 bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={handleFind}
            disabled={loading || !nationIdInput}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
          >
            <Crosshair size={14} />
            Find Targets
          </button>
        </div>

        {/* Score range banner */}
        {result && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl px-4 py-3 text-sm text-slate-300">
            Score: <strong className="text-white">{fmt(Math.round(result.yourScore))}</strong>
            <span className="mx-3 text-slate-500">→</span>
            Attack range: <strong className="text-green-400">{fmt(result.minScore)}</strong>
            <span className="mx-1 text-slate-500">–</span>
            <strong className="text-red-400">{fmt(result.maxScore)}</strong>
            <span className="ml-4 text-slate-400">({result.targets.length} targets found)</span>
          </div>
        )}

        {/* States */}
        {loading && (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-xl px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        {!loading && result && result.targets.length === 0 && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <Crosshair size={40} className="text-slate-600 mx-auto mb-3" />
            <p className="text-white font-medium">No attackable targets found</p>
            <p className="text-slate-400 text-sm mt-1">
              No enemy nations are within your score range ({fmt(result.minScore)} – {fmt(result.maxScore)})
            </p>
          </div>
        )}

        {!loading && !result && !error && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <Crosshair size={40} className="text-slate-600 mx-auto mb-3" />
            <p className="text-white font-medium">Enter your nation ID to find targets</p>
            <p className="text-slate-400 text-sm mt-1">
              Shows nations in enemy alliances within 75%–133% of your score
            </p>
          </div>
        )}

        {/* Results table */}
        {!loading && sorted.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-[#2a3150]">
            <table className="w-full text-sm">
              <thead className="bg-[#161b2e] border-b border-[#2a3150]">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap"></th>
                  {COLUMNS.map(({ key, label }) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      onKeyDown={e => (e.key === "Enter" || e.key === " ") && handleSort(key)}
                      tabIndex={0}
                      className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-white whitespace-nowrap select-none"
                    >
                      <span className="flex items-center gap-1">
                        {label}
                        <SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a3150]">
                {sorted.map(t => (
                  <tr key={t.id} className="bg-[#161b2e] hover:bg-[#1e2540] transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <a
                          href={`https://politicsandwar.com/nation/war/declare/id=${t.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 bg-red-700/80 hover:bg-red-600 text-white text-xs font-semibold rounded transition-colors"
                        >
                          <Swords size={11} />
                          War
                        </a>
                        {canSendWarTargets && result?.nationInAlliance && (() => {
                          const status = sendStatuses[t.id] ?? "idle";
                          return (
                            <button
                              onClick={() => handleSend(t)}
                              disabled={status === "sending" || status === "sent"}
                              title={status === "error" ? "Failed — click to retry" : "Send to nation via Discord DM"}
                              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded transition-colors disabled:cursor-not-allowed ${
                                status === "sent"
                                  ? "bg-green-700/80 text-white"
                                  : status === "error"
                                    ? "bg-orange-700/80 hover:bg-orange-600 text-white"
                                    : "bg-[#2a3150] hover:bg-[#3a4160] text-slate-300"
                              }`}
                            >
                              <Send size={10} className={status === "sending" ? "animate-pulse" : ""} />
                              {status === "sent" ? "Sent" : status === "error" ? "Retry" : "Send"}
                            </button>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <a
                        href={`https://politicsandwar.com/nation/id=${t.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 font-medium"
                      >
                        {t.nation_name}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{t.alliance_name}</td>
                    <td className="px-3 py-2 text-slate-200 whitespace-nowrap">{fmt(Math.round(t.score))}</td>
                    <td className="px-3 py-2 text-slate-200">{t.num_cities}</td>
                    <td className="px-3 py-2 text-slate-200 font-medium">{fmt(t.avg_infra)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(t.soldiers)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(t.tanks)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(t.aircraft)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(t.ships)}</td>
                    <td className="px-3 py-2 text-slate-200">{t.offensive_wars_count}</td>
                    <td className="px-3 py-2">
                      <span className={`font-medium ${t.defensive_wars_count >= 3 ? "text-orange-400" : "text-slate-200"}`}>
                        {t.defensive_wars_count}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {t.beige_loot != null ? (
                        <div>
                          <div className="text-green-400 font-medium">${fmt(Math.round(t.beige_loot))}</div>
                          {t.beige_date && <div className="text-slate-500 text-xs">{new Date(t.beige_date).toLocaleDateString()}</div>}
                        </div>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {t.beige_avg != null ? (
                        <div>
                          <div className="text-green-300 font-medium">${fmt(t.beige_avg)}</div>
                          <div className="text-slate-500 text-xs">{t.beige_count} war{t.beige_count === 1 ? "" : "s"}</div>
                        </div>
                      ) : <span className="text-slate-600">—</span>}
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
