export type GuildSettings = {
  intervalSeconds: number;
};

export type WatchState = {
  guilds: Record<string, GuildSettings>;
  /** Members who explicitly opted in, grouped by server. */
  registrations: Record<string, string[]>;
  /** offer keys that were uncompetitive on the prior successful scan */
  alertedOffers: string[];
  /** Saved alert pages so navigation still works after a bot restart. */
  alertSummaries: Record<string, AlertSummary>;
};

export type AlertSummary = {
  guildId: string;
  guildName: string;
  memberId: string;
  offers: { trade: Trade; bestPrice: number; marketBestPrice?: number }[];
};

export type Trade = {
  id: string;
  buy_or_sell: "buy" | "sell";
  offer_amount: number;
  offer_resource: string;
  total: number;
  sid: string;
  rid: string;
};
