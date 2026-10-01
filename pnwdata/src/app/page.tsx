"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Shield } from "lucide-react";

export default function HomePage() {
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)),
    retry: false,
    staleTime: Infinity,
  });

  const isLoggedIn = !!me;

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
      <div className="text-center space-y-6 px-6">
        <div className="flex items-center justify-center gap-3 mb-2">
          <Shield size={40} className="text-blue-400" />
          <h1 className="text-4xl font-bold text-white">BK Analytics</h1>
        </div>
        <p className="text-slate-400 text-lg max-w-md mx-auto">
          Alliance intelligence dashboard for Politics &amp; War.
        </p>
        <div className="flex items-center justify-center gap-4 pt-2">
          {!isLoading && !isLoggedIn && (
            <a
              href="/api/auth/discord"
              className="flex items-center gap-3 bg-[#5865F2] hover:bg-[#4752c4] text-white font-semibold py-2.5 px-6 rounded-lg transition-colors text-sm"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.031.054a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
              </svg>
              Login with Discord
            </a>
          )}
          {isLoggedIn && (
            <Link
              href="/dashboard"
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Dashboard
            </Link>
          )}
          <Link
            href="/war-targets"
            className="px-5 py-2.5 bg-[#161b2e] hover:bg-[#1e2540] border border-[#2a3150] text-slate-300 rounded-lg text-sm font-medium transition-colors"
          >
            War Targets
          </Link>
          {isLoggedIn && (
            <Link
              href="/optimizer"
              className="px-5 py-2.5 bg-[#161b2e] hover:bg-[#1e2540] border border-[#2a3150] text-slate-300 rounded-lg text-sm font-medium transition-colors"
            >
              City Build
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
