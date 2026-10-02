"use client";
import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { AllianceHeader, useMyAlliance } from "./AllianceHeader";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: alliance } = useMyAlliance();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  return (
    <div className="flex min-h-screen bg-[#0f1117]">
      <Sidebar allianceName={alliance?.name} open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <AllianceHeader onOpenMenu={() => setMobileNavOpen(true)} />
        <main className="flex-1 p-4 md:p-6 min-w-0">{children}</main>
      </div>
    </div>
  );
}
