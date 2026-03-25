"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Brain, RefreshCw } from "lucide-react";
import type { AiTargetsResponse, AiPick } from "@/lib/aiTargets";

interface Me {
  discordId: string;
  username: string;
}

function fmt$(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function PickCard({
  picks,
  title,
  accent,
  statLabel,
  statValue,
}: {
  picks: AiPick[];
  title: string;
  accent: string;
  statLabel: string;
  statValue: (p: AiPick) => string;
}) {
  return (
    <div className={`rounded-xl border bg-[#161b2e] p-5 space-y-4 ${accent}`}>
      <h2 className="font-bold text-sm text-white">{title}</h2>
      <div className="space-y-3">
        {picks.map((pick, i) => (
          <div key={pick.nation_id} className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-[#2a3150] flex items-center justify-center text-xs font-bold text-slate-300">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <a
                  href={`https://politicsandwar.com/nation/id=${pick.nation_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-white hover:underline text-sm"
                >
                  {pick.nation_name}
                </a>
                <span className="text-xs text-slate-500">{pick.alliance_name}</span>
                <span className="text-xs font-mono text-slate-400 ml-auto">{statLabel}: {statValue(pick)}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{pick.reason}</p>
            </div>
          </div>
        ))}
        {picks.length === 0 && (
          <p className="text-sm text-slate-500 italic">No picks available.</p>
        )}
      </div>
    </div>
  );
}

export default function AiTargetsPage() {
  const [triggered, setTriggered] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);

  const { data: me, isLoading: meLoading } = useQuery<Me | null>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/auth/me").then(r => r.ok ? r.json() : null),
    retry: false,
    staleTime: Infinity,
  });

  const {
    data,
    isLoading: analysisLoading,
    error,
    refetch,
  } = useQuery<AiTargetsResponse>({
    queryKey: ["aiTargets", fetchKey],
    queryFn: async () => {
      const res = await fetch("/api/aiTargets");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Server error (${res.status})`);
      }
      return res.json();
    },
    enabled: triggered,
    retry: false,
    staleTime: Infinity,
  });

  function handleAnalyze() {
    if (!triggered) {
      setTriggered(true);
    } else {
      setFetchKey(k => k + 1);
      refetch();
    }
  }

  if (meLoading) {
    return <AppShell><LoadingSpinner /></AppShell>;
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Brain size={20} className="text-purple-400" />
              AI Target Analysis
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              AI-powered picks for maximum damage and maximum loot.
            </p>
          </div>
          {data && (
            <button
              onClick={handleAnalyze}
              disabled={analysisLoading}
              className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-300 border border-[#2a3150] hover:border-slate-500 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
            >
              <RefreshCw size={12} className={analysisLoading ? "animate-spin" : ""} />
              Re-analyze
            </button>
          )}
        </div>

        {!me && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-8 text-center space-y-3">
            <Brain size={32} className="text-slate-600 mx-auto" />
            <p className="text-slate-400 text-sm">Log in with Discord to use AI targeting.</p>
            <a
              href="/login"
              className="inline-block bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              Login with Discord
            </a>
          </div>
        )}

        {me && !triggered && !data && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-8 text-center space-y-3">
            <Brain size={32} className="text-purple-400 mx-auto" />
            <p className="text-slate-400 text-sm">
              Fetches all valid targets in your score range and asks AI to pick the best 5 for damage and loot.
              Takes about a minute.
            </p>
            <button
              onClick={handleAnalyze}
              className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-6 py-2 rounded-lg transition-colors"
            >
              Analyze Targets
            </button>
          </div>
        )}

        {analysisLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-10 h-10 border-4 border-[#2a3150] border-t-purple-500 rounded-full animate-spin" />
            <p className="text-slate-400 text-sm">Analyzing targets… this may take a minute</p>
          </div>
        )}

        {error && !analysisLoading && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-xl px-4 py-3 space-y-2">
            <p className="text-red-400 text-sm">{error instanceof Error ? error.message : "Unknown error"}</p>
            <button
              onClick={handleAnalyze}
              className="text-xs text-red-400 hover:text-red-300 underline"
            >
              Try again
            </button>
          </div>
        )}

        {data && !analysisLoading && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <PickCard
                picks={data.damage_picks}
                title="⚔ Max Damage"
                accent="border-red-500/30"
                statLabel="Avg Infra"
                statValue={p => p.avg_infra.toLocaleString()}
              />
              <PickCard
                picks={data.loot_picks}
                title="💰 Max Loot"
                accent="border-amber-500/30"
                statLabel="Avg Beige Loot"
                statValue={p => p.beige_avg != null ? fmt$(p.beige_avg) : "No beige history"}
              />
            </div>

            {data.summary && (
              <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">AI Summary</p>
                <p className="text-slate-400 text-sm leading-relaxed">{data.summary}</p>
              </div>
            )}

            <p className="text-xs text-slate-600 text-center">
              Analyzed {data.target_count} valid target{data.target_count !== 1 ? "s" : ""}
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
