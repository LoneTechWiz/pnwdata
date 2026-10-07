"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, RotateCcw, Save } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ErrorMessage, LoadingSpinner } from "@/components/LoadingSpinner";
import {
  parseNumberList,
  STAGNANT_DEFAULTS,
  type StagnantCitiesConfig,
} from "@/lib/stagnant-config";

interface Draft {
  minTurns: string;
  minCities: string;
  maxCities: string;
  taxIds: string;
  excludedCities: string;
}

function toDraft(config: StagnantCitiesConfig): Draft {
  return {
    minTurns: String(config.min_turns),
    minCities: config.min_cities === null ? "" : String(config.min_cities),
    maxCities: config.max_cities === null ? "" : String(config.max_cities),
    taxIds: config.tax_ids.join(", "),
    excludedCities: config.excluded_cities.join(", "),
  };
}

const inputClass = "mt-2 rounded-lg border border-[#2a3150] bg-[#0f1117] px-3 py-2 text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none";

export default function StagnantCitiesConfigPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<StagnantCitiesConfig>({
    queryKey: ["stagnantCitiesConfig"],
    queryFn: async () => {
      const response = await fetch("/api/stagnant-cities-config");
      if (!response.ok) throw new Error("Failed to load the Stagnant Cities defaults");
      return response.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async (config: StagnantCitiesConfig) => {
      const response = await fetch("/api/stagnant-cities-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to save the defaults");
      return body as StagnantCitiesConfig;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["stagnantCitiesConfig"], saved);
      setDraft(null);
    },
  });

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error || !data) return <AppShell><ErrorMessage message={error instanceof Error ? error.message : "Failed to load"} /></AppShell>;

  const values = draft ?? toDraft(data);
  const update = (patch: Partial<Draft>) => { setFormError(null); setDraft({ ...values, ...patch }); };

  function submit(event: FormEvent) {
    event.preventDefault();
    const taxIds = parseNumberList(values.taxIds);
    const excluded = parseNumberList(values.excludedCities);
    if (!taxIds) return setFormError("Tax IDs must be whole numbers separated by commas or spaces");
    if (!excluded) return setFormError("Excluded cities must be whole numbers separated by commas or spaces");
    setFormError(null);
    mutation.mutate({
      min_turns: Number(values.minTurns),
      min_cities: values.minCities.trim() === "" ? null : Number(values.minCities),
      max_cities: values.maxCities.trim() === "" ? null : Number(values.maxCities),
      tax_ids: taxIds,
      excluded_cities: excluded,
    });
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <Layers size={20} className="text-amber-400" />
            <h1 className="text-xl font-bold text-white">Stagnant Cities Defaults</h1>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            The filters the Stagnant Cities page starts with. Anyone can still change them on the page itself for their own session.
          </p>
        </div>

        <form onSubmit={submit} className="max-w-xl rounded-xl border border-[#2a3150] bg-[#161b2e] p-5 space-y-5">
          <div>
            <label htmlFor="min-turns" className="block text-sm font-semibold text-slate-200">Minimum turns since last city</label>
            <p className="mt-1 text-xs text-slate-500">Nations with more turns than this (2 hours each) are listed.</p>
            <input id="min-turns" type="number" min={0} step={1} value={values.minTurns}
              onChange={e => update({ minTurns: e.target.value })} className={`${inputClass} w-32`} />
          </div>

          <div className="grid grid-cols-2 gap-4 max-w-sm">
            <div>
              <label htmlFor="min-cities" className="block text-sm font-semibold text-slate-200">Min cities</label>
              <input id="min-cities" type="number" min={0} step={1} placeholder="no limit" value={values.minCities}
                onChange={e => update({ minCities: e.target.value })} className={`${inputClass} w-full`} />
            </div>
            <div>
              <label htmlFor="max-cities" className="block text-sm font-semibold text-slate-200">Max cities</label>
              <input id="max-cities" type="number" min={0} step={1} placeholder="no limit" value={values.maxCities}
                onChange={e => update({ maxCities: e.target.value })} className={`${inputClass} w-full`} />
            </div>
          </div>

          <div>
            <label htmlFor="tax-ids" className="block text-sm font-semibold text-slate-200">Tax IDs</label>
            <p className="mt-1 text-xs text-slate-500">Only these tax IDs are listed. Separate with commas or spaces. Leave blank to include every tax ID.</p>
            <textarea id="tax-ids" rows={3} value={values.taxIds}
              onChange={e => update({ taxIds: e.target.value })} className={`${inputClass} w-full font-mono text-sm`} />
          </div>

          <div>
            <label htmlFor="excluded-cities" className="block text-sm font-semibold text-slate-200">Excluded city counts</label>
            <p className="mt-1 text-xs text-slate-500">City counts inside the min–max range to leave out by default, for example 25, 30. Leave blank to include them all.</p>
            <input id="excluded-cities" type="text" value={values.excludedCities}
              onChange={e => update({ excludedCities: e.target.value })} className={`${inputClass} w-full font-mono text-sm`} />
          </div>

          {formError && <ErrorMessage message={formError} />}
          {mutation.error && <ErrorMessage message={mutation.error instanceof Error ? mutation.error.message : "Save failed"} />}
          {mutation.isSuccess && draft === null && <p className="text-sm text-emerald-400">Defaults saved.</p>}

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
              onClick={() => { setFormError(null); setDraft(toDraft(STAGNANT_DEFAULTS)); }}
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
