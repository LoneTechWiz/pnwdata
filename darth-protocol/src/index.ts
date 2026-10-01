import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type Guild,
  type GuildMember,
  type SendableChannels,
} from "discord.js";
import { config } from "./config.js";
import { getOpenGlobalTrades, marketUrl } from "./pnw.js";
import { configuredGuildIds, getGuildSettings, hasAlerted, loadState, replaceAlertedOffers, saveGuildSettings } from "./store.js";
import type { Trade } from "./types.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

let scanning = false;
const lastGuildScans = new Map<string, number>();

function nationIdFromNickname(member: GuildMember): string | undefined {
  // Use the last bracketed ID so an older tag elsewhere in the display name wins less often.
  return [...member.displayName.matchAll(/\[(\d+)\]/g)].at(-1)?.[1];
}

function pricePerUnit(trade: Trade): number {
  // P&W's `total` value in this trade response is the quoted price per unit,
  // not an aggregate order value. Do not divide it by offer_amount.
  return trade.total;
}

function offerOwnerId(trade: Trade): string {
  // For open market offers, P&W identifies the nation that created the offer
  // in `sid` for both buy and sell orders. `rid` is 0 until another nation
  // accepts the offer, so it cannot identify an open buy order's owner.
  return trade.sid;
}

function offerKey(guildId: string, trade: Trade): string {
  return `${guildId}:${trade.id}`;
}

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

async function getTrackedMembers(guild: Guild): Promise<Map<string, GuildMember[]>> {
  const members = await guild.members.fetch();
  const byNation = new Map<string, GuildMember[]>();
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const nationId = nationIdFromNickname(member);
    if (!nationId) continue;
    const linkedMembers = byNation.get(nationId) ?? [];
    linkedMembers.push(member);
    byNation.set(nationId, linkedMembers);
  }
  return byNation;
}

function isUncompetitive(
  trade: Trade,
  allTrades: Trade[],
  serverNationIds: ReadonlyMap<string, GuildMember[]>,
): { bestPrice: number; competitor: Trade } | undefined {
  const competitors = allTrades.filter((candidate) =>
    candidate.id !== trade.id &&
    candidate.offer_resource === trade.offer_resource &&
    candidate.buy_or_sell === trade.buy_or_sell &&
    // Only alert when an offer from outside this server beats the member.
    !serverNationIds.has(offerOwnerId(candidate)),
  );
  if (!competitors.length) return undefined;

  const comparator = trade.buy_or_sell === "sell"
    ? (a: Trade, b: Trade) => pricePerUnit(a) - pricePerUnit(b)
    : (a: Trade, b: Trade) => pricePerUnit(b) - pricePerUnit(a);
  const competitor = competitors.sort(comparator)[0];
  const bestPrice = pricePerUnit(competitor);
  const ownPrice = pricePerUnit(trade);
  const hasLostLead = trade.buy_or_sell === "sell" ? ownPrice > bestPrice : ownPrice < bestPrice;
  return hasLostLead ? { bestPrice, competitor } : undefined;
}

async function configuredTextChannel(guild: Guild): Promise<SendableChannels | undefined> {
  const settings = getGuildSettings(guild.id);
  if (!settings) return undefined;
  const channel = await guild.channels.fetch(settings.channelId).catch(() => null);
  return channel?.isSendable() ? channel : undefined;
}

async function scanGuild(guild: Guild, trades: Trade[]): Promise<Set<string>> {
  const trackedMembers = await getTrackedMembers(guild);
  const channel = await configuredTextChannel(guild);
  if (!channel) return new Set();

  const currentAlerts = new Set<string>();
  for (const trade of trades) {
    const members = trackedMembers.get(offerOwnerId(trade));
    if (!members) continue;
    const result = isUncompetitive(trade, trades, trackedMembers);
    if (!result) continue;

    const key = offerKey(guild.id, trade);
    currentAlerts.add(key);
    if (hasAlerted(key)) continue;

    const action = trade.buy_or_sell === "sell" ? "a lower sell" : "a higher buy";
    const memberMentions = members.map((member) => `<@${member.id}>`).join(" ");
    await channel.send({
      content: `${memberMentions} your **${trade.offer_resource}** ${trade.buy_or_sell} offer is no longer competitive: ${currency(pricePerUnit(trade))}/unit; ${action} offer is ${currency(result.bestPrice)}/unit. [Open market](${marketUrl(trade.offer_resource)})`,
      allowedMentions: { users: members.map((member) => member.id) },
    });
  }
  return currentAlerts;
}

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
  await scanAllGuilds(true).catch((error) => console.error("Initial trade scan failed:", error));
  setInterval(() => {
    void scanAllGuilds().catch((error) => console.error("Trade scan failed:", error));
  }, 60_000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "trade-watch" || !interaction.guild) return;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "configure") {
    const channel = interaction.options.getChannel("channel", true);
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
      await interaction.reply({ content: "Choose a text or announcement channel.", ephemeral: true });
      return;
    }
    const intervalSeconds = interaction.options.getInteger("interval-seconds") ?? config.defaultScanIntervalSeconds;
    await saveGuildSettings(interaction.guild.id, { channelId: channel.id, intervalSeconds });
    await interaction.reply({ content: `Trade alerts will be sent to <#${channel.id}> every ${intervalSeconds} seconds.`, ephemeral: true });
    return;
  }

  if (subcommand === "status") {
    const settings = getGuildSettings(interaction.guild.id);
    await interaction.reply({ content: settings ? `Alerts: <#${settings.channelId}> every ${settings.intervalSeconds} seconds.` : "Trade watch has not been configured for this server.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await scanAllGuilds(true, interaction.guild.id);
    await interaction.editReply(`Scan complete: ${result.alerts} uncompetitive offer(s) found in this server.`);
  } catch (error) {
    await interaction.editReply(`Scan failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});

await loadState();
await client.login(config.discordToken);
