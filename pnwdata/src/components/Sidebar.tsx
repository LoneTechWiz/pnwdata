"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Users, Swords, BarChart2, Shield,
  Search, Clock, Target, UserPlus,
  DollarSign, Crosshair, Radio, LogOut, LogIn, Settings, ShieldOff, Link2, BellRing, Coins, Trophy, Layers, Landmark, Wallet, Receipt, X,
} from "lucide-react";
import { useEffect } from "react";

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
  { label: "Raid Finder", href: "/raid-finder", icon: Crosshair },
  { label: "Tiering", href: "/tiering", icon: Layers },
  // Economy
  { label: "Stockpile", href: "/cashholders", icon: DollarSign },
  { label: "Credits", href: "/credits", icon: Coins },
  { label: "Revenue", href: "/revenue", icon: Wallet },
  // Intel
  { label: "Recruitment", href: "/recruitment", icon: Trophy },
  // Offshore
  { label: "Offshore Config", href: "/offshore-config", icon: Landmark },
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

export function Sidebar({
  allianceName,
  open = false,
  onClose,
}: {
  allianceName?: string;
  open?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();

  const { data: me } = useQuery<Me | null>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)),
    retry: false,
    staleTime: Infinity,
  });

  const isLoggedIn = !!me;

  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#161b2e] border-r border-[#2a3150] flex flex-col overflow-y-auto transform transition-transform duration-200 ease-in-out
          md:sticky md:top-0 md:z-auto md:h-screen md:w-56 md:shrink-0 md:translate-x-0
          ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
      <div className="p-5 border-b border-[#2a3150] flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href="/" className="flex items-center gap-2 mb-1 hover:opacity-80 transition-opacity">
            <Shield size={20} className="text-blue-400" />
            <span className="font-bold text-white text-sm">PnW Analytics</span>
          </Link>
          {allianceName && (
            <p className="text-xs text-slate-400 truncate">{allianceName}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="md:hidden text-slate-500 hover:text-white transition-colors shrink-0 p-1"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
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
              href="/raid-config"
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                pathname === "/raid-config" ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-[#1e2540] hover:text-white"
              }`}
            >
              <Crosshair size={16} />
              Raid Config
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
            <Link
              href="/tax-config"
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                pathname === "/tax-config" ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-[#1e2540] hover:text-white"
              }`}
            >
              <Receipt size={16} />
              Tax Config
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
    </>
  );
}
