export function LoadingSpinner({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-10 h-10 border-4 border-[#2a3150] border-t-blue-500 rounded-full animate-spin" />
      <p className="text-slate-400 text-sm">{label}</p>
    </div>
  );
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-6 text-center">
      <p className="text-red-400 font-medium">Error</p>
      <p className="text-red-300/70 text-sm mt-1">{message}</p>
    </div>
  );
}
