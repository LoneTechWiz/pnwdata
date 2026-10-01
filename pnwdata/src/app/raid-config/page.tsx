"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, SlidersHorizontal } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ErrorMessage, LoadingSpinner } from "@/components/LoadingSpinner";

interface RaidConfig { min_inactive_days: number }

export default function RaidConfigPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery<RaidConfig>({
    queryKey: ["raidConfig"],
    queryFn: async () => {
      const response = await fetch("/api/raid-config");
      if (!response.ok) throw new Error("Access denied or failed to load raid configuration");
      return response.json();
    },
  });
  const mutation = useMutation({
    mutationFn: async (config: RaidConfig) => {
      const response = await fetch("/api/raid-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to save raid configuration");
      return body as RaidConfig;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["raidConfig"], saved);
      setDraft(null);
    },
  });

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error || !data) return <AppShell><ErrorMessage message={error instanceof Error ? error.message : "Failed to load"} /></AppShell>;

  const value = draft ?? String(data.min_inactive_days);
  function submit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate({ min_inactive_days: Number(value) });
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={20} className="text-amber-400" />
            <h1 className="text-xl font-bold text-white">Raid Finder Configuration</h1>
          </div>
          <p className="mt-1 text-sm text-slate-400">Set how long a nation must be inactive before it can appear as a raid target.</p>
        </div>

        <form onSubmit={submit} className="max-w-xl rounded-xl border border-[#2a3150] bg-[#161b2e] p-5 space-y-4">
          <div>
            <label htmlFor="min-inactive-days" className="block text-sm font-semibold text-slate-200">Minimum inactive days</label>
            <p className="mt-1 text-xs text-slate-500">Whole days from 1 to 365. The hourly local raid sync retains every nation inactive for at least one day, so this filter applies immediately.</p>
            <input
              id="min-inactive-days"
              type="number"
              min={1}
              max={365}
              step={1}
              value={value}
              onChange={(event) => setDraft(event.target.value)}
              className="mt-3 w-32 rounded-lg border border-[#2a3150] bg-[#0f1117] px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
            />
          </div>
          {mutation.error && <ErrorMessage message={mutation.error instanceof Error ? mutation.error.message : "Save failed"} />}
          {mutation.isSuccess && <p className="text-sm text-emerald-400">Raid finder configuration saved.</p>}
          <button
            type="submit"
            disabled={mutation.isPending || draft === null}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save size={14} /> {mutation.isPending ? "Saving…" : "Save changes"}
          </button>
        </form>
      </div>
    </AppShell>
  );
}
