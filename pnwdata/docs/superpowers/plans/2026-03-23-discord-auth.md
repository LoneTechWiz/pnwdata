# Discord Auth & Role-Based Access Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client-side password system with Discord OAuth2 login and role-based page access controlled by guild roles.

**Architecture:** `jose` JWT signed cookie for sessions; Next.js middleware (Node.js runtime via `experimental.nodeMiddleware`) reads the cookie and `data/role-config.json` to enforce per-page role access; all new API routes live under `/api/auth/`.

**Tech Stack:** Next.js 16 App Router, `jose` (JWT), Discord OAuth2 + bot API, SQLite (unchanged), Tailwind dark theme.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `next.config.ts` | Modify | Enable `experimental.nodeMiddleware` |
| `src/lib/session.ts` | Create | JWT sign/verify helpers; SessionPayload type |
| `src/lib/role-config.ts` | Create | Read/write `data/role-config.json` |
| `data/role-config.json` | Create | Initial role→page mappings |
| `src/middleware.ts` | Create | Route protection — JWT check + role check |
| `src/app/api/auth/discord/route.ts` | Create | OAuth initiation + state cookie |
| `src/app/api/auth/callback/route.ts` | Create | OAuth callback, guild member fetch, JWT set |
| `src/app/api/auth/logout/route.ts` | Create | Clear session cookie |
| `src/app/api/auth/me/route.ts` | Create | Return current user or 401 |
| `src/app/api/auth/guild-roles/route.ts` | Create | Return guild roles list (Emperor only) |
| `src/app/api/auth/role-config/route.ts` | Create | GET/POST role-config.json (Emperor only) |
| `src/app/login/page.tsx` | Create | Login page with Discord button |
| `src/app/403/page.tsx` | Create | Access denied page (rewrite target) |
| `src/app/role-config/page.tsx` | Create | Role management UI (Emperor only) |
| `src/components/Sidebar.tsx` | Modify | Replace password UI with Discord user + logout |
| `.env.local` | Modify | Add new env vars |

---

## Chunk 1: Foundation — Session Helpers, Role Config, Initial Data

### Task 1: Install `jose` and enable Node.js middleware

- [ ] **Install the dependency**

```bash
npm install jose
```

- [ ] **Enable Node.js middleware runtime in `next.config.ts`**

Add `experimental: { nodeMiddleware: true }` so middleware can use `fs` and other Node.js APIs:

```typescript
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    nodeMiddleware: true,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "politicsandwar.com" },
      { protocol: "https", hostname: "*.politicsandwar.com" },
    ],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
```

- [ ] **Commit**

```bash
git add package.json package-lock.json next.config.ts
git commit -m "feat: add jose, enable Node.js middleware runtime"
```

---

### Task 2: Create `src/lib/session.ts`

This module signs and verifies the JWT session token. Route handlers use the `SESSION_COOKIE` constant and `COOKIE_OPTIONS` to set cookies directly via `NextResponse.cookies.set()` — this avoids the multi-Set-Cookie header problem.

```typescript
// src/lib/session.ts
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

export interface SessionPayload {
  discordId: string;
  username: string;
  avatar: string | null;
  roleIds: string[];
  isEmperor: boolean;
}

export const SESSION_COOKIE = "__session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_MAX_AGE,
  path: "/",
};

function getKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

/** Signs and returns the raw JWT token string. Callers set the cookie themselves. */
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getKey());
}

/** Verifies a raw JWT token string and returns the payload, or null if invalid. */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Reads the session from the request (middleware/route handlers with NextRequest)
 * or from next/headers cookies() (server components / route handlers without req).
 */
export async function getSession(req?: NextRequest): Promise<SessionPayload | null> {
  let token: string | undefined;
  if (req) {
    token = req.cookies.get(SESSION_COOKIE)?.value;
  } else {
    const jar = await cookies();
    token = jar.get(SESSION_COOKIE)?.value;
  }
  if (!token) return null;
  return verifySessionToken(token);
}
```

- [ ] **Create the file** with the content above

- [ ] **Commit**

```bash
git add src/lib/session.ts
git commit -m "feat: add JWT session helpers"
```

---

### Task 3: Create `src/lib/role-config.ts`

- [ ] **Create the file**

