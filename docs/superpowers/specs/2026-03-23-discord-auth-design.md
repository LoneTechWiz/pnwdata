# Discord Auth & Role-Based Access — Design Spec

## Overview

Replace the current client-side password system with Discord OAuth2 login. Users authenticate via Discord, their roles in guild `677645003652333578` are fetched and cached in a signed session cookie, and Next.js middleware enforces per-page access based on role mappings stored in `data/role-config.json`.

---

## Auth Flow

1. Unauthenticated user visits a protected page → redirected to `/login`
2. User clicks "Login with Discord" → redirected to `GET /api/auth/discord` (Discord OAuth2, scopes: `identify guilds.members.read`)
3. Discord redirects to `GET /api/auth/callback?code=...`
4. Server exchanges code for Discord access token, fetches user's roles in the guild
5. `iron-session` cookie set with `{ discordId, username, avatar, roles: string[] }`
6. User redirected to `/`
7. Logout: `POST /api/auth/logout` clears the cookie

Roles are cached in the cookie until logout — not re-fetched on every request.

---

## Route Protection (middleware.ts)

A `middleware.ts` at the project root intercepts all requests.

**Public routes** (always pass through):
- `/`, `/war-targets`, `/conflict`, `/optimizer`
- `/login`
- `/api/auth/*`
- Static assets (`/_next/*`, `/favicon.ico`, etc.)

**Protected routes** (all others):
- No session cookie → redirect to `/login`
- Session present → check `data/role-config.json` for the requested path
  - User has a matching role → allow
  - No matching role → render `/403`
- `/role-config` → hardcoded: only users with a role named `Emperor` may access (checked by role name)
- `Emperor` role → bypasses all other checks (full access)

---

## Session

Library: `iron-session`

Cookie payload:
```ts
{
  discordId: string;
  username: string;
  avatar: string | null;
  roles: string[];  // role IDs from the guild
}
```

Session secret via env var `SESSION_SECRET` (32+ char random string).

---

## Role Config (`data/role-config.json`)

Maps page paths to arrays of allowed Discord role IDs:

```json
{
  "pages": {
    "/dashboard": ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/members": ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/applicants": ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/military": ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/mmr": ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/infra": ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/wars": ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/bank": ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/cashholders": ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/charts": ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/inactive": ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/explore": ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/slots": ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/command-center": ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"]
  }
}
```

Role IDs are used (not names) for stability. The config page displays role names by fetching them from Discord at render time. `/role-config` is **not** in this file — it is hardcoded to `Emperor` only in middleware.

---

## Environment Variables

```
DISCORD_CLIENT_ID=        # OAuth2 app client ID
DISCORD_CLIENT_SECRET=    # OAuth2 app client secret
DISCORD_GUILD_ID=677645003652333578
DISCORD_ADMIN_ROLE=Emperor
SESSION_SECRET=           # 32+ char random string
```

`DISCORD_GUILD_ID` and `DISCORD_ADMIN_ROLE` may be hardcoded as constants in the auth code since they are alliance-specific and unlikely to change.

---

## New Pages

| Route | Description |
|-------|-------------|
| `/login` | Public. "Login with Discord" button. Redirects to `/` if already logged in. |
| `/role-config` | Emperor-only. Table of all private pages with multi-select role assignments. |
| `/403` | Shown when logged-in user lacks the required role. |

---

## New API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/discord` | GET | Redirects to Discord OAuth2 authorization URL |
| `/api/auth/callback` | GET | Handles OAuth callback; sets session cookie; redirects to `/` |
| `/api/auth/logout` | POST | Destroys session cookie; redirects to `/login` |
| `/api/auth/me` | GET | Returns `{ discordId, username, avatar }` for the current session |
| `/api/auth/role-config` | GET | Returns current `role-config.json` contents (Emperor only) |
| `/api/auth/role-config` | POST | Writes updated role mappings to `role-config.json` (Emperor only) |

---

## Sidebar Changes

Remove the password lock/unlock UI. Replace with:
- Discord avatar + username at the bottom of the sidebar (fetched from `/api/auth/me`)
- Logout button (`POST /api/auth/logout`)
- Hidden nav is always rendered for logged-in users — middleware enforces access, the sidebar does not need to gatekeep

---

## New Dependencies

- `iron-session` — encrypted session cookies for Next.js
