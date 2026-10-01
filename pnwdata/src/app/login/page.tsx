// src/app/login/page.tsx
"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Shield } from "lucide-react";

const ERROR_MESSAGES: Record<string, string> = {
  not_member: "You must be a member of the Black Knights Discord server to log in.",
  invalid_state: "Authentication failed. Please try again.",
  token_exchange: "Authentication failed. Please try again.",
};

function LoginContent() {
  const params = useSearchParams();
  const error = params.get("error");
  const errorMsg = error ? ERROR_MESSAGES[error] : null;

  return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
      <div className="bg-[#161b2e] border border-[#2a3150] rounded-2xl p-10 flex flex-col items-center gap-6 w-full max-w-sm">
        <div className="flex items-center gap-3">
          <Shield size={28} className="text-blue-400" />
          <span className="text-white font-bold text-xl">BK Analytics</span>
        </div>

        <div className="text-center">
          <h1 className="text-white font-semibold text-lg">Sign in to continue</h1>
          <p className="text-slate-400 text-sm mt-1">Black Knights members only</p>
        </div>

        {errorMsg && (
          <div className="w-full bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm text-center">
            {errorMsg}
          </div>
        )}

        <a
          href="/api/auth/discord"
          className="w-full flex items-center justify-center gap-3 bg-[#5865F2] hover:bg-[#4752c4] text-white font-semibold py-3 px-6 rounded-xl transition-colors"
        >
          {/* Discord logo SVG */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.031.054a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
          </svg>
          Login with Discord
        </a>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
