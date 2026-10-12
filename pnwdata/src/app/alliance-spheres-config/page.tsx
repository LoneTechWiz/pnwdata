"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, Save } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ErrorMessage, LoadingSpinner } from "@/components/LoadingSpinner";
import {
  MAX_SPHERE_NAME,
  MAX_SPHERES,
  TOP_ALLIANCES,
  type AllianceSpheresConfig,
} from "@/lib/alliance-spheres";

interface AllianceOption {
  id: number;
  name: string;
  acronym: string | null;
  score: number;
  nations: number;
  rank: number;
  inTop: boolean;
}

interface ConfigResponse {
  config: AllianceSpheresConfig;
  options: AllianceOption[];
}

const inputClass = "rounded-lg border border-[#2a3150] bg-[#0f1117] px-3 py-2 text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none";

export default function AllianceSpheresConfigPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AllianceSpheresConfig | null>(null);

  const { data, isLoading, error } = useQuery<ConfigResponse>({
    queryKey: ["allianceSpheresConfig"],
    queryFn: async () => {
      const response = await fetch("/api/alliance-spheres-config");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Access denied or failed to load the sphere configuration");
      return body;
    },
  });

  const mutation = useMutation({
    mutationFn: async (config: AllianceSpheresConfig) => {
      const response = await fetch("/api/alliance-spheres-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to save the sphere configuration");
      return body as AllianceSpheresConfig;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["allianceSpheresConfig"] });
      queryClient.invalidateQueries({ queryKey: ["allianceSpheres"] });
      queryClient.setQueryData<ConfigResponse>(["allianceSpheresConfig"], prev => prev && { ...prev, config: saved });
      setDraft(null);
    },
  });

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error || !data) return <AppShell><ErrorMessage message={error instanceof Error ? error.message : "Failed to load"} /></AppShell>;

  const config = draft ?? data.config;
  const edit = (next: AllianceSpheresConfig) => { mutation.reset(); setDraft(next); };

  function setCount(count: number) {
    const target = Math.min(MAX_SPHERES, Math.max(1, count));
    const spheres = config.spheres.slice(0, target);
    while (spheres.length < target) {
      let n = spheres.length + 1;
      while (spheres.some(s => s.name === `Sphere ${n}`)) n++;
      spheres.push({ name: `Sphere ${n}`, alliance_ids: [] });
    }
    edit({ spheres });
  }

  function rename(index: number, name: string) {
    edit({ spheres: config.spheres.map((s, i) => i === index ? { ...s, name } : s) });
  }

  function assign(allianceId: number, sphereIndex: number | null) {
    edit({
      spheres: config.spheres.map((s, i) => {
        const without = s.alliance_ids.filter(id => id !== allianceId);
        return i === sphereIndex ? { ...s, alliance_ids: [...without, allianceId] } : { ...s, alliance_ids: without };
      }),
    });
  }

  const sphereOf = (allianceId: number) => config.spheres.findIndex(s => s.alliance_ids.includes(allianceId));
  const names = config.spheres.map(s => s.name.trim().toLowerCase());
  const nameProblem = config.spheres.some(s => !s.name.trim()) || new Set(names).size !== names.length;
  const optionIds = new Set(data.options.map(o => o.id));
  const unknownIds = config.spheres.flatMap(s => s.alliance_ids).filter(id => !optionIds.has(id));

  function submit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate(config);
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <Network size={20} className="text-amber-400" />
            <h1 className="text-xl font-bold text-white">Alliance Spheres Configuration</h1>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Choose how many spheres to track, name them, and place alliances from the top {TOP_ALLIANCES} into them. An alliance can be in one sphere.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-6 max-w-3xl">
          <div className="rounded-xl border border-[#2a3150] bg-[#161b2e] p-5 space-y-4">
            <div>
              <label htmlFor="sphere-count" className="block text-sm font-semibold text-slate-200">Number of spheres</label>
              <p className="mt-1 text-xs text-slate-500">
                1 to {MAX_SPHERES}. Reducing the number removes the last spheres and frees their alliances.
              </p>
              <input
                id="sphere-count"
                type="number"
                min={1}
                max={MAX_SPHERES}
                step={1}
                value={config.spheres.length}
                onChange={e => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n)) setCount(n); }}
                className={`${inputClass} mt-2 w-24`}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {config.spheres.map((sphere, index) => (
                <div key={index}>
                  <label htmlFor={`sphere-name-${index}`} className="block text-xs font-medium text-slate-400">Sphere {index + 1} name</label>
                  <input
                    id={`sphere-name-${index}`}
                    type="text"
                    maxLength={MAX_SPHERE_NAME}
                    value={sphere.name}
                    onChange={e => rename(index, e.target.value)}
                    className={`${inputClass} mt-1 w-full`}
                  />
                  <p className="mt-1 text-xs text-slate-500">{sphere.alliance_ids.length} alliance{sphere.alliance_ids.length === 1 ? "" : "s"}</p>
                </div>
              ))}
            </div>
            {nameProblem && <p className="text-sm text-amber-400">Every sphere needs a name, and the names must be different.</p>}
          </div>

          <div className="rounded-xl border border-[#2a3150] bg-[#161b2e] overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#2a3150] text-xs font-medium text-slate-400">
                  <th className="px-3 py-3 text-right w-12">#</th>
                  <th className="px-3 py-3 text-left">Alliance</th>
                  <th className="px-3 py-3 text-right">Score</th>
                  <th className="px-3 py-3 text-right">Nations</th>
                  <th className="px-3 py-3 text-left">Sphere</th>
                </tr>
              </thead>
              <tbody>
                {data.options.map((option, index) => {
                  const current = sphereOf(option.id);
                  return (
                    <tr key={option.id} className={`border-b border-[#1e2540] ${current >= 0 ? "bg-[#1a2035]" : ""}`}>
                      <td className="px-3 py-2 text-right text-slate-400">{option.inTop ? index + 1 : "–"}</td>
                      <td className="px-3 py-2 text-white">
                        {option.name}
                        {!option.inTop && <span className="ml-2 text-xs text-amber-400">outside top {TOP_ALLIANCES}</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-300">{Math.round(option.score).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-slate-300">{option.nations.toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={`Sphere for ${option.name}`}
                          value={current >= 0 ? String(current) : ""}
                          onChange={e => assign(option.id, e.target.value === "" ? null : Number(e.target.value))}
                          className="rounded-lg border border-[#2a3150] bg-[#0f1117] px-2 py-1 text-sm text-white focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">None</option>
                          {config.spheres.map((s, i) => <option key={i} value={i}>{s.name || `Sphere ${i + 1}`}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {unknownIds.length > 0 && (
            <p className="text-sm text-amber-400">
              Alliance IDs {unknownIds.join(", ")} are in a sphere but no longer exist. They will stay until you save over them.
            </p>
          )}
          {mutation.error && <ErrorMessage message={mutation.error instanceof Error ? mutation.error.message : "Save failed"} />}
          {mutation.isSuccess && draft === null && <p className="text-sm text-emerald-400">Spheres saved.</p>}

          <button
            type="submit"
            disabled={mutation.isPending || draft === null || nameProblem}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save size={14} /> {mutation.isPending ? "Saving…" : "Save changes"}
          </button>
        </form>
      </div>
    </AppShell>
  );
}
