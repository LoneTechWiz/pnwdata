"use client";
import { useState, useMemo, useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { ShieldOff, ChevronUp, ChevronDown, ChevronsUpDown, Swords } from "lucide-react";
import type { BeigeNation, BeigeWatchResponse } from "@/app/api/beigeWatch/route";

type SortKey = keyof BeigeNation;
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
  { key: "beige_turns", label: "Beige Turns" },
  { key: "inRange", label: "In Range" },
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

export default function BeigeWatchPage() {
  const [nationIdInput, setNationIdInput] = useState("");
  const [maxBeigeTurns, setMaxBeigeTurns] = useState("");
  const [minCities, setMinCities] = useState("");
  const [maxCities, setMaxCities] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BeigeWatchResponse | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("beige_turns");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Single useMemo for filter + sort — MUST be before any conditional early returns
  const displayedNations = useMemo(() => {
    if (!result) return [];
    let nations = [...result.nations];

    // Client-side filters
    if (maxBeigeTurns !== "") {
      const max = Number(maxBeigeTurns);
      if (Number.isFinite(max)) nations = nations.filter(n => n.beige_turns <= max);
    }
    if (minCities !== "") {
      const min = Number(minCities);
      if (Number.isFinite(min)) nations = nations.filter(n => n.num_cities >= min);
    }
    if (maxCities !== "") {
      const max = Number(maxCities);
      if (Number.isFinite(max)) nations = nations.filter(n => n.num_cities <= max);
    }

    // Sort
    return nations.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];

      // Special-case inRange (boolean | null) — must come before generic null guards
      if (sortKey === "inRange") {
        const toNum = (v: unknown) => v === true ? 1 : v === false ? 0 : -1;
        const cmp = toNum(av) - toNum(bv);
        return sortDir === "asc" ? cmp : -cmp;
      }

      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      const cmp = typeof av === "string"
        ? (av as string).localeCompare(bv as string)
        : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [result, sortKey, sortDir, maxBeigeTurns, minCities, maxCities]);

  // Single useEffect on mount
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("nationId");
    if (id && Number.isInteger(Number(id)) && Number(id) > 0) {
      setNationIdInput(id);
      fetchNations(Number(id));
    } else {
      fetchNations(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  async function fetchNations(id: number | null) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const url = id != null ? `/api/beigeWatch?nationId=${id}` : "/api/beigeWatch";
      const res = await fetch(url);
      if (!res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        const data = ct.includes("application/json") ? await res.json() : null;
        setError(data?.error ?? `Server error (${res.status})`);
      } else {
        setResult(await res.json() as BeigeWatchResponse);
      }
    } catch {
      setError("Network error — check your connection");
    } finally {
      setLoading(false);
    }
  }

  function handleLoad() {
    const id = nationIdInput ? Number(nationIdInput) : null;
    if (nationIdInput && (!Number.isInteger(id) || (id as number) <= 0)) {
      setError("Please enter a valid nation ID");
      return;
    }
    fetchNations(id);
  }

  const showInRange = !!result?.yourScore;

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldOff size={20} className="text-amber-400" />
            Beige Watch
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Enemy nations currently on beige — sorted by turns remaining
          </p>
        </div>

        {/* Inputs bar */}
        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <label htmlFor="nation-id-input" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Your Nation ID
              </label>
              {result?.yourLeader && (
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
              onKeyDown={e => e.key === "Enter" && handleLoad()}
              placeholder="optional"
              className="w-32 bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="max-beige-input" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Max Beige Turns
            </label>
            <input
              id="max-beige-input"
              type="number"
              min={1}
              value={maxBeigeTurns}
              onChange={e => setMaxBeigeTurns(e.target.value)}
              placeholder="any"
              className="w-28 bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="min-cities-input" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Min Cities
            </label>
            <input
              id="min-cities-input"
              type="number"
              min={1}
              value={minCities}
              onChange={e => setMinCities(e.target.value)}
              placeholder="any"
              className="w-24 bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="max-cities-input" className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
              Max Cities
            </label>
            <input
              id="max-cities-input"
              type="number"
              min={1}
              value={maxCities}
              onChange={e => setMaxCities(e.target.value)}
              placeholder="any"
              className="w-24 bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            onClick={handleLoad}
            disabled={loading}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
          >
            <ShieldOff size={14} />
            Load
          </button>
        </div>

        {/* Score range banner */}
        {result?.yourScore != null && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl px-4 py-3 text-sm text-slate-300">
            Score: <strong className="text-white">{fmt(Math.round(result.yourScore))}</strong>
            <span className="mx-3 text-slate-500">→</span>
            Attack range: <strong className="text-green-400">{fmt(result.minScore!)}</strong>
            <span className="mx-1 text-slate-500">–</span>
            <strong className="text-red-400">{fmt(result.maxScore!)}</strong>
            <span className="ml-4 text-slate-400">({displayedNations.length} nations shown)</span>
          </div>
        )}

        {/* Result count — shown when no nationId (score banner not visible) */}
        {!loading && result && !result.yourScore && displayedNations.length > 0 && (
          <p className="text-sm text-slate-400">
            {displayedNations.length} nation{displayedNations.length === 1 ? "" : "s"} on beige
          </p>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-xl px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Empty — server returned no beige nations */}
        {!loading && result && result.nations.length === 0 && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <ShieldOff size={40} className="text-slate-600 mx-auto mb-3" />
            <p className="text-white font-medium">No nations are currently on beige</p>
            <p className="text-slate-400 text-sm mt-1">No enemy nations are currently protected by beige</p>
          </div>
        )}

        {/* Empty — filters eliminated all results */}
        {!loading && result && result.nations.length > 0 && displayedNations.length === 0 && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <ShieldOff size={40} className="text-slate-600 mx-auto mb-3" />
            <p className="text-white font-medium">No nations match your filters</p>
            <p className="text-slate-400 text-sm mt-1">Try loosening the beige turns or city count filters</p>
          </div>
        )}

        {/* Results table */}
        {!loading && displayedNations.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-[#2a3150]">
            <table className="w-full text-sm">
              <thead className="bg-[#161b2e] border-b border-[#2a3150]">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap"></th>
                  {COLUMNS.map(({ key, label }) => {
                    if (key === "inRange" && !showInRange) return null;
                    return (
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
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a3150]">
                {displayedNations.map(n => (
                  <tr key={n.id} className="bg-[#161b2e] hover:bg-[#1e2540] transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <a
                        href={`https://politicsandwar.com/nation/war/declare/id=${n.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 bg-red-700/80 hover:bg-red-600 text-white text-xs font-semibold rounded transition-colors"
                      >
                        <Swords size={11} />
                        War
                      </a>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <a
                        href={`https://politicsandwar.com/nation/id=${n.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 font-medium"
                      >
                        {n.nation_name}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{n.alliance_name}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`font-semibold ${n.beige_turns <= 6 ? "text-red-400" : "text-amber-400"}`}>
                        {n.beige_turns}
                      </span>
                    </td>
                    {showInRange && (
                      <td className="px-3 py-2">
                        {n.inRange === null ? null : (
                          <span
                            className={`inline-block w-2.5 h-2.5 rounded-full ${n.inRange ? "bg-green-500" : "bg-slate-600"}`}
                            title={n.inRange ? "In score range" : "Out of score range"}
                          />
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-slate-200 whitespace-nowrap">{fmt(Math.round(n.score))}</td>
                    <td className="px-3 py-2 text-slate-200">{n.num_cities}</td>
                    <td className="px-3 py-2 text-slate-200 font-medium">{fmt(n.avg_infra)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(n.soldiers)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(n.tanks)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(n.aircraft)}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(n.ships)}</td>
                    <td className="px-3 py-2 text-slate-200">{n.offensive_wars_count}</td>
                    <td className="px-3 py-2">
                      <span className={`font-medium ${n.defensive_wars_count >= 3 ? "text-orange-400" : "text-slate-200"}`}>
                        {n.defensive_wars_count}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {n.beige_loot != null ? (
                        <div>
                          <div className="text-green-400 font-medium">${fmt(Math.round(n.beige_loot))}</div>
                          {n.beige_date && <div className="text-slate-500 text-xs">{new Date(n.beige_date).toLocaleDateString()}</div>}
                        </div>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {n.beige_avg != null ? (
                        <div>
                          <div className="text-green-300 font-medium">${fmt(n.beige_avg)}</div>
                          <div className="text-slate-500 text-xs">{n.beige_count} war{n.beige_count === 1 ? "" : "s"}</div>
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
