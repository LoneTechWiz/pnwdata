"use client";
import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMembers, fetchSyncStatus } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { SyncingPlaceholder } from "@/components/SyncingPlaceholder";
import {
  Plus, X, ArrowUpDown, SlidersHorizontal, ChevronDown, ChevronUp,
  RotateCcw, Bookmark,
} from "lucide-react";
import { ExportButton } from "@/components/ExportButton";
import {
  FIELDS, FIELD_MAP, GROUPS, Filter, opsForField, defaultOp,
  applyFilter, DEFAULT_FIELDS, PRESETS,
} from "./fieldDefs";

const STORAGE_KEY = "pnw_explore_v1";

function load() {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) return JSON.parse(raw) as { selectedFields: string[]; filters: Filter[] };
  } catch {}
  return null;
}

function save(selectedFields: string[], filters: Filter[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedFields, filters })); } catch {}
}

function newFilter(fieldKey: string): Filter {
  const field = FIELD_MAP[fieldKey];
  return { id: Math.random().toString(36).slice(2), field: fieldKey, op: field ? defaultOp(field) : "=", value: "" };
}

// ---- Sub-components ----

function FieldGroup({ group, selectedFields, toggle }: {
  group: string;
  selectedFields: string[];
  toggle: (key: string) => void;
}) {
  const groupFields = FIELDS.filter(f => f.group === group);
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{group}</p>
      <div className="flex flex-wrap gap-1.5">
        {groupFields.map(f => {
          const on = selectedFields.includes(f.key);
          return (
            <button
              key={f.key}
              onClick={() => toggle(f.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                on
                  ? "bg-blue-600 border-blue-500 text-white"
                  : "bg-[#1e2540] border-[#2a3150] text-slate-400 hover:border-blue-500 hover:text-slate-200"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilterRow({ filter, onChange, onRemove }: {
  filter: Filter;
  onChange: (f: Filter) => void;
  onRemove: () => void;
}) {
  const field = FIELD_MAP[filter.field];
  const ops = field ? opsForField(field) : ["="];

  const selectCls = "bg-[#1e2540] border border-[#2a3150] rounded-lg text-xs text-slate-200 px-2 py-1.5 focus:outline-none focus:border-blue-500";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Field selector */}
      <select
        value={filter.field}
        onChange={e => {
          const newField = FIELD_MAP[e.target.value];
          onChange({ ...filter, field: e.target.value, op: newField ? defaultOp(newField) : "=", value: "" });
        }}
        className={selectCls}
      >
        {GROUPS.map(g => (
          <optgroup key={g} label={g}>
            {FIELDS.filter(f => f.group === g).map(f => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* Operator */}
      <select
        value={filter.op}
        onChange={e => onChange({ ...filter, op: e.target.value })}
        className={selectCls}
      >
        {ops.map(op => <option key={op} value={op}>{op}</option>)}
      </select>

      {/* Value — dropdown for enum, text for others */}
      {field?.type === "enum" && field.options ? (
        <select
          value={filter.value}
          onChange={e => onChange({ ...filter, value: e.target.value })}
          className={selectCls}
        >
          <option value="">— any —</option>
          {field.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={field?.type === "number" ? "number" : "text"}
          value={filter.value}
          onChange={e => onChange({ ...filter, value: e.target.value })}
          placeholder="value…"
          className="bg-[#1e2540] border border-[#2a3150] rounded-lg text-xs text-slate-200 px-2 py-1.5 w-28 focus:outline-none focus:border-blue-500 placeholder-slate-600"
        />
      )}

      <button onClick={onRemove} className="text-slate-600 hover:text-red-400 transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}

// ---- Main page ----

export default function ExplorePage() {
  const [configOpen, setConfigOpen] = useState(true);
  const [selectedFields, setSelectedFields] = useState<string[]>(DEFAULT_FIELDS);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [hydrated, setHydrated] = useState(false);

  // Load persisted config after hydration
  useEffect(() => {
    const saved = load();
    if (saved) {
      if (saved.selectedFields?.length) setSelectedFields(saved.selectedFields);
      if (saved.filters) setFilters(saved.filters);
    }
    setHydrated(true);
  }, []);

  // Persist on every change
  useEffect(() => {
    if (hydrated) save(selectedFields, filters);
  }, [selectedFields, filters, hydrated]);

  const { data: members = [], isLoading, error } = useQuery({
    queryKey: ["members"],
    queryFn: fetchMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: status } = useQuery({ queryKey: ["syncStatus"], queryFn: fetchSyncStatus, refetchInterval: 15_000 });

  const toggleField = useCallback((key: string) => {
    setSelectedFields(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  }, []);

  const addFilter = () => setFilters(prev => [...prev, newFilter(FIELDS[0].key)]);

  const updateFilter = (id: string, updated: Filter) =>
    setFilters(prev => prev.map(f => f.id === id ? updated : f));

  const removeFilter = (id: string) =>
    setFilters(prev => prev.filter(f => f.id !== id));

  const applyPreset = (preset: typeof PRESETS[number]) => {
    setSelectedFields(preset.fields);
    setFilters(preset.filters.map(f => ({ ...f, id: Math.random().toString(36).slice(2) })));
  };

  const reset = () => { setSelectedFields(DEFAULT_FIELDS); setFilters([]); };

  function handleSort(key: string) {
    if (key === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={(error as Error).message} /></AppShell>;
  if (members.length === 0 && (status?.status === "never" || status?.status === "syncing")) {
    return <AppShell><SyncingPlaceholder /></AppShell>;
  }

  const visibleFieldDefs = selectedFields.map(k => FIELD_MAP[k]).filter(Boolean);

  const rows = members
    .filter(n => filters.every(f => applyFilter(n, f)))
    .sort((a, b) => {
      const field = FIELD_MAP[sortKey];
      if (!field) return 0;
      const av = field.getValue(a);
      const bv = field.getValue(b);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });

  const activeFilterCount = filters.filter(f => f.value.trim()).length;

  return (
    <AppShell>
      <div className="space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Explore</h2>
            <p className="text-slate-400 text-sm">
              {rows.length} of {members.length} nations
              {activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""} active`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ExportButton
              filename="explore"
              getData={() => rows.map(nation => {
                const row: Record<string, unknown> = {};
                for (const f of visibleFieldDefs) {
                  row[f.label] = f.getValue(nation);
                }
                return row;
              })}
            />
            <button
              onClick={reset}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors px-3 py-1.5 rounded-lg border border-[#2a3150] hover:border-slate-500"
            >
              <RotateCcw size={12} /> Reset
            </button>
            <button
              onClick={() => setConfigOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#2a3150] bg-[#161b2e] text-slate-300 hover:border-blue-500 transition-colors"
            >
              <SlidersHorizontal size={12} />
              Configure
              {configOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>
        </div>

        {/* Config panel */}
        {configOpen && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 space-y-5">

            {/* Presets */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Bookmark size={13} className="text-slate-500" />
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Presets</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(p)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-[#1e2540] border border-[#2a3150] text-slate-300 hover:border-blue-500 hover:text-white transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-[#2a3150]" />

            {/* Fields */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Columns</span>
                <span className="text-xs text-slate-600">({selectedFields.length} selected)</span>
              </div>
              <div className="space-y-3">
                {GROUPS.map(g => (
                  <FieldGroup key={g} group={g} selectedFields={selectedFields} toggle={toggleField} />
                ))}
              </div>
            </div>

            <div className="border-t border-[#2a3150]" />

            {/* Filters */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Filters</span>
                <button
                  onClick={addFilter}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <Plus size={13} /> Add filter
                </button>
              </div>
              {filters.length === 0 ? (
                <p className="text-xs text-slate-600 italic">No filters — showing all nations</p>
              ) : (
                <div className="space-y-2">
                  {filters.map(f => (
                    <FilterRow
                      key={f.id}
                      filter={f}
                      onChange={updated => updateFilter(f.id, updated)}
                      onRemove={() => removeFilter(f.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Selected field pills (collapsed summary) */}
        {!configOpen && selectedFields.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-slate-600">Columns:</span>
            {visibleFieldDefs.map(f => (
              <span key={f.key} className="text-xs bg-[#1e2540] text-slate-400 px-2 py-0.5 rounded-full border border-[#2a3150]">
                {f.label}
              </span>
            ))}
            {activeFilterCount > 0 && (
              <>
                <span className="text-xs text-slate-600 ml-2">Filters:</span>
                {filters.filter(f => f.value.trim()).map(f => {
                  const fd = FIELD_MAP[f.field];
                  return (
                    <span key={f.id} className="text-xs bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded-full border border-blue-700/30">
                      {fd?.label} {f.op} {f.value}
                    </span>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* Results table */}
        {selectedFields.length === 0 ? (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center">
            <p className="text-slate-400">Select at least one column above</p>
          </div>
        ) : (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#2a3150]">
                  {visibleFieldDefs.map(f => {
                    const active = sortKey === f.key;
                    return (
                      <th
                        key={f.key}
                        onClick={() => handleSort(f.key)}
                        className="px-4 py-3 cursor-pointer select-none group text-left"
                      >
                        <span className={`flex items-center gap-1 text-xs font-medium ${active ? "text-blue-400" : "text-slate-400 group-hover:text-slate-200"}`}>
                          {f.label}
                          <ArrowUpDown size={10} className={active ? "opacity-100" : "opacity-30"} />
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={visibleFieldDefs.length} className="px-4 py-12 text-center text-slate-500 text-sm">
                      No nations match the current filters
                    </td>
                  </tr>
                ) : (
                  rows.map(nation => (
                    <tr key={nation.id} className="border-b border-[#1e2540] hover:bg-[#1a2035] transition-colors">
                      {visibleFieldDefs.map(f => {
                        const raw = f.getValue(nation);
                        const display = f.format ? f.format(raw) : String(raw);
                        const isName = f.key === "nation_name";
                        return (
                          <td key={f.key} className="px-4 py-2.5 text-slate-300">
                            {isName ? (
                              <a
                                href={`https://politicsandwar.com/nation/id=${nation.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-white font-medium hover:text-blue-400 transition-colors"
                              >
                                {display}
                              </a>
                            ) : (
                              <span className={f.type === "number" ? "tabular-nums" : ""}>{display}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {rows.length > 0 && (
              <div className="px-4 py-2 border-t border-[#1e2540] text-xs text-slate-600">
                {rows.length} nation{rows.length !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
