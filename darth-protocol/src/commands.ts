import { InteractionContextType, SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("trade-watch")
    .setDescription("Register for or manage Politics & War trade alerts")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((subcommand) => subcommand.setName("register").setDescription("Sign up for trade alert DMs using the nation ID in your nickname"))
    .addSubcommand((subcommand) => subcommand.setName("unregister").setDescription("Stop receiving trade alerts in this server"))
    .addSubcommand((subcommand) => subcommand
      .setName("configure")
      .setDescription("Enable trade alert DMs and set the scan interval")
      .addIntegerOption((option) => option.setName("interval-seconds").setDescription("How often to scan (minimum 60 seconds)").setMinValue(60).setMaxValue(3600))
    )
    .addSubcommand((subcommand) => subcommand.setName("scan").setDescription("Run an alert scan now"))
    .addSubcommand((subcommand) => subcommand.setName("status").setDescription("Show your registration and this server's trade-watch settings")),
  new SlashCommandBuilder()
    .setName("targets")
    .setDescription("Find your top Politics & War targets")
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) => option
      .setName("count")
      .setDescription("Number of targets to show (default 5, maximum 5)")
      .setMinValue(1)
      .setMaxValue(5),
    )
    .addStringOption((option) => option
      .setName("sort")
      .setDescription("How to rank targets")
      .addChoices(
        { name: "Infra (highest first)", value: "infra" },
        { name: "Soldiers (lowest first)", value: "soldiers" },
        { name: "Avg Loot (highest first)", value: "loot" },
      ),
    ),
].map((command) => command.toJSON());
