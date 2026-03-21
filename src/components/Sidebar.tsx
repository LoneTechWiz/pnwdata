"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { LayoutDashboard, Users, Swords, Landmark, BarChart2, Shield, Building2, Search, Clock, Calculator, Target, UserPlus, DollarSign, Crosshair, Lock, LockOpen } from "lucide-react";

const nav = [
  { label: "Members", href: "/members", icon: Users },
  { label: "Applicants", href: "/applicants", icon: UserPlus },
  { label: "Military", href: "/military", icon: Shield },
  { label: "MMR Checker", href: "/mmr", icon: Target },
  { label: "War Targets", href: "/war-targets", icon: Crosshair },
  { label: "City Build", href: "/optimizer", icon: Calculator },
];

const hiddenNav = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Infra & Land", href: "/infra", icon: Building2 },
  { label: "Wars", href: "/wars", icon: Swords },
  { label: "Bank", href: "/bank", icon: Landmark },
  { label: "Stockpile", href: "/cashholders", icon: DollarSign },
  { label: "Charts", href: "/charts", icon: BarChart2 },
  { label: "Inactive", href: "/inactive", icon: Clock },
  { label: "Explore", href: "/explore", icon: Search },
];

const STORAGE_KEY = "pnw_unlocked";
const PASSWORD = "Yosotinydick";

export function Sidebar({ allianceName }: { allianceName?: string }) {
  const pathname = usePathname();
  const [unlocked, setUnlocked] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    setUnlocked(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  function handleUnlock() {
    if (input === PASSWORD) {
      localStorage.setItem(STORAGE_KEY, "1");
      setUnlocked(true);
      setShowInput(false);
      setInput("");
      setError(false);
    } else {
      setError(true);
      setInput("");
    }
  }

  function handleLock() {
    localStorage.removeItem(STORAGE_KEY);
    setUnlocked(false);
    setShowInput(false);
    setInput("");
    setError(false);
  }

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

        {unlocked && hiddenNav.map(({ label, href, icon: Icon }) => {
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

      <div className="p-3 border-t border-[#2a3150] space-y-2">
        {showInput && !unlocked && (
          <div className="space-y-1">
            <input
              type="password"
              value={input}
              onChange={e => { setInput(e.target.value); setError(false); }}
              onKeyDown={e => e.key === "Enter" && handleUnlock()}
              placeholder="Password"
              autoFocus
              className={`w-full bg-[#0f1117] border rounded-lg text-white px-2 py-1 text-xs focus:outline-none ${error ? "border-red-500" : "border-[#2a3150] focus:border-blue-500"}`}
            />
            {error && <p className="text-red-400 text-xs">Wrong password</p>}
          </div>
        )}
        <button
          onClick={unlocked ? handleLock : () => setShowInput(v => !v)}
          className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-400 transition-colors w-full"
        >
          {unlocked ? <LockOpen size={12} /> : <Lock size={12} />}
          {unlocked ? "Lock hidden pages" : "Politics & War"}
        </button>
      </div>
    </aside>
  );
}
