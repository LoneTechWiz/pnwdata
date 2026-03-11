"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchWars, fetchMembers, fetchSyncStatus, War, Nation } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { StatCard } from "@/components/StatCard";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import { Swords, Shield, AlertTriangle } from "lucide-react";
import { ExportButton } from "@/components/ExportButton";

function WarRow({ war, memberIds }: { war: War; memberIds: Set<number> }) {
  const isAtt = memberIds.has(war.att_id);
  const ourRes = isAtt ? war.att_resistance : war.def_resistance;
  const theirRes = isAtt ? war.def_resistance : war.att_resistance;
  const ourPts = isAtt ? war.att_points : war.def_points;
  const theirPts = isAtt ? war.def_points : war.att_points;
  const wePeace = isAtt ? war.att_peace : war.def_peace;
  const theyPeace = isAtt ? war.def_peace : war.att_peace;

  return (
    <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${isAtt ? "bg-red-900/40 text-red-400 border border-red-700/30" : "bg-yellow-900/40 text-yellow-400 border border-yellow-700/30"}`}>
              {isAtt ? "Offense" : "Defense"}
            </span>
            <span className="text-xs bg-[#2a3150] text-slate-400 px-2 py-0.5 rounded">{war.war_type}</span>
            <span className="text-xs text-slate-500">{war.turns_left} turns left</span>
          </div>
          <div className="mt-2 text-sm">
            <a href={`https://politicsandwar.com/nation/id=${war.att_id}`} target="_blank" rel="noopener noreferrer" className="text-white font-medium hover:text-blue-400 transition-colors">{war.attacker?.nation_name ?? `Nation #${war.att_id}`}</a>
            {war.attacker?.alliance?.name && <span className="text-slate-400 mx-2 text-xs">({war.attacker.alliance.name})</span>}
            <span className="text-slate-500 mx-1">vs</span>
            <a href={`https://politicsandwar.com/nation/id=${war.def_id}`} target="_blank" rel="noopener noreferrer" className="text-white font-medium hover:text-blue-400 transition-colors">{war.defender?.nation_name ?? `Nation #${war.def_id}`}</a>
            {war.defender?.alliance?.name && <span className="text-slate-400 mx-2 text-xs">({war.defender.alliance.name})</span>}
          </div>
          {war.reason && <p className="text-xs text-slate-500 mt-1">Reason: {war.reason}</p>}
        </div>
        <div className="text-right text-xs text-slate-500">#{war.id} · {new Date(war.date).toLocaleDateString()}</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[{ label: "Our Resistance", val: ourRes, color: "bg-blue-500", text: "text-blue-400" },
          { label: "Their Resistance", val: theirRes, color: "bg-red-500", text: "text-red-400" }].map(({ label, val, color, text }) => (
          <div key={label} className="bg-[#1a2035] rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">{label}</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-[#2a3150] rounded-full h-2">
                <div className={`${color} h-2 rounded-full`} style={{ width: `${Math.min(100, val)}%` }} />
              </div>
              <span className={`text-sm font-bold ${text}`}>{val}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-4 text-xs text-slate-400 flex-wrap">
        <span>Our Pts: <strong className="text-slate-200">{ourPts}</strong></span>
        <span>Their Pts: <strong className="text-slate-200">{theirPts}</strong></span>
        {wePeace && <span className="text-yellow-400">We offered peace</span>}
        {theyPeace && <span className="text-green-400">They offered peace</span>}
      </div>

      <div className="flex gap-2 flex-wrap text-xs">
        {([
          { label: "Ground", val: war.ground_control },
          { label: "Air",    val: war.air_superiority },
          { label: "Naval",  val: war.naval_blockade },
        ] as const).map(({ label, val }) => {
          const ourId = isAtt ? war.att_id : war.def_id;
          const holder = Number(val);
          const neutral = !holder;
          const weHaveIt = !neutral && holder === Number(ourId);
          return (
            <span key={label} className={`px-2 py-0.5 rounded ${neutral ? "bg-slate-800/60 text-slate-500" : weHaveIt ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"}`}>
              {label} {neutral ? "–" : weHaveIt ? "✓" : "✗"}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function WarsPage() {
  const { data: wars = [], isLoading, error } = useQuery<War[]>({
    queryKey: ["wars"],
    queryFn: fetchWars,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: members = [] } = useQuery<Nation[]>({
    queryKey: ["members"],
    queryFn: fetchMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: status } = useQuery({ queryKey: ["syncStatus"], queryFn: fetchSyncStatus, refetchInterval: 15_000 });

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (members.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  const memberIds = new Set(members.map(m => m.id));
  const offWars = wars.filter(w => memberIds.has(w.att_id));
  const defWars = wars.filter(w => memberIds.has(w.def_id));
  const membersAtWar = new Set([...offWars.map(w => w.att_id), ...defWars.map(w => w.def_id)]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Active Wars</h2>
            <p className="text-slate-400 text-sm">{wars.length} active wars</p>
          </div>
          <ExportButton
            filename="active-wars"
            getData={() => wars.map(w => {
              const isAtt = memberIds.has(w.att_id);
              return {
                "War ID": w.id,
                Date: w.date,
                Type: isAtt ? "Offense" : "Defense",
                "War Type": w.war_type,
                Attacker: w.attacker?.nation_name ?? `Nation #${w.att_id}`,
                "Att Alliance": w.attacker?.alliance?.name ?? "",
                Defender: w.defender?.nation_name ?? `Nation #${w.def_id}`,
                "Def Alliance": w.defender?.alliance?.name ?? "",
                "Turns Left": w.turns_left,
                "Our Resistance": isAtt ? w.att_resistance : w.def_resistance,
                "Their Resistance": isAtt ? w.def_resistance : w.att_resistance,
                "Our Points": isAtt ? w.att_points : w.def_points,
                "Their Points": isAtt ? w.def_points : w.att_points,
                Reason: w.reason,
              };
            })}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Wars" value={wars.length} icon={Swords} color="text-red-400" />
          <StatCard label="Offensive" value={offWars.length} icon={Swords} color="text-orange-400" sub="We attacked" />
          <StatCard label="Defensive" value={defWars.length} icon={Shield} color="text-yellow-400" sub="Attacked us" />
          <StatCard label="Members at War" value={membersAtWar.size} icon={AlertTriangle} color="text-red-400" sub={`of ${members.length}`} />
        </div>

        {wars.length === 0 ? (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <Shield size={40} className="text-green-400 mx-auto mb-3" />
            <p className="text-white font-medium">No active wars</p>
            <p className="text-slate-400 text-sm mt-1">Your alliance is at peace</p>
          </div>
        ) : (
          <div className="space-y-6">
            {offWars.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Offensive Wars ({offWars.length})</h3>
                <div className="space-y-3">{offWars.map(w => <WarRow key={w.id} war={w} memberIds={memberIds} />)}</div>
              </div>
            )}
            {defWars.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Defensive Wars ({defWars.length})</h3>
                <div className="space-y-3">{defWars.map(w => <WarRow key={w.id} war={w} memberIds={memberIds} />)}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
