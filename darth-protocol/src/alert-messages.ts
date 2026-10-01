import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, type ButtonInteraction } from "discord.js";
import { existingOfferUrl, marketUrl, replacementOfferUrl, replacementPrice } from "./pnw.js";
import { getAlertSummary } from "./store.js";
import type { AlertSummary } from "./types.js";

const offersPerPage = 4;
const buttonPrefix = "trade-alerts:";

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function offerText(offer: AlertSummary["offers"][number], index: number): string {
  const { trade, bestPrice, marketBestPrice = bestPrice } = offer;
  const action = trade.buy_or_sell === "sell" ? "a lower sell" : "a higher buy";
  return `- **${trade.offer_resource} ${trade.buy_or_sell}**: ${currency(trade.total)}/unit; ${action} offer is ${currency(bestPrice)}/unit. [Open market](${marketUrl(trade.offer_resource)})\n  Offer ${index + 1} (#${trade.id}): ${trade.offer_amount.toLocaleString("en-US")} units. Suggested replacement: **${currency(replacementPrice(trade, marketBestPrice))}/unit**.`;
}

export function alertMessage(summaryId: string, summary: AlertSummary, page = 0) {
  const pageCount = Math.ceil(summary.offers.length / offersPerPage);
  if (!Number.isInteger(page) || page < 0 || page >= pageCount) throw new Error("Invalid alert page.");
  const start = page * offersPerPage;
  const visibleOffers = summary.offers.slice(start, start + offersPerPage);
  const header = `**Trade alerts for ${summary.guildName}**\n${summary.offers.length} uncompetitive offer${summary.offers.length === 1 ? "" : "s"}:`;
  const footer = "Prepare replacement opens P&W with the resource, amount, suggested price, and buy/sell side prefilled. Review the current market, cancel the old offer, and submit the replacement yourself.\nUse `/trade-watch unregister` in that server to stop these alerts.";
  const pageText = visibleOffers.map((offer, index) => offerText(offer, start + index)).join("\n\n");
  const content = `${header}\n\n${pageText}\n\n${pageCount > 1 ? `Page ${page + 1}/${pageCount}. Button numbers match the offers above.\n` : ""}${footer}`;
  const components = visibleOffers.map(({ trade, bestPrice, marketBestPrice = bestPrice }, index) => new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`${start + index + 1}. View existing offer`).setURL(existingOfferUrl(trade)),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`${start + index + 1}. Prepare replacement`).setURL(replacementOfferUrl(trade, marketBestPrice)),
  ));
  if (pageCount > 1) components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel("Previous").setCustomId(`${buttonPrefix}${summaryId}:${Math.max(0, page - 1)}`).setDisabled(page === 0),
    new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel("Next").setCustomId(`${buttonPrefix}${summaryId}:${Math.min(pageCount - 1, page + 1)}`).setDisabled(page === pageCount - 1),
  ));
  // The full report stays in the same DM; pages keep every offer's two buttons accessible.
  const fullReport = `${header}\n\n${summary.offers.map((offer, index) => `${offerText(offer, index)}\n  View existing offer: ${existingOfferUrl(offer.trade)}\n  Prepare replacement: ${replacementOfferUrl(offer.trade, offer.marketBestPrice ?? offer.bestPrice)}`).join("\n\n")}\n\n${footer}`;
  return {
    content: content.length <= 2_000 ? content : `${header}\n\nPage ${page + 1}/${pageCount}. Full offer details are attached; use each numbered button pair.\n\n${footer}`,
    files: fullReport.length > 2_000 ? [new AttachmentBuilder(Buffer.from(fullReport, "utf8"), { name: "trade-alerts.txt" })] : [],
    components,
    allowedMentions: { parse: [] as const },
  };
}

export async function handleAlertPageInteraction(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith(buttonPrefix)) return false;
  const match = /^trade-alerts:([\da-f-]+):(\d+)$/.exec(interaction.customId);
  const summary = match ? getAlertSummary(match[1]) : undefined;
  const page = match ? Number(match[2]) : NaN;
  if (!summary || !Number.isInteger(page) || page < 0 || page >= Math.ceil(summary.offers.length / offersPerPage)) {
    await interaction.reply({ content: "This alert page is unavailable. Check the attached report or a newer alert summary.", ephemeral: true });
    return true;
  }
  if (summary.memberId !== interaction.user.id) {
    await interaction.reply({ content: "These trade alerts belong to another member.", ephemeral: true });
    return true;
  }
  await interaction.deferUpdate();
  const { files, ...message } = alertMessage(match![1], summary, page);
  // Editing pages preserves the report already attached to this DM.
  await interaction.editReply(message);
  return true;
}
