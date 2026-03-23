// src/app/role-config/page.tsx
"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { Save } from "lucide-react";

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
  "/inactive", "/explore", "/slots", "/command-center",
];

function roleColor(color: number): string {
  if (color === 0) return "#94a3b8";
  return `#${color.toString(16).padStart(6, "0")}`;
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

  function toggleRole(page: string, roleId: string) {
    const current = activeConfig[page] ?? [];
    const next = current.includes(roleId)
      ? current.filter((id) => id !== roleId)
      : [...current, roleId];
    setLocalConfig({ ...activeConfig, [page]: next });
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

        <div className="rounded-xl border border-[#2a3150] overflow-x-auto">
          <table className="w-full text-sm text-white min-w-max">
            <thead className="bg-[#161b2e] text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Page</th>
                {guildRoles.map((role) => (
                  <th key={role.id} className="px-3 py-3 text-center whitespace-nowrap">
                    <span style={{ color: roleColor(role.color) }}>{role.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a3150]">
              {ALL_PAGES.map((page) => (
                <tr key={page} className="hover:bg-[#1e2540] transition-colors">
                  <td className="px-4 py-2 font-mono text-slate-300">{page}</td>
                  {guildRoles.map((role) => {
                    const checked = (activeConfig[page] ?? []).includes(role.id);
                    return (
                      <td key={role.id} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRole(page, role.id)}
                          className="w-4 h-4 accent-blue-500 cursor-pointer"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
