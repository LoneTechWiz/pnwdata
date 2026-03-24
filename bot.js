// bot.js — Discord bot
// Run with: node bot.js
import { Client, GatewayIntentBits } from "discord.js";
import { readFileSync } from "fs";

// Load .env.local manually
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) process.env[key.trim()] ??= rest.join("=").trim();
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("messageCreate", (message) => {
  if (message.author.bot) return;
  if (message.content.toLowerCase() === "ayy") {
    message.reply("lmao");
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
