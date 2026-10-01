import { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  color?: string;
}

export function StatCard({ label, value, sub, icon: Icon, color = "text-blue-400" }: StatCardProps) {
  return (
    <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-400 uppercase tracking-wide">{label}</span>
        {Icon && <Icon size={16} className={color} />}
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
