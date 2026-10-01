"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { Save, Bell, BellOff } from "lucide-react";

interface StockpileAlertConfig {
  enabled: boolean;
  thresholds: Record<string, number | null>;
}

const RESOURCES = [
  { key: "money",     label: "Cash",       color: "text-yellow-400",  hint: "e.g. 2000000" },
  { key: "coal",      label: "Coal",       color: "text-stone-400",   hint: "e.g. 500"     },
  { key: "oil",       label: "Oil",        color: "text-amber-600",   hint: "e.g. 500"     },
  { key: "uranium",   label: "Uranium",    color: "text-lime-400",    hint: "e.g. 100"     },
  { key: "iron",      label: "Iron",       color: "text-zinc-400",    hint: "e.g. 500"     },
  { key: "bauxite",   label: "Bauxite",    color: "text-orange-300",  hint: "e.g. 500"     },
  { key: "lead",      label: "Lead",       color: "text-slate-400",   hint: "e.g. 500"     },
  { key: "gasoline",  label: "Gasoline",   color: "text-orange-400",  hint: "e.g. 500"     },
  { key: "munitions", label: "Munitions",  color: "text-red-400",     hint: "e.g. 500"     },
  { key: "steel",     label: "Steel",      color: "text-slate-300",   hint: "e.g. 500"     },
  { key: "aluminum",  label: "Aluminum",   color: "text-cyan-400",    hint: "e.g. 500"     },
  { key: "food",      label: "Food",       color: "text-green-400",   hint: "e.g. 3000"    },
];

export default function StockpileAlertConfigPage() {
  const queryClient = useQueryClient();

  const { data: saved, isLoading, error } = useQuery<StockpileAlertConfig>({
    queryKey: ["stockpileAlertConfig"],
    queryFn: () => fetch("/api/stockpile-alert-config").then(r => {
      if (!r.ok) throw new Error("Forbidden");
      return r.json();
    }),
  });

  const [local, setLocal] = useState<StockpileAlertConfig | null>(null);

  const active = useMemo<StockpileAlertConfig>(() => {
    if (local !== null) return local;
    return saved ?? { enabled: false, thresholds: {} };
  }, [local, saved]);

  const saveMutation = useMutation({
    mutationFn: (cfg: StockpileAlertConfig) =>
      fetch("/api/stockpile-alert-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stockpileAlertConfig"] });
      setLocal(null);
    },
  });

  function setEnabled(enabled: boolean) {
    setLocal({ ...active, enabled });
  }

  function setThreshold(key: string, raw: string) {
    const value = raw === "" ? null : parseFloat(raw);
    setLocal({ ...active, thresholds: { ...active.thresholds, [key]: value } });
  }

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message="Access denied or failed to load." /></AppShell>;

  const isDirty = local !== null;

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Stockpile Alert Config</h1>
            <p className="text-slate-400 text-sm mt-1">
              Members exceeding any per-city threshold will receive a Discord DM after each sync (24h cooldown per resource).
            </p>
          </div>
          <button
            onClick={() => saveMutation.mutate(active)}
            disabled={!isDirty || saveMutation.isPending}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Save size={14} />
            {saveMutation.isPending ? "Saving…" : "Save Changes"}
          </button>
        </div>

        {saveMutation.isError && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            Failed to save. Please try again.
          </div>
        )}

        {/* Enable toggle */}
        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {active.enabled
              ? <Bell size={18} className="text-blue-400" />
              : <BellOff size={18} className="text-slate-500" />}
            <div>
              <p className="text-sm font-medium text-white">
                Alerts are <span className={active.enabled ? "text-green-400" : "text-slate-400"}>
                  {active.enabled ? "enabled" : "disabled"}
                </span>
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Toggle to start or stop sending stockpile DMs to members.
              </p>
            </div>
          </div>
          <button
            onClick={() => setEnabled(!active.enabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              active.enabled ? "bg-blue-600" : "bg-[#2a3150]"
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              active.enabled ? "translate-x-6" : "translate-x-1"
            }`} />
          </button>
        </div>

        {/* Threshold inputs */}
        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Thresholds</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Leave blank to disable alerts for that resource. Members holding more than threshold × cities will be notified — except uranium, which uses a flat (total) threshold.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {RESOURCES.map(r => {
              const val = active.thresholds[r.key];
              const isFlat = r.key === "uranium";
              return (
                <div key={r.key}>
                  <label className={`block text-xs font-medium mb-1 ${r.color}`}>{r.label} {isFlat ? "(total)" : "/ city"}</label>
                  <input
                    type="number"
                    min="0"
                    placeholder={r.hint}
                    value={val != null ? String(val) : ""}
                    onChange={e => setThreshold(r.key, e.target.value)}
                    className="w-full bg-[#0f1117] border border-[#2a3150] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
