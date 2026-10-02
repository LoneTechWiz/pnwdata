"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchAlliance, Alliance } from "@/lib/pnw";
import { SyncStatus } from "./SyncStatus";
import Image from "next/image";
import { Menu } from "lucide-react";

export function useMyAlliance() {
  return useQuery<Alliance | null>({
    queryKey: ["alliance"],
    queryFn: fetchAlliance,
    refetchInterval: 10 * 60 * 1000,
  });
}

export function AllianceHeader({ onOpenMenu }: { onOpenMenu?: () => void }) {
  const { data: alliance, isLoading } = useMyAlliance();

  if (isLoading) return (
    <header className="h-[57px] bg-[#161b2e] border-b border-[#2a3150] flex items-center gap-3 px-4 md:px-6">
      <button onClick={onOpenMenu} className="md:hidden text-slate-400 hover:text-white transition-colors shrink-0" aria-label="Open menu">
        <Menu size={20} />
      </button>
      <div className="h-4 w-48 bg-[#2a3150] rounded animate-pulse" />
    </header>
  );

  return (
    <header className="bg-[#161b2e] border-b border-[#2a3150] px-4 md:px-6 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={onOpenMenu} className="md:hidden text-slate-400 hover:text-white transition-colors shrink-0" aria-label="Open menu">
          <Menu size={20} />
        </button>
        {alliance?.flag && (
          <Image
            src={alliance.flag}
            alt="flag"
            width={40}
            height={24}
            className="rounded object-cover shrink-0 hidden sm:block"
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
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
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
