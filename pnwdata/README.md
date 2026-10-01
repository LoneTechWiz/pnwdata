# pnwdata

Self-hosted Politics & War alliance analytics. The production image runs the Next.js website and its scheduled sync worker together, stores all durable state in a local SQLite database, and delegates Discord gateway operations to `darth-protocol`.

```text
      P&W API ──> pnwdata container ──> data/pnw.db
                           │    ▲
                           │    │ authenticated local HTTP
                           ▼    │
                     darth-protocol ──> Discord
```

There is no Vercel or Supabase runtime dependency. The only persistent pnwdata state is `data/pnw.db`, which is bind-mounted into the container.

## Run locally with Docker

Requirements: Docker Engine with Compose, and a reachable `darth-protocol` process for Discord OAuth, login role checks, DMs, nickname-to-nation linking, stockpile alerts, and `/targets`. Each linked Discord member must include their P&W nation ID in their server nickname, such as `Member [526341]`.

1. Copy `.env.docker.example` to `.env` and fill in the required values. Compose intentionally passes only the variables named in `compose.yaml`; consolidate any older `.env.local` values into `.env`. Use the same high-entropy `BOT_SERVICE_TOKEN` in both repositories.
2. Configure `../darth-protocol/.env` with:

   ```dotenv
   PNWDATA_URL=http://127.0.0.1:3000
   BOT_SERVICE_TOKEN=the-same-random-secret
   BOT_API_HOST=0.0.0.0
   BOT_API_PORT=3100
   DISCORD_CLIENT_ID=your-discord-application-id
   DISCORD_CLIENT_SECRET=your-discord-oauth-secret
   DISCORD_REDIRECT_URI=https://your-site.example/api/auth/callback
   DISCORD_GUILD_ID=your-primary-server-id
   DISCORD_ADMIN_ROLE=Emperor
   ```

3. Build and run pnwdata, then start or restart the bot so it immediately publishes the nickname-derived nation links:

   ```bash
   docker compose up -d --build
   systemctl --user restart darth-protocol.service
   docker compose ps
   curl --fail http://127.0.0.1:3000/api/health
   ```

The website is published on port `3000` by default. Override it with `PNWDATA_PORT`. `compose.yaml` maps `./data` to `/app/data`, so rebuilding or replacing the container preserves SQLite state.

For an internet-facing deployment, put a reverse proxy with TLS and request limits in front of port 3000. Set `DISCORD_REDIRECT_URI` on `darth-protocol` to the public HTTPS callback URL.

## Migrate the current Supabase data once

The migration downloads all existing application tables before changing SQLite, creates a timestamped backup of `data/pnw.db`, and then imports the snapshot in one local transaction. It does not modify Supabase.

Keep `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) in the environment for this one command:

```bash
npm install
npm run migrate:supabase
```

After the import succeeds, remove the Supabase values. The bind mount means `docker compose up` will use the migrated `data/pnw.db` directly.

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

Run the scheduler outside Docker with `npm run sync:worker`. The manual refresh endpoint records a request in SQLite; the worker claims it, performs the same sync, and updates the visible status.

## Runtime configuration

Important variables are documented in `.env.docker.example`:

- `PNW_API_KEY` supplies game data, including member spies and project ownership.
- `PUBLIC_APP_URL` is the browser-facing origin used for authentication redirects; the Unraid template defaults to `https://pnwdata.lonetechwiz.com`.
- Discord OAuth credentials, primary guild selection, and admin-role selection belong to `darth-protocol`; pnwdata receives only the safe identity and role result through its private bot-service API.
- `SESSION_SECRET` signs website sessions.
- `BOT_SERVICE_TOKEN` authenticates both directions between pnwdata and `darth-protocol`.
- `DARTH_PROTOCOL_URL` points to the bot's private HTTP service.
- `PNW_DB_PATH` defaults to `/app/data/pnw.db` inside the image.

Do not expose `BOT_SERVICE_TOKEN`, Discord credentials, or API keys to client-side variables. The `/api/bot/*` routes require the shared bearer token.

## Container behavior

The entrypoint supervises two long-running processes:

- `next start` serves the website and API on port 3000.
- `scripts/sync-worker.ts` performs the 10-minute alliance sync, hourly raid-intelligence sync, daily recruitment crawl, and queued manual refreshes.

The raid sync stores inactive nation snapshots, one GNI snapshot per nation per day, and completed beige events in SQLite. Raid Finder combines those observed records with visible alliance-bank transactions; modeled values are labeled in the UI.

If either process exits, the container stops so Docker can restart the complete runtime. `/api/health` verifies that the web process can open SQLite; the image includes a Docker health check.
