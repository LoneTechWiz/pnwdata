"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchSyncStatus } from "@/lib/pnw";
import { RefreshCw, CheckCircle, AlertCircle, Clock } from "lucide-react";

function timeAgo(ts: number | null): string {
  if (!ts) return "Never synced";
  const min = Math.floor((Date.now() - ts) / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

export function SyncStatus() {
  const qc = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ["syncStatus"],
    queryFn: fetchSyncStatus,
    refetchInterval: 15_000,
  });

  const { mutate: triggerSync, isPending } = useMutation({
    mutationFn: () => fetch("/api/sync", { method: "POST" }).then(r => r.json()),
    onSuccess: () => {
      // Poll for completion then refresh all data
      const poll = setInterval(async () => {
        const s = await fetchSyncStatus();
        qc.setQueryData(["syncStatus"], s);
        if (s.status === "success" || s.status === "error") {
          clearInterval(poll);
          qc.invalidateQueries({ queryKey: ["members"] });
          qc.invalidateQueries({ queryKey: ["wars"] });
          qc.invalidateQueries({ queryKey: ["bankrecs"] });
          qc.invalidateQueries({ queryKey: ["alliance"] });
        }
      }, 2000);
    },
  });

  if (!status) return null;

  const syncing = status.status === "syncing" || isPending;

  return (
    <div className="flex items-center gap-2 text-xs">
      {status.status === "success" && !syncing && <CheckCircle size={12} className="text-green-400 shrink-0" />}
      {status.status === "error" && !syncing && <AlertCircle size={12} className="text-red-400 shrink-0" />}
      {(status.status === "never") && !syncing && <Clock size={12} className="text-slate-500 shrink-0" />}
      {syncing && <RefreshCw size={12} className="text-blue-400 animate-spin shrink-0" />}

      <span className={`${status.status === "error" ? "text-red-400" : "text-slate-400"}`}>
        {syncing ? "Syncing…" : timeAgo(status.last_synced_at)}
      </span>

      {status.status === "error" && status.error && (
        <span className="text-red-500 truncate max-w-[160px]" title={status.error}>
          — {status.error}
        </span>
      )}

      <button
        onClick={() => triggerSync()}
        disabled={syncing}
        title="Sync now"
        className="text-slate-500 hover:text-blue-400 transition-colors disabled:opacity-40 ml-1"
      >
        <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
      </button>
    </div>
  );
}
