"use client";
import { useState, useMemo, KeyboardEvent, ClipboardEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { Save, X, Plus } from "lucide-react";

interface WarConfig {
  enemy_alliance_ids: number[];
  ally_alliance_ids: number[];
}

function IdChip({ id, onRemove }: { id: number; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-medium border border-slate-600 text-slate-200 bg-slate-700/40">
      {id}
      <button onClick={onRemove} className="hover:opacity-70 transition-opacity ml-0.5">
        <X size={10} />
      </button>
    </span>
  );
}

function AddIdInput({ onAdd }: { onAdd: (ids: number[]) => void }) {
  const [value, setValue] = useState("");

  function parseIds(raw: string): number[] {
    return raw.split(/[\s,]+/).map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n > 0);
  }

  function commit() {
    const ids = parseIds(value);
    if (ids.length > 0) {
      onAdd(ids);
      setValue("");
    }
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (pasted.includes(",") || pasted.includes(" ") || pasted.includes("\n")) {
      e.preventDefault();
      const ids = parseIds(pasted);
      if (ids.length > 0) {
        onAdd(ids);
        setValue("");
      }
    }
  }

  return (
    <div className="flex items-center gap-1 mt-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        onPaste={handlePaste}
        placeholder="ID or comma-separated list…"
        className="bg-[#0f1117] border border-[#2a3150] rounded px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-52"
      />
      <button
        onClick={commit}
        disabled={!value.trim()}
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-400 border border-dashed border-[#2a3150] hover:border-slate-500 hover:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Plus size={10} /> Add
      </button>
    </div>
  );
}

export default function WarConfigPage() {
  const queryClient = useQueryClient();

  const { data: warConfig, isLoading, error } = useQuery<WarConfig>({
    queryKey: ["warConfig"],
    queryFn: () => fetch("/api/war-config").then((r) => {
      if (!r.ok) throw new Error("Forbidden");
      return r.json();
    }),
  });

  const [local, setLocal] = useState<WarConfig | null>(null);

  const active = useMemo<WarConfig>(() => {
    if (local !== null) return local;
    return warConfig ?? { enemy_alliance_ids: [], ally_alliance_ids: [] };
  }, [local, warConfig]);

  const saveMutation = useMutation({
    mutationFn: (cfg: WarConfig) =>
      fetch("/api/war-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warConfig"] });
      setLocal(null);
    },
  });

  function addId(list: "enemy_alliance_ids" | "ally_alliance_ids", ids: number[]) {
    const existing = new Set(active[list]);
    const toAdd = ids.filter((id) => !existing.has(id));
    if (toAdd.length === 0) return;
    setLocal({ ...active, [list]: [...active[list], ...toAdd].sort((a, b) => a - b) });
  }

  function removeId(list: "enemy_alliance_ids" | "ally_alliance_ids", id: number) {
    setLocal({ ...active, [list]: active[list].filter((x) => x !== id) });
  }

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message="Access denied or failed to load." /></AppShell>;

  const isDirty = local !== null;

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">War Configuration</h1>
            <p className="text-slate-400 text-sm mt-1">
              Manage enemy and ally alliance IDs used by War Targets and Conflict Stats.
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {(["enemy_alliance_ids", "ally_alliance_ids"] as const).map((list) => {
            const label = list === "enemy_alliance_ids" ? "Enemy Alliances" : "Ally Alliances";
            const accent = list === "enemy_alliance_ids" ? "text-red-400" : "text-green-400";
            return (
              <div key={list} className="rounded-xl border border-[#2a3150] bg-[#161b2e] p-5 space-y-3">
                <div>
                  <h2 className={`font-semibold text-sm ${accent}`}>{label}</h2>
                  <p className="text-slate-500 text-xs mt-0.5">{active[list].length} alliance{active[list].length !== 1 ? "s" : ""}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
                  {active[list].map((id) => (
                    <IdChip key={id} id={id} onRemove={() => removeId(list, id)} />
                  ))}
                  {active[list].length === 0 && (
                    <span className="text-slate-600 text-xs italic">No alliances added</span>
                  )}
                </div>
                <AddIdInput onAdd={(ids) => addId(list, ids)} />
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
