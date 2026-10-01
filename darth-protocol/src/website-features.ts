import { EmbedBuilder, type ChatInputCommandInteraction, type Client, type Guild, type GuildMember, type User } from "discord.js";
import { config } from "./config.js";
import {
  acknowledgeStockpileAlerts,
  getStockpileAlerts,
  getWarTargets,
  updateDiscordLinks,
  type StockpileAlert,
} from "./pnwdata.js";
import { formatStockpileAlert, sortWarTargets, type TargetSort } from "./website-messages.js";
import { nationIdFromNickname } from "./watch.js";

async function websiteGuilds(client: Client): Promise<Guild[]> {
  if (config.discordGuildId) {
    const guild = client.guilds.cache.get(config.discordGuildId) ?? await client.guilds.fetch(config.discordGuildId);
    return [guild];
  }
  return [...client.guilds.cache.values()];
}

export function nationLinksFromMembers(
  members: Iterable<Pick<GuildMember, "id" | "displayName" | "user">>,
): Array<{ nationId: number; discordId: string; username: string }> {
  const links = new Map<number, { nationId: number; discordId: string; username: string }>();
  for (const member of members) {
    if (member.user.bot) continue;
    const nationId = Number(nationIdFromNickname(member));
    if (Number.isSafeInteger(nationId) && nationId > 0) {
      links.set(nationId, { nationId, discordId: member.id, username: member.user.username });
    }
  }
  return [...links.values()];
}

export async function syncWebsiteDiscordLinks(client: Client): Promise<number> {
  const links = new Map<number, { nationId: number; discordId: string; username: string }>();
  for (const guild of await websiteGuilds(client)) {
    const members = await guild.members.fetch();
    for (const link of nationLinksFromMembers(members.values())) {
      links.set(link.nationId, link);
    }
  }
  await updateDiscordLinks([...links.values()]);
  return links.size;
}

async function findUser(client: Client, alert: StockpileAlert, guilds: Guild[]): Promise<User | undefined> {
  if (alert.discord_id) return client.users.fetch(alert.discord_id).catch(() => undefined);
  if (!alert.discord_username) return undefined;
  const expected = alert.discord_username.includes("#") ? alert.discord_username.split("#")[0] : alert.discord_username;
  for (const guild of guilds) {
    const matches = await guild.members.search({ query: expected, limit: 10 }).catch(() => null);
    const member = matches?.find((candidate) =>
      candidate.user.username.toLowerCase() === expected.toLowerCase() ||
      candidate.user.tag.toLowerCase() === alert.discord_username!.toLowerCase(),
    );
    if (member) return member.user;
  }
  return undefined;
}

export async function deliverStockpileAlerts(client: Client): Promise<{ delivered: number; acknowledged: number }> {
  const alerts = await getStockpileAlerts();
  if (alerts.length === 0) return { delivered: 0, acknowledged: 0 };

  const guilds = await websiteGuilds(client);
  const groups = new Map<string, StockpileAlert[]>();
  const discardedIds: number[] = [];
  for (const alert of alerts) {
    const key = alert.discord_id ?? alert.discord_username;
    if (!key) {
      discardedIds.push(alert.id);
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push(alert);
    groups.set(key, group);
  }

  const deliveredIds: number[] = [];
  let delivered = 0;
  for (const groupedAlerts of groups.values()) {
    const user = await findUser(client, groupedAlerts[0], guilds);
    if (!user) {
      console.warn(`[Stockpile Alerts] Could not resolve a Discord user for nation ${groupedAlerts[0].nation_name}.`);
      discardedIds.push(...groupedAlerts.map((alert) => alert.id));
      continue;
    }
    try {
      await user.send(formatStockpileAlert(groupedAlerts));
      deliveredIds.push(...groupedAlerts.map((alert) => alert.id));
      delivered += 1;
    } catch (error) {
      console.error(`[Stockpile Alerts] Could not DM ${user.id}:`, error instanceof Error ? error.message : error);
    }
  }

  const acknowledgedIds = [...discardedIds, ...deliveredIds];
  if (acknowledgedIds.length > 0) await acknowledgeStockpileAlerts(acknowledgedIds);
  return { delivered, acknowledged: acknowledgedIds.length };
}

export async function handleTargetsInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  if (config.targetsChannelId && interaction.channelId !== config.targetsChannelId) {
    await interaction.reply({ content: "This command can only be used in the designated channel.", ephemeral: true });
    return;
  }

  await interaction.deferReply();
  try {
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    const nationId = Number(member ? nationIdFromNickname(member) : undefined);
    if (!Number.isSafeInteger(nationId) || nationId <= 0) {
      await interaction.editReply("Add your P&W nation ID to your server nickname, such as `YourName [526341]`, then try again.");
      return;
    }
    const response = await getWarTargets(nationId);
    if (response.targets.length === 0) {
      await interaction.editReply(`No attackable targets found in your score range (${response.minScore.toLocaleString()} – ${response.maxScore.toLocaleString()}).`);
      return;
    }

    const count = interaction.options.getInteger("count") ?? 5;
    const sort = (interaction.options.getString("sort") ?? "infra") as TargetSort;
    const targets = sortWarTargets(response.targets, sort).slice(0, count);
    const sortLabel = sort === "soldiers" ? "lowest soldiers" : sort === "loot" ? "highest avg loot" : "highest infra";
    const embeds = targets.map((target) => new EmbedBuilder()
      .setColor(0xb91c1c)
      .setTitle(target.nation_name)
      .setURL(`https://politicsandwar.com/nation/id=${target.id}`)
      .setDescription(`[⚔ Declare War](https://politicsandwar.com/nation/war/declare/id=${target.id})`)
      .addFields(
        { name: "Alliance", value: target.alliance_name || "None", inline: true },
        { name: "Avg Infra", value: Math.round(target.avg_infra).toLocaleString(), inline: true },
        { name: "Soldiers", value: target.soldiers.toLocaleString(), inline: true },
        { name: "Avg Loot", value: target.beige_avg != null ? `$${target.beige_avg.toLocaleString()}` : "—", inline: true },
      ));

    await interaction.editReply({
      content: `Top ${targets.length} targets for **${response.yourLeader}** (sorted by ${sortLabel}):`,
      embeds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await interaction.editReply(message === "Nation not found"
      ? "Couldn't find the nation ID from your server nickname in pnwdata."
      : `Target lookup failed: ${message}`);
  }
}
