import { PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { getGuildSettings, isRegistered, registerMember, saveGuildSettings, unregisterMember } from "./store.js";
import { nationIdFromNickname } from "./watch.js";

type Scan = (force: boolean, guildId: string) => Promise<{ scanned: number; alerts: number }>;

export async function handleTradeWatchInteraction(
  interaction: ChatInputCommandInteraction,
  scan: Scan,
  defaultIntervalSeconds: number,
) {
  if (!interaction.guild) return;
  const guildId = interaction.guild.id;
  const memberId = interaction.user.id;
  const subcommand = interaction.options.getSubcommand();

  // The command is available to members, so enforce admin actions here.
  if ((subcommand === "configure" || subcommand === "scan") &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "You need the Manage Server permission to configure trade watch or run scans.", ephemeral: true });
    return;
  }

  if (subcommand === "status") {
    const settings = getGuildSettings(guildId);
    const registration = isRegistered(guildId, memberId)
      ? "You are registered for trade alert DMs. Use `/trade-watch unregister` to stop them."
      : "You are not registered for trade alert DMs. Use `/trade-watch register` to sign up.";
    await interaction.reply({
      content: `${registration}\n${settings ? `Delivery: direct messages. Scans every ${settings.intervalSeconds} seconds. Allow DMs from this server to receive alerts.` : "Trade watch has not been configured for this server."}`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    if (subcommand === "register") {
      const member = await interaction.guild.members.fetch(memberId);
      const nationId = nationIdFromNickname(member);
      if (!nationId || !/[1-9]/.test(nationId)) {
        await interaction.editReply("Add your P&W nation ID to your server nickname, such as `YourName [526341]`, then run `/trade-watch register` again.");
        return;
      }
      const alreadyRegistered = isRegistered(guildId, memberId);
      await registerMember(guildId, memberId);
      const settings = getGuildSettings(guildId);
      await interaction.editReply(`${alreadyRegistered ? "You are already registered" : "You are now registered"} for trade alert DMs for nation ${nationId}. ${settings ? "Alerts will be sent directly to you." : "Alerts will start after an administrator configures trade watch."} Allow DMs from this server to receive alerts. Use \`/trade-watch unregister\` to stop them.`);
      return;
    }

    if (subcommand === "unregister") {
      await unregisterMember(guildId, memberId);
      await interaction.editReply("You are no longer registered for trade alerts in this server.");
      return;
    }

    if (subcommand === "configure") {
      const intervalSeconds = interaction.options.getInteger("interval-seconds") ?? defaultIntervalSeconds;
      await saveGuildSettings(guildId, { intervalSeconds });
      await interaction.editReply(`Trade alerts will be sent by direct message to registered members. Scans run every ${intervalSeconds} seconds. Members must use \`/trade-watch register\` to receive alerts.`);
      return;
    }

    if (subcommand === "scan") {
      const result = await scan(true, guildId);
      await interaction.editReply(`Scan complete: ${result.alerts} uncompetitive member offer(s) found in this server.`);
    }
  } catch (error) {
    await interaction.editReply(`Trade watch failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
