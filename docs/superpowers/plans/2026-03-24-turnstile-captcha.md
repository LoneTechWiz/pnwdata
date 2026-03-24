# Turnstile Captcha Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the Discord OAuth login flow behind a Cloudflare Turnstile captcha challenge to prevent bot-initiated OAuth requests.

**Architecture:** The `/login` page renders a Turnstile widget inside a `<form>` that POSTs to `/api/auth/discord`. The route verifies the token server-side with Cloudflare's siteverify API before generating OAuth state and redirecting to Discord. The GET handler on that route is replaced with a plain redirect to `/login`.

**Tech Stack:** Next.js 16 App Router, TypeScript, `@marsidev/react-turnstile`, Cloudflare Turnstile siteverify API

**Spec:** `docs/superpowers/specs/2026-03-24-turnstile-captcha-design.md`

---

## Chunk 1: Install dependency and update the discord route

### Task 1: Install `@marsidev/react-turnstile`

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the package**

```bash
npm install @marsidev/react-turnstile
```

Expected: package added to `dependencies` in `package.json`, `package-lock.json` updated.

- [ ] **Step 2: Verify install**

```bash
ls node_modules/@marsidev/react-turnstile/package.json
```

Expected: file path printed with no error.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @marsidev/react-turnstile dependency"
```

---

### Task 2: Replace the discord auth route

**Files:**
- Modify: `src/app/api/auth/discord/route.ts` (replace entirely)

Current file exports only `GET` which immediately redirects to Discord OAuth. We replace it with:
- A `GET` handler that redirects to `/login` (safety net for cached old links)
- A `POST` handler that verifies the Turnstile token, then initiates OAuth

- [ ] **Step 1: Read the current file to understand what to preserve**

Read `src/app/api/auth/discord/route.ts`. Note the Discord OAuth URL construction and the `__oauth_state` cookie shape — these must be identical in the new `POST` handler.

- [ ] **Step 2: Write the new route**

Replace the entire contents of `src/app/api/auth/discord/route.ts` with:

```typescript
// src/app/api/auth/discord/route.ts
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

const getBaseUrl = () => new URL(process.env.DISCORD_REDIRECT_URI!).origin;

export async function GET() {
  return NextResponse.redirect(new URL("/login", getBaseUrl()));
}

