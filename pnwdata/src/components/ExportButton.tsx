"use client";
import { Download } from "lucide-react";
import { exportToExcel } from "@/lib/excel";

export function ExportButton({
  filename,
  getData,
}: {
  filename: string;
  getData: () => Record<string, unknown>[];
}) {
  return (
    <button
      onClick={() => exportToExcel(filename, getData())}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-[#1e2540] border border-[#2a3150] rounded-lg hover:bg-[#2a3150] hover:text-white transition-colors"
    >
      <Download size={13} />
      Export Excel
    </button>
  );
}
