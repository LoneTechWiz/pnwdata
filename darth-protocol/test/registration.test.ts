import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ButtonStyle, InteractionContextType, PermissionFlagsBits, PermissionsBitField, type ActionRowBuilder, type AttachmentBuilder, type ButtonBuilder, type ButtonInteraction, type ChatInputCommandInteraction, type Guild, type GuildMember } from "discord.js";
import type { Trade } from "../src/types.js";

const originalDirectory = process.cwd();
const directory = await mkdtemp(join(tmpdir(), "trade-watch-registration-"));
await mkdir(join(directory, "data"));
process.chdir(directory);
// No real credentials or external requests are used by these tests.
process.env.DISCORD_TOKEN = "test-token";
process.env.DISCORD_CLIENT_ID = "test-application";
process.env.DISCORD_CLIENT_SECRET = "test-client-secret";
process.env.DISCORD_REDIRECT_URI = "http://localhost:3000/api/auth/callback";
process.env.DISCORD_GUILD_ID = "guild";
process.env.PNW_API_KEY = "test-api-key";
process.env.PNWDATA_URL = "http://127.0.0.1:3000";
process.env.BOT_SERVICE_TOKEN = "test-service-token";
const store = await import("../src/store.js");
const { scanGuild } = await import("../src/watch.js");
const { handleTradeWatchInteraction } = await import("../src/interactions.js");
const { commands } = await import("../src/commands.js");
const { handleAlertPageInteraction } = await import("../src/alert-messages.js");
const { replacementPrice } = await import("../src/pnw.js");
const { nationLinksFromMembers } = await import("../src/website-features.js");

beforeEach(async () => {
  await writeFile(join(directory, "data/state.json"), JSON.stringify({
    guilds: { guild: { intervalSeconds: 300 } },
    registrations: {},
    alertedOffers: [],
  }));
  await store.loadState();
});

after(async () => {
  process.chdir(originalDirectory);
  await rm(directory, { recursive: true, force: true });
});

function member(id: string, nationId: string, bot = false): GuildMember {
  return { id, displayName: `Member [${nationId}]`, user: { bot } } as GuildMember;
}

type DirectMessage = { recipientId: string; content: string; files?: AttachmentBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; allowedMentions: { parse: string[] } };

function guild(members: GuildMember[], onSend?: (memberId: string) => Promise<void>) {
  const messages: DirectMessage[] = [];
  const attempts: string[] = [];
  const directMessageMembers = members.map((member) => ({
    ...member,
    send: async (message: Omit<DirectMessage, "recipientId">) => {
      attempts.push(member.id);
      await onSend?.(member.id);
      messages.push({ ...message, recipientId: member.id });
    },
  }));
  return {
    messages,
    attempts,
    value: {
      id: "guild",
      name: "Test Server",
      members: { fetch: async () => new Map(directMessageMembers.map((value) => [value.id, value])) },
      channels: { fetch: async () => { assert.fail("Trade alerts must not use server channels"); } },
    } as unknown as Guild,
  };
}

function trade(id: string, nationId: string, price: number, side: "buy" | "sell" = "sell"): Trade {
  return { id, sid: nationId, rid: "0", total: price, buy_or_sell: side, offer_amount: 100, offer_resource: "food" };
}

test("members can access registration commands in servers", () => {
  const command = commands[0];
  assert.equal(command.default_member_permissions, undefined);
  assert.deepEqual(command.contexts, [InteractionContextType.Guild]);
  assert.ok(command.options?.some((option) => option.name === "register"));
  assert.ok(command.options?.some((option) => option.name === "unregister"));
  const configure = command.options?.find((option) => option.name === "configure");
  assert.ok(configure && "options" in configure);
  assert.ok(configure.options?.every((option) => option.name !== "channel"));
});

test("website links come from the final bracketed nation ID in member nicknames", () => {
  const members = [
    { id: "alice", displayName: "Alice [111]", user: { bot: false, username: "alice-user" } },
    { id: "bob", displayName: "Bob [old] [222]", user: { bot: false, username: "bob-user" } },
    { id: "missing", displayName: "Missing", user: { bot: false, username: "missing-user" } },
    { id: "bot", displayName: "Bot [333]", user: { bot: true, username: "bot-user" } },
  ] as unknown as GuildMember[];

  assert.deepEqual(nationLinksFromMembers(members), [
    { nationId: 111, discordId: "alice", username: "alice-user" },
    { nationId: 222, discordId: "bob", username: "bob-user" },
  ]);
});

