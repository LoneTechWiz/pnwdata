"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchAlliance, Alliance } from "@/lib/pnw";
import { SyncStatus } from "./SyncStatus";
import Image from "next/image";

export function useMyAlliance() {
  return useQuery<Alliance | null>({
    queryKey: ["alliance"],
    queryFn: fetchAlliance,
    refetchInterval: 10 * 60 * 1000,
  });
}

export function AllianceHeader() {
  const { data: alliance, isLoading } = useMyAlliance();

  if (isLoading) return (
    <header className="h-[57px] bg-[#161b2e] border-b border-[#2a3150] flex items-center px-6">
      <div className="h-4 w-48 bg-[#2a3150] rounded animate-pulse" />
    </header>
  );

  return (
    <header className="bg-[#161b2e] border-b border-[#2a3150] px-6 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        {alliance?.flag && (
          <Image
            src={alliance.flag}
            alt="flag"
            width={40}
            height={24}
            className="rounded object-cover shrink-0"
            unoptimized
          />
        )}
        <div className="min-w-0">
          <h1 className="font-bold text-white text-lg leading-tight truncate">
            {alliance?.name ?? "PnW Analytics"}
            {alliance?.acronym && (
              <span className="text-slate-400 font-normal text-sm ml-1">({alliance.acronym})</span>
            )}
          </h1>
          {alliance && (
            <div className="flex gap-4 text-xs text-slate-400">
              <span>Rank #{alliance.rank}</span>
              <span>{alliance.member_count} Members</span>
              <span>Score: {Number(alliance.score).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
      <SyncStatus />
    </header>
  );
}