```typescript
// src/lib/role-config.ts
import fs from "fs";
import path from "path";

export interface RoleConfig {
  pages: Record<string, string[]>; // path → role ID array
}

const CONFIG_PATH = path.join(process.cwd(), "data", "role-config.json");

export function readRoleConfig(): RoleConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as RoleConfig;
  } catch {
    return { pages: {} };
  }
}

export function writeRoleConfig(config: RoleConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

export function hasAccess(config: RoleConfig, pathname: string, roleIds: string[]): boolean {
  const allowed = config.pages[pathname];
  if (!allowed) return false;
  return roleIds.some((id) => allowed.includes(id));
}
```

- [ ] **Commit**

```bash
git add src/lib/role-config.ts
git commit -m "feat: add role-config read/write helpers"
```

---

### Task 4: Create `data/role-config.json`

- [ ] **Create the file** with the Archduke and Viceroy role IDs pre-populated

```json
{
  "pages": {
    "/dashboard":      ["1084632591929454672", "1399051515393740900"],
    "/members":        ["1084632591929454672", "1399051515393740900"],
    "/applicants":     ["1084632591929454672", "1399051515393740900"],
    "/military":       ["1084632591929454672", "1399051515393740900"],
    "/mmr":            ["1084632591929454672", "1399051515393740900"],
    "/infra":          ["1084632591929454672", "1399051515393740900"],
    "/wars":           ["1084632591929454672", "1399051515393740900"],
    "/bank":           ["1084632591929454672", "1399051515393740900"],
    "/cashholders":    ["1084632591929454672", "1399051515393740900"],
    "/charts":         ["1084632591929454672", "1399051515393740900"],
    "/inactive":       ["1084632591929454672", "1399051515393740900"],
    "/explore":        ["1084632591929454672", "1399051515393740900"],
    "/slots":          ["1084632591929454672", "1399051515393740900"],
    "/command-center": ["1084632591929454672", "1399051515393740900"]
  }
}
```

- [ ] **Commit**

```bash
git add data/role-config.json
git commit -m "feat: add initial role-config.json with Archduke and Viceroy access"
```

---

### Task 5: Add env vars to `.env.local`

