"use client";
import { Sidebar } from "./Sidebar";
import { AllianceHeader, useMyAlliance } from "./AllianceHeader";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: alliance } = useMyAlliance();
  return (
    <div className="flex min-h-screen bg-[#0f1117]">
      <Sidebar allianceName={alliance?.name} />
      <div className="flex-1 flex flex-col min-w-0">
        <AllianceHeader />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
