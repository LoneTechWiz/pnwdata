// bot.js — Discord bot
// Run with: node bot.js
import { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } from "discord.js";
import { readFileSync } from "fs";
import Database from "better-sqlite3";

// Load .env.local manually
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) process.env[key.trim()] ??= rest.join("=").trim();
}

const db = new Database("data/pnw.db", { readonly: true });
const dbRW = new Database("data/pnw.db"); // read-write for marking alerts sent

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const RESOURCE_LABELS = {
  money: "Cash",
  coal: "Coal",
  oil: "Oil",
  uranium: "Uranium",
  iron: "Iron",
  bauxite: "Bauxite",
  lead: "Lead",
  gasoline: "Gasoline",
  munitions: "Munitions",
  steel: "Steel",
  aluminum: "Aluminum",
  food: "Food",
};

async function resolveGuildUsernames() {
  const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
  if (!guild) { console.warn("[Discord Resolved] Guild not in cache:", process.env.DISCORD_GUILD_ID); return; }
  await guild.members.fetch();
  const now = Date.now();
  const stmt = dbRW.prepare(`INSERT OR REPLACE INTO discord_resolved (discord_id, username, updated_at) VALUES (?, ?, ?)`);
  const upsertAll = dbRW.transaction((members) => {
    for (const [id, member] of members) {
      stmt.run(id, member.user.username, now);
    }
  });
  upsertAll(guild.members.cache);
  console.log(`[Discord Resolved] Cached ${guild.members.cache.size} usernames`);
}

async function sendStockpileAlerts() {
  const unsent = db.prepare(`SELECT * FROM stockpile_alert_queue WHERE sent = 0`).all();
  if (unsent.length === 0) return;

  // Group by discord_id (preferred) or discord_username as fallback key
  const byUser = new Map();
  for (const alert of unsent) {
    const key = alert.discord_id || alert.discord_username;
    if (!key) {
      dbRW.prepare(`UPDATE stockpile_alert_queue SET sent = 1, sent_at = ? WHERE id = ?`)
        .run(Date.now(), alert.id);
      continue;
    }
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(alert);
  }

  const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);

  for (const [key, alerts] of byUser) {
    try {
      const discordId = alerts[0].discord_id;
      const username = alerts[0].discord_username;
      let user;

      if (discordId) {
        user = await client.users.fetch(discordId);
      } else if (guild && username) {
        // Fallback: guild member search by username
        const searchQuery = username.includes("#") ? username.split("#")[0] : username;
        const members = await guild.members.search({ query: searchQuery, limit: 10 });
        const member = members.find(m =>
          m.user.username.toLowerCase() === username.toLowerCase() ||
          m.user.tag.toLowerCase() === username.toLowerCase()
        );
        user = member?.user;
      }

      if (!user) {
        console.warn(`[Stockpile Alerts] Could not resolve user for nation ${alerts[0].nation_name} (id=${discordId}, username=${username})`);
        for (const alert of alerts) {
          dbRW.prepare(`UPDATE stockpile_alert_queue SET sent = 1, sent_at = ? WHERE id = ?`)
            .run(Date.now(), alert.id);
        }
        continue;
      }

      const lines = alerts.map(a => {
        const label = RESOURCE_LABELS[a.resource] ?? a.resource;
        const limit = a.resource === "uranium" ? a.threshold : a.threshold * a.num_cities;
        const excess = a.amount - limit;
        if (a.resource === "money") {
          return `• **${label}**: $${Math.round(a.amount).toLocaleString()} — limit $${Math.round(limit).toLocaleString()} ($${Math.round(excess).toLocaleString()} over)`;
        }
        return `• **${label}**: ${Math.round(a.amount).toLocaleString()} — limit ${Math.round(limit).toLocaleString()} (${Math.round(excess).toLocaleString()} over)`;
      }).join("\n");

      await user.send(
        `⚠️ **Stockpile Alert** — ${alerts[0].nation_name}\n\n` +
        `You're holding more than the per-city limits:\n${lines}\n\n` +
        `Consider depositing the excess to the alliance bank.`
      );

      for (const alert of alerts) {
        dbRW.prepare(`UPDATE stockpile_alert_queue SET sent = 1, sent_at = ? WHERE id = ?`)
          .run(Date.now(), alert.id);
      }
      console.log(`[Stockpile Alerts] DMed ${user.username} about ${alerts.length} resource(s)`);
    } catch (err) {
      console.error(`[Stockpile Alerts] Failed to DM for nation ${alerts[0].nation_name}:`, err.message);
    }
  }
}

