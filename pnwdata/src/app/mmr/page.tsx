"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMembers, fetchBknetMembers, fetchSyncStatus } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { CheckCircle, XCircle, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { ExportButton } from "@/components/ExportButton";

interface MmrInputs {
  barracks: number;
  factories: number;
  hangars: number;
  dockyards: number;
}

function NumberInput({
  label,
  value,
  max,
  onChange,
  color,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
  color: string;
}) {
  return (
    <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 flex flex-col gap-2">
      <label className={`text-xs font-semibold uppercase tracking-wide ${color}`}>{label}</label>
      <div className="flex items-center gap-2">
        <button
          className="w-8 h-8 rounded-lg bg-[#1e2540] text-slate-300 hover:bg-[#2a3150] text-lg font-bold flex items-center justify-center"
          onClick={() => onChange(Math.max(0, value - 1))}
        >−</button>
        <input
          type="number"
          min={0}
          max={max}
          value={value}
          onChange={e => onChange(Math.min(max, Math.max(0, Number(e.target.value))))}
          className="w-16 text-center bg-[#0f1117] border border-[#2a3150] rounded-lg text-white text-lg font-bold py-1 focus:outline-none focus:border-blue-500"
        />
        <button
          className="w-8 h-8 rounded-lg bg-[#1e2540] text-slate-300 hover:bg-[#2a3150] text-lg font-bold flex items-center justify-center"
          onClick={() => onChange(Math.min(max, value + 1))}
        >+</button>
      </div>
      <span className="text-xs text-slate-500">max {max} per city</span>
    </div>
  );
}

function pct(current: number, max: number) {
  if (max === 0) return 100;
  return Math.min(100, Math.round((current / max) * 100));
}

function UnitCell({ current, max }: { current: number; max: number }) {
  const atMax = max === 0 || current >= max;
  const p = pct(current, max);
  return (
    <td className="px-3 py-2 text-right">
      <div className="flex flex-col items-end gap-0.5">
        <div className="flex items-center gap-1">
          {atMax
            ? <CheckCircle size={12} className="text-green-400" />
            : <XCircle size={12} className="text-red-400" />}
          <span className={atMax ? "text-green-400 font-semibold" : "text-slate-300"}>
            {current.toLocaleString()}
          </span>
        </div>
        {max > 0 && (
          <span className="text-xs text-slate-500">/ {max.toLocaleString()} ({p}%)</span>
        )}
      </div>
    </td>
  );
}

type SortField = "nation" | "cities" | "soldiers" | "tanks" | "aircraft" | "ships" | "spies" | "status";

