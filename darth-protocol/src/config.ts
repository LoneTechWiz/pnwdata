import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  discordClientId: required("DISCORD_CLIENT_ID"),
  discordClientSecret: required("DISCORD_CLIENT_SECRET"),
  discordRedirectUri: required("DISCORD_REDIRECT_URI"),
  discordAdminRole: process.env.DISCORD_ADMIN_ROLE?.trim() || "Emperor",
  discordGuildId: process.env.DISCORD_GUILD_ID?.trim(),
  pnwApiKey: required("PNW_API_KEY"),
  pnwdataUrl: required("PNWDATA_URL").replace(/\/$/, ""),
  botServiceToken: required("BOT_SERVICE_TOKEN"),
  httpHost: process.env.BOT_API_HOST?.trim() || "0.0.0.0",
  httpPort: Number(process.env.BOT_API_PORT ?? 3100),
  targetsChannelId: process.env.TARGETS_CHANNEL_ID?.trim(),
  defaultScanIntervalSeconds: Number(process.env.SCAN_INTERVAL_SECONDS ?? 300),
};

if (!Number.isFinite(config.defaultScanIntervalSeconds) || config.defaultScanIntervalSeconds < 60) {
  throw new Error("SCAN_INTERVAL_SECONDS must be a number of at least 60.");
}

if (!Number.isInteger(config.httpPort) || config.httpPort < 1 || config.httpPort > 65_535) {
  throw new Error("BOT_API_PORT must be an integer between 1 and 65535.");
}
