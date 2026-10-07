"use client";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { fetchMembers, fetchDiscordLinks, fetchSyncStatus, fetchStagnantCitiesConfig } from "@/lib/pnw";
import { STAGNANT_DEFAULTS } from "@/lib/stagnant-config";
import { findStagnantNations, taxBracketId } from "@/lib/city-stagnation";
import { ArrowUpDown } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { ExportButton } from "@/components/ExportButton";

interface FilterDraft {
  minTurns?: string;
  minCities?: string;
  maxCities?: string;
  taxIds?: number[];
  excludedCities?: number[];
}

const MAX_CITY_CHIPS = 100;

type SortKey = "nation_name" | "num_cities" | "turnsSinceCity" | "bracket";

export default function StagnantCitiesPage() {
  // Filters start from the saved defaults; anything the user changes is kept in `draft`.
  const [draft, setDraft] = useState<FilterDraft>({});
  const [sortKey, setSortKey] = useState<SortKey>("num_cities");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const { data: config = STAGNANT_DEFAULTS, isLoading: configLoading } = useQuery({
    queryKey: ["stagnantCitiesConfig"],
    queryFn: fetchStagnantCitiesConfig,
  });
  const minTurns = draft.minTurns ?? String(config.min_turns);
  const minCities = draft.minCities ?? (config.min_cities === null ? "" : String(config.min_cities));
  const maxCities = draft.maxCities ?? (config.max_cities === null ? "" : String(config.max_cities));
  const selectedTaxIds = draft.taxIds ?? config.tax_ids;
  const excludedCities = draft.excludedCities ?? config.excluded_cities;

  const { data: members = [], isLoading, error } = useQuery({
    queryKey: ["members"],
    queryFn: fetchMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: discordLinks = {} } = useQuery({ queryKey: ["discordLinks"], queryFn: fetchDiscordLinks, refetchInterval: 10 * 60 * 1000 });
  const { data: status } = useQuery({ queryKey: ["syncStatus"], queryFn: fetchSyncStatus, refetchInterval: 15_000 });

  const showAllianceTag = new Set(members.map(m => m.alliance_name).filter(Boolean)).size > 1;

  const taxIdOptions = useMemo(
    () => [...new Set([...config.tax_ids, ...members.map(taxBracketId).filter((id): id is number => id !== null)])].sort((a, b) => a - b),
    [members, config.tax_ids],
  );

  function toggleTaxId(id: number) {
    setDraft(prev => {
      const current = prev.taxIds ?? config.tax_ids;
      return { ...prev, taxIds: current.includes(id) ? current.filter(x => x !== id) : [...current, id] };
    });
  }

  function toggleCity(count: number) {
    setDraft(prev => {
      const current = prev.excludedCities ?? config.excluded_cities;
      return { ...prev, excludedCities: current.includes(count) ? current.filter(x => x !== count) : [...current, count] };
    });
  }

  const stagnant = useMemo(() => {
    const threshold = parseInt(minTurns, 10);
    return findStagnantNations(members, Number.isNaN(threshold) ? config.min_turns : threshold);
  }, [members, minTurns, config.min_turns]);

  const lo = parseInt(minCities, 10);
  const hi = parseInt(maxCities, 10);

  // One toggle per city count in the range. With an open-ended range, only counts that exist are offered.
  const cityOptions = useMemo(() => {
    const present = [...new Set(stagnant.map(m => m.num_cities))].sort((a, b) => a - b);
    if (!Number.isNaN(lo) && !Number.isNaN(hi)) {
      return Array.from({ length: Math.max(0, Math.min(hi - lo + 1, MAX_CITY_CHIPS)) }, (_, i) => lo + i);
    }
    return present.filter(c => (Number.isNaN(lo) || c >= lo) && (Number.isNaN(hi) || c <= hi)).slice(0, MAX_CITY_CHIPS);
  }, [stagnant, lo, hi]);

  const rows = useMemo(() => {
    const found = stagnant
      .filter(m => (Number.isNaN(lo) || m.num_cities >= lo) && (Number.isNaN(hi) || m.num_cities <= hi))
      .filter(m => !excludedCities.includes(m.num_cities))
      .filter(m => selectedTaxIds.length === 0 || selectedTaxIds.includes(taxBracketId(m) ?? -1));
    return [...found].sort((a, b) => {
      const av = sortKey === "nation_name" ? a.nation_name : sortKey === "bracket" ? taxBracketId(a) ?? 0 : a[sortKey];
      const bv = sortKey === "nation_name" ? b.nation_name : sortKey === "bracket" ? taxBracketId(b) ?? 0 : b[sortKey];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      const dir = sortDir === "asc" ? cmp : -cmp;
      return dir || b.turnsSinceCity - a.turnsSinceCity;
    });
  }, [stagnant, lo, hi, excludedCities, selectedTaxIds, sortKey, sortDir]);

  if (isLoading || configLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (members.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  const columns: { key: SortKey; label: string }[] = [
    { key: "nation_name", label: "Nation" },
    { key: "num_cities", label: "Cities" },
    { key: "bracket", label: "Tax ID" },
    { key: "turnsSinceCity", label: "Turns Since Last City" },
  ];

  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-white">Stagnant Cities</h2>
          <p className="text-slate-400 text-sm">Nations that have gone more than the set number of turns (2 hours each) without building a city</p>
        </div>

        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-400">Minimum turns since last city</label>
              <input
                type="number"
                min="0"
                value={minTurns}
                onChange={e => setDraft(prev => ({ ...prev, minTurns: e.target.value }))}
                className="w-full bg-[#0f1117] border border-[#2a3150] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-400">Min cities</label>
              <input
                type="number"
                min="0"
                placeholder="any" value={minCities}
                onChange={e => setDraft(prev => ({ ...prev, minCities: e.target.value }))}
                className="w-full bg-[#0f1117] border border-[#2a3150] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-slate-400">Max cities</label>
              <input
                type="number"
                min="0"
                placeholder="any" value={maxCities}
                onChange={e => setDraft(prev => ({ ...prev, maxCities: e.target.value }))}
                className="w-full bg-[#0f1117] border border-[#2a3150] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          {cityOptions.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs font-medium text-slate-400">Cities included</span>
                <span className="text-xs text-slate-500">
                  {excludedCities.some(c => cityOptions.includes(c))
                    ? `${cityOptions.filter(c => excludedCities.includes(c)).length} left out`
                    : "all"}
                </span>
                {excludedCities.length > 0 && (
                  <button
                    onClick={() => setDraft(prev => ({ ...prev, excludedCities: [] }))}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Include all
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {cityOptions.map(count => {
                  const excluded = excludedCities.includes(count);
                  return (
                    <button
                      key={count}
                      onClick={() => toggleCity(count)}
                      aria-pressed={!excluded}
                      className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${
                        excluded
                          ? "bg-[#0f1117] border-[#2a3150] text-slate-600 line-through hover:text-slate-400"
                          : "bg-blue-500/20 border-blue-500 text-blue-300"
                      }`}
                    >
                      {count}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {taxIdOptions.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs font-medium text-slate-400">Tax ID</span>
                <span className="text-xs text-slate-500">
                  {selectedTaxIds.length === 0 ? "all" : `${selectedTaxIds.length} selected`}
                </span>
                {selectedTaxIds.length > 0 && (
                  <button
                    onClick={() => setDraft(prev => ({ ...prev, taxIds: [] }))}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {taxIdOptions.map(id => {
                  const on = selectedTaxIds.includes(id);
                  return (
                    <button
                      key={id}
                      onClick={() => toggleTaxId(id)}
                      aria-pressed={on}
                      className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${
                        on
                          ? "bg-blue-500/20 border-blue-500 text-blue-300"
                          : "bg-[#0f1117] border-[#2a3150] text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {id}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-slate-400 text-sm">{rows.length} nation{rows.length !== 1 ? "s" : ""} matched</p>
          <ExportButton
            filename="stagnant-cities"
            label="Export Excel"
            getData={() => rows.map(m => ({
              Nation: m.nation_name,
              Alliance: m.alliance_name ?? "",
              Leader: m.leader_name,
              Discord: discordLinks[String(m.id)]?.username ?? "",
              Cities: m.num_cities,
              "Tax ID": taxBracketId(m) ?? "",
              "Turns Since Last City": m.turnsSinceCity,
              "Days Since Last City": Math.floor(m.turnsSinceCity / 12),
            }))}
          />
        </div>

        {rows.length === 0 ? (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-8 text-center text-slate-400">
            No nations match.
          </div>
        ) : (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#2a3150]">
                  {columns.map(({ key, label }) => {
                    const isLeft = key === "nation_name";
                    const active = sortKey === key;
                    return (
                      <th
                        key={key}
                        onClick={() => handleSort(key)}
                        className={`px-3 py-3 text-xs font-medium cursor-pointer select-none group ${isLeft ? "text-left" : "text-right"}`}
                      >
                        <span className={`flex items-center ${isLeft ? "" : "justify-end"} gap-1 ${active ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`}>
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
                {rows.map(m => (
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
                      {showAllianceTag && m.alliance_name && (
                        <div className="text-xs text-sky-400">{m.alliance_name}</div>
                      )}
                      {discordLinks[String(m.id)] && (
                        <div className="text-xs text-indigo-400">{discordLinks[String(m.id)].username}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{m.num_cities}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{taxBracketId(m) ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-amber-400">
                      {m.turnsSinceCity.toLocaleString()}
                      <span className="text-xs text-slate-500 ml-1">({Math.floor(m.turnsSinceCity / 12)}d)</span>
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