- [ ] **Open `.env.local`** (create if it doesn't exist) and add:

```
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here
DISCORD_REDIRECT_URI=http://localhost:3000/api/auth/callback
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_GUILD_ID=677645003652333578
DISCORD_ADMIN_ROLE=Emperor
SESSION_SECRET=your_32plus_char_random_string_here
```

Generate a SESSION_SECRET with:
```bash
openssl rand -base64 32
```

- [ ] **Verify `.env.local` is in `.gitignore`**

```bash
grep ".env.local" .gitignore
```

Expected: `.env.local` is listed. If not, add it.

> **Note:** Do NOT commit `.env.local`.

---

## Chunk 2: API Routes

### Task 6: Create `src/app/api/auth/discord/route.ts`

- [ ] **Create the file**

```typescript
// src/app/api/auth/discord/route.ts
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

export async function GET() {
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
    maxAge: 600, // 10 minutes
    path: "/",
  });
  return res;
}
```

- [ ] **Commit**

```bash
git add src/app/api/auth/discord/route.ts
git commit -m "feat: add Discord OAuth initiation route"
```

---

### Task 7: Create `src/app/api/auth/callback/route.ts`

Uses `res.cookies.set()` for both the session cookie and clearing the state cookie to ensure both Set-Cookie headers are written reliably.

- [ ] **Create the file**

```typescript
// src/app/api/auth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, COOKIE_OPTIONS } from "@/lib/session";

const GUILD_ID = process.env.DISCORD_GUILD_ID!;
const ADMIN_ROLE = process.env.DISCORD_ADMIN_ROLE ?? "Emperor";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const storedState = req.cookies.get("__oauth_state")?.value;

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(new URL("/login?error=invalid_state", req.url));
  }

  // Exchange code for access token
  const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI!,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL("/login?error=token_exchange", req.url));
  }

  const { access_token } = await tokenRes.json() as { access_token: string };

  // Fetch guild member (role IDs + user info)
  const memberRes = await fetch(
    `https://discord.com/api/v10/users/@me/guilds/${GUILD_ID}/member`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );

  if (!memberRes.ok) {
    return NextResponse.redirect(new URL("/login?error=not_member", req.url));
  }

  const member = await memberRes.json() as {
    roles: string[];
    user: { id: string; username: string; avatar: string | null };
  };

  // Fetch guild roles to resolve Emperor by name using bot token
  const rolesRes = await fetch(
    `https://discord.com/api/v10/guilds/${GUILD_ID}/roles`,
    { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
  );

  let isEmperor = false;
  if (rolesRes.ok) {
    const guildRoles = await rolesRes.json() as { id: string; name: string }[];
    const emperorRole = guildRoles.find((r) => r.name === ADMIN_ROLE);
    if (emperorRole) {
      isEmperor = member.roles.includes(emperorRole.id);
    }
  }

  const token = await createSessionToken({
    discordId: member.user.id,
    username: member.user.username,
    avatar: member.user.avatar,
    roleIds: member.roles,
    isEmperor,
  });

  const res = NextResponse.redirect(new URL("/", req.url));
  // Use res.cookies.set() for reliable multi-cookie writes
  res.cookies.set(SESSION_COOKIE, token, COOKIE_OPTIONS);
  res.cookies.set("__oauth_state", "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: "/" });
  return res;
}
```

- [ ] **Commit**

```bash
git add src/app/api/auth/callback/route.ts
git commit -m "feat: add Discord OAuth callback route"
```

---

### Task 8: Create `src/app/api/auth/logout/route.ts`

- [ ] **Create the file**

```typescript
// src/app/api/auth/logout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: "/" });
  return res;
}
```

- [ ] **Commit**

```bash
git add src/app/api/auth/logout/route.ts
git commit -m "feat: add logout route"
```

---

### Task 9: Create `src/app/api/auth/me/route.ts`

- [ ] **Create the file**

```typescript
// src/app/api/auth/me/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    discordId: session.discordId,
    username: session.username,
    avatar: session.avatar,
  });
}
```

- [ ] **Commit**

```bash
git add src/app/api/auth/me/route.ts
git commit -m "feat: add /api/auth/me route"
```

---

### Task 10: Create `src/app/api/auth/guild-roles/route.ts`

- [ ] **Create the file**

```typescript
// src/app/api/auth/guild-roles/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session?.isEmperor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const res = await fetch(
    `https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/roles`,
    { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Failed to fetch guild roles" }, { status: 502 });
  }

  const roles = await res.json() as { id: string; name: string; color: number; position: number }[];
  const filtered = roles
    .filter((r) => r.name !== "@everyone")
    .sort((a, b) => b.position - a.position);

  return NextResponse.json(filtered);
}
```

- [ ] **Commit**

```bash
git add src/app/api/auth/guild-roles/route.ts
git commit -m "feat: add guild-roles API route"
```

---

### Task 11: Create `src/app/api/auth/role-config/route.ts`

- [ ] **Create the file**

```typescript
// src/app/api/auth/role-config/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readRoleConfig, writeRoleConfig, RoleConfig } from "@/lib/role-config";

