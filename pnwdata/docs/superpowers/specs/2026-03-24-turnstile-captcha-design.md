# Cloudflare Turnstile Captcha — Design Spec

**Date:** 2026-03-24
**Status:** Draft

## Goal

Protect the Discord OAuth login entry point from automated bot requests by requiring a Cloudflare Turnstile captcha challenge before the server initiates the OAuth flow.

## Security Properties

- **Bot prevention**: Turnstile requires a solved challenge before the server initiates Discord OAuth.
- **Single-use tokens**: Cloudflare's siteverify endpoint invalidates a token after its first successful verification. Tokens are not reusable and must not be cached or retried.
- **CSRF**: Turnstile does not fully prevent CSRF — a human with a valid token from the legitimate domain could craft a cross-origin POST. The actual CSRF defense is the OAuth `state` cookie: the callback enforces state matching, so an attacker-initiated flow only logs themselves in, not the victim. No additional CSRF token is needed for this specific endpoint.

## User Flow

1. User navigates to `/login`
2. Turnstile widget renders and auto-solves (managed/invisible mode)
3. "Login with Discord" button is disabled until Turnstile fires `onSuccess` with a token
4. User clicks the button; a `<form>` POSTs the token to `/api/auth/discord`
5. Server verifies the token against `https://challenges.cloudflare.com/turnstile/v1/siteverify`
6. **Fail** → redirect to `/login?error=captcha_failed`; **server error** (missing key, network) → redirect to `/login?error=server_error`
7. **Pass** → generate OAuth state, set `__oauth_state` cookie, redirect to Discord OAuth
8. Discord OAuth flow continues to `/api/auth/callback` (unchanged)

On captcha failure the page reloads, the widget re-renders fresh — no manual reset needed. No `__oauth_state` cookie has been set at failure time, so no cookie cleanup is needed.

## Architecture

### Route: `POST /api/auth/discord`

Use `NextRequest` as the handler parameter type (consistent with all other routes in this file tree).

**Runtime**: This route must run on the Node.js runtime (not edge). Do not add `export const runtime = "edge"`. This is consistent with all other routes in this codebase (which use `better-sqlite3` and are Node-only) and is required for `AbortSignal.timeout()` support.

Compute `baseUrl` at **module scope** (outside both handler functions): `const getBaseUrl = () => new URL(process.env.DISCORD_REDIRECT_URI!).origin`. Both handlers use this. If `DISCORD_REDIRECT_URI` is not set, it throws — same behaviour as the existing `callback` route.

The existing `GET` handler is replaced. A `GET` handler is kept that returns a plain redirect to `/login`: `NextResponse.redirect(new URL("/login", getBaseUrl()))`. `NextResponse.redirect()` requires an absolute URL — a bare relative path like `"/login"` will throw at runtime. This handler must **not** set any cookies or construct an OAuth URL. It is a safety net during the deployment rollout for any cached old-page `<a>` links.

In the `POST` handler, compute `const baseUrl = getBaseUrl()` as the first line to use in all redirect calls.

Steps:
1. Parse `cf-turnstile-response` from the POST form body: `const formData = await req.formData(); const cfToken = String(formData.get("cf-turnstile-response") ?? "")`. If `cfToken` is empty, redirect immediately to `/login?error=captcha_failed` without calling siteverify (this is the short-circuit path; it produces the same user-visible result as a siteverify rejection and avoids a pointless network call).
2. If `TURNSTILE_SECRET_KEY` is not set → `console.error("[auth] TURNSTILE_SECRET_KEY is not configured")`, redirect to `/login?error=server_error`. Do not throw.
3. Build a `URLSearchParams` body with `secret`, `response`, and optionally `remoteip`. Do **not** forward `req.body` or the incoming form data directly — the siteverify call requires the server's secret key which is not in the incoming form.
   - `remoteip`: read the first comma-separated value from `req.headers.get("x-forwarded-for")` (e.g. `"1.2.3.4, 5.6.7.8"` → `"1.2.3.4"`). If the header is absent, omit the field. Note: `x-forwarded-for` is only trustworthy behind a trusted reverse proxy; Cloudflare uses it for signals, not as a hard gate.
   - POST with `Content-Type: application/x-www-form-urlencoded` — sending JSON causes a silent `missing-input-secret` failure.
   - Add a 5-second timeout: `fetch(url, { method: "POST", body, headers, signal: AbortSignal.timeout(5000) })`