export async function POST(req: NextRequest) {
  const baseUrl = getBaseUrl();

  // Parse Turnstile token from form body
  const formData = await req.formData();
  const cfToken = String(formData.get("cf-turnstile-response") ?? "");
  if (!cfToken) {
    return NextResponse.redirect(new URL("/login?error=captcha_failed", baseUrl));
  }

  // Guard: secret key must be configured
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    console.error("[auth] TURNSTILE_SECRET_KEY is not configured");
    return NextResponse.redirect(new URL("/login?error=server_error", baseUrl));
  }

  // Build siteverify request body
  const verifyBody = new URLSearchParams({ secret: secretKey, response: cfToken });
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    verifyBody.set("remoteip", forwarded.split(",")[0].trim());
  }

  // Verify with Cloudflare (fail closed on network error)
  let verifyResult: { success: boolean };
  try {
    const verifyRes = await fetch(
      "https://challenges.cloudflare.com/turnstile/v1/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: verifyBody,
        signal: AbortSignal.timeout(5000),
      }
    );
    verifyResult = await verifyRes.json() as { success: boolean };
  } catch {
    return NextResponse.redirect(new URL("/login?error=server_error", baseUrl));
  }

  if (!verifyResult.success) {
    return NextResponse.redirect(new URL("/login?error=captcha_failed", baseUrl));
  }

  // Captcha passed — initiate Discord OAuth
  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID!,
    redirect_uri: process.env.DISCORD_REDIRECT_URI!,
    response_type: "code",
    scope: "identify guilds.members.read",
    state,
  });

  const discordUrl = `https://discord.com/oauth2/authorize?${params}`;

  const res = NextResponse.redirect(discordUrl);
  res.cookies.set("__oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/discord/route.ts
git commit -m "feat: replace discord auth GET with POST + Turnstile verification"
```

---

## Chunk 2: Update the login page and docs

### Task 3: Update the login page

**Files:**
- Modify: `src/app/login/page.tsx`

The login page currently renders an `<a href="/api/auth/discord">` button. We convert it to a `<form method="POST">` with an embedded Turnstile widget. The widget fires `onSuccess` with a token that enables the submit button.

Key rules from the spec:
- `<Turnstile>` must be **inside** the `<form>` (so the library-injected hidden input is submitted)
- Do **not** add a manual `<input name="cf-turnstile-response">` — the library injects one automatically
- `onExpire` and `onError` both reset token to `""` (re-disables button)
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` must be set at build time; if empty, log a warning

- [ ] **Step 1: Read the current login page**

Read `src/app/login/page.tsx` to understand the existing structure before editing.

- [ ] **Step 2: Write the updated login page**

Replace the entire contents of `src/app/login/page.tsx` with:

```tsx
// src/app/login/page.tsx
"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Shield } from "lucide-react";
import { Turnstile } from "@marsidev/react-turnstile";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
if (!SITE_KEY) {
  console.warn("[login] NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set");
}

const ERROR_MESSAGES: Record<string, string> = {
  not_member: "You must be a member of the Black Knights Discord server to log in.",
  invalid_state: "Authentication failed. Please try again.",
  token_exchange: "Authentication failed. Please try again.",
  captcha_failed: "Security check failed. Please try again.",
  server_error: "Login is temporarily unavailable. Please try again later.",
};

function LoginContent() {
  const params = useSearchParams();
  const error = params.get("error");
  const errorMsg = error ? ERROR_MESSAGES[error] : null;
  const [token, setToken] = useState<string>("");

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

        <form method="POST" action="/api/auth/discord" className="w-full flex flex-col items-center gap-4">
          <Turnstile
            siteKey={SITE_KEY}
            onSuccess={setToken}
            onExpire={() => setToken("")}
            onError={() => setToken("")}
          />
          <button
            type="submit"
            disabled={!token}
            className={`w-full flex items-center justify-center gap-3 bg-[#5865F2] text-white font-semibold py-3 px-6 rounded-xl transition-colors ${
              token ? "hover:bg-[#4752c4]" : "opacity-50 pointer-events-none"
            }`}
          >
            {/* Discord logo SVG */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.031.054a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
            </svg>
            Login with Discord
          </button>
        </form>
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
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat: add Turnstile captcha widget to login page"
```

---

### Task 4: Update CLAUDE.md and build

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add env vars to CLAUDE.md**

Open `CLAUDE.md` and find the `### Environment Variables` section. Append these two lines at the end of the env var code block, after the `DISCORD_ADMIN_ROLE=` line:

```
NEXT_PUBLIC_TURNSTILE_SITE_KEY= # Cloudflare Turnstile site key (required at build time)
TURNSTILE_SECRET_KEY=           # Cloudflare Turnstile secret key (required at runtime)
```

Also find the `### Deployment Notes` section and add a note before the build command:

```
- **Before building**: ensure `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set — it is inlined at build time and cannot be changed without a rebuild.
```

- [ ] **Step 2: Commit CLAUDE.md**

```bash
git add CLAUDE.md
git commit -m "docs: add Turnstile env vars to CLAUDE.md"
```

- [ ] **Step 3: Set env vars and build**

Ensure `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set in the environment (from Cloudflare dashboard), then:

```bash
npm run build
```

Expected: build completes with no TypeScript or compilation errors.

- [ ] **Step 4: Deploy**

```bash
kill -9 $(ss -tlnp | grep ':3000' | grep -oP 'pid=\K[0-9]+')
nohup npm run start > /tmp/nextjs.log 2>&1 &
sleep 4 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

Expected: `200`

- [ ] **Step 5: Smoke test**

1. Navigate to `http://localhost:3000/login` — Turnstile widget should appear, button should be disabled
2. After widget auto-solves, button should become enabled
3. Clicking the button should redirect to Discord OAuth
4. Navigate directly to `http://localhost:3000/api/auth/discord` in the browser — should redirect to `/login`
