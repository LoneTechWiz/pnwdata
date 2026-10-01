"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchSyncStatus } from "@/lib/pnw";
import { RefreshCw } from "lucide-react";

export function SyncingPlaceholder() {
  const { data: status } = useQuery({
    queryKey: ["syncStatus"],
    queryFn: fetchSyncStatus,
    refetchInterval: 3000,
  });

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <RefreshCw size={36} className="text-blue-500 animate-spin" />
      <p className="text-white font-semibold text-lg">Initial sync in progress…</p>
      <p className="text-slate-400 text-sm">
        {status?.status === "error"
          ? `Sync error: ${status.error}`
          : "Fetching your alliance data from Politics & War. This will only take a moment."}
      </p>
    </div>
  );
}
