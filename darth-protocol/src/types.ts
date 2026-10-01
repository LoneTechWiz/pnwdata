export type GuildSettings = {
  channelId: string;
  intervalSeconds: number;
};

export type WatchState = {
  guilds: Record<string, GuildSettings>;
  /** offer keys that were uncompetitive on the prior successful scan */
  alertedOffers: string[];
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