test("legacy state does not automatically register members and keeps server settings", async () => {
  await writeFile(join(directory, "data/state.json"), JSON.stringify({
    guilds: { guild: { channelId: "legacy", intervalSeconds: 120 } }, alertedOffers: ["guild:own"],
  }));
  await store.loadState();
  assert.deepEqual(store.getGuildSettings("guild"), { intervalSeconds: 120 });
  const server = guild([member("alice", "123")]);
  assert.deepEqual([...await scanGuild(server.value, [trade("own", "123", 100), trade("outside", "999", 90)])], []);
  assert.equal(server.messages.length, 0);
});

test("only registered members receive DMs, including when a nation is shared", async () => {
  await store.registerMember("guild", "alice");
  await store.registerMember("other-guild", "bob");
  const server = guild([member("alice", "123"), member("bob", "123")]);
  const alerts = await scanGuild(server.value, [trade("own", "123", 100), trade("outside", "999", 90)]);
  assert.equal(server.messages[0].recipientId, "alice");
  assert.deepEqual([...alerts], ["guild:alice:dm:own"]);
  assert.deepEqual(server.messages[0].allowedMentions.parse, []);
  assert.doesNotMatch(server.messages[0].content, /<@/);
  assert.match(server.messages[0].content, /Test Server/);
  assert.match(server.messages[0].content, /Open market/);
});

test("multiple resources and buy/sell offers are combined into one DM per member", async () => {
  await store.registerMember("guild", "alice");
  await store.registerMember("guild", "bob");
  const server = guild([member("alice", "123"), member("bob", "123")]);
  const trades = [
    trade("food-sell", "123", 100), trade("outside-food", "999", 90),
    { ...trade("oil-buy", "123", 200, "buy"), offer_resource: "oil" },
    { ...trade("outside-oil", "999", 210, "buy"), offer_resource: "oil" },
    { ...trade("coal-sell", "123", 300), offer_resource: "coal" },
    { ...trade("outside-coal", "999", 280), offer_resource: "coal" },
  ];
  const alerts = await scanGuild(server.value, trades);
  assert.deepEqual(server.messages.map((message) => message.recipientId), ["alice", "bob"]);
  for (const message of server.messages) {
    assert.match(message.content, /3 uncompetitive offers/);
    assert.match(message.content, /\*\*food sell\*\*: \$100\/unit; a lower sell offer is \$90/);
    assert.match(message.content, /\*\*oil buy\*\*: \$200\/unit; a higher buy offer is \$210/);
    assert.match(message.content, /\*\*coal sell\*\*: \$300\/unit; a lower sell offer is \$280/);
    assert.ok(message.files?.every((file) => file.name === "trade-alerts.txt"));
    assert.doesNotMatch(message.content, /userscript|browser helper|install/i);
    assert.deepEqual(message.allowedMentions.parse, []);
  }
  assert.equal(alerts.size, 6);
  await store.replaceAlertedOffers(alerts, ["guild"]);
  await scanGuild(server.value, trades);
  assert.equal(server.messages.length, 2);
});

test("summaries contain only new offers while preserving previously delivered offer state", async () => {
  await store.registerMember("guild", "alice");
  await store.replaceAlertedOffers(["guild:alice:dm:old"], ["guild"]);
  const server = guild([member("alice", "123")]);
  const trades = [trade("old", "123", 101), trade("new-1", "123", 102), trade("new-2", "123", 103), trade("outside", "999", 90)];
  const alerts = await scanGuild(server.value, trades);
  assert.equal(server.messages.length, 1);
  assert.match(server.messages[0].content, /2 uncompetitive offers/);
  assert.doesNotMatch(server.messages[0].content, /\$101\/unit/);
  assert.match(server.messages[0].content, /\$102\/unit/);
  assert.match(server.messages[0].content, /\$103\/unit/);
  assert.equal(alerts.size, 3);
  await store.replaceAlertedOffers(alerts, ["guild"]);
  await scanGuild(server.value, trades);
  assert.equal(server.messages.length, 1);
});

test("an offer can appear in a fresh summary after becoming competitive and falling behind again", async () => {
  await store.registerMember("guild", "alice");
  const server = guild([member("alice", "123")]);
  const own = trade("own", "123", 100);
  const competitive = [own, trade("outside", "999", 110)];
  const uncompetitive = [own, trade("outside", "999", 90)];
  await store.replaceAlertedOffers(await scanGuild(server.value, uncompetitive), ["guild"]);
  await store.replaceAlertedOffers(await scanGuild(server.value, competitive), ["guild"]);
  assert.equal(server.messages.length, 1);
  await store.replaceAlertedOffers(await scanGuild(server.value, uncompetitive), ["guild"]);
  assert.equal(server.messages.length, 2);
});

