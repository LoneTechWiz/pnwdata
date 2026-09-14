# P&W trade watchdog

A Discord bot that recognizes a Politics & War nation ID in a server member's nickname, such as `LoneTechWiz [526341]`, and alerts that member when one of their open **global** market offers is no longer competitive:

- sell offer: a cheaper sell offer exists for the same resource;
- buy offer: a higher buy offer exists for the same resource.

The bot checks only the member's own open offers. It does not place, cancel, or alter trades.

## Setup

1. Create a Discord application and bot at the [Discord Developer Portal](https://discord.com/developers/applications). Enable **Server Members Intent** under Bot → Privileged Gateway Intents. Invite it with `bot` and `applications.commands` scopes, and permission to view the server and send messages in the alert channel.
2. Copy `.env.example` to `.env` and fill in the Discord token, application ID, and P&W API key. Keep the API key secret.
3. Install dependencies and register slash commands:

   ```sh
   npm install
   npm run register
   npm run start
   ```

4. In each server, an administrator runs `/trade-watch configure` to choose an alert channel and (optionally) a scan interval. Use `/trade-watch scan` for a manual run.

For development, set `DISCORD_GUILD_ID`; commands then appear in that one server almost immediately. Without it, commands are global and Discord can take up to an hour to surface them.

## Nickname format

The last bracketed number in a nickname is used as the nation ID. These all work:

```text
LoneTechWiz [526341]
LoneTechWiz — [526341]
LoneTechWiz [526341] (away)
```

Display names are read at scan time, so changing a nickname automatically updates the link. The bot ignores people without an ID and bots.

## Alert behavior

Each flagged offer produces one alert while it remains uncompetitive against an offer made by a nation outside the Discord server. Server members do not trigger each other's alerts. If an offer becomes competitive and later falls behind again, a fresh alert is sent. The alert includes a direct P&W market link and the current best competing price. State is saved in `data/state.json`, which is intentionally excluded from Git.

For open P&W market offers, `sid` identifies the nation that created the order for both buy and sell offers; `rid` is `0` until an offer is accepted. P&W returns the quoted price per unit in `total`; the bot compares that value only within the same resource and side, excluding the member's own offer.
