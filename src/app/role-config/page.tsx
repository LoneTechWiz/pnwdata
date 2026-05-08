// src/app/role-config/page.tsx
"use client";
import { useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { Save, X, ChevronDown } from "lucide-react";

interface GuildRole {
  id: string;
  name: string;
  color: number;
}

interface RoleConfig {
  pages: Record<string, string[]>;
}

const ALL_PAGES = [
  "/dashboard", "/members", "/applicants", "/military", "/mmr",
  "/infra", "/wars", "/bank", "/cashholders", "/charts",
  "/inactive", "/explore", "/slots", "/command-center", "/beige-watch", "/ai-targets", "/relink", "/credits", "/role-config", "/war-config", "/stockpile-alert-config",
];

function roleColor(color: number): string {
  if (color === 0) return "#94a3b8";
  return `#${color.toString(16).padStart(6, "0")}`;
}

function RoleChip({ role, onRemove }: { role: GuildRole; onRemove: () => void }) {
  const color = roleColor(role.color);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border"
      style={{ color, borderColor: `${color}40`, backgroundColor: `${color}18` }}
    >
      {role.name}
      <button onClick={onRemove} className="hover:opacity-70 transition-opacity ml-0.5">
        <X size={10} />
      </button>
    </span>
  );
}

function RoleDropdown({
  available,
  onAdd,
}: {
  available: GuildRole[];
  onAdd: (role: GuildRole) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, openUp: false });

  const filtered = available.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase())
  );

  function handleOpen() {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < 260;
      setDropPos({ top: openUp ? rect.top : rect.bottom + 4, left: rect.left, openUp });
    }
    setSearch("");
    setOpen(true);
  }

  if (available.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-slate-400 border border-dashed border-[#2a3150] hover:border-slate-500 hover:text-slate-300 transition-colors"
      >
        Add role <ChevronDown size={10} />
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 bg-[#1e2540] border border-[#2a3150] rounded-lg shadow-xl w-52"
            style={
              dropPos.openUp
                ? { bottom: window.innerHeight - dropPos.top + 4, left: dropPos.left }
                : { top: dropPos.top, left: dropPos.left }
            }
          >
            <div className="p-2 border-b border-[#2a3150]">
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search roles…"
                className="w-full bg-[#0f1117] border border-[#2a3150] rounded px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="max-h-48 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-2 text-xs text-slate-500">No roles found</p>
              ) : (
                filtered.map((role) => (
                  <button
                    key={role.id}
                    onClick={() => { onAdd(role); setOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#2a3150] transition-colors"
                    style={{ color: roleColor(role.color) }}
                  >
                    {role.name}
                  </button>
                ))
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

export default function RoleConfigPage() {
  const queryClient = useQueryClient();

  const { data: guildRoles = [], isLoading: rolesLoading, error: rolesErr } = useQuery<GuildRole[]>({
    queryKey: ["guildRoles"],
    queryFn: () => fetch("/api/auth/guild-roles").then((r) => r.json()),
  });

  const { data: roleConfig, isLoading: configLoading, error: configErr } = useQuery<RoleConfig>({
    queryKey: ["roleConfig"],
    queryFn: () => fetch("/api/auth/role-config").then((r) => r.json()),
  });

  const [localConfig, setLocalConfig] = useState<Record<string, string[]> | null>(null);

  const activeConfig = useMemo(() => {
    if (localConfig !== null) return localConfig;
    return roleConfig?.pages ?? {};
  }, [localConfig, roleConfig]);

  const roleById = useMemo(() => {
    return Object.fromEntries(guildRoles.map((r) => [r.id, r]));
  }, [guildRoles]);

  const saveMutation = useMutation({
    mutationFn: (pages: Record<string, string[]>) =>
      fetch("/api/auth/role-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roleConfig"] });
      setLocalConfig(null);
    },
  });

  function addRole(page: string, role: GuildRole) {
    const current = activeConfig[page] ?? [];
    if (current.includes(role.id)) return;
    setLocalConfig({ ...activeConfig, [page]: [...current, role.id] });
  }

  function removeRole(page: string, roleId: string) {
    const current = activeConfig[page] ?? [];
    setLocalConfig({ ...activeConfig, [page]: current.filter((id) => id !== roleId) });
  }

  const isLoading = rolesLoading || configLoading;
  const error = rolesErr || configErr;

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={String(error)} /></AppShell>;

  const isDirty = localConfig !== null;

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Role Configuration</h1>
            <p className="text-slate-400 text-sm mt-1">
              Control which Discord roles can access each page.
            </p>
          </div>
          <button
            onClick={() => saveMutation.mutate(activeConfig)}
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

        <div className="rounded-xl border border-[#2a3150] overflow-hidden">
          {ALL_PAGES.map((page, i) => {
            const allowedIds = activeConfig[page] ?? [];
            const allowedRoles = allowedIds.map((id) => roleById[id]).filter(Boolean);
            const availableRoles = guildRoles.filter((r) => !allowedIds.includes(r.id));

            return (
              <div
                key={page}
                className={`flex items-center gap-4 px-4 py-3 ${
                  i !== ALL_PAGES.length - 1 ? "border-b border-[#2a3150]" : ""
                } hover:bg-[#1a1f35] transition-colors`}
              >
                <span className="font-mono text-slate-300 text-sm w-40 shrink-0">{page}</span>
                <div className="flex items-center gap-2 flex-wrap flex-1">
                  {allowedRoles.map((role) => (
                    <RoleChip
                      key={role.id}
                      role={role}
                      onRemove={() => removeRole(page, role.id)}
                    />
                  ))}
                  <RoleDropdown available={availableRoles} onAdd={(role) => addRole(page, role)} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