test("oversized summaries use one DM with the complete alert list attached", async () => {
  await store.registerMember("guild", "alice");
  const server = guild([member("alice", "123")]);
  const ownOffers = Array.from({ length: 40 }, (_, index) => trade(`own-${index}`, "123", 101 + index));
  const trades = [...ownOffers, trade("outside", "999", 90)];
  const alerts = await scanGuild(server.value, trades);
  assert.equal(server.messages.length, 1);
  const message = server.messages[0];
  assert.ok(message.content.length <= 2_000);
  assert.match(message.content, /40 uncompetitive offers/);
  assert.equal(message.files?.length, 1);
  const attachment = message.files!.find((file) => file.name === "trade-alerts.txt")!;
  assert.equal(attachment.name, "trade-alerts.txt");
  assert.ok(Buffer.isBuffer(attachment.attachment));
  const report = attachment.attachment.toString("utf8");
  assert.equal(report.match(/^- \*\*food sell\*\*/gm)?.length, 40);
  for (const offer of ownOffers) assert.ok(report.includes(`$${offer.total}/unit`));
  assert.equal(alerts.size, 40);
  await store.replaceAlertedOffers(alerts, ["guild"]);
  await scanGuild(server.value, trades);
  assert.equal(server.messages.length, 1);
});

test("each alert has two read-only links carrying its offer and replacement values", async () => {
  await store.registerMember("guild", "alice");
  const server = guild([member("alice", "123")]);
  const sell = { ...trade("1234567", "123", 5400), offer_resource: "iron", offer_amount: 423 };
  const buy = { ...trade("1234568", "123", 80, "buy"), offer_resource: "oil", offer_amount: 654 };
  await scanGuild(server.value, [sell, buy, { ...trade("outside-sell", "999", 5300), offer_resource: "iron" }, { ...trade("outside-buy", "999", 85, "buy"), offer_resource: "oil" }]);
  assert.equal(server.messages.length, 1);
  const rows = server.messages[0].components.map((row) => row.toJSON());
  assert.equal(rows.length, 2);
  for (const [index, row] of rows.entries()) {
    assert.equal(row.components.length, 2);
    const [view, prepare] = row.components;
    assert.equal(view.style, ButtonStyle.Link);
    assert.equal(prepare.style, ButtonStyle.Link);
    assert.ok("url" in view && "url" in prepare);
    assert.equal("custom_id" in view, false);
    assert.equal("custom_id" in prepare, false);
    const own = [sell, buy][index];
    const viewingUrl = new URL(view.url);
    assert.equal(viewingUrl.origin, "https://politicsandwar.com");
    assert.equal(viewingUrl.searchParams.get("id"), "26");
    assert.equal(viewingUrl.searchParams.get("display"), "nation");
    assert.equal(viewingUrl.searchParams.get("resource1"), own.offer_resource);
    assert.equal(viewingUrl.searchParams.has("tradedelid"), false);
    assert.equal(viewingUrl.hash, "");
    const preparingUrl = new URL(prepare.url);
    assert.equal(preparingUrl.pathname, "/nation/trade/create/");
    assert.equal(preparingUrl.searchParams.get("q"), String(own.offer_amount));
    assert.equal(preparingUrl.searchParams.get("p"), String([5299, 86][index]));
    assert.equal(preparingUrl.searchParams.get("resource"), own.offer_resource);
    assert.equal(preparingUrl.searchParams.get("t"), own.buy_or_sell === "sell" ? "s" : "b");
    assert.equal(preparingUrl.searchParams.has("tw_side"), false);
    assert.equal(preparingUrl.origin, "https://politicsandwar.com");
    if (index === 0) assert.equal(prepare.url, "https://politicsandwar.com/nation/trade/create/?resource=iron&p=5299&q=423&t=s");
    assert.match(server.messages[0].content, /Suggested replacement/);
  }
});

