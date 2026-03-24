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
  const content = message.content.toLowerCase().trim();

  if (content === "ayy") {
    message.reply("lmao");
  } else if (content.includes("grok")) {
    message.reply(`There is no Grok, only ${client.user.username}`);
  } else if (content === "summarize this" || content === "summarise this") {
    message.reply("Learn to read ayy lmao");
  } else if (content === "ayylah give me wisdom") {
    message.reply("You didn't ask me how to use it, now you have arrested development");
  } else if (content === "ayylah grant me a wish") {
    message.reply("Wish you'd ayy lmaout of my face, I'm not a jinn");
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
