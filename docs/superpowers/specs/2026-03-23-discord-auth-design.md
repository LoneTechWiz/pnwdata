# Discord Auth & Role-Based Access — Design Spec

## Overview

Replace the current client-side password system with Discord OAuth2 login. Users authenticate via Discord, their roles in guild `677645003652333578` are fetched and cached in a signed JWT cookie, and Next.js middleware enforces per-page access based on role mappings stored in `data/role-config.json`.

---

## Auth Flow

1. Unauthenticated user visits a protected page → redirected to `/login`
2. User clicks "Login with Discord" → `GET /api/auth/discord`:
   - Generates a random `state` value, stores it in a short-lived `__oauth_state` cookie (HttpOnly, 10 min TTL)
   - Redirects to Discord OAuth2 with scopes `identify guilds.members.read` and the `state` parameter
3. Discord redirects to `GET /api/auth/callback?code=...&state=...`:
   - Validates `state` matches the `__oauth_state` cookie (CSRF protection); clears state cookie
   - Exchanges code for Discord access token
   - Fetches `GET https://discord.com/api/v10/users/@me/guilds/{guild_id}/member`
   - If user is not in the guild (404) → redirect to `/login?error=not_member`
   - Extracts role IDs; fetches `GET https://discord.com/api/v10/guilds/{guild_id}/roles` using the **bot token** (`DISCORD_BOT_TOKEN`) to resolve role names; checks if any role is named `Emperor`
   - Sets a signed JWT (`jose`, JWS/HS256) session cookie: `{ discordId, username, avatar, roleIds: string[], isEmperor: boolean }`
4. User redirected to `/`
5. Logout: `POST /api/auth/logout` clears the `__session` cookie → redirects to `/login`

Roles are cached in the JWT until logout. 7-day cookie TTL. If a user's roles change in Discord, they must log out and back in. This is a known, accepted limitation for an internal tool.

---

## Session (JWT via `jose`)

- Library: `jose` (JWS HS256 — signed, not encrypted; payload is readable but not forgeable; acceptable for an internal tool)
- Cookie name: `__session`
- Options: `HttpOnly`, `SameSite=Lax`, `Secure` in production, 7-day `Max-Age`
- Payload: `{ discordId: string, username: string, avatar: string | null, roleIds: string[], isEmperor: boolean }`
- Signing key: `SESSION_SECRET` env var (must be 32+ bytes / 256+ bits for HS256)

---

## Route Protection (`middleware.ts`)

Middleware uses `export const runtime = 'nodejs'` to opt into the Node.js runtime, enabling both `jose` JWT verification and `fs` access to read `data/role-config.json`.

**Public routes** (always pass through):
- `/`, `/war-targets`, `/conflict`, `/optimizer`
- `/login`, `/403`
- `/api/auth/*`
- `/_next/*`, `/favicon.ico`, and other static assets

**Protected routes** (all others):
- No valid `__session` JWT → redirect to `/login`
- `/role-config` → `isEmperor` must be `true`; otherwise `NextResponse.rewrite('/403')`
- All other protected routes → read `data/role-config.json`; if any of the user's `roleIds` appear in the allowed list for the path → allow; otherwise `NextResponse.rewrite('/403')`
- `isEmperor: true` → bypasses all role checks, always allowed

`/403` is served via `NextResponse.rewrite` so the original URL stays in the address bar. `/403` is on the public pass-through list to avoid rewrite loops.

Middleware reads `data/role-config.json` directly from the filesystem per-request. The file is small and Node.js will cache it in the OS page cache; no application-level caching needed.

---

## Role Config (`data/role-config.json`)

Maps page paths to arrays of allowed Discord role IDs:

```json
{
  "pages": {
    "/dashboard":       ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/members":         ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/applicants":      ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/military":        ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/mmr":             ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/infra":           ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/wars":            ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/bank":            ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/cashholders":     ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/charts":          ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/inactive":        ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/explore":         ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/slots":           ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"],
    "/command-center":  ["ARCHDUKE_ROLE_ID", "VICEROY_ROLE_ID"]
  }
}
```

Role IDs are used (not names) for stability. The config page resolves names via the guild roles API at render time. `/role-config` is not in this file — hardcoded Emperor-only in middleware. Written to `data/role-config.json` by `POST /api/auth/role-config` (same `data/` convention as `pnw.db`).

---

## Environment Variables

```
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=https://yourdomain.com/api/auth/callback   # must exactly match Discord dev portal
DISCORD_BOT_TOKEN=       # bot in the guild; used to fetch guild roles list
DISCORD_GUILD_ID=677645003652333578
DISCORD_ADMIN_ROLE=Emperor
SESSION_SECRET=          # 32+ byte random string (e.g. openssl rand -base64 32)
```

`DISCORD_GUILD_ID` and `DISCORD_ADMIN_ROLE` may also be hardcoded as constants since they are alliance-specific.

---

## New Pages

| Route | Description |
|-------|-------------|
| `/login` | Public. "Login with Discord" button. Redirects to `/` if already logged in. Shows user-facing error for `?error=not_member`. |
| `/role-config` | Emperor-only. Table of all private pages; each row has a multi-select of guild roles (fetched from `/api/auth/guild-roles`). Saves via `POST /api/auth/role-config`. |
| `/403` | Rewrite target. Brief "you don't have access" message with a link to `/`. |

---

## New API Routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/auth/discord` | GET | none | Sets `__oauth_state` cookie; redirects to Discord OAuth2 |
| `/api/auth/callback` | GET | none | Validates state; exchanges code; sets `__session` JWT; redirects to `/` |
| `/api/auth/logout` | POST | any | Clears `__session`; redirects to `/login` |
| `/api/auth/me` | GET | any | Returns `{ discordId, username, avatar }` or `401` JSON if no valid session |
| `/api/auth/guild-roles` | GET | Emperor | Fetches and returns all roles from the Discord guild via bot token |
| `/api/auth/role-config` | GET | Emperor | Returns current `role-config.json` contents |
| `/api/auth/role-config` | POST | Emperor | Writes updated role mappings to `role-config.json` |

---

## Sidebar Changes

Remove the password lock/unlock UI entirely. Replace the bottom section with:
- Discord avatar (16×16, optional) + username, loaded client-side via `GET /api/auth/me` (TanStack Query, no refetch interval)
- Shows nothing while loading (no skeleton — avoids layout flicker)
- Logout button → `POST /api/auth/logout`
- Hidden nav is always rendered for logged-in users; middleware enforces access

---

## New Dependencies

- `jose` — JWT signing/verification (HS256); Edge- and Node.js-compatible