export default function MmrPage() {
  const [mmr, setMmr] = useState<MmrInputs>({ barracks: 5, factories: 5, hangars: 5, dockyards: 3 });
  const [filter, setFilter] = useState<"all" | "maxed" | "not-maxed">("all");
  const [cityMin, setCityMin] = useState("");
  const [cityMax, setCityMax] = useState("");
  const [sortField, setSortField] = useState<SortField>("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const { data: allMembers = [], isLoading, error } = useQuery({
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

  const members = allMembers.filter(m => m.vacation_mode_turns === 0);

  // Build spy map: nation_id (string) -> { spies, hasIA }
  const spyMap = useMemo(() => {
    const map = new Map<string, { spies: number; hasIA: boolean }>();
    for (const bm of bknetMembers) {
      map.set(String(bm.nation.id), {
        spies: bm.nation.military?.spies ?? 0,
        hasIA: bm.nation.projects?.intelligence_agency === true,
      });
    }
    return map;
  }, [bknetMembers]);

  const rows = useMemo(() => members.map(m => {
    const c = m.num_cities;
    const maxSoldiers = mmr.barracks * 3000 * c;
    const maxTanks = mmr.factories * 250 * c;
    const maxAircraft = mmr.hangars * 15 * c;
    const maxShips = mmr.dockyards * 5 * c;

    const spyData = spyMap.get(String(m.id));
    const currentSpies = spyData?.spies ?? 0;
    const hasIA = spyData?.hasIA ?? false;
    const maxSpies = hasIA ? 60 : 50;
    const hasBknet = spyMap.has(String(m.id));

    const soldierOk = m.soldiers >= maxSoldiers;
    const tankOk = m.tanks >= maxTanks;
    const aircraftOk = m.aircraft >= maxAircraft;
    const shipOk = mmr.dockyards === 0 || m.ships >= maxShips;
    const spiesOk = !hasBknet || currentSpies >= maxSpies;
    const allMaxed = soldierOk && tankOk && aircraftOk && shipOk && spiesOk;

    return {
      m, maxSoldiers, maxTanks, maxAircraft, maxShips,
      currentSpies, maxSpies, hasIA, hasBknet,
      soldierOk, tankOk, aircraftOk, shipOk, spiesOk, allMaxed,
    };
  }), [members, mmr, spyMap]);

  // City-filtered rows — used for counts, avg days, and as base for table
  const cityRows = useMemo(() => {
    const minC = cityMin !== "" ? Number(cityMin) : -Infinity;
    const maxC = cityMax !== "" ? Number(cityMax) : Infinity;
    return rows.filter(r => r.m.num_cities >= minC && r.m.num_cities <= maxC);
  }, [rows, cityMin, cityMax]);

  const filtered = useMemo(() => {
    const base = cityRows.filter(r => {
      if (filter === "maxed") return r.allMaxed;
      if (filter === "not-maxed") return !r.allMaxed;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      switch (sortField) {
        case "nation":   return dir * a.m.nation_name.localeCompare(b.m.nation_name);
        case "cities":   return dir * (a.m.num_cities - b.m.num_cities);
        case "soldiers": return dir * (a.m.soldiers - b.m.soldiers);
        case "tanks":    return dir * (a.m.tanks - b.m.tanks);
        case "aircraft": return dir * (a.m.aircraft - b.m.aircraft);
        case "ships":    return dir * (a.m.ships - b.m.ships);
        case "spies":    return dir * (a.currentSpies - b.currentSpies);
        case "status":   return dir * (Number(a.allMaxed) - Number(b.allMaxed));
        default:         return 0;
      }
    });
  }, [cityRows, filter, sortField, sortDir]);

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (allMembers.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  const maxedCount = cityRows.filter(r => r.allMaxed).length;

  // Per-type counts (from city-filtered rows)
  const soldierMaxed = cityRows.filter(r => r.soldierOk || mmr.barracks === 0).length;
  const tankMaxed    = cityRows.filter(r => r.tankOk    || mmr.factories === 0).length;
  const aircraftMaxed = cityRows.filter(r => r.aircraftOk || mmr.hangars === 0).length;
  const shipMaxed    = cityRows.filter(r => r.shipOk    || mmr.dockyards === 0).length;
  const spiesMaxed   = cityRows.filter(r => r.spiesOk).length;
  const hasBknetData = bknetMembers.length > 0;

  // Average days to max (from city-filtered, non-maxed members)
  type Row = typeof rows[0];
  function avgDays(
    getNeeded: (r: Row) => number,
    getDailyRate: (r: Row) => number,
    isOk: (r: Row) => boolean,
  ): string {
    const notMaxed = cityRows.filter(r => !isOk(r));
    if (notMaxed.length === 0) return "—";
    const total = notMaxed.reduce((sum, r) => {
      const needed = getNeeded(r);
      const rate = getDailyRate(r);
      return sum + (rate > 0 ? Math.ceil(needed / rate) : 0);
    }, 0);
    const avg = total / notMaxed.length;
    return avg < 1 ? "<1" : avg.toFixed(1);
  }

  const avgDaysSoldiers = avgDays(
    r => Math.max(0, r.maxSoldiers - r.m.soldiers),
    r => mmr.barracks * 3000 * r.m.num_cities,
    r => r.soldierOk,
  );
  const avgDaysTanks = avgDays(
    r => Math.max(0, r.maxTanks - r.m.tanks),
    r => mmr.factories * 250 * r.m.num_cities,
    r => r.tankOk,
  );
  const avgDaysAircraft = avgDays(
    r => Math.max(0, r.maxAircraft - r.m.aircraft),
    r => mmr.hangars * 5 * r.m.num_cities,
    r => r.aircraftOk,
  );
  const avgDaysShips = avgDays(
    r => Math.max(0, r.maxShips - r.m.ships),
    r => mmr.dockyards * 1 * r.m.num_cities,
    r => r.shipOk,
  );
  const avgDaysSpies = avgDays(
    r => Math.max(0, r.maxSpies - r.currentSpies),
    () => 2, // 2 spies trainable per day
    r => r.spiesOk,
  );

  const tableTotal = cityRows.length;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white">MMR Checker</h2>
          <p className="text-slate-400 text-sm">Set buildings per city to check who is at max units</p>
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <NumberInput label="Barracks" value={mmr.barracks} max={5} color="text-green-400"
            onChange={v => setMmr(p => ({ ...p, barracks: v }))} />
          <NumberInput label="War Factories" value={mmr.factories} max={5} color="text-orange-400"
            onChange={v => setMmr(p => ({ ...p, factories: v }))} />
          <NumberInput label="Hangars" value={mmr.hangars} max={5} color="text-blue-400"
            onChange={v => setMmr(p => ({ ...p, hangars: v }))} />
          <NumberInput label="Dockyards" value={mmr.dockyards} max={3} color="text-cyan-400"
            onChange={v => setMmr(p => ({ ...p, dockyards: v }))} />
        </div>

        {/* Per-type stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: "Soldiers", count: soldierMaxed, days: avgDaysSoldiers, color: "text-green-400",  border: "border-green-400/20" },
            { label: "Tanks",    count: tankMaxed,    days: avgDaysTanks,    color: "text-orange-400", border: "border-orange-400/20" },
            { label: "Aircraft", count: aircraftMaxed, days: avgDaysAircraft, color: "text-blue-400",  border: "border-blue-400/20" },
            { label: "Ships",    count: shipMaxed,    days: avgDaysShips,    color: "text-cyan-400",   border: "border-cyan-400/20" },
            { label: "Spies",    count: spiesMaxed,   days: hasBknetData ? avgDaysSpies : "—", color: "text-violet-400", border: "border-violet-400/20" },
          ].map(({ label, count, days, color, border }) => (
            <div key={label} className={`bg-[#161b2e] border ${border} rounded-xl p-4`}>
              <p className={`text-xs font-semibold uppercase tracking-wide ${color} mb-2`}>{label}</p>
              <p className="text-2xl font-bold text-white">
                {count}<span className="text-slate-500 text-base font-normal">/{tableTotal}</span>
              </p>
              <p className="text-xs text-slate-500 mt-0.5">at max</p>
              <div className="mt-3 pt-3 border-t border-[#2a3150]">
                <p className="text-xs text-slate-400">Avg days to max</p>
                <p className={`text-lg font-semibold ${days === "—" ? "text-slate-500" : color}`}>{days}</p>
              </div>
            </div>
          ))}
        </div>

        {/* City range filter */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-medium text-slate-400">City range:</span>
          <input
            type="number"
            min={1}
            placeholder="Min"
            value={cityMin}
            onChange={e => setCityMin(e.target.value)}
            className="w-20 bg-[#161b2e] border border-[#2a3150] rounded-lg text-sm text-white px-2 py-1 focus:outline-none focus:border-blue-500 placeholder-slate-600"
          />
          <span className="text-slate-500 text-xs">–</span>
          <input
            type="number"
            min={1}
            placeholder="Max"
            value={cityMax}
            onChange={e => setCityMax(e.target.value)}
            className="w-20 bg-[#161b2e] border border-[#2a3150] rounded-lg text-sm text-white px-2 py-1 focus:outline-none focus:border-blue-500 placeholder-slate-600"
          />
          {(cityMin !== "" || cityMax !== "") && (
            <button
              onClick={() => { setCityMin(""); setCityMax(""); }}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Summary + filter */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-green-400 font-semibold">{maxedCount} fully maxed</span>
            <span className="text-red-400 font-semibold">{tableTotal - maxedCount} not maxed</span>
            <span className="text-slate-500">of {tableTotal} shown</span>
          </div>
          <div className="flex items-center gap-2">
            <ExportButton
              filename="mmr-check"
              getData={() => filtered.map(r => ({
                Nation: r.m.nation_name,
                Leader: r.m.leader_name,
                Cities: r.m.num_cities,
                Soldiers: r.m.soldiers,
                "Max Soldiers": r.maxSoldiers,
                "Soldiers %": r.maxSoldiers > 0 ? Math.round(r.m.soldiers / r.maxSoldiers * 100) : 100,
                Tanks: r.m.tanks,
                "Max Tanks": r.maxTanks,
                "Tanks %": r.maxTanks > 0 ? Math.round(r.m.tanks / r.maxTanks * 100) : 100,
                Aircraft: r.m.aircraft,
                "Max Aircraft": r.maxAircraft,
                "Aircraft %": r.maxAircraft > 0 ? Math.round(r.m.aircraft / r.maxAircraft * 100) : 100,
                Ships: r.m.ships,
                "Max Ships": r.maxShips,
                "Ships %": r.maxShips > 0 ? Math.round(r.m.ships / r.maxShips * 100) : 100,
                Spies: r.hasBknet ? r.currentSpies : "",
                "Max Spies": r.hasBknet ? r.maxSpies : "",
                "Has IA": r.hasBknet ? (r.hasIA ? "Yes" : "No") : "",
                "Soldiers OK": r.soldierOk ? "Yes" : "No",
                "Tanks OK": r.tankOk ? "Yes" : "No",
                "Aircraft OK": r.aircraftOk ? "Yes" : "No",
                "Ships OK": r.shipOk ? "Yes" : "No",
                "Spies OK": r.hasBknet ? (r.spiesOk ? "Yes" : "No") : "",
                Status: r.allMaxed ? "Maxed" : "Low",
              }))}
            />
            <div className="flex gap-1 bg-[#161b2e] border border-[#2a3150] rounded-lg p-1">
              {(["all", "maxed", "not-maxed"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    filter === f ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                  }`}>
                  {f === "all" ? "All" : f === "maxed" ? "Maxed" : "Not Maxed"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a3150]">
                {(
                  [
                    { field: "nation",   label: "Nation",   align: "left",   color: "text-slate-400" },
                    { field: "cities",   label: "Cities",   align: "center", color: "text-slate-400" },
                    { field: "soldiers", label: "Soldiers", align: "right",  color: "text-green-400" },
                    { field: "tanks",    label: "Tanks",    align: "right",  color: "text-orange-400" },
                    { field: "aircraft", label: "Aircraft", align: "right",  color: "text-blue-400" },
                    { field: "ships",    label: "Ships",    align: "right",  color: "text-cyan-400" },
                    { field: "spies",    label: "Spies",    align: "right",  color: "text-violet-400" },
                    { field: "status",   label: "Status",   align: "center", color: "text-slate-400" },
                  ] as { field: SortField; label: string; align: string; color: string }[]
                ).map(({ field, label, align, color }) => {
                  const active = sortField === field;
                  const Icon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
                  return (
                    <th key={field}
                      className={`px-3 py-2 text-xs font-medium ${color} cursor-pointer select-none hover:text-white transition-colors ${align === "left" ? "text-left px-4" : align === "right" ? "text-right" : "text-center"}`}
                      onClick={() => handleSort(field)}>
                      <span className="inline-flex items-center gap-1">
                        {label}
                        <Icon size={11} className={active ? "opacity-100" : "opacity-40"} />
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.m.id} className="border-b border-[#1e2540] hover:bg-[#1a2035]">
                  <td className="px-4 py-2">
                    <a href={`https://politicsandwar.com/nation/id=${r.m.id}`} target="_blank" rel="noopener noreferrer"
                      className="text-white hover:text-blue-400 transition-colors font-medium">
                      {r.m.nation_name}
                    </a>
                    <div className="text-xs text-slate-500">{r.m.leader_name}</div>
                  </td>
                  <td className="px-3 py-2 text-center text-slate-300">{r.m.num_cities}</td>
                  <UnitCell current={r.m.soldiers} max={r.maxSoldiers} />
                  <UnitCell current={r.m.tanks} max={r.maxTanks} />
                  <UnitCell current={r.m.aircraft} max={r.maxAircraft} />
                  <UnitCell current={r.m.ships} max={r.maxShips} />
                  <td className="px-3 py-2 text-right">
                    {r.hasBknet ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <div className="flex items-center gap-1">
                          {r.spiesOk
                            ? <CheckCircle size={12} className="text-green-400" />
                            : <XCircle size={12} className="text-red-400" />}
                          <span className={r.spiesOk ? "text-green-400 font-semibold" : "text-slate-300"}>
                            {r.currentSpies}
                          </span>
                        </div>
                        <span className="text-xs text-slate-500">
                          / {r.maxSpies} ({pct(r.currentSpies, r.maxSpies)}%){r.hasIA ? " IA" : ""}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.allMaxed
                      ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">Max</span>
                      : <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">Low</span>}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">No nations match this filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
