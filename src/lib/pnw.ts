// ---- Types ----

export interface Nation {
  id: number;
  nation_name: string;
  leader_name: string;
  discord: string;
  score: number;
  num_cities: number;
  color: string;
  last_active: string;
  soldiers: number;
  tanks: number;
  aircraft: number;
  ships: number;
  missiles: number;
  nukes: number;
  vacation_mode_turns: number;
  beige_turns: number;
  alliance_position: string;
  war_policy: string;
  domestic_policy: string;
  offensive_wars_count: number;
  defensive_wars_count: number;
  cities?: { infrastructure: number; land: number }[];
}

export interface War {
  id: number;
  date: string;
  reason: string;
  war_type: string;
  turns_left: number;
  att_id: number;
  att_alliance_id: number;
  def_id: number;
  def_alliance_id: number;
  attacker: { nation_name: string; leader_name: string; alliance?: { name: string } };
  defender: { nation_name: string; leader_name: string; alliance?: { name: string } };
  att_points: number;
  def_points: number;
  att_peace: boolean;
  def_peace: boolean;
  att_resistance: number;
  def_resistance: number;
  ground_control: number;
  air_superiority: number;
  naval_blockade: number;
}

export interface BankRec {
  id: number;
  date: string;
  sender_id: number;
  sender_type: number;
  receiver_id: number;
  receiver_type: number;
  banker_id: number;
  note: string;
  money: number;
  coal: number;
  oil: number;
  uranium: number;
  iron: number;
  bauxite: number;
  lead: number;
  gasoline: number;
  munitions: number;
  steel: number;
  aluminum: number;
  food: number;
  tax_id: number;
  sender: { nation_name: string } | null;
  receiver: { nation_name: string } | null;
}

export interface Alliance {
  id: number;
  name: string;
  acronym: string;
  score: number;
  color: string;
  rank: number;
  member_count: number;
  average_score: number;
  flag: string;
  forum_link: string;
  discord_link: string;
  money: number;
  coal: number;
  oil: number;
  uranium: number;
  iron: number;
  bauxite: number;
  lead: number;
  gasoline: number;
  munitions: number;
  steel: number;
  aluminum: number;
  food: number;
}

export interface SyncStatus {
  id: number;
  last_synced_at: number | null;
  status: "never" | "syncing" | "success" | "error";
  error: string | null;
  member_count: number;
  war_count: number;
  bankrec_count: number;
}

// ---- Client-side fetchers (read from local DB via API) ----

async function apiFetch<T>(type: string): Promise<T> {
  const res = await fetch(`/api/data?type=${type}`);
  if (!res.ok) throw new Error(`Failed to fetch ${type}`);
  return res.json();
}

export interface BknetResources {
  money: number;
  coal: number;
  oil: number;
  uranium: number;
  iron: number;
  bauxite: number;
  lead: number;
  gasoline: number;
  munitions: number;
  steel: number;
  aluminum: number;
  food: number;
  credits: number;
}

export interface BknetMember {
  nation: {
    id: number;
    nation_name: string;
    leader_name: string;
    discord: string;
    discord_id: string;
    num_cities: number;
    score: number;
    vacation_mode_turns: number;
    alliance_position: string;
    resources: BknetResources;
    military: {
      soldiers: number;
      tanks: number;
      aircraft: number;
      ships: number;
      missiles: number;
      nukes: number;
      spies: number;
    };
    projects: Record<string, boolean>;
  };
  discord: {
    nation_handle: string;
    nation_discord_id: string;
    account: { discord_id: string; discord_username: string } | null;
  } | null;
}

export interface TradePrice {
  id: number;
  date: string;
  coal: number;
  oil: number;
  uranium: number;
  iron: number;
  bauxite: number;
  lead: number;
  gasoline: number;
  munitions: number;
  steel: number;
  aluminum: number;
  food: number;
  credits: number;
}

export const fetchMembers = (): Promise<Nation[]> => apiFetch("members");
export const fetchWars = (): Promise<War[]> => apiFetch("wars");
export const fetchBankrecs = (): Promise<BankRec[]> => apiFetch("bankrecs");
export const fetchAlliance = (): Promise<Alliance | null> => apiFetch("alliance");
export const fetchBknetMembers = (): Promise<BknetMember[]> => apiFetch("bknet_members");
export const fetchSyncStatus = (): Promise<SyncStatus> => apiFetch("status");
export const fetchTradePrices = (): Promise<TradePrice | null> => apiFetch("trade_prices");
