# P&W trade watchdog

A Discord bot that sends direct message alerts to registered members when one of their open Politics & War **global** market offers is no longer competitive. Members must opt in with `/trade-watch register`; the bot reads their nation ID from their server nickname, such as `LoneTechWiz [526341]`:

- sell offer: a cheaper sell offer exists for the same resource;
- buy offer: a higher buy offer exists for the same resource.

The bot checks only the member's own open offers. It does not place, cancel, or alter trades. It also owns the Discord boundary used by the local `pnwdata` website: OAuth exchange, primary-guild member and role lookups, website-triggered DMs, the `/targets` command, nickname-based nation linking, and stockpile-alert delivery. Discord credentials stay in this service; pnwdata receives only safe identity and role results.

## Setup

1. Create a Discord application and bot at the [Discord Developer Portal](https://discord.com/developers/applications). Enable **Server Members Intent** under Bot → Privileged Gateway Intents. Invite it with `bot` and `applications.commands` scopes.
2. Copy `.env.example` to `.env` and fill in the Discord bot and OAuth credentials, primary guild, P&W API key, `PNWDATA_URL`, and `BOT_SERVICE_TOKEN`. Register `DISCORD_REDIRECT_URI` in the Discord Developer Portal. Use the same service token in pnwdata. Keep all secrets private.
3. Install dependencies and register slash commands:

   ```sh
   npm install
   npm run register
   npm run start
   ```

4. In each server, an administrator runs `/trade-watch configure` to enable alerts and (optionally) set a scan interval. No alert channel is needed. Use `/trade-watch scan` for a manual run.
5. Members add their nation ID to their nickname and run `/trade-watch register` to receive alerts by DM. They must allow direct messages from the server so the bot can reach them. They can use `/trade-watch unregister` to stop alerts and `/trade-watch status` to check their registration. Registration is separate for each server and survives bot restarts. Only members with **Manage Server** permission can configure alerts or run manual scans.

After updating an existing installation, run `npm run register` again and restart the bot. Existing members are not automatically registered.

The registered command set also includes `/targets`, which resolves the caller's nation through pnwdata and returns up to five current war targets. Set `TARGETS_CHANNEL_ID` to restrict that command to one channel.

When upgrading from channel alerts, existing registrations and scan intervals are preserved. Previously posted channel alerts do not suppress the first DM.

Set `DISCORD_GUILD_ID` to register commands in that server. Otherwise, `npm run register` registers them in every server already configured in `data/state.json`. It removes matching global commands so each command appears once. [Server-specific commands update immediately](https://docs.discord.com/developers/interactions/application-commands#making-a-guild-command). Before any server is configured, registration uses global commands for setup. Run `npm run register` again after configuring a server to switch to server-specific commands.

## Run as a service

The included systemd user service keeps the bot running after logout, starts it after reboot, and restarts it 10 seconds after an unexpected exit. It runs from `/home/devin/dev/darth-protocol` using `/usr/bin/node`, loading the repository's `.env` and preserving `data/state.json`. Adjust `WorkingDirectory` and `ExecStart` in `deploy/darth-protocol.service` if installing elsewhere.

Stop any manually launched bot process before starting the service so only one instance sends alerts. Install the service and enable lingering for your account:

```sh
mkdir -p ~/.config/systemd/user
cp deploy/darth-protocol.service ~/.config/systemd/user/
systemctl --user daemon-reload
loginctl enable-linger "$USER"
systemctl --user enable --now darth-protocol.service
```

Check the service and follow its logs:

```sh
systemctl --user status darth-protocol.service
journalctl --user -u darth-protocol.service -f
```

After updating code or `.env`, reload the bot with `systemctl --user restart darth-protocol.service`. To stop it and disable startup, run `systemctl --user disable --now darth-protocol.service`.

## pnwdata integration

The bot exposes a small bearer-token-protected HTTP API for the website and calls pnwdata's protected `/api/bot/*` routes in the other direction:

```text
pnwdata -> bot API: Discord OAuth, primary-guild roles and membership, website-triggered DMs
bot -> pnwdata API: nickname-derived nation links, stockpile queue, war targets
```

Use matching configuration on the same private host or Docker network:

```dotenv
PNWDATA_URL=http://127.0.0.1:3000
BOT_SERVICE_TOKEN=one-long-random-secret-shared-by-both-services
BOT_API_HOST=0.0.0.0
BOT_API_PORT=3100
DISCORD_GUILD_ID=your-primary-server-id
DISCORD_CLIENT_ID=your-discord-application-id
DISCORD_CLIENT_SECRET=your-discord-oauth-secret
DISCORD_REDIRECT_URI=https://your-site.example/api/auth/callback
DISCORD_ADMIN_ROLE=Emperor
```

The pnwdata container reaches a host-run bot at `http://host.docker.internal:3100`. Because the bot API may bind to all interfaces for Docker access, firewall port 3100 from untrusted networks; every non-health request also requires `BOT_SERVICE_TOKEN`.

On startup and every ten minutes, the bot parses the final bracketed nation ID from each primary-guild member nickname and sends the resulting nation-to-Discord map to pnwdata. Start pnwdata before restarting this service so the initial snapshot succeeds. Every two minutes it claims pending stockpile alerts, sends grouped DMs, and acknowledges only delivered or permanently unresolvable rows. Transient DM failures remain queued for retry.

## Nickname format

The last bracketed number in a nickname is used as the nation ID. These all work:

```text
LoneTechWiz [526341]
LoneTechWiz — [526341]
LoneTechWiz [526341] (away)
```

Display names are read at scan time, so changing a nickname automatically updates the website link. The bot ignores people without an ID and bots. Having an ID in a nickname alone does not enable trade alerts.

## Alert behavior

For each server scan, the bot combines all newly flagged offers for a registered member into one DM. Each offer is included once while it remains uncompetitive against an offer made by a nation outside the Discord server. Server members do not trigger each other's alerts, including members who have not registered. If an offer becomes competitive and later falls behind again, it can appear in a fresh summary. A newly registered member can receive an alert even if another member linked to the same nation was already alerted. The summary lists each offer's resource, buy/sell side, remaining amount, own price, best competing price, and suggested replacement price. Sell suggestions are $1 below the best competing sell price (with a $1 floor); buy suggestions are $1 above the best competing buy price. Prices and amounts reflect the scan, so review them against the current market before acting.

Each displayed offer has **View existing offer** and **Prepare replacement** link buttons. Larger summaries display four offers per page, with Previous/Next buttons that edit the same DM. Page data is saved in `data/state.json` so navigation survives bot restarts. A full report is attached as `trade-alerts.txt` when needed. If delivery fails, the bot continues with other members and retries pending offers on the next scan; failed deliveries are not marked as alerted.

The bot never cancels or submits offers. **View existing offer** opens your personal offers filtered to the relevant resource and side; use the offer ID shown in the alert to find the original. **Prepare replacement** opens P&W's creation page using its prefill URL parameters: `resource` for the resource, `p` for the suggested price per unit, `q` for the remaining amount, and `t=s` for a sell offer or `t=b` for a buy offer. No userscript or browser extension is required. For example, `https://politicsandwar.com/nation/trade/create/?resource=iron&p=5299&q=423&t=s` prepares a sell offer for 423 iron at $5,299 per unit.

Members cancel the original offer and review and submit the prepared replacement themselves. Members must be logged in to P&W; if a link redirects to login, reopen the link after logging in. Registration and alert state are saved in `data/state.json`, which is intentionally excluded from Git.

For open P&W market offers, `sid` identifies the nation that created the order for both buy and sell offers; `rid` is `0` until an offer is accepted. P&W returns the quoted price per unit in `total`; the bot compares that value only within the same resource and side, excluding the member's own offer.