test("suggested prices beat the whole market while fellow members still do not trigger alerts", async () => {
  await store.registerMember("guild", "alice");
  const server = guild([member("alice", "123"), member("bob", "456")]);
  await scanGuild(server.value, [trade("own", "123", 100), trade("outside", "999", 90), trade("fellow-member", "456", 85), trade("other-own", "123", 80)]);
  assert.equal(server.messages.length, 1);
  const row = server.messages[0].components[0].toJSON();
  const prepare = row.components[1];
  assert.ok("url" in prepare);
  assert.equal(new URL(prepare.url).searchParams.get("p"), "84");
  assert.equal(replacementPrice(trade("sell", "123", 5), 1), 1);
  assert.equal(replacementPrice(trade("buy", "123", 5, "buy"), 10), 11);
});

function pageInteraction(customId: string, memberId = "alice") {
  const updates: Record<string, unknown>[] = [];
  const replies: string[] = [];
  return {
    updates, replies,
    value: {
      customId, user: { id: memberId },
      deferUpdate: async () => {},
      editReply: async (message: Record<string, unknown>) => { updates.push(message); },
      reply: async ({ content }: { content: string }) => { replies.push(content); },
    } as unknown as ButtonInteraction,
  };
}

test("large summaries keep every offer's buttons accessible in one DM after reloading state", async () => {
  await store.registerMember("guild", "alice");
  const server = guild([member("alice", "123")]);
  const ownOffers = Array.from({ length: 10 }, (_, index) => trade(String(1234000 + index), "123", 101 + index));
  await scanGuild(server.value, [...ownOffers, trade("outside", "999", 90)]);
  assert.equal(server.messages.length, 1);
  await store.loadState();
  let rows = server.messages[0].components;
  const seen: number[] = [];
  for (let page = 0; page < 3; page++) {
    assert.ok(rows.length <= 5);
    for (const row of rows.slice(0, -1)) {
      const buttons = row.toJSON().components;
      assert.equal(buttons.length, 2);
      assert.ok("url" in buttons[0] && "url" in buttons[1]);
      seen.push(Number(buttons[0].label?.split(".")[0]));
      assert.equal(new URL(buttons[1].url).searchParams.get("t"), "s");
    }
    const next = rows.at(-1)!.toJSON().components[1];
    assert.ok("custom_id" in next);
    if (page < 2) {
      const request = pageInteraction(next.custom_id);
      assert.equal(await handleAlertPageInteraction(request.value), true);
      assert.equal(request.updates.length, 1);
      const update = request.updates[0];
      assert.ok(String(update.content).length <= 2_000);
      assert.equal("files" in update, false);
      rows = update.components as ActionRowBuilder<ButtonBuilder>[];
    } else assert.equal(next.disabled, true);
  }
  assert.deepEqual(seen, ownOffers.map((_, index) => index + 1));
  assert.equal(server.messages.length, 1);
});

test("pagination rejects other members and invalid pages without editing the summary", async () => {
  await store.registerMember("guild", "alice");
  const server = guild([member("alice", "123")]);
  await scanGuild(server.value, [...Array.from({ length: 5 }, (_, index) => trade(String(index + 1), "123", 100)), trade("outside", "999", 90)]);
  const next = server.messages[0].components.at(-1)!.toJSON().components[1];
  assert.ok("custom_id" in next);
  const otherMember = pageInteraction(next.custom_id, "bob");
  await handleAlertPageInteraction(otherMember.value);
  assert.match(otherMember.replies[0], /another member/);
  assert.equal(otherMember.updates.length, 0);
  const invalidPage = pageInteraction(next.custom_id.replace(/:\d+$/, ":999"));
  await handleAlertPageInteraction(invalidPage.value);
  assert.match(invalidPage.replies[0], /unavailable/);
  assert.equal(invalidPage.updates.length, 0);
});

test("channel alert state upgrades to DMs without losing registrations or scan intervals", async () => {
  await writeFile(join(directory, "data/state.json"), JSON.stringify({
    guilds: { guild: { channelId: "old-channel", intervalSeconds: 120 } },
    registrations: { guild: ["alice"] },
    alertedOffers: ["guild:alice:own"],
  }));
  await store.loadState();
  assert.deepEqual(store.getGuildSettings("guild"), { intervalSeconds: 120 });
  assert.equal(store.isRegistered("guild", "alice"), true);
  const server = guild([member("alice", "123")]);
  await store.replaceAlertedOffers(await scanGuild(server.value, [trade("own", "123", 100), trade("outside", "999", 90)]), ["guild"]);
  assert.equal(server.messages.length, 1);
  assert.equal(store.hasAlerted("guild:alice:dm:own"), true);
  assert.equal(store.hasAlerted("guild:alice:own"), false);
});

