"use client";

import { FormEvent, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, Crosshair, ExternalLink, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ErrorMessage, LoadingSpinner } from "@/components/LoadingSpinner";
import {
  RAID_SORT_OPTIONS,
  sortRaidTargets,
  type RaidSortDirection,
  type RaidSortKey,
} from "@/lib/raid-sort";

interface Me { nationId: number | null; isEmperor: boolean }

interface RaidTarget {
  id: number;
  nationName: string;
  leaderName: string;
  allianceName: string;
  score: number;
  cities: number;
  averageInfrastructure: number;
  soldiers: number;
  tanks: number;
  aircraft: number;
  ships: number;
  defensiveWars: number;
  lastActive: string;
  inactiveDays: number;
  lastBeigeAt: string | null;
  beigeCount: number;
  lastNationLoot: number | null;
  averageNationLoot: number | null;
  lastAllianceLoot: number | null;
  averageAllianceLoot: number | null;
  revenueSinceBeige: number | null;
  revenueBasis: "observed" | "recent-rate" | "lifetime-rate" | "unavailable";
  bankNetSinceBeige: number;
  bankRecordCount: number;
  estimatedNationLoot: number | null;
  estimatedAllianceLoot: number | null;
  estimatedTotalLoot: number | null;
  confidence: "high" | "medium" | "low";
}

interface RaidFinderResponse {
  requester: { id: number; nationName: string; leaderName: string; score: number };
  scoreRange: { min: number; max: number };
  minInactiveDays: number;
  targets: RaidTarget[];
  syncStatus: { last_synced_at: number | null; status: string };
  methodology: { observed: string; estimate: string };
}

