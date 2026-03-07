import type { Nation } from "@/lib/pnw";

export type FieldType = "number" | "string" | "enum";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  group: "Nation" | "Military" | "Wars" | "Infrastructure";
  options?: string[];
  format?: (v: number | string) => string;
  getValue: (n: Nation) => number | string;
}

function timeSince(dateStr: string): string {
  const h = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3_600_000);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const citySum = (n: Nation, key: "infrastructure" | "land") =>
  (n.cities ?? []).reduce((s, c) => s + (c[key] ?? 0), 0);

const cityAvg = (n: Nation, key: "infrastructure" | "land") => {
  const cities = n.cities ?? [];
  return cities.length ? citySum(n, key) / cities.length : 0;
};

export const FIELDS: FieldDef[] = [
  // Nation
  { key: "nation_name",          label: "Nation",           type: "string", group: "Nation",         getValue: n => n.nation_name },
  { key: "leader_name",          label: "Leader",           type: "string", group: "Nation",         getValue: n => n.leader_name },
  { key: "score",                label: "Score",            type: "number", group: "Nation",         format: v => Number(v).toLocaleString(), getValue: n => n.score },
  { key: "num_cities",           label: "Cities",           type: "number", group: "Nation",         getValue: n => n.num_cities },
  { key: "color",                label: "Color",            type: "string", group: "Nation",         getValue: n => n.color },
  { key: "alliance_position",    label: "Position",         type: "enum",   group: "Nation",
    options: ["MEMBER", "OFFICER", "HEIR", "LEADER"],
    getValue: n => n.alliance_position },
  { key: "war_policy",           label: "War Policy",       type: "enum",   group: "Nation",
    options: ["ATTRITION", "TURTLE", "BLITZKRIEG", "FORTRESS", "MONEYBAGS", "PIRATE", "TACTICIAN", "GUARDIAN", "COVERT", "ARCANE"],
    getValue: n => n.war_policy },
  { key: "domestic_policy",      label: "Domestic Policy",  type: "string", group: "Nation",         getValue: n => n.domestic_policy },
  { key: "vacation_mode_turns",  label: "VM Turns",         type: "number", group: "Nation",         getValue: n => n.vacation_mode_turns },
  { key: "beige_turns",          label: "Beige Turns",      type: "number", group: "Nation",         getValue: n => n.beige_turns },
  { key: "last_active",          label: "Last Active",      type: "string", group: "Nation",
    format: v => timeSince(String(v)), getValue: n => n.last_active },

  // Military
  { key: "soldiers",   label: "Soldiers",  type: "number", group: "Military", format: v => Number(v).toLocaleString(), getValue: n => n.soldiers },
  { key: "tanks",      label: "Tanks",     type: "number", group: "Military", format: v => Number(v).toLocaleString(), getValue: n => n.tanks },
  { key: "aircraft",   label: "Aircraft",  type: "number", group: "Military", format: v => Number(v).toLocaleString(), getValue: n => n.aircraft },
  { key: "ships",      label: "Ships",     type: "number", group: "Military", format: v => Number(v).toLocaleString(), getValue: n => n.ships },
  { key: "missiles",   label: "Missiles",  type: "number", group: "Military", getValue: n => n.missiles },
  { key: "nukes",      label: "Nukes",     type: "number", group: "Military", getValue: n => n.nukes },

  // Wars
  { key: "offensive_wars_count",  label: "Offensive Wars",  type: "number", group: "Wars", getValue: n => n.offensive_wars_count },
  { key: "defensive_wars_count",  label: "Defensive Wars",  type: "number", group: "Wars", getValue: n => n.defensive_wars_count },

  // Infrastructure
  { key: "avg_infra",   label: "Avg Infra / City",  type: "number", group: "Infrastructure", format: v => Number(v).toFixed(0), getValue: n => cityAvg(n, "infrastructure") },
  { key: "avg_land",    label: "Avg Land / City",   type: "number", group: "Infrastructure", format: v => Number(v).toFixed(0), getValue: n => cityAvg(n, "land") },
  { key: "total_infra", label: "Total Infra",        type: "number", group: "Infrastructure", format: v => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }), getValue: n => citySum(n, "infrastructure") },
  { key: "total_land",  label: "Total Land",         type: "number", group: "Infrastructure", format: v => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }), getValue: n => citySum(n, "land") },
];

export const FIELD_MAP = Object.fromEntries(FIELDS.map(f => [f.key, f]));

export const GROUPS = ["Nation", "Military", "Wars", "Infrastructure"] as const;

// Filter
export interface Filter {
  id: string;
  field: string;
  op: string;
  value: string;
}

export const NUM_OPS  = [">", ">=", "<", "<=", "=", "!="] as const;
export const STR_OPS  = ["contains", "=", "starts with"] as const;
export const ENUM_OPS = ["=", "!="] as const;

export function defaultOp(field: FieldDef): string {
  if (field.type === "number") return ">=";
  return "contains";
}

export function opsForField(field: FieldDef): readonly string[] {
  if (field.type === "number") return NUM_OPS;
  if (field.type === "enum")   return ENUM_OPS;
  return STR_OPS;
}

export function applyFilter(n: Nation, filter: Filter): boolean {
  const field = FIELD_MAP[filter.field];
  if (!field || !filter.value.trim()) return true;
  const raw = field.getValue(n);
  const val = filter.value.trim();

  if (field.type === "number") {
    const num = Number(raw);
    const fnum = Number(val);
    if (isNaN(fnum)) return true;
    if (filter.op === ">")  return num > fnum;
    if (filter.op === ">=") return num >= fnum;
    if (filter.op === "<")  return num < fnum;
    if (filter.op === "<=") return num <= fnum;
    if (filter.op === "=")  return num === fnum;
    if (filter.op === "!=") return num !== fnum;
  } else {
    const str = String(raw).toLowerCase();
    const fstr = val.toLowerCase();
    if (filter.op === "contains")    return str.includes(fstr);
    if (filter.op === "=")           return str === fstr;
    if (filter.op === "starts with") return str.startsWith(fstr);
    if (filter.op === "!=")          return str !== fstr;
  }
  return true;
}

export const DEFAULT_FIELDS = ["nation_name", "score", "num_cities", "soldiers", "tanks", "aircraft", "ships"];

export const PRESETS: { label: string; fields: string[]; filters: Omit<Filter, "id">[] }[] = [
  {
    label: "Military Focus",
    fields: ["nation_name", "num_cities", "score", "soldiers", "tanks", "aircraft", "ships", "missiles", "nukes"],
    filters: [],
  },
  {
    label: "Infra Check",
    fields: ["nation_name", "num_cities", "avg_infra", "avg_land", "total_infra", "total_land"],
    filters: [],
  },
  {
    label: "Active Wars",
    fields: ["nation_name", "score", "num_cities", "offensive_wars_count", "defensive_wars_count", "war_policy"],
    filters: [{ field: "offensive_wars_count", op: ">=", value: "1" }],
  },
  {
    label: "Nuke / Missile Armed",
    fields: ["nation_name", "num_cities", "score", "nukes", "missiles"],
    filters: [{ field: "nukes", op: ">=", value: "1" }],
  },
];
