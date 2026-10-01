import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";
import { config } from "./config.js";
import { configuredGuildIds, loadState } from "./store.js";

const rest = new REST({ version: "10" }).setToken(config.discordToken);
await loadState();
const guildIds = config.discordGuildId ? [config.discordGuildId] : configuredGuildIds();

if (!guildIds.length) {
  await rest.put(Routes.applicationCommands(config.discordClientId), { body: commands });
  console.log(`Registered ${commands.length} command(s) globally.`);
}

// Use server registration once servers are known to avoid duplicate global entries.
// Upsert each command individually to preserve any other server-specific commands.
for (const guildId of guildIds) {
  for (const command of commands) {
    const guildCommand = { ...command, default_member_permissions: command.default_member_permissions ?? null };
    delete guildCommand.contexts;
    delete guildCommand.integration_types;
    await rest.post(Routes.applicationGuildCommands(config.discordClientId, guildId), { body: guildCommand });
  }
  console.log(`Registered ${commands.length} command(s) in server ${guildId}.`);
}

if (guildIds.length) {
  // Confirm server registration succeeded before removing global copies.
  const globalCommands = await rest.get(Routes.applicationCommands(config.discordClientId)) as { id: string; name: string; type: number }[];
  for (const registered of globalCommands) {
    if (!commands.some((command) => command.name === registered.name && (command.type ?? 1) === registered.type)) continue;
    await rest.delete(Routes.applicationCommand(config.discordClientId, registered.id));
    console.log(`Removed the global duplicate of /${registered.name}.`);
  }
}
