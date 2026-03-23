// src/app/403/page.tsx
"use client";
import Link from "next/link";
import { ShieldOff } from "lucide-react";

export default function ForbiddenPage() {
  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
      <div className="bg-[#161b2e] border border-[#2a3150] rounded-2xl p-10 flex flex-col items-center gap-4 w-full max-w-sm text-center">
        <ShieldOff size={40} className="text-slate-500" />
        <h1 className="text-white font-bold text-xl">Access Denied</h1>
        <p className="text-slate-400 text-sm">
          You don&apos;t have the required role to view this page.
        </p>
        <Link href="/" className="mt-2 text-blue-400 hover:underline text-sm">
          Back to home
        </Link>
      </div>
    </div>
  );
}
