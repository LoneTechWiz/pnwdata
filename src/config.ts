import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  discordClientId: required("DISCORD_CLIENT_ID"),
  discordGuildId: process.env.DISCORD_GUILD_ID?.trim(),
  pnwApiKey: required("PNW_API_KEY"),
  defaultScanIntervalSeconds: Number(process.env.SCAN_INTERVAL_SECONDS ?? 300),
};

if (!Number.isFinite(config.defaultScanIntervalSeconds) || config.defaultScanIntervalSeconds < 60) {
  throw new Error("SCAN_INTERVAL_SECONDS must be a number of at least 60.");
}
