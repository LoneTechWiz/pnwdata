"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Swords, Landmark, BarChart2, Shield, Building2, Search, Clock, Calculator, Target, UserPlus, DollarSign, Crosshair } from "lucide-react";

const nav = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Members", href: "/members", icon: Users },
  { label: "Applicants", href: "/applicants", icon: UserPlus },
  { label: "Military", href: "/military", icon: Shield },
  { label: "MMR Checker", href: "/mmr", icon: Target },
  { label: "Infra & Land", href: "/infra", icon: Building2 },
  { label: "Wars", href: "/wars", icon: Swords },
  { label: "War Targets", href: "/war-targets", icon: Crosshair },
  { label: "Bank", href: "/bank", icon: Landmark },
  { label: "Charts", href: "/charts", icon: BarChart2 },
  { label: "Inactive", href: "/inactive", icon: Clock },
  { label: "City Build", href: "/optimizer", icon: Calculator },
  { label: "Explore", href: "/explore", icon: Search },
];

export function Sidebar({ allianceName }: { allianceName?: string }) {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 bg-[#161b2e] border-r border-[#2a3150] flex flex-col min-h-screen">
      <div className="p-5 border-b border-[#2a3150]">
        <div className="flex items-center gap-2 mb-1">
          <Shield size={20} className="text-blue-400" />
          <span className="font-bold text-white text-sm">PnW Analytics</span>
        </div>
        {allianceName && (
          <p className="text-xs text-slate-400 truncate">{allianceName}</p>
        )}
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {nav.map(({ label, href, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:bg-[#1e2540] hover:text-white"
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-[#2a3150]">
        <p className="text-xs text-slate-600">Politics & War</p>
      </div>
    </aside>
  );
}