4. If the fetch throws (network error, timeout, abort) → redirect to `/login?error=server_error` (fail closed).
5. If `success !== true` → redirect to `/login?error=captcha_failed`.
6. Generate 16-byte hex `state`, set `__oauth_state` cookie: `{ httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" }`.
   - `sameSite: "lax"` is correct: cookie is set on same-origin POST, and the callback receives it via a top-level cross-site GET redirect from Discord — which `lax` permits. Do not change to `strict` (breaks callback) or `none` (requires `secure`).
   - `secure: true` not set, matching the existing route behaviour. Out of scope.
7. Build Discord OAuth URL with existing params, redirect.

### Page: `/login`

`/login` is a **public route** (pre-auth). It does **not** require a `data/role-config.json` entry or `ALL_PAGES` registration.

- Replace `<a href="/api/auth/discord">` with `<form method="POST" action="/api/auth/discord">`
- Token state: `const [token, setToken] = useState<string>("")`
- The `<Turnstile>` component must be rendered **inside** the `<form>` element
- Add `<Turnstile siteKey={SITE_KEY} onSuccess={setToken} onExpire={() => setToken("")} onError={() => setToken("")} />`
  - The library injects a hidden input named `cf-turnstile-response` by default — this matches what the server reads. Do not add a manual `<input>` alongside it.
  - `onExpire` and `onError` both call `setToken("")`, re-disabling the button.
- Submit button: `disabled={!token}` with `pointer-events-none opacity-50` when disabled
- Add to `ERROR_MESSAGES`:
  - `captcha_failed`: `"Security check failed. Please try again."`
  - `server_error`: `"Login is temporarily unavailable. Please try again later."`
- `const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""`. If empty, log `console.warn("[login] NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set")` and pass the empty string to the widget (it will show an error state).

**Build-time requirement**: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is inlined at build time. It must be set before `npm run build`. Rotating it requires a rebuild.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@marsidev/react-turnstile` | React wrapper for Cloudflare Turnstile widget |

Install with `npm install @marsidev/react-turnstile`.

## Environment Variables

Two new env vars are required. Add both to the `### Environment Variables` table in `CLAUDE.md`, and add a note to `CLAUDE.md`'s deployment section that `NEXT_PUBLIC_TURNSTILE_SITE_KEY` must be set before `npm run build`.

```
NEXT_PUBLIC_TURNSTILE_SITE_KEY=   # Cloudflare dashboard → Turnstile → site key (required at build time)
TURNSTILE_SECRET_KEY=             # Cloudflare dashboard → Turnstile → secret key (required at runtime)
```

## Files Changed

| File | Change |
|------|--------|
| `package.json` / `package-lock.json` | Add `@marsidev/react-turnstile` via `npm install` |
| `src/app/api/auth/discord/route.ts` | Replace `GET` with `POST` (Turnstile verify + OAuth redirect); add `GET` → redirect to `/login` |
| `src/app/login/page.tsx` | Add Turnstile widget inside form, convert button to submit, handle token/error state |
| `CLAUDE.md` | Add env vars to table; note `NEXT_PUBLIC_TURNSTILE_SITE_KEY` required before build |

## Out of Scope

- Protecting any route other than the login → Discord OAuth entry point
- Rate limiting
- Turnstile appearance customization
- Adding `secure: true` to `__oauth_state` cookie (matches existing behaviour)
