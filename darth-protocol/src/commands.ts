import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("trade-watch")
    .setDescription("Configure or run Politics & War trade alerts")
    .addSubcommand((subcommand) => subcommand
      .setName("configure")
      .setDescription("Set the channel and scan interval for trade alerts")
      .addChannelOption((option) => option.setName("channel").setDescription("Where alerts are posted").setRequired(true))
      .addIntegerOption((option) => option.setName("interval-seconds").setDescription("How often to scan (minimum 60 seconds)").setMinValue(60).setMaxValue(3600))
    )
    .addSubcommand((subcommand) => subcommand.setName("scan").setDescription("Run an alert scan now"))
    .addSubcommand((subcommand) => subcommand.setName("status").setDescription("Show this server's trade-watch settings"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((command) => command.toJSON());