function money(value: number | null): string {
  if (value == null) return "—";
  const sign = value < 0 ? "−" : "";
  const amount = Math.abs(value);
  if (amount >= 1_000_000_000) return `${sign}$${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `${sign}$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${sign}$${(amount / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(amount).toLocaleString()}`;
}

function basisLabel(basis: RaidTarget["revenueBasis"]): string {
  if (basis === "observed") return "observed snapshots";
  if (basis === "recent-rate") return "modeled from recent rate";
  if (basis === "lifetime-rate") return "modeled from lifetime rate";
  return "unavailable";
}

function SortIcon({ active, direction }: { active: boolean; direction: RaidSortDirection }) {
  if (!active) return <ArrowUpDown aria-hidden="true" size={12} />;
  return direction === "asc"
    ? <ArrowUp aria-hidden="true" size={12} />
    : <ArrowDown aria-hidden="true" size={12} />;
}

function SortHeader({
  label,
  value,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  value: RaidSortKey;
  activeKey: RaidSortKey;
  direction: RaidSortDirection;
  onSort: (value: RaidSortKey) => void;
}) {
  const active = value === activeKey;
  return (
    <th
      className="px-3 py-2 text-right"
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(value)}
        className="ml-auto inline-flex items-center gap-1 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {label} <SortIcon active={active} direction={direction} />
      </button>
    </th>
  );
}

export default function RaidFinderPage() {
  const [nationId, setNationId] = useState("");
  const [submittedNationId, setSubmittedNationId] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<RaidSortKey>("estimatedNationLoot");
  const [sortDirection, setSortDirection] = useState<RaidSortDirection>("desc");

  const { data: me } = useQuery<Me | null>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/auth/me").then((response) => response.ok ? response.json() : null),
    retry: false,
    staleTime: Infinity,
  });

  const { data, isFetching, error } = useQuery<RaidFinderResponse>({
    queryKey: ["raidFinder", submittedNationId],
    enabled: submittedNationId !== "",
    queryFn: async () => {
      const response = await fetch(`/api/raid-finder?nationId=${encodeURIComponent(submittedNationId)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Raid finder failed");
      return body;
    },
  });

  const sortedTargets = useMemo(
    () => sortRaidTargets(data?.targets ?? [], sortKey, sortDirection),
    [data, sortDirection, sortKey],
  );
  const displayedTargets = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return sortedTargets;
    return sortedTargets.filter((target) =>
      target.nationName.toLowerCase().includes(term)
      || target.leaderName.toLowerCase().includes(term)
      || target.allianceName.toLowerCase().includes(term)
      || String(target.id).includes(term)
    );
  }, [search, sortedTargets]);
  const rankByNationId = useMemo(
    () => new Map(sortedTargets.map((target, index) => [target.id, index + 1])),
    [sortedTargets],
  );

  function changeSort(value: RaidSortKey) {
    if (value === sortKey) {
      setSortDirection((current) => current === "desc" ? "asc" : "desc");
      return;
    }
    setSortKey(value);
    setSortDirection(value === "nationName" ? "asc" : "desc");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = nationId.trim() || (me?.nationId ? String(me.nationId) : "");
    if (value) setSubmittedNationId(value);
  }

  return (
    <AppShell>
      <div className="p-4 md:p-6 space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Crosshair className="text-amber-400" size={22} />
              <h1 className="text-xl font-bold text-white">Raid Finder</h1>
            </div>
            <p className="mt-1 text-sm text-slate-400">
              Inactive, attackable nations ranked by separate nation and alliance loot estimates.
            </p>
          </div>
          {me?.isEmperor && (
            <Link href="/raid-config" className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white">
              <SlidersHorizontal size={15} /> Raid configuration
            </Link>
          )}
        </div>

        <form onSubmit={submit} className="rounded-xl border border-[#2a3150] bg-[#161b2e] p-4">
          <label htmlFor="raid-nation-id" className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Attacking nation ID
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="raid-nation-id"
              inputMode="numeric"
              value={nationId}
              onChange={(event) => setNationId(event.target.value.replace(/\D/g, ""))}
              placeholder={me?.nationId ? `Your linked nation: ${me.nationId}` : "Nation ID"}
              className="min-w-0 flex-1 rounded-lg border border-[#2a3150] bg-[#0f1117] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isFetching || (!nationId.trim() && !me?.nationId)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Search size={15} /> {isFetching ? "Ranking…" : "Find raids"}
            </button>
          </div>
        </form>

        {isFetching && <LoadingSpinner />}
        {error && <ErrorMessage message={error instanceof Error ? error.message : "Raid finder failed"} />}

        {data && !isFetching && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl border border-[#2a3150] bg-[#161b2e] p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Requester</p>
                <p className="mt-1 truncate font-semibold text-white">{data.requester.nationName}</p>
                <p className="text-xs text-slate-400">#{data.requester.id} · {data.requester.score.toLocaleString()} score</p>
              </div>
              <div className="rounded-xl border border-[#2a3150] bg-[#161b2e] p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Attack range</p>
                <p className="mt-1 font-semibold text-white">{data.scoreRange.min.toLocaleString()}–{data.scoreRange.max.toLocaleString()}</p>
              </div>
              <div className="rounded-xl border border-[#2a3150] bg-[#161b2e] p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Minimum inactive</p>
                <p className="mt-1 font-semibold text-white">{data.minInactiveDays} days</p>
              </div>
              <div className="rounded-xl border border-[#2a3150] bg-[#161b2e] p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Eligible targets</p>
                <p className="mt-1 font-semibold text-white">{data.targets.length.toLocaleString()}</p>
                <p className="text-xs text-slate-500">
                  {data.syncStatus.last_synced_at ? `Synced ${new Date(data.syncStatus.last_synced_at).toLocaleString()}` : data.syncStatus.status}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[#2a3150] bg-[#161b2e] p-4 text-xs text-slate-400">
              <p><span className="font-semibold text-slate-300">Observed:</span> {data.methodology.observed}</p>
              <p className="mt-1"><span className="font-semibold text-slate-300">Modeled estimate:</span> {data.methodology.estimate}</p>
            </div>

            <div className="rounded-xl border border-[#2a3150] bg-[#161b2e] overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-[#2a3150] p-3 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm font-semibold text-white">Ranked raid queue</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    Sort by
                    <select
                      value={sortKey}
                      onChange={(event) => changeSort(event.target.value as RaidSortKey)}
                      className="rounded-lg border border-[#2a3150] bg-[#0f1117] px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                    >
                      {RAID_SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => setSortDirection((current) => current === "desc" ? "asc" : "desc")}
                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-[#2a3150] bg-[#0f1117] px-3 py-1.5 text-xs text-slate-300 hover:text-white"
                    aria-label={`Sort ${sortDirection === "desc" ? "ascending" : "descending"}`}
                  >
                    {sortDirection === "desc" ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
                    {sortDirection === "desc" ? "Descending" : "Ascending"}
                  </button>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Filter nation, leader, alliance, or ID…"
                    aria-label="Filter raid targets"
                    className="rounded-lg border border-[#2a3150] bg-[#0f1117] px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none sm:w-72"
                  />
                </div>
              </div>
              {displayedTargets.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-slate-400">
                  No eligible targets match the configured inactivity threshold and this nation’s score range.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1320px] text-left text-xs">
                    <thead className="bg-[#111624] text-slate-400">
                      <tr>
                        <th className="px-3 py-2" aria-sort={sortKey === "nationName" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                          <button type="button" onClick={() => changeSort("nationName")} className="inline-flex items-center gap-1 hover:text-white">
                            Rank / Nation <SortIcon active={sortKey === "nationName"} direction={sortDirection} />
                          </button>
                        </th>
                        <SortHeader label="Nation loot" value="estimatedNationLoot" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
                        <SortHeader label="Alliance loot" value="estimatedAllianceLoot" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
                        <SortHeader label="Inactive" value="inactiveDays" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
                        <SortHeader label="Score / cities" value="score" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
                        <SortHeader label="Revenue since beige" value="revenueSinceBeige" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
                        <SortHeader label="Visible bank net" value="bankNetSinceBeige" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
                        <SortHeader label="Military" value="aircraft" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
                        <SortHeader label="Slots" value="defensiveWars" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2a3150]">
                      {displayedTargets.map((target) => {
                        const rank = rankByNationId.get(target.id);
                        return (
                          <tr key={target.id} className="hover:bg-[#1a1f35]">
                            <td className="px-3 py-3">
                              <div className="flex gap-2">
                                <span className="w-6 shrink-0 text-right font-semibold text-slate-500">{rank}</span>
                                <div className="min-w-0">
                                  <a
                                    href={`https://politicsandwar.com/nation/id=${target.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 font-semibold text-blue-300 hover:text-blue-200"
                                  >
                                    {target.nationName} <ExternalLink size={11} />
                                  </a>
                                  <p className="max-w-52 truncate text-slate-500">{target.leaderName} · {target.allianceName}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <p className="font-semibold text-emerald-400">{money(target.estimatedNationLoot)}</p>
                              <p className="text-slate-500">last {money(target.lastNationLoot)} · avg {money(target.averageNationLoot)}</p>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <p className="font-semibold text-blue-300">{money(target.estimatedAllianceLoot)}</p>
                              <p className="text-slate-500">last {money(target.lastAllianceLoot)} · avg {money(target.averageAllianceLoot)}</p>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <p className="font-medium text-amber-300">{target.inactiveDays.toFixed(1)}d</p>
                              <p className="text-slate-500">{new Date(target.lastActive).toLocaleDateString()}</p>
                            </td>
                            <td className="px-3 py-3 text-right text-slate-300">
                              <p>{Math.round(target.score).toLocaleString()}</p>
                              <p className="text-slate-500">{target.cities}c · {target.averageInfrastructure.toLocaleString()} infra</p>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <p className="text-slate-300">{money(target.revenueSinceBeige)}</p>
                              <p className="text-slate-500">{basisLabel(target.revenueBasis)} · {target.beigeCount} beige</p>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <p className={target.bankNetSinceBeige > 0 ? "text-emerald-400" : target.bankNetSinceBeige < 0 ? "text-red-400" : "text-slate-400"}>
                                {money(target.bankNetSinceBeige)}
                              </p>
                              <p className="text-slate-500">{target.bankRecordCount} record{target.bankRecordCount === 1 ? "" : "s"}</p>
                            </td>
                            <td className="px-3 py-3 text-right text-slate-400">
                              <p>{target.soldiers.toLocaleString()} S · {target.tanks.toLocaleString()} T</p>
                              <p>{target.aircraft.toLocaleString()} A · {target.ships.toLocaleString()} N</p>
                            </td>
                            <td className="px-3 py-3 text-right font-medium text-slate-300">{target.defensiveWars}/3</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
