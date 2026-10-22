"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hammer, RotateCcw, Save } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ErrorMessage, LoadingSpinner } from "@/components/LoadingSpinner";
import { fetchRebuildConfig } from "@/lib/pnw";
import { REBUILD_DEFAULTS, REBUILD_TIER_RANGES, type RebuildConfig } from "@/lib/rebuild-cost";

type Draft = { start: string; target: string }[];

function toDraft(config: RebuildConfig): Draft {
  return config.tiers.map((t) => ({ start: String(t.start_infra), target: String(t.target_infra) }));
}

const inputClass = "mt-2 w-32 rounded-lg border border-[#2a3150] bg-[#0f1117] px-3 py-2 text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none";

export default function RebuildConfigPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ["rebuildConfig"], queryFn: fetchRebuildConfig });

  const mutation = useMutation({
    mutationFn: async (values: Draft) => {
      const response = await fetch("/api/rebuild-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiers: values.map((v) => ({ start_infra: v.start, target_infra: v.target })) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to save the settings");
      return body as RebuildConfig;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["rebuildConfig"], saved);
      setDraft(null);
    },
  });

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error || !data) return <AppShell><ErrorMessage message={error instanceof Error ? error.message : "Failed to load"} /></AppShell>;

  const values = draft ?? toDraft(data);
  const update = (index: number, patch: Partial<Draft[number]>) =>
    setDraft(values.map((v, i) => (i === index ? { ...v, ...patch } : v)));

  function submit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate(values);
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <Hammer size={20} className="text-amber-400" />
            <h1 className="text-xl font-bold text-white">Rebuild Cost Settings</h1>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            The infrastructure level each city starts from and is rebuilt to, by how many cities the nation has. The Rebuild Cost page prices every member against these.
          </p>
        </div>

        <form onSubmit={submit} className="max-w-xl rounded-xl border border-[#2a3150] bg-[#161b2e] p-5 space-y-5">
          {REBUILD_TIER_RANGES.map((range, i) => (
            <div key={range.label} className="flex flex-wrap items-end gap-6 border-b border-[#2a3150] pb-5 last:border-0 last:pb-0">
              <div className="w-36 text-sm font-semibold text-slate-200">{range.label}</div>
              <div>
                <label htmlFor={`start-${i}`} className="block text-xs text-slate-400">Starting infra</label>
                <input id={`start-${i}`} type="number" min={0} step={1} value={values[i].start}
                  onChange={(e) => update(i, { start: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor={`target-${i}`} className="block text-xs text-slate-400">Target infra</label>
                <input id={`target-${i}`} type="number" min={0} step={1} value={values[i].target}
                  onChange={(e) => update(i, { target: e.target.value })} className={inputClass} />
              </div>
            </div>
          ))}

          {mutation.error && <ErrorMessage message={mutation.error instanceof Error ? mutation.error.message : "Save failed"} />}
          {mutation.isSuccess && draft === null && <p className="text-sm text-emerald-400">Settings saved.</p>}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={mutation.isPending || draft === null}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save size={14} /> {mutation.isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => setDraft(toDraft(REBUILD_DEFAULTS))}
              className="inline-flex items-center gap-2 rounded-lg border border-[#2a3150] bg-[#1e2540] px-4 py-2 text-sm font-medium text-slate-300 hover:bg-[#2a3150] hover:text-white"
            >
              <RotateCcw size={14} /> Reset to built-in defaults
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