test("DM delivery does not depend on a configured or accessible server channel", async () => {
  await writeFile(join(directory, "data/state.json"), JSON.stringify({ guilds: {}, registrations: { guild: ["alice"] }, alertedOffers: [] }));
  await store.loadState();
  const server = guild([member("alice", "123")]);
  await scanGuild(server.value, [trade("own", "123", 100), trade("outside", "999", 90)]);
  assert.equal(server.messages[0].recipientId, "alice");
});

test("failed DMs do not block other members, are retried, and do not count as delivered", async (t) => {
  t.mock.method(console, "error", () => {});
  await store.registerMember("guild", "alice");
  await store.registerMember("guild", "bob");
  let blocked = true;
  const server = guild([member("alice", "123"), member("bob", "123")], async (memberId) => {
    if (memberId === "alice" && blocked) throw Object.assign(new Error("Cannot send messages to this user"), { code: 50007 });
  });
  const trades = [trade("own-1", "123", 100), trade("own-2", "123", 110), trade("outside", "999", 90)];
  await store.replaceAlertedOffers(await scanGuild(server.value, trades), ["guild"]);
  assert.deepEqual(server.attempts, ["alice", "bob"]);
  assert.deepEqual(server.messages.map((message) => message.recipientId), ["bob"]);
  assert.match(server.messages[0].content, /2 uncompetitive offers/);
  assert.equal(store.hasAlerted("guild:alice:dm:own-1"), false);
  assert.equal(store.hasAlerted("guild:bob:dm:own-1"), true);
  blocked = false;
  await store.replaceAlertedOffers(await scanGuild(server.value, trades), ["guild"]);
  assert.deepEqual(server.messages.map((message) => message.recipientId), ["bob", "alice"]);
  assert.match(server.messages[1].content, /2 uncompetitive offers/);
  await scanGuild(server.value, trades);
  assert.equal(server.messages.length, 2);
});

test("unregister while delivering a shared nation's offer skips the next recipient", async () => {
  await store.registerMember("guild", "alice");
  await store.registerMember("guild", "bob");
  const server = guild([member("alice", "123"), member("bob", "123")], async () => store.unregisterMember("guild", "bob"));
  await scanGuild(server.value, [trade("own", "123", 100), trade("outside", "999", 90)]);
  assert.deepEqual(server.messages.map((message) => message.recipientId), ["alice"]);
});

test("unregistered server members still do not count as competing nations", async () => {
  await store.registerMember("guild", "alice");
  const server = guild([member("alice", "123"), member("bob", "456")]);
  await scanGuild(server.value, [trade("own", "123", 100), trade("server-member", "456", 90)]);
  assert.equal(server.messages.length, 0);
});

test("buy offers alert on higher outside prices and ignore fellow members", async () => {
  await store.registerMember("guild", "alice");
  const server = guild([member("alice", "123"), member("bob", "456")]);
  await scanGuild(server.value, [trade("own", "123", 100, "buy"), trade("member", "456", 120, "buy"), trade("outside", "999", 110, "buy")]);
  assert.equal(server.messages[0].recipientId, "alice");
  assert.match(server.messages[0].content, /higher buy offer is \$110/);
});

test("new registrations receive alerts already sent to another linked member without duplicate DMs", async () => {
  const server = guild([member("alice", "123"), member("bob", "123")]);
  const trades = [trade("own", "123", 100), trade("outside", "999", 90)];
  await store.registerMember("guild", "alice");
  await store.replaceAlertedOffers(await scanGuild(server.value, trades), ["guild"]);
  await scanGuild(server.value, trades);
  assert.equal(server.messages.length, 1);
  await store.registerMember("guild", "bob");
  await store.replaceAlertedOffers(await scanGuild(server.value, trades), ["guild"]);
  assert.equal(server.messages[1].recipientId, "bob");
});

test("unregister stops alerts immediately and re-register permits a fresh alert", async () => {
  const server = guild([member("alice", "123")]);
  const trades = [trade("own", "123", 100), trade("outside", "999", 90)];
  await store.registerMember("guild", "alice");
  await store.replaceAlertedOffers(await scanGuild(server.value, trades), ["guild"]);
  await store.unregisterMember("guild", "alice");
  await scanGuild(server.value, trades);
  assert.equal(server.messages.length, 1);
  await store.registerMember("guild", "alice");
  await scanGuild(server.value, trades);
  assert.equal(server.messages.length, 2);
});