export async function GET() {
  const session = await getSession();
  if (!session?.isEmperor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(readRoleConfig());
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.isEmperor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json() as RoleConfig;
  if (!body.pages || typeof body.pages !== "object") {
    return NextResponse.json({ error: "Invalid config" }, { status: 400 });
  }
  writeRoleConfig(body);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Commit**

```bash
git add src/app/api/auth/role-config/route.ts
git commit -m "feat: add role-config API route"
```

---

## Chunk 3: Middleware

### Task 12: Create `src/middleware.ts`

`export const runtime = "nodejs"` requires `experimental.nodeMiddleware: true` in next.config.ts (done in Task 1). This enables `fs` access to read `role-config.json`.

- [ ] **Create the file**

```typescript
// src/middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session";
import { readRoleConfig, hasAccess } from "@/lib/role-config";

export const runtime = "nodejs";

const PUBLIC_PREFIXES = ["/_next/", "/favicon.ico", "/api/auth/"];

const PUBLIC_EXACT = new Set([
  "/",
  "/war-targets",
  "/conflict",
  "/optimizer",
  "/login",
  "/403",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get("__session")?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Emperor bypasses all role checks
  if (session.isEmperor) return NextResponse.next();

  // /role-config is Emperor-only
  if (pathname === "/role-config") {
    return NextResponse.rewrite(new URL("/403", req.url));
  }

  // Check role-config.json for all other protected routes
  const config = readRoleConfig();
  if (hasAccess(config, pathname, session.roleIds)) {
    return NextResponse.next();
  }

  return NextResponse.rewrite(new URL("/403", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Commit**

```bash
git add src/middleware.ts
git commit -m "feat: add route protection middleware"
```

---

## Chunk 4: Pages

### Task 13: Create `src/app/login/page.tsx`

- [ ] **Create the file**

```typescript
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
```

- [ ] **Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat: add login page"
```

---

### Task 14: Create `src/app/403/page.tsx`

- [ ] **Create the file**

```typescript
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
```

- [ ] **Commit**

```bash
git add src/app/403/page.tsx
git commit -m "feat: add 403 access denied page"
```

---

### Task 15: Create `src/app/role-config/page.tsx`

- [ ] **Create the file**

```typescript
// src/app/role-config/page.tsx
"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner, ErrorMessage } from "@/components/LoadingSpinner";
import { Save } from "lucide-react";

interface GuildRole {
  id: string;
  name: string;
  color: number;
}

interface RoleConfig {
  pages: Record<string, string[]>;
}

const ALL_PAGES = [
  "/dashboard", "/members", "/applicants", "/military", "/mmr",
  "/infra", "/wars", "/bank", "/cashholders", "/charts",
  "/inactive", "/explore", "/slots", "/command-center",
];

function roleColor(color: number): string {
  if (color === 0) return "#94a3b8";
  return `#${color.toString(16).padStart(6, "0")}`;
}

export default function RoleConfigPage() {
  const queryClient = useQueryClient();

  const { data: guildRoles = [], isLoading: rolesLoading, error: rolesErr } = useQuery<GuildRole[]>({
    queryKey: ["guildRoles"],
    queryFn: () => fetch("/api/auth/guild-roles").then((r) => r.json()),
  });

  const { data: roleConfig, isLoading: configLoading, error: configErr } = useQuery<RoleConfig>({
    queryKey: ["roleConfig"],
    queryFn: () => fetch("/api/auth/role-config").then((r) => r.json()),
  });

  const [localConfig, setLocalConfig] = useState<Record<string, string[]> | null>(null);

  const activeConfig = useMemo(() => {
    if (localConfig !== null) return localConfig;
    return roleConfig?.pages ?? {};
  }, [localConfig, roleConfig]);

  const saveMutation = useMutation({
    mutationFn: (pages: Record<string, string[]>) =>
      fetch("/api/auth/role-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roleConfig"] });
      setLocalConfig(null);
    },
  });

  function toggleRole(page: string, roleId: string) {
    const current = activeConfig[page] ?? [];
    const next = current.includes(roleId)
      ? current.filter((id) => id !== roleId)
      : [...current, roleId];
    setLocalConfig({ ...activeConfig, [page]: next });
  }

  const isLoading = rolesLoading || configLoading;
  const error = rolesErr || configErr;

  if (isLoading) return <AppShell><LoadingSpinner /></AppShell>;
  if (error) return <AppShell><ErrorMessage message={String(error)} /></AppShell>;

  const isDirty = localConfig !== null;

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Role Configuration</h1>
            <p className="text-slate-400 text-sm mt-1">
              Control which Discord roles can access each page.
            </p>
          </div>
          <button
            onClick={() => saveMutation.mutate(activeConfig)}
            disabled={!isDirty || saveMutation.isPending}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Save size={14} />
            {saveMutation.isPending ? "Saving…" : "Save Changes"}
          </button>
        </div>

        {saveMutation.isError && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            Failed to save. Please try again.
          </div>
        )}

        <div className="rounded-xl border border-[#2a3150] overflow-x-auto">
          <table className="w-full text-sm text-white min-w-max">
            <thead className="bg-[#161b2e] text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Page</th>
                {guildRoles.map((role) => (
                  <th key={role.id} className="px-3 py-3 text-center whitespace-nowrap">
                    <span style={{ color: roleColor(role.color) }}>{role.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a3150]">
              {ALL_PAGES.map((page) => (
                <tr key={page} className="hover:bg-[#1e2540] transition-colors">
                  <td className="px-4 py-2 font-mono text-slate-300">{page}</td>
                  {guildRoles.map((role) => {
                    const checked = (activeConfig[page] ?? []).includes(role.id);
                    return (
                      <td key={role.id} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRole(page, role.id)}
                          className="w-4 h-4 accent-blue-500 cursor-pointer"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
```

- [ ] **Commit**

```bash
git add src/app/role-config/page.tsx
git commit -m "feat: add role configuration admin page"
```

---

## Chunk 5: Sidebar + Build

### Task 16: Update `src/components/Sidebar.tsx`

Remove the password system entirely. Add Discord user info + logout. Hidden nav shown when `me` query returns a user.

- [ ] **Replace the entire file contents with:**

```typescript
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Users, Swords, Landmark, BarChart2, Shield,
  Building2, Search, Clock, Calculator, Target, UserPlus,
  DollarSign, Crosshair, Flame, Radio, LogOut,
} from "lucide-react";

const nav = [
  { label: "War Targets", href: "/war-targets", icon: Crosshair },
  { label: "Conflict Stats", href: "/conflict", icon: Flame },
  { label: "City Build", href: "/optimizer", icon: Calculator },
];

const hiddenNav = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Members", href: "/members", icon: Users },
  { label: "Applicants", href: "/applicants", icon: UserPlus },
  { label: "Military", href: "/military", icon: Shield },
  { label: "MMR Checker", href: "/mmr", icon: Target },
  { label: "Infra & Land", href: "/infra", icon: Building2 },
  { label: "Wars", href: "/wars", icon: Swords },
  { label: "Bank", href: "/bank", icon: Landmark },
  { label: "Stockpile", href: "/cashholders", icon: DollarSign },
  { label: "Charts", href: "/charts", icon: BarChart2 },
  { label: "Inactive", href: "/inactive", icon: Clock },
  { label: "Explore", href: "/explore", icon: Search },
  { label: "Need to Declare", href: "/slots", icon: Swords },
  { label: "Command Center", href: "/command-center", icon: Radio },
];

interface Me {
  discordId: string;
  username: string;
  avatar: string | null;
}

function avatarUrl(me: Me): string | null {
  if (!me.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${me.discordId}/${me.avatar}.png?size=32`;
}

export function Sidebar({ allianceName }: { allianceName?: string }) {
  const pathname = usePathname();

  const { data: me } = useQuery<Me | null>({
    queryKey: ["me"],
    queryFn: () => fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)),
    retry: false,
    staleTime: Infinity,
  });

  const isLoggedIn = !!me;

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
                active ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-[#1e2540] hover:text-white"
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}

        {isLoggedIn && hiddenNav.map(({ label, href, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-[#1e2540] hover:text-white"
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>

      {isLoggedIn && me && (
        <div className="p-3 border-t border-[#2a3150] flex items-center gap-2">
          {avatarUrl(me) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl(me)!}
              alt={me.username}
              width={24}
              height={24}
              className="rounded-full"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-[#2a3150] flex items-center justify-center text-xs text-slate-400">
              {me.username[0].toUpperCase()}
            </div>
          )}
          <span className="text-xs text-slate-400 flex-1 truncate">{me.username}</span>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              title="Logout"
              className="text-slate-600 hover:text-slate-300 transition-colors"
            >
              <LogOut size={14} />
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: replace password UI with Discord user info and logout"
```

---

### Task 17: Build, restart, and verify

- [ ] **Build**

```bash
npm run build
```

Expected: no TypeScript or build errors. Fix any errors before proceeding.

- [ ] **Restart the server**

```bash
kill -9 $(ss -tlnp | grep ':3000' | grep -oP 'pid=\K[0-9]+') 2>/dev/null
sleep 1
nohup npm run start > /tmp/nextjs.log 2>&1 &
sleep 4 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

Expected: `200`

- [ ] **Verify unauthenticated redirect** — visit `http://localhost:3000/dashboard`. Should redirect to `/login`.

- [ ] **Verify public pages load without login** — visit `http://localhost:3000/war-targets`. Should load normally.

- [ ] **Complete the Discord login flow** — click "Login with Discord" on `/login`, authorize the app, confirm you land back on `/` with the hidden nav visible.

- [ ] **Verify role-config page** — if logged in as Emperor, visit `/role-config`. Should show the role management table with all guild roles as columns. A non-Emperor should see the 403 page.

- [ ] **Verify logout** — click the logout icon. Hidden nav should disappear. Visiting `/dashboard` should redirect to `/login`.

- [ ] **Final commit**

```bash
git add -A
git commit -m "feat: Discord OAuth login with role-based page access — complete"
```
