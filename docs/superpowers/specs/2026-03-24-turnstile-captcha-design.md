# Cloudflare Turnstile Captcha — Design Spec

**Date:** 2026-03-24
**Status:** Approved

## Goal

Protect the Discord OAuth login entry point from automated bot requests by requiring a Cloudflare Turnstile captcha challenge before the server initiates the OAuth flow.

## User Flow

1. User navigates to `/login`
2. Turnstile widget renders and auto-solves (managed/invisible mode)
3. "Login with Discord" button is disabled until Turnstile fires `onSuccess` with a token
4. User clicks the button; a `<form>` POSTs the token to `/api/auth/discord`
5. Server verifies the token against `https://challenges.cloudflare.com/turnstile/v1/siteverify`
6. **Fail** → redirect to `/login?error=captcha_failed`
7. **Pass** → generate OAuth state, set `__oauth_state` cookie, redirect to Discord OAuth
8. Discord OAuth flow continues to `/api/auth/callback` (unchanged)

## Architecture

### Route: `POST /api/auth/discord`

Replaces the existing `GET` handler entirely. No GET handler remains — direct URL navigation to `/api/auth/discord` will 405.

Steps:
1. Parse `cf-turnstile-response` from the POST form body
2. POST to `https://challenges.cloudflare.com/turnstile/v1/siteverify` with `secret` + `response`
3. If `success !== true` → redirect to `/login?error=captcha_failed`
4. Generate 16-byte hex `state`, set `__oauth_state` cookie (httpOnly, sameSite=lax, maxAge=600)
5. Build Discord OAuth URL with existing params, redirect

### Page: `/login`

- Replace `<a href="/api/auth/discord">` with `<form method="POST" action="/api/auth/discord">`
- Add `<Turnstile siteKey={...} onSuccess={setToken} />` from `@marsidev/react-turnstile`
- Hidden input `<input type="hidden" name="cf-turnstile-response" value={token} />`
- Submit button disabled (`pointer-events-none opacity-50`) until `token` is non-empty
- Add `captcha_failed` to `ERROR_MESSAGES`: `"Security check failed. Please try again."`

## Dependencies

| Package | Purpose |
|---------|---------|
| `@marsidev/react-turnstile` | React wrapper for Cloudflare Turnstile widget |

## Environment Variables

```
NEXT_PUBLIC_TURNSTILE_SITE_KEY=   # Cloudflare dashboard → Turnstile → site key
TURNSTILE_SECRET_KEY=             # Cloudflare dashboard → Turnstile → secret key
```

Both must be set. The route will throw at runtime if `TURNSTILE_SECRET_KEY` is missing.

## Files Changed

| File | Change |
|------|--------|
| `src/app/api/auth/discord/route.ts` | Replace `GET` export with `POST`; add Turnstile verification |
| `src/app/login/page.tsx` | Add Turnstile widget, convert button to form submit, handle disabled state |

## Out of Scope

- Protecting any route other than the login → Discord OAuth entry point
- Rate limiting (Turnstile covers the bot-traffic concern)
- Turnstile appearance customization beyond defaults
