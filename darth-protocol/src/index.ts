import {
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";
import { config } from "./config.js";
import { getOpenGlobalTrades } from "./pnw.js";
import { configuredGuildIds, getGuildSettings, loadState, replaceAlertedOffers } from "./store.js";
import { scanGuild } from "./watch.js";
import { handleAlertPageInteraction } from "./alert-messages.js";
import { handleTradeWatchInteraction } from "./interactions.js";
import { startBotApi } from "./http-server.js";
import { deliverStockpileAlerts, handleTargetsInteraction, syncWebsiteDiscordLinks } from "./website-features.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

let scanning = false;
let deliveringStockpileAlerts = false;
const lastGuildScans = new Map<string, number>();

async function scanAllGuilds(force = false, onlyGuildId?: string): Promise<{ scanned: number; alerts: number }> {
  if (scanning) throw new Error("A trade scan is already running.");
  scanning = true;
  try {
    const alertKeys = new Set<string>();
    let scanned = 0;
    const dueGuildIds = configuredGuildIds().filter((guildId) => {
      if (onlyGuildId && guildId !== onlyGuildId) return false;
      const settings = getGuildSettings(guildId);
      const lastScan = lastGuildScans.get(guildId) ?? 0;
      return force || Boolean(settings && Date.now() - lastScan >= settings.intervalSeconds * 1_000);
    });
    if (!dueGuildIds.length) return { scanned, alerts: 0 };

    const trades = await getOpenGlobalTrades();
    for (const guildId of dueGuildIds) {
      const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) continue;
      scanned += 1;
      for (const key of await scanGuild(guild, trades)) alertKeys.add(key);
      lastGuildScans.set(guildId, Date.now());
    }
    await replaceAlertedOffers(alertKeys, dueGuildIds);
    return { scanned, alerts: alertKeys.size };
  } finally {
    scanning = false;
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Connected as ${readyClient.user.tag}.`);
  startBotApi(client);
  await syncWebsiteDiscordLinks(client)
    .then((count) => console.log(`[Website] Cached ${count} nation-to-Discord link(s) from nicknames.`))
    .catch((error) => console.error("[Website] Initial nickname sync failed:", error));
  setInterval(() => {
    void syncWebsiteDiscordLinks(client)
      .then((count) => console.log(`[Website] Refreshed ${count} nation-to-Discord link(s) from nicknames.`))
      .catch((error) => console.error("[Website] Nickname sync failed:", error));
  }, 10 * 60 * 1_000);
  const pollStockpileAlerts = async () => {
    if (deliveringStockpileAlerts) return;
    deliveringStockpileAlerts = true;
    try {
      const result = await deliverStockpileAlerts(client);
      if (result.acknowledged > 0) {
        console.log(`[Website] Delivered ${result.delivered} stockpile DM(s); acknowledged ${result.acknowledged} alert row(s).`);
      }
    } catch (error) {
      console.error("[Website] Stockpile alert poll failed:", error);
    } finally {
      deliveringStockpileAlerts = false;
    }
  };
  void pollStockpileAlerts();
  setInterval(() => void pollStockpileAlerts(), 2 * 60 * 1_000);

  await scanAllGuilds(true)
    .then((result) => console.log(`Initial trade scan complete: ${result.scanned} server(s), ${result.alerts} uncompetitive member offer(s).`))
    .catch((error) => console.error("Initial trade scan failed:", error));
  setInterval(() => {
    void scanAllGuilds().catch((error) => console.error("Trade scan failed:", error));
  }, 60_000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    await handleAlertPageInteraction(interaction).catch((error) => console.error("Alert page update failed:", error));
    return;
  }
  if (!interaction.isChatInputCommand() || !interaction.guild) return;
  if (interaction.commandName === "trade-watch") {
    await handleTradeWatchInteraction(interaction, scanAllGuilds, config.defaultScanIntervalSeconds);
  } else if (interaction.commandName === "targets") {
    await handleTargetsInteraction(interaction);
  }
});

await loadState();
await client.login(config.discordToken);
