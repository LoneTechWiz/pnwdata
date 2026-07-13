"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Users, Swords, Landmark, BarChart2, Shield,
  Building2, Search, Clock, Calculator, Target, UserPlus,
  DollarSign, Crosshair, Radio, LogOut, LogIn, Settings, ShieldOff, Brain, Link2, BellRing, Coins, Trophy, Layers,
} from "lucide-react";

const nav = [
  { label: "War Targets", href: "/war-targets", icon: Crosshair },
];

const hiddenNav = [
  // Overview
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Charts", href: "/charts", icon: BarChart2 },
  // Members
  { label: "Members", href: "/members", icon: Users },
  { label: "Applicants", href: "/applicants", icon: UserPlus },
  { label: "Relink", href: "/relink", icon: Link2 },
  { label: "Inactive", href: "/inactive", icon: Clock },
  { label: "Explore", href: "/explore", icon: Search },
  // Military & War
  { label: "Military", href: "/military", icon: Shield },
  { label: "MMR Checker", href: "/mmr", icon: Target },
  { label: "Wars", href: "/wars", icon: Swords },
  { label: "Need to Declare", href: "/slots", icon: Swords },
  { label: "Command Center", href: "/command-center", icon: Radio },
  { label: "Beige Watch", href: "/beige-watch", icon: ShieldOff },
  { label: "AI Targets", href: "/ai-targets", icon: Brain },
  { label: "Tiering", href: "/tiering", icon: Layers },
  { label: "City Build", href: "/optimizer", icon: Calculator },
  // Economy
  { label: "Infra & Land", href: "/infra", icon: Building2 },
  { label: "Bank", href: "/bank", icon: Landmark },
  { label: "Stockpile", href: "/cashholders", icon: DollarSign },
  { label: "Credits", href: "/credits", icon: Coins },
  // Intel
  { label: "Recruitment", href: "/recruitment", icon: Trophy },
];

interface Me {
  discordId: string;
  username: string;
  avatar: string | null;
  isEmperor: boolean;
  canManageRoles: boolean;
  accessiblePages: string[];
}

function avatarUrl(me: Me): string | null {
  if (!me.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${me.discordId}/${me.avatar}.png?size=32`;
}

export function Sidebar({ allianceName }: { allianceName?: string }) {
  const pathname = usePathname();

  const { data: me } = useQuery<Me | null>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)),
    retry: false,
    staleTime: Infinity,
  });

  const isLoggedIn = !!me;

  return (
    <aside className="w-56 shrink-0 bg-[#161b2e] border-r border-[#2a3150] flex flex-col sticky top-0 h-screen overflow-y-auto">
      <div className="p-5 border-b border-[#2a3150]">
        <Link href="/" className="flex items-center gap-2 mb-1 hover:opacity-80 transition-opacity">
          <Shield size={20} className="text-blue-400" />
          <span className="font-bold text-white text-sm">PnW Analytics</span>
        </Link>
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
                active ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-[#1e2540] hover:text-white"
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}

        {isLoggedIn && hiddenNav.filter(({ href }) => me?.accessiblePages.includes(href)).map(({ label, href, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-[#1e2540] hover:text-white"
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}

        {me?.canManageRoles && (
          <>
            <Link
              href="/role-config"
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                pathname === "/role-config" ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-[#1e2540] hover:text-white"
              }`}
            >
              <Settings size={16} />
              Role Config
            </Link>
            <Link
              href="/war-config"
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                pathname === "/war-config" ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-[#1e2540] hover:text-white"
              }`}
            >
              <Swords size={16} />
              War Config
            </Link>
            <Link
              href="/stockpile-alert-config"
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                pathname === "/stockpile-alert-config" ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-[#1e2540] hover:text-white"
              }`}
            >
              <BellRing size={16} />
              Stockpile Alerts
            </Link>
          </>
        )}
      </nav>

      {!isLoggedIn && (
        <div className="p-3 border-t border-[#2a3150]">
          <a
            href="/login"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-[#1e2540] hover:text-white transition-colors w-full"
          >
            <LogIn size={16} />
            Login with Discord
          </a>
        </div>
      )}

      {isLoggedIn && me && (
        <div className="p-3 border-t border-[#2a3150] flex items-center gap-2">
          {avatarUrl(me) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl(me)!}
              alt={me.username}
              width={24}
              height={24}
              className="rounded-full"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-[#2a3150] flex items-center justify-center text-xs text-slate-400">
              {me.username[0].toUpperCase()}
            </div>
          )}
          <span className="text-xs text-slate-400 flex-1 truncate">{me.username}</span>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              title="Logout"
              className="text-slate-600 hover:text-slate-300 transition-colors"
            >
              <LogOut size={14} />
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}
