"use client";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMembers, fetchWars, fetchSyncStatus, fetchBknetMembers, Nation, War } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${color}`}>
      {label}
    </span>
  );
}

export default function CommandCenterPage() {
  const { data: members = [], isLoading: mLoading, error: mErr } = useQuery({
    queryKey: ["members"],
    queryFn: fetchMembers,
    refetchInterval: 10 * 60 * 1000,
  });

  const { data: wars = [], isLoading: wLoading, error: wErr } = useQuery<War[]>({
    queryKey: ["wars"],
    queryFn: fetchWars,
    refetchInterval: 10 * 60 * 1000,
  });

  const { data: status } = useQuery({
    queryKey: ["syncStatus"],
    queryFn: fetchSyncStatus,
    refetchInterval: 15_000,
  });

  const { data: bknetMembers = [] } = useQuery({
    queryKey: ["bknet_members"],
    queryFn: fetchBknetMembers,
    refetchInterval: 10 * 60 * 1000,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [minSpies, setMinSpies] = useState("");
  const [maxSpies, setMaxSpies] = useState("");
  // Manual toggle for opponent beige (we don't have live opponent beige data)
  const [beigedOpps, setBeigedOpps] = useState<Set<number>>(new Set());

  function toggleOppBeiged(warId: number) {
    setBeigedOpps(prev => {
      const next = new Set(prev);
      if (next.has(warId)) next.delete(warId); else next.add(warId);
      return next;
    });
  }

  const bknetSpies = useMemo(
    () => new Map(bknetMembers.map(m => [String(m.nation.id), m.nation.military.spies])),
    [bknetMembers]
  );

  const sortedMembers = useMemo(() => {
    const min = minSpies !== "" ? Number(minSpies) : null;
    const max = maxSpies !== "" ? Number(maxSpies) : null;
    return [...members]
      .filter((m) => m.vacation_mode_turns === 0)
      .filter((m) => {
        const s = bknetSpies.get(String(m.id)) ?? null;
        if (min !== null && (s === null || s < min)) return false;
        if (max !== null && (s === null || s > max)) return false;
        return true;
      })
      .sort((a, b) => a.nation_name.localeCompare(b.nation_name));
  }, [members, minSpies, maxSpies, bknetSpies]);

  const selectedNation: Nation | undefined = useMemo(
    () => sortedMembers.find((m) => String(m.id) === selectedId),
    [sortedMembers, selectedId]
  );

  const activeWars = useMemo(() => {
    if (!selectedNation) return [];
    const id = String(selectedNation.id);
    return wars.filter(
      (w) => String(w.att_id) === id || String(w.def_id) === id
    );
  }, [wars, selectedNation]);

  // Collect opponents who are blockading the selected nation
  const blockaders = useMemo(() => {
    if (!selectedNation) return [];
    const nid = selectedNation.id;
    const result: { warId: number; opponentName: string }[] = [];
    for (const war of activeWars) {
      if (war.naval_blockade === 0) continue;
      const isAttacker = war.att_id === nid;
      const opponentId = isAttacker ? war.def_id : war.att_id;
      // blockade is active against BK nation if the opponent is the one performing it
      if (war.naval_blockade === opponentId) {
        const opponentName = isAttacker
          ? (war.defender?.nation_name ?? `Nation #${opponentId}`)
          : (war.attacker?.nation_name ?? `Nation #${opponentId}`);
        result.push({ warId: war.id, opponentName });
      }
    }
    return result;
  }, [activeWars, selectedNation]);

  useEffect(() => {
    if (selectedId === null && sortedMembers.length > 0) {
      setSelectedId(String(sortedMembers[0].id));
    }
  }, [sortedMembers, selectedId]);

  const isLoading = mLoading || wLoading;
  const error = mErr || wErr;

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={String(error)} /></AppShell>;
  if (members.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  const lastSynced = status?.last_synced_at
    ? new Date(status.last_synced_at).toLocaleString()
    : "—";

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide">
            BLACK KNIGHTS COMMAND CENTER
          </h1>
          <p className="text-xs text-slate-400 mt-1">Last synced: {lastSynced}</p>
        </div>

        {/* Nation Selector */}
        <div className="flex items-center gap-3 flex-wrap">
          <label htmlFor="nation-select" className="text-sm text-slate-400">
            Nation
          </label>
          <select
            id="nation-select"
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
            className="bg-[#0f1117] border border-[#2a3150] rounded-lg text-white px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          >
            {sortedMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nation_name} ({m.leader_name}){m.discord ? ` — ${m.discord}` : ""}
              </option>
            ))}
          </select>
          {selectedNation && (
            <a
              href={`https://politicsandwar.com/nation/id=${selectedNation.id}`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:text-blue-300 text-sm font-medium hover:underline"
            >
              {selectedNation.nation_name} ↗
            </a>
          )}
          {selectedNation && bknetSpies.has(String(selectedNation.id)) && (
            <span className="text-sm text-yellow-400">
              🕵 {bknetSpies.get(String(selectedNation.id))} spies
            </span>
          )}
          <span className="text-sm text-slate-400 ml-2">Spies</span>
          <input
            type="number"
            min={0}
            max={60}
            placeholder="min"
            value={minSpies}
            onChange={e => setMinSpies(e.target.value)}
            className="w-16 bg-[#0f1117] border border-[#2a3150] rounded px-2 py-0.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-yellow-500"
          />
          <span className="text-slate-600 text-sm">–</span>
          <input
            type="number"
            min={0}
            max={60}
            placeholder="max"
            value={maxSpies}
            onChange={e => setMaxSpies(e.target.value)}
            className="w-16 bg-[#0f1117] border border-[#2a3150] rounded px-2 py-0.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-yellow-500"
          />
        </div>

        {/* Blockade Banner */}
        {blockaders.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-sky-600/60 bg-sky-900/30">
            <span className="text-sky-300 text-lg">⚓</span>
            <div>
              <span className="text-sky-200 font-semibold text-sm">Naval Blockade Active</span>
              <span className="text-sky-400 text-sm ml-2">
                Blockaded by: {blockaders.map(b => b.opponentName).join(", ")}
              </span>
            </div>
          </div>
        )}

        {/* Wars Table */}
        {selectedId !== null && (
          <div className="rounded-xl border border-[#2a3150] overflow-x-auto">
            <table className="w-full text-sm text-white min-w-max">
              <thead className="bg-[#161b2e] text-slate-400 text-xs uppercase">
                <tr>
                  <th className="px-3 py-3 text-left">Opponent</th>
                  <th className="px-3 py-3 text-right">BK Res</th>
                  <th className="px-3 py-3 text-right">Opp Res</th>
                  <th className="px-3 py-3 text-right">BK MAPs</th>
                  <th className="px-3 py-3 text-right">Opp MAPs</th>
                  <th className="px-3 py-3 text-left">BK Status</th>
                  <th className="px-3 py-3 text-left">Opp Status</th>
                  <th className="px-3 py-3 text-right">BK Sol</th>
                  <th className="px-3 py-3 text-right">BK Tank</th>
                  <th className="px-3 py-3 text-right">BK Air</th>
                  <th className="px-3 py-3 text-right">BK Ship</th>
                  <th className="px-3 py-3 text-right">Opp Sol</th>
                  <th className="px-3 py-3 text-right">Opp Tank</th>
                  <th className="px-3 py-3 text-right">Opp Air</th>
                  <th className="px-3 py-3 text-right">Opp Ship</th>
                  <th className="px-3 py-3 text-right">Opp Spies</th>
                  <th className="px-3 py-3 text-left">Off/Def</th>
                  <th className="px-3 py-3 text-left">War Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a3150]">
                {activeWars.length === 0 ? (
                  <tr>
                    <td colSpan={18} className="px-3 py-8 text-center text-slate-400">
                      No active wars
                    </td>
                  </tr>
                ) : (
                  activeWars.map((war) => {
                    const isAttacker = String(war.att_id) === String(selectedNation!.id);
                    const opponent = isAttacker ? war.defender : war.attacker;
                    const opponentId = isAttacker ? war.def_id : war.att_id;
                    const bkId = isAttacker ? war.att_id : war.def_id;
                    const bkRes = isAttacker ? war.att_resistance : war.def_resistance;
                    const oppRes = isAttacker ? war.def_resistance : war.att_resistance;
                    const bkMaps = isAttacker ? war.att_points : war.def_points;
                    const oppMaps = isAttacker ? war.def_points : war.att_points;
                    const offDef = isAttacker ? "Offense" : "Defense";

                    // naval_blockade holds the ID of who is doing the blockading
                    const isBkBlockaded = war.naval_blockade !== 0 && war.naval_blockade === Number(opponentId);
                    const isOppBlockaded = war.naval_blockade !== 0 && war.naval_blockade === Number(bkId);
                    const isBkBeiged = selectedNation!.beige_turns > 0;
                    const isOppBeiged = beigedOpps.has(war.id);

                    return (
                      <tr key={war.id} className="hover:bg-[#1e2540] transition-colors">
                        <td className="px-3 py-2">
                          <a
                            href={`https://politicsandwar.com/nation/id=${opponentId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-400 hover:underline"
                          >
                            {opponent?.nation_name ?? `Nation #${opponentId}`}
                          </a>
                        </td>
                        <td className={`px-3 py-2 text-right ${bkRes < oppRes ? "bg-pink-900/40" : ""}`}>
                          {bkRes}
                        </td>
                        <td className="px-3 py-2 text-right">{oppRes}</td>
                        <td className={`px-3 py-2 text-right ${bkMaps === 0 ? "bg-pink-900/40" : ""}`}>
                          {bkMaps}
                        </td>
                        <td className="px-3 py-2 text-right">{oppMaps}</td>
                        {/* BK Status */}
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            {isBkBeiged && <StatusBadge label="Beiged" color="bg-amber-600/80 text-amber-100" />}
                            {isBkBlockaded && <StatusBadge label="Blockaded" color="bg-sky-700/80 text-sky-100" />}
                            {!isBkBeiged && !isBkBlockaded && <span className="text-slate-600 text-xs">—</span>}
                          </div>
                        </td>
                        {/* Opp Status */}
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            {isOppBlockaded && <StatusBadge label="Blockaded" color="bg-sky-700/80 text-sky-100" />}
                            <button
                              onClick={() => toggleOppBeiged(war.id)}
                              className={`px-1.5 py-0.5 rounded text-xs font-semibold transition-colors ${
                                isOppBeiged
                                  ? "bg-amber-600/80 text-amber-100 hover:bg-amber-700/80"
                                  : "bg-[#2a3150] text-slate-400 hover:bg-[#3a4160]"
                              }`}
                            >
                              {isOppBeiged ? "Beiged ✓" : "Beige?"}
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">{selectedNation!.soldiers.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{selectedNation!.tanks.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{selectedNation!.aircraft.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{selectedNation!.ships.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{(opponent?.soldiers ?? 0).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{(opponent?.tanks ?? 0).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{(opponent?.aircraft ?? 0).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{(opponent?.ships ?? 0).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-yellow-400">{opponent?.spies ?? "—"}</td>
                        <td className="px-3 py-2">{offDef}</td>
                        <td className="px-3 py-2">{war.war_type}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