client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Resolve and cache Discord usernames from guild members
  resolveGuildUsernames().catch(err => console.error("[Discord Resolved] Initial error:", err));
  setInterval(() => {
    resolveGuildUsernames().catch(err => console.error("[Discord Resolved] Refresh error:", err));
  }, 60 * 60 * 1000);

  // Poll for unsent stockpile alerts every 2 minutes
  setInterval(() => {
    sendStockpileAlerts().catch(err => console.error("[Stockpile Alerts] Poll error:", err));
  }, 2 * 60 * 1000);

  // Register /targets as a guild command (instant, no propagation delay)
  const commands = [
    new SlashCommandBuilder()
      .setName("targets")
      .setDescription("Find your top war targets")
      .addIntegerOption(opt =>
        opt.setName("count")
          .setDescription("Number of targets to show (default 5, max 5)")
          .setMinValue(1)
          .setMaxValue(5)
          .setRequired(false)
      )
      .addStringOption(opt =>
        opt.setName("sort")
          .setDescription("Sort targets by (default: infra)")
          .setRequired(false)
          .addChoices(
            { name: "Infra (highest first)", value: "infra" },
            { name: "Soldiers (lowest first)", value: "soldiers" },
            { name: "Avg Loot (highest first)", value: "loot" },
          )
      )
      .toJSON(),
  ];
  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(client.application.id, process.env.DISCORD_GUILD_ID),
    { body: commands }
  );
  console.log("Registered /targets slash command");
});

// ── Message handler ───────────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // Fun commands — only in designated channel
  if (message.channelId !== "677645004155387916") return;
  const content = message.content.toLowerCase().trim();

  if (content === "hail") {
    message.reply("Ayylah");
  } else if (content === "ayy") {
    message.reply("lmao");
  } else if (content.includes("grok")) {
    message.reply(`There is no Grok, only Ayylah`);
  } else if (content === "summarize this" || content === "summarise this") {
    message.reply("Learn to read ayy lmao");
  } else if (content === "ayylah give me wisdom") {
    message.reply("You didn't ask me how to use it, now you have arrested development");
  } else if (content === "ayylah grant me a wish") {
    message.reply("Wish you'd ayy lmaout of my face, I'm not a jinn");
  } else if (content.includes("you successfully assassinated enemy spies")) {
    message.reply("That's an adorable little body count, James Pond, but I've accidentally liquidated more people than that just by sneezing in a crowded elevator with a live grenade in my pocket.");
  } else if (content.includes("the attack destroyed")) {
    message.reply("Smite thy enemies");
  } else if (content.includes("you defeated")) {
    message.reply("Glory to BK");
  }
});

// ── /targets slash command ────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "targets") {
    if (interaction.channelId !== "719292084435157033") {
      await interaction.reply({ content: "This command can only be used in the designated channel.", ephemeral: true });
      return;
    }
    await interaction.deferReply();
    await handleTargets(interaction);
  }
});

// ── /targets helper ───────────────────────────────────────────────────────────
async function handleTargets(interaction) {
  const discordUsername = interaction.user.username;

  const row = db.prepare(
    `SELECT id FROM nations WHERE LOWER(json_extract(data, '$.discord')) = LOWER(?) LIMIT 1`
  ).get(discordUsername);

  if (!row) {
    await interaction.editReply("Couldn't find a nation linked to your Discord account. Make sure your Discord username matches what's set in Politics and War.");
    return;
  }

  let data;
  try {
    const res = await fetch(`http://localhost:3000/api/warTargets?nationId=${row.id}`);
    if (!res.ok) {
      await interaction.editReply("Failed to fetch war targets. Try again later.");
      return;
    }
    data = await res.json();
  } catch {
    await interaction.editReply("Network error fetching war targets.");
    return;
  }

  if (!data.targets || data.targets.length === 0) {
    const min = data.minScore?.toLocaleString() ?? "?";
    const max = data.maxScore?.toLocaleString() ?? "?";
    await interaction.editReply(`No attackable targets found in your score range (${min} – ${max}).`);
    return;
  }

  const count = interaction.options.getInteger("count") ?? 5;
  const sortBy = interaction.options.getString("sort") ?? "infra";

  const sorted = [...data.targets].sort((a, b) => {
    if (sortBy === "soldiers") return a.soldiers - b.soldiers;
    if (sortBy === "loot") return (b.beige_avg ?? -1) - (a.beige_avg ?? -1);
    if (b.avg_infra !== a.avg_infra) return b.avg_infra - a.avg_infra;
    return a.soldiers - b.soldiers;
  });

  const targets = sorted.slice(0, count);
  const sortLabel = sortBy === "soldiers" ? "lowest soldiers" : sortBy === "loot" ? "highest avg loot" : "highest infra";

  const embeds = targets.map(t =>
    new EmbedBuilder()
      .setColor(0xb91c1c)
      .setTitle(t.nation_name)
      .setURL(`https://politicsandwar.com/nation/id=${t.id}`)
      .setDescription(`[⚔ Declare War](https://politicsandwar.com/nation/war/declare/id=${t.id})`)
      .addFields(
        { name: "Alliance", value: t.alliance_name || "None", inline: true },
        { name: "Avg Infra", value: Math.round(t.avg_infra).toLocaleString(), inline: true },
        { name: "Soldiers", value: t.soldiers.toLocaleString(), inline: true },
        { name: "Avg Loot", value: t.beige_avg != null ? `$${t.beige_avg.toLocaleString()}` : "—", inline: true },
      )
  );

  await interaction.editReply({
    content: `Top ${targets.length} targets for **${data.yourLeader}** (sorted by ${sortLabel}):`,
    embeds,
  });
}

client.login(process.env.DISCORD_BOT_TOKEN);
