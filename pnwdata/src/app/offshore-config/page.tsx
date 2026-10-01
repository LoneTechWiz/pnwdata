"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { KeyRound, Trash2 } from "lucide-react";

interface OffshoreAlliance {
  allianceId: number;
  allianceName: string;
  label: string | null;
  apiKeyPreview: string;
  addedByDiscordId: string;
  addedByUsername: string;
  status: "pending" | "syncing" | "success" | "error";
  error: string | null;
  memberCount: number;
  warCount: number;
  bankrecCount: number;
  lastSyncedAt: number | null;
  createdAt: number;
}

interface Me {
  discordId: string;
  isEmperor: boolean;
}

function StatusBadge({ status }: { status: OffshoreAlliance["status"] }) {
  const styles: Record<OffshoreAlliance["status"], string> = {
    pending: "bg-slate-700/40 text-slate-300 border-slate-600",
    syncing: "bg-blue-900/30 text-blue-300 border-blue-700",
    success: "bg-green-900/30 text-green-300 border-green-700",
    error: "bg-red-900/30 text-red-300 border-red-700",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}>
      {status}
    </span>
  );
}

function formatTimestamp(ms: number | null): string {
  if (!ms) return "Never";
  return new Date(ms).toLocaleString();
}

export default function OffshoreConfigPage() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");

  const { data: me } = useQuery<Me | null>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)),
    retry: false,
    staleTime: Infinity,
  });

  const { data: alliances, isLoading, error } = useQuery<OffshoreAlliance[]>({
    queryKey: ["offshoreConfig"],
    queryFn: () => fetch("/api/offshore-config").then((r) => {
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    }),
    refetchInterval: 30 * 1000,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/offshore-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, label: label || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to add key");
      return body;
    },
    onSuccess: () => {
      setApiKey("");
      setLabel("");
      queryClient.invalidateQueries({ queryKey: ["offshoreConfig"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (allianceId: number) => {
      const res = await fetch(`/api/offshore-config?allianceId=${allianceId}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to remove");
      return body;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["offshoreConfig"] }),
  });

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message="Access denied or failed to load." /></AppShell>;

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white">Offshore &amp; Extension Config</h1>
          <p className="text-slate-400 text-sm mt-1">
            Add a Politics &amp; War API key for an offshore or extension alliance to pull in the same
            member, war, and bank data this dashboard tracks for the main alliance.
          </p>
        </div>

        <div className="rounded-xl border border-[#2a3150] bg-[#161b2e] p-5 space-y-3 max-w-xl">
          <h2 className="font-semibold text-sm text-white flex items-center gap-2">
            <KeyRound size={14} /> Add an API key
          </h2>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="P&W API key"
            className="w-full bg-[#0f1117] border border-[#2a3150] rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={'Label (optional, e.g. "Offshore Bank")'}
            className="w-full bg-[#0f1117] border border-[#2a3150] rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => addMutation.mutate()}
            disabled={!apiKey.trim() || addMutation.isPending}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {addMutation.isPending ? "Verifying…" : "Add key"}
          </button>
          <p className="text-slate-500 text-xs">
            We verify the key against the P&W API and detect the alliance automatically — you don&apos;t
            need to know the alliance ID. The key is stored server-side and never shown again after saving.
          </p>
          {addMutation.isError && (
            <div className="bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-xs">
              {(addMutation.error as Error).message}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#2a3150] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1a1f35] text-slate-400 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2 font-medium">Alliance</th>
                <th className="text-left px-4 py-2 font-medium">Key</th>
                <th className="text-left px-4 py-2 font-medium">Added by</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Members / Wars / Bank</th>
                <th className="text-left px-4 py-2 font-medium">Last synced</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(alliances ?? []).map((entry) => {
                const canRemove = me?.isEmperor || me?.discordId === entry.addedByDiscordId;
                return (
                  <tr key={entry.allianceId} className="border-t border-[#2a3150] hover:bg-[#1a1f35] transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-white font-medium">{entry.label || entry.allianceName}</p>
                      <p className="text-slate-500 text-xs">{entry.allianceName} · #{entry.allianceId}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-400 text-xs">{entry.apiKeyPreview}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs">{entry.addedByUsername}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={entry.status} />
                      {entry.status === "error" && entry.error && (
                        <p className="text-red-400/70 text-xs mt-1 max-w-xs truncate" title={entry.error}>{entry.error}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs font-mono">
                      {entry.memberCount} / {entry.warCount} / {entry.bankrecCount}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{formatTimestamp(entry.lastSyncedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {canRemove && (
                        <button
                          onClick={() => removeMutation.mutate(entry.allianceId)}
                          disabled={removeMutation.isPending}
                          className="text-slate-500 hover:text-red-400 transition-colors disabled:opacity-40"
                          title="Remove"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(alliances ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500 text-sm italic">
                    No offshore or extension alliances configured yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
