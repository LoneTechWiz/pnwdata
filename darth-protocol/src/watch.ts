import { randomUUID } from "node:crypto";
import type { Guild, GuildMember } from "discord.js";
import { alertMessage } from "./alert-messages.js";
import { hasAlerted, isRegistered, removeAlertSummary, saveAlertSummary } from "./store.js";
import type { AlertSummary, Trade } from "./types.js";

export function nationIdFromNickname(member: Pick<GuildMember, "displayName">): string | undefined {
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

function offerKey(guildId: string, memberId: string, trade: Trade): string {
  // Previously delivered channel alerts must not suppress the first DM.
  return `${guildId}:${memberId}:dm:${trade.id}`;
}

async function getServerMembers(guild: Guild): Promise<Map<string, GuildMember[]>> {
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

export async function scanGuild(guild: Guild, trades: Trade[]): Promise<Set<string>> {
  const serverMembers = await getServerMembers(guild);
  const currentAlerts = new Set<string>();
  const pendingMessages = new Map<string, { member: GuildMember; alerts: Map<string, AlertSummary["offers"][number]> }>();
  for (const trade of trades) {
    const members = serverMembers.get(offerOwnerId(trade))?.filter((member) => isRegistered(guild.id, member.id));
    if (!members?.length) continue;
    const result = isUncompetitive(trade, trades, serverMembers);
    if (!result) continue;

    // Alerts ignore fellow members, but a replacement should beat the whole
    // market, excluding this nation's own offers.
    const marketPrices = trades.filter((candidate) =>
      candidate.offer_resource === trade.offer_resource && candidate.buy_or_sell === trade.buy_or_sell &&
      offerOwnerId(candidate) !== offerOwnerId(trade),
    ).map(pricePerUnit);
    const marketBestPrice = trade.buy_or_sell === "sell" ? Math.min(...marketPrices) : Math.max(...marketPrices);

    for (const member of members) {
      const key = offerKey(guild.id, member.id, trade);
      if (hasAlerted(key)) {
        currentAlerts.add(key);
        continue;
      }
      const pending = pendingMessages.get(member.id) ?? { member, alerts: new Map<string, AlertSummary["offers"][number]>() };
      pending.alerts.set(key, { trade, bestPrice: result.bestPrice, marketBestPrice });
      pendingMessages.set(member.id, pending);
    }
  }

  for (const { member, alerts } of pendingMessages.values()) {
    // A member can unregister while another member's summary is being sent.
    if (!isRegistered(guild.id, member.id)) continue;
    const summaryId = randomUUID();
    const summary: AlertSummary = { guildId: guild.id, guildName: guild.name, memberId: member.id, offers: [...alerts.values()] };
    try {
      await saveAlertSummary(summaryId, summary);
      if (!isRegistered(guild.id, member.id)) {
        await removeAlertSummary(summaryId);
        continue;
      }
      await member.send(alertMessage(summaryId, summary));
      for (const key of alerts.keys()) currentAlerts.add(key);
    } catch (error) {
      await removeAlertSummary(summaryId).catch((cleanupError) => console.error("Could not remove failed alert summary:", cleanupError));
      // The entire summary remains pending for the next scan if delivery fails.
      console.error(`Could not DM trade alert summary to member ${member.id} in server ${guild.id}:`, error instanceof Error ? error.message : "unknown error");
    }
  }
  return currentAlerts;
}