test("unregister during summary delivery does not retain alert state for that member", async () => {
  await store.registerMember("guild", "alice");
  const server = guild([member("alice", "123")], () => store.unregisterMember("guild", "alice"));
  await store.replaceAlertedOffers(await scanGuild(server.value, [trade("own-1", "123", 100), trade("own-2", "123", 110), trade("outside", "999", 90)]), ["guild"]);
  assert.equal(server.messages.length, 1);
  assert.equal(store.hasAlerted("guild:alice:dm:own-1"), false);
});

test("bots and registered members no longer in the server receive no alerts", async () => {
  await store.registerMember("guild", "bot");
  await store.registerMember("guild", "departed");
  const server = guild([member("bot", "123", true)]);
  await scanGuild(server.value, [trade("own", "123", 100), trade("outside", "999", 90)]);
  assert.equal(server.messages.length, 0);
});

test("concurrent registrations persist across reloads without duplicates", async () => {
  await Promise.all([store.registerMember("guild", "alice"), store.registerMember("guild", "bob"), store.registerMember("guild", "alice")]);
  await store.loadState();
  const saved = JSON.parse(await readFile(join(directory, "data/state.json"), "utf8"));
  assert.deepEqual(saved.registrations.guild, ["alice", "bob"]);
  assert.equal(store.isRegistered("guild", "alice"), true);
  assert.equal(store.isRegistered("guild", "bob"), true);
});

function interaction(subcommand: string, displayName = "Alice [123]", manageGuild = false) {
  const responses: string[] = [];
  return {
    responses,
    value: {
      guild: { id: "guild", members: { fetch: async () => ({ displayName }) } },
      user: { id: "alice" },
      memberPermissions: new PermissionsBitField(manageGuild ? PermissionFlagsBits.ManageGuild : 0n),
      options: {
        getSubcommand: () => subcommand,
        getInteger: () => null,
      },
      deferReply: async () => {},
      reply: async ({ content }: { content: string }) => { responses.push(content); },
      editReply: async (content: string) => { responses.push(content); },
    } as unknown as ChatInputCommandInteraction,
  };
}

test("members can register, check status and unregister without admin permissions", async () => {
  const register = interaction("register");
  const scan = async () => { throw new Error("Unexpected scan"); };
  await handleTradeWatchInteraction(register.value, scan, 300);
  assert.equal(store.isRegistered("guild", "alice"), true);
  assert.match(register.responses[0], /now registered.*nation 123/);
  assert.match(register.responses[0], /sent directly to you/);
  assert.match(register.responses[0], /Allow DMs/);
  assert.doesNotMatch(register.responses[0], /<#/);
  const status = interaction("status");
  await handleTradeWatchInteraction(status.value, scan, 300);
  assert.match(status.responses[0], /You are registered/);
  assert.match(status.responses[0], /Delivery: direct messages/);
  assert.doesNotMatch(status.responses[0], /<#/);
  await handleTradeWatchInteraction(interaction("unregister").value, scan, 300);
  assert.equal(store.isRegistered("guild", "alice"), false);
});

test("registration rejects nicknames without a positive nation ID", async () => {
  for (const displayName of ["Alice", "Alice [0]", "Alice [000]"]) {
    const request = interaction("register", displayName);
    await handleTradeWatchInteraction(request.value, async () => ({ scanned: 0, alerts: 0 }), 300);
    assert.equal(store.isRegistered("guild", "alice"), false);
    assert.match(request.responses[0], /Add your P&W nation ID/);
  }
});

test("ordinary members cannot configure alerts or run scans", async () => {
  for (const subcommand of ["configure", "scan"]) {
    const request = interaction(subcommand);
    await handleTradeWatchInteraction(request.value, async () => { throw new Error("Unauthorized scan"); }, 300);
    assert.match(request.responses[0], /Manage Server permission/);
    assert.deepEqual(store.getGuildSettings("guild"), { intervalSeconds: 300 });
  }
});

test("admins can still configure alerts and manually scan", async () => {
  await handleTradeWatchInteraction(interaction("configure", "Alice [123]", true).value, async () => ({ scanned: 0, alerts: 0 }), 120);
  assert.deepEqual(store.getGuildSettings("guild"), { intervalSeconds: 120 });
  let called = false;
  await handleTradeWatchInteraction(interaction("scan", "Alice [123]", true).value, async (force, guildId) => {
    called = true;
    assert.equal(force, true);
    assert.equal(guildId, "guild");
    return { scanned: 1, alerts: 0 };
  }, 300);
  assert.equal(called, true);
});
