"use client";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMembers, fetchBknetMembers, fetchTradePrices, fetchGameInfo, TradePrice, GameInfo } from "@/lib/pnw";
import { AppShell } from "@/components/AppShell";
import { Search, ChevronDown, ChevronUp, Zap, TrendingUp } from "lucide-react";

// ── Power plant definitions ──────────────────────────────────────────────────

const POWER_TYPES = {
  coal:    { name: "Coal",    infraPerPlant: 500,  dailyCost: 1200,  fuel: "coal"    as const, fuelPerDay: 1.2 },
  oil:     { name: "Oil",     infraPerPlant: 500,  dailyCost: 1800,  fuel: "oil"     as const, fuelPerDay: 1.2 },
  wind:    { name: "Wind",    infraPerPlant: 250,  dailyCost: 500,   fuel: null,               fuelPerDay: 0   },
  nuclear: { name: "Nuclear", infraPerPlant: 2000, dailyCost: 10500, fuel: "uranium" as const, fuelPerDay: 1.8 },
} as const;
type PowerType = keyof typeof POWER_TYPES;

// ── Commerce improvements ────────────────────────────────────────────────────

interface CommerceImp { name: string; pct: number; dailyCost: number; max: number }
const COMMERCE_IMPS: CommerceImp[] = [
  { name: "Stadium",       pct: 12, dailyCost: 12150, max: 3 },
  { name: "Shopping Mall", pct: 9,  dailyCost: 5400,  max: 5 },
  { name: "Subway",        pct: 8,  dailyCost: 3250,  max: 1 },
  { name: "Bank",          pct: 5,  dailyCost: 1800,  max: 6 },
  { name: "Supermarket",   pct: 3,  dailyCost: 600,   max: 6 },
];

// ── Manufacturing improvements ───────────────────────────────────────────────

interface ManufImp { name: string; output: number; produces: string; inputs: Record<string, number>; dailyCost: number; max: number }
const MANUF_IMPS: ManufImp[] = [
  { name: "Steel Mill",          output: 9,  produces: "steel",     inputs: { iron: 3, coal: 3 }, dailyCost: 4000, max: 5 },
  { name: "Aluminum Refinery",   output: 9,  produces: "aluminum",  inputs: { bauxite: 3 },        dailyCost: 2500, max: 5 },
  { name: "Munitions Factory",   output: 18, produces: "munitions", inputs: { lead: 6 },           dailyCost: 4000, max: 5 },
  { name: "Oil Refinery",        output: 6,  produces: "gasoline",  inputs: { oil: 3 },            dailyCost: 4000, max: 5 },
];

// ── Military buildings ───────────────────────────────────────────────────────

interface ExtraBuilding { key: string; name: string; max: number; dailyCost: number }
const MIL_BUILDINGS: ExtraBuilding[] = [
  { key: "barracks",  name: "Barracks",      max: 5, dailyCost: 3000 },
  { key: "factories", name: "War Factories", max: 5, dailyCost: 3000 },
  { key: "hangars",   name: "Hangars",       max: 5, dailyCost: 1000 },
  { key: "dockyards", name: "Dockyards",     max: 3, dailyCost: 2500 },
];

// ── Civil buildings ──────────────────────────────────────────────────────────

const CIVIL_BUILDINGS: ExtraBuilding[] = [
  { key: "hospitals",         name: "Hospitals",         max: 5, dailyCost: 1000 },
  { key: "subway",            name: "Subway",            max: 1, dailyCost: 3250 },
  { key: "police_stations",   name: "Police Stations",   max: 5, dailyCost: 750  },
  { key: "recycling_centers", name: "Recycling Centers", max: 3, dailyCost: 2500 },
];

// ── Raw resource improvements ────────────────────────────────────────────────

interface ResourceImp { name: string; amount: number; produces: string; dailyCost: number; max: number }
const RESOURCE_IMPS: ResourceImp[] = [
  { name: "Coal Mine",    amount: 3, produces: "coal",    dailyCost: 400,  max: 10 },
  { name: "Oil Well",     amount: 3, produces: "oil",     dailyCost: 600,  max: 10 },
  { name: "Iron Mine",    amount: 3, produces: "iron",    dailyCost: 1600, max: 10 },
  { name: "Lead Mine",    amount: 3, produces: "lead",    dailyCost: 1600, max: 10 },
  { name: "Bauxite Mine", amount: 3, produces: "bauxite", dailyCost: 1600, max: 10 },
  { name: "Uranium Mine", amount: 3, produces: "uranium", dailyCost: 5000, max: 5  },
];

// ── Pollution values (per improvement) ──────────────────────────────────────

const IMPROVEMENT_POLLUTION: Record<string, number> = {
  // Commerce
  "Stadium": 0, "Shopping Mall": 0, "Subway": -45, "Bank": 0, "Supermarket": 0,
  // Manufacturing
  "Steel Mill": 40, "Aluminum Refinery": 40, "Munitions Factory": 35, "Oil Refinery": 40,
  // Raw resources
  "Coal Mine": 12, "Oil Well": 12, "Iron Mine": 12, "Lead Mine": 12, "Bauxite Mine": 12,
  "Uranium Mine": 12, "Farm": 2,
};
const POWER_POLLUTION: Record<PowerType, number> = { coal: 8, oil: 6, wind: 0, nuclear: 0 };
const MIL_POLLUTION: Record<string, number> = { barracks: 0, factories: 3, hangars: 0, dockyards: 0 };
const CIVIL_POLLUTION: Record<string, number> = { hospitals: 4, subway: -45, police_stations: 1, recycling_centers: -70 };

// ── Resource prices ──────────────────────────────────────────────────────────

const FALLBACK_PRICES: Record<string, number> = {
  coal: 3500, oil: 4000, uranium: 25000, iron: 4500, bauxite: 4000,
  lead: 4000, gasoline: 4000, munitions: 2500, steel: 5000, aluminum: 3500, food: 150,
};

function tradePriceToMap(tp: TradePrice): Record<string, number> {
  return {
    coal: tp.coal, oil: tp.oil, uranium: tp.uranium, iron: tp.iron,
    bauxite: tp.bauxite, lead: tp.lead, gasoline: tp.gasoline,
    munitions: tp.munitions, steel: tp.steel, aluminum: tp.aluminum, food: tp.food,
  };
}

const RESOURCE_LABELS: Record<string, string> = {
  coal: "Coal", oil: "Oil", uranium: "Uranium", iron: "Iron", bauxite: "Bauxite",
  lead: "Lead", gasoline: "Gasoline", munitions: "Munitions", steel: "Steel", aluminum: "Aluminum", food: "Food",
};

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  if (n === 0) return "$0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000)     return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)         return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtNum(n: number, decimals = 1): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

// ── Core computation ─────────────────────────────────────────────────────────

function computePowerSlots(infra: number, powerType: PowerType): number {
  return Math.ceil(infra / POWER_TYPES[powerType].infraPerPlant);
}

function computePowerDailyCost(infra: number, powerType: PowerType, prices: Record<string, number>): number {
  const pw = POWER_TYPES[powerType];
  const plants = computePowerSlots(infra, powerType);
  const fuelCost = pw.fuel ? pw.fuelPerDay * plants * prices[pw.fuel] : 0;
  return plants * pw.dailyCost + fuelCost;
}

// Disease rate (%) before hospitals: max(0, (infra/100)^2 * 0.1 + infra/100 - 25) / 100
function baseDisease(infra: number): number {
  return Math.max(0, (Math.pow(infra / 100, 2) * 0.1 + infra / 100 - 25) / 100);
}

// Disease rate after hospitals (each hospital removes 2.5 percentage points)
function diseaseAfterHospitals(infra: number, hospitals: number): number {
  return Math.max(0, baseDisease(infra) - hospitals * 2.5);
}

// How many hospitals needed to bring disease to 0
export function hospitalsToZeroDisease(infra: number): number {
  return Math.ceil(baseDisease(infra) / 2.5);
}

// Daily commerce income given current commerce % and population modifier from disease
// Formula: ((commerce/50)*0.725 + 0.725) * (infra*100 * popMod) * 12
function commerceIncome(infra: number, commercePct: number, popMod = 1): number {
  const population = infra * 100 * popMod;
  const avgIncome = (commercePct / 50) * 0.725 + 0.725;
  return population * avgIncome * 12;
}

// Marginal income gain from adding `addedPct` commerce (capped at maxCommerce)
function marginalCommerceIncome(infra: number, currentPct: number, addedPct: number, maxCommerce: number, popMod = 1): number {
  const effective = Math.min(currentPct + addedPct, maxCommerce) - currentPct;
  if (effective <= 0) return 0;
  const population = infra * 100 * popMod;
  return (effective / 50) * 0.725 * population * 12;
}

interface BuildEntry {
  category: "power" | "commerce" | "manufacturing" | "resource" | "civil";
  name: string;
  count: number;
  dailyRevenue: number;
  dailyCost: number;
}

interface OptimizerResult {
  totalSlots: number;
  powerSlots: number;
  milSlots: number;
  civilSlots: number;
  availableSlots: number;
  commercePct: number;
  dailyCommerce: number;
  dailyCommerceNoDiseaseReduction: number;
  dailyProduction: number;
  dailyPowerCost: number;
  dailyCommerceCost: number;
  dailyProductionCost: number;
  dailyMilCost: number;
  dailyCivilCost: number;
  baseDiseasePct: number;
  finalDiseasePct: number;
  popMod: number;
  hospitalsNeeded: number;
  // Pollution & crime
  totalPollution: number;
  pollutionDisease: number;
  correctedDiseasePct: number;
  crimePct: number;
  effectivePopMod: number;
  build: BuildEntry[];
  improvementOptions: ImprovementOption[];
}

interface ImprovementOption {
  name: string;
  category: string;
  profitPerSlot: number;
  revenuePerSlot: number;
  costPerSlot: number;
  detail: string;
}

// Total food from n farms in a city:
// specialization bonus = 1 + (0.5 * (n-1) / 19)
// total = round(n * bonus * landRate, 2)
function farmTotalFood(n: number, landRate: number): number {
  if (n <= 0) return 0;
  const bonus = 1 + (0.5 * (n - 1)) / 19;
  return Math.round(n * bonus * landRate * 100) / 100;
}

function getImpMax(name: string): number {
  return COMMERCE_IMPS.find(c => c.name === name)?.max
    ?? MANUF_IMPS.find(m => m.name === name)?.max
    ?? RESOURCE_IMPS.find(r => r.name === name)?.max
    ?? CIVIL_BUILDINGS.find(b => b.name === name)?.max
    ?? (name === "Farm" ? 20 : Infinity);
}

function computeOptimalBuild(
  infra: number,
  land: number,
  prices: Record<string, number>,
  maxCommerce: number,
  hasMassIrrigation: boolean,
  hasUraniumEnrichment: boolean,
  radiationPenalty: number,
  milCounts: Record<string, number>,
  civilCounts: Record<string, number>,
): OptimizerResult {
  const powerType: PowerType = "nuclear";
  const totalSlots = Math.floor(infra / 50);
  const powerSlots = computePowerSlots(infra, powerType);
  const powerDailyCost = computePowerDailyCost(infra, powerType, prices);
  const milSlots = MIL_BUILDINGS.reduce((s, b) => s + (milCounts[b.key] ?? 0), 0);
  const dailyMilCost = MIL_BUILDINGS.reduce((s, b) => s + (milCounts[b.key] ?? 0) * b.dailyCost, 0);
  // All civil buildings are manual inputs
  const civilSlots = CIVIL_BUILDINGS.reduce((s, b) => s + (civilCounts[b.key] ?? 0), 0);
  const dailyCivilCost = CIVIL_BUILDINGS.reduce((s, b) => s + (civilCounts[b.key] ?? 0) * b.dailyCost, 0);
  let remainingSlots = totalSlots - powerSlots - milSlots - civilSlots;

  // Disease from manually set hospitals
  const hospitals = civilCounts.hospitals ?? 0;
  const baseDiseasePct = baseDisease(infra);
  const finalDiseasePct = diseaseAfterHospitals(infra, hospitals);
  const popMod = 1 - finalDiseasePct / 100;
  const hospitalsNeeded = hospitalsToZeroDisease(infra);

  // Pre-apply manually set subway (max 1, adds 8% commerce, slot already reserved above)
  const subwayManual = Math.min(civilCounts.subway ?? 0, 1);

  // Commerce improvements — greedy fill to cap, skip Subway if manually set
  const commerceSorted = [...COMMERCE_IMPS]
    .filter(ci => subwayManual === 0 || ci.name !== "Subway")
    .sort((a, b) => {
      const av = a.pct * (0.725 / 50) * (infra * 100 * popMod) * 12 - a.dailyCost;
      const bv = b.pct * (0.725 / 50) * (infra * 100 * popMod) * 12 - b.dailyCost;
      return bv - av;
    });

  const build: BuildEntry[] = [];
  let currentCommerce = subwayManual * 8; // subway already placed manually
  let dailyCommerceCost = 0;

  for (const ci of commerceSorted) {
    if (remainingSlots <= 0 || currentCommerce >= maxCommerce) break;
    const spaceByCommerce = Math.floor((maxCommerce - currentCommerce) / ci.pct);
    const canAdd = Math.min(ci.max, remainingSlots, spaceByCommerce);
    if (canAdd <= 0) continue;
    const revenue = Array.from({ length: canAdd }, (_, i) =>
      marginalCommerceIncome(infra, currentCommerce + i * ci.pct, ci.pct, maxCommerce, popMod)
    ).reduce((s, v) => s + v, 0);
    const cost = canAdd * ci.dailyCost;
    build.push({ category: "commerce", name: ci.name, count: canAdd, dailyRevenue: revenue, dailyCost: cost });
    currentCommerce += canAdd * ci.pct;
    dailyCommerceCost += cost;
    remainingSlots -= canAdd;
  }

  // Production options (for remaining slots & the comparison table)
  // Multiply by 12 turns/day to get daily food production
  // Apply radiation penalty: food * max(0, 1 - (global + continent radiation) / 1000)
  const radiationMod = Math.max(0, 1 - radiationPenalty / 100);
  const farmLandRate = (land / (hasMassIrrigation ? 400 : 500)) * 12 * radiationMod;

  const improvementOptions: ImprovementOption[] = [];

  // Manufacturing (buy inputs from market)
  for (const mi of MANUF_IMPS) {
    const inputCost = Object.entries(mi.inputs).reduce((s, [r, q]) => s + q * (prices[r] ?? 0), 0);
    const revenue = mi.output * (prices[mi.produces] ?? 0);
    const cost = mi.dailyCost + inputCost;
    improvementOptions.push({
      name: mi.name, category: "Manufacturing",
      revenuePerSlot: revenue, costPerSlot: cost, profitPerSlot: revenue - cost,
      detail: `${mi.output} ${mi.produces}/day from ${Object.entries(mi.inputs).map(([r, q]) => `${q} ${r}`).join(" + ")}`,
    });
  }

  // Raw resources
  for (const ri of RESOURCE_IMPS) {
    const amount = (ri.name === "Uranium Mine" && hasUraniumEnrichment) ? ri.amount * 2 : ri.amount;
    const revenue = amount * (prices[ri.produces] ?? 0);
    improvementOptions.push({
      name: ri.name, category: "Raw Resource",
      revenuePerSlot: revenue, costPerSlot: ri.dailyCost, profitPerSlot: revenue - ri.dailyCost,
      detail: `${amount} ${ri.produces}/day${ri.name === "Uranium Mine" && hasUraniumEnrichment ? " (Uranium Enrichment)" : ""}`,
    });
  }

  // Farm — avg revenue per slot assuming max 20 farms (specialization bonus caps at 1.5×)
  const farmMaxFood = farmTotalFood(20, farmLandRate);
  const farmFoodPerFarmAtMax = farmMaxFood / 20;
  const farmAvgRevPerSlot = farmFoodPerFarmAtMax * (prices.food ?? 0);
  const farmDailyCost = 300;
  improvementOptions.push({
    name: "Farm", category: "Raw Resource",
    revenuePerSlot: farmAvgRevPerSlot, costPerSlot: farmDailyCost, profitPerSlot: farmAvgRevPerSlot - farmDailyCost,
    detail: `${fmtNum(farmFoodPerFarmAtMax)} food/farm avg (${fmtNum(farmMaxFood)} total at 20) × ${fmtMoney(prices.food ?? 0)}/unit`,
  });

  // Hospitals — each reduces disease 2.5%, increasing effective population → commerce income
  // Show marginal value for each hospital slot (diminishing once disease hits 0)
  for (let h = 1; h <= 5; h++) {
    const diseaseBefore = Math.max(0, baseDiseasePct - (h - 1) * 2.5);
    const diseaseAfter  = Math.max(0, baseDiseasePct - h * 2.5);
    if (diseaseBefore <= 0) break; // no disease left to reduce
    const popBefore = 1 - diseaseBefore / 100;
    const popAfter  = 1 - diseaseAfter  / 100;
    const revenueGain = commerceIncome(infra, currentCommerce, popAfter)
                      - commerceIncome(infra, currentCommerce, popBefore);
    improvementOptions.push({
      name: "Hospital",
      category: "Civil",
      revenuePerSlot: revenueGain,
      costPerSlot: 1000,
      profitPerSlot: revenueGain - 1000,
      detail: `Disease ${diseaseBefore.toFixed(2)}% → ${diseaseAfter.toFixed(2)}% (+${fmtMoney(revenueGain)}/day commerce)`,
    });
  }

  // Police stations and recycling centers — qualitative benefit (crime/pollution reduction)
  improvementOptions.push({
    name: "Police Station", category: "Civil",
    revenuePerSlot: 0, costPerSlot: 750, profitPerSlot: -750,
    detail: "Reduces crime rate → less population loss (formula not quantified)",
  });
  improvementOptions.push({
    name: "Recycling Center", category: "Civil",
    revenuePerSlot: 0, costPerSlot: 2500, profitPerSlot: -2500,
    detail: "Reduces pollution → less disease/population loss (formula not quantified)",
  });

  improvementOptions.sort((a, b) => b.profitPerSlot - a.profitPerSlot);

  // Fill remaining slots with production improvements (civil buildings are all manual — skip them)
  let dailyProduction = 0;
  let dailyProductionCost = 0;
  for (const opt of improvementOptions) {
    if (remainingSlots <= 0) break;
    if (opt.profitPerSlot <= 0) break;
    if (opt.category === "Civil") continue; // all civil is manual
    const max = getImpMax(opt.name);
    const toAdd = Math.min(remainingSlots, max);
    if (toAdd <= 0) continue;
    const revenue = opt.name === "Farm"
      ? farmTotalFood(toAdd, farmLandRate) * (prices.food ?? 0)
      : opt.revenuePerSlot * toAdd;
    const cost = opt.costPerSlot * toAdd;
    const category: BuildEntry["category"] = opt.category === "Manufacturing" ? "manufacturing" : "resource";
    build.push({ category, name: opt.name, count: toAdd, dailyRevenue: revenue, dailyCost: cost });
    dailyProduction += revenue;
    dailyProductionCost += cost;
    remainingSlots -= toAdd;
  }

  // ── Pollution & crime (post-fill) ──────────────────────────────────────────
  let totalPollution = 0;
  totalPollution += powerSlots * POWER_POLLUTION[powerType];
  for (const b of MIL_BUILDINGS)   totalPollution += (milCounts[b.key]   ?? 0) * (MIL_POLLUTION[b.key]   ?? 0);
  for (const b of CIVIL_BUILDINGS) totalPollution += (civilCounts[b.key] ?? 0) * (CIVIL_POLLUTION[b.key] ?? 0);
  for (const entry of build)       totalPollution += entry.count * (IMPROVEMENT_POLLUTION[entry.name] ?? 0);
  const pollutionDisease = Math.max(0, totalPollution) / 100;
  const correctedDiseasePct = Math.max(0, baseDiseasePct + pollutionDisease - hospitals * 2.5);
  // Crime: max(0, 103 - police*2.5 - commerce%)
  const crimePct = Math.max(0, 103 - (civilCounts.police_stations ?? 0) * 2.5 - currentCommerce);
  // Effective pop modifier combines disease and crime
  const effectivePopMod = (1 - correctedDiseasePct / 100) * (1 - crimePct / 100);

  const dailyCommerce = commerceIncome(infra, currentCommerce, effectivePopMod);
  const dailyCommerceNoDiseaseReduction = commerceIncome(infra, currentCommerce, 1 - baseDiseasePct / 100);

  return {
    totalSlots, powerSlots, milSlots, civilSlots,
    availableSlots: totalSlots - powerSlots - milSlots - civilSlots,
    commercePct: currentCommerce, dailyCommerce, dailyCommerceNoDiseaseReduction, dailyProduction,
    dailyPowerCost: powerDailyCost, dailyCommerceCost, dailyProductionCost, dailyMilCost, dailyCivilCost,
    baseDiseasePct, finalDiseasePct, popMod, hospitalsNeeded,
    totalPollution, pollutionDisease, correctedDiseasePct, crimePct, effectivePopMod,
    build, improvementOptions,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

const inputCls = "bg-[#1e2540] border border-[#2a3150] rounded-lg text-sm text-white px-3 py-1.5 focus:outline-none focus:border-blue-500 w-full placeholder-slate-600";

function PriceRow({ resource, prices, onChange }: { resource: string; prices: Record<string, number>; onChange: (r: string, v: number) => void; }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400 w-20 shrink-0 capitalize">{RESOURCE_LABELS[resource] ?? resource}</span>
      <input
        type="number" min={0} value={prices[resource] ?? 0}
        onChange={e => onChange(resource, parseFloat(e.target.value) || 0)}
        className="bg-[#1e2540] border border-[#2a3150] rounded text-xs text-white px-2 py-1 w-28 focus:outline-none focus:border-blue-500"
      />
    </div>
  );
}

export default function OptimizerPage() {
  const [nationId, setNationId] = useState("");
  const [nationName, setNationName] = useState("");
  const [infra, setInfra] = useState("");
  const [land, setLand] = useState("");
  const [maxCommerce, setMaxCommerce] = useState(100);
  const [hasMassIrrigation, setHasMassIrrigation] = useState(false);
  const [hasUraniumEnrichment, setHasUraniumEnrichment] = useState(false);
  const [radiationPenalty, setRadiationPenalty] = useState(0);
  const [prices, setPrices] = useState<Record<string, number>>(FALLBACK_PRICES);
  const [pricesOverridden, setPricesOverridden] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [lookupMsg, setLookupMsg] = useState("");
  const [milCounts, setMilCounts] = useState<Record<string, number>>({ barracks: 0, factories: 0, hangars: 0, dockyards: 0 });
  const [civilCounts, setCivilCounts] = useState<Record<string, number>>({ hospitals: 0, subway: 0, police_stations: 0, recycling_centers: 0 });

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["members"], queryFn: fetchMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: bknetMembers = [] } = useQuery({
    queryKey: ["bknet_members"], queryFn: fetchBknetMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: tradePrices } = useQuery({
    queryKey: ["trade_prices"], queryFn: fetchTradePrices,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: gameInfo } = useQuery<GameInfo | null>({
    queryKey: ["game_info"], queryFn: fetchGameInfo,
    refetchInterval: 10 * 60 * 1000,
  });

  // Keep prices in sync with the latest API data unless the user has manually overridden them
  useEffect(() => {
    if (tradePrices && !pricesOverridden) {
      setPrices(tradePriceToMap(tradePrices));
    }
  }, [tradePrices, pricesOverridden]);

  const result = useMemo<OptimizerResult | null>(() => {
    const i = parseFloat(infra) || 0;
    const l = parseFloat(land) || 0;
    if (i < 100) return null;
    return computeOptimalBuild(i, l, prices, maxCommerce, hasMassIrrigation, hasUraniumEnrichment, radiationPenalty, milCounts, civilCounts);
  }, [infra, land, prices, maxCommerce, hasMassIrrigation, hasUraniumEnrichment, radiationPenalty, milCounts, civilCounts]);

  function lookupNation() {
    const id = nationId.trim();
    if (!id) return;
    const member = members.find(m => String(m.id) === id);
    if (!member) {
      setLookupMsg("Nation not found in alliance DB. Enter infra and land manually.");
      setNationName("");
      return;
    }
    const cities = member.cities ?? [];
    if (cities.length === 0) {
      setLookupMsg(`Found ${member.nation_name} — no city data yet. Enter infra and land manually.`);
      setNationName(member.nation_name);
      return;
    }
    const avgInfra = Math.round(cities.reduce((s, c) => s + (c.infrastructure ?? 0), 0) / cities.length);
    const avgLand  = Math.round(cities.reduce((s, c) => s + (c.land ?? 0), 0) / cities.length);
    setInfra(avgInfra.toString());
    setLand(avgLand.toString());
    setNationName(member.nation_name);

    // Auto-fill buildings from first city (if building data is present)
    const firstCity = cities[0];
    if (firstCity.factory !== undefined) {
      setMilCounts({
        barracks:  firstCity.barracks ?? 0,
        factories: firstCity.factory  ?? 0,
        hangars:   firstCity.hangar   ?? 0,
        dockyards: firstCity.drydock  ?? 0,
      });
      setCivilCounts({
        hospitals:         firstCity.hospital        ?? 0,
        subway:            firstCity.subway          ?? 0,
        police_stations:   firstCity.policestation   ?? 0,
        recycling_centers: firstCity.recycling_center ?? 0,
      });
    }

    // Auto-fill projects — PnW data first, BK Net as fallback
    if (member.mass_irrigation !== undefined || member.international_trade_center !== undefined) {
      setHasMassIrrigation(!!member.mass_irrigation);
      setMaxCommerce(member.telecommunications_satellite ? 125 : member.international_trade_center ? 115 : 100);
      setHasUraniumEnrichment(!!member.uranium_enrichment_program);
    } else {
      const bknet = bknetMembers.find(m => String(m.nation.id) === id);
      if (bknet?.nation.projects) {
        const proj = bknet.nation.projects;
        setHasMassIrrigation(!!proj.mass_irrigation);
        setMaxCommerce(proj.telecommunications_satellite ? 125 : proj.international_trade_center ? 115 : 100);
        setHasUraniumEnrichment(!!proj.uranium_enrichment_program);
      }
    }

    // Auto-set radiation penalty from game radiation data + nation's continent
    if (gameInfo?.radiation && member.continent) {
      const CONTINENT_KEY: Record<string, keyof typeof gameInfo.radiation> = {
        na: "north_america", sa: "south_america", eu: "europe",
        af: "africa", as: "asia", au: "australia",
      };
      const key = CONTINENT_KEY[member.continent];
      if (key) {
        const penalty = (gameInfo.radiation.global + gameInfo.radiation[key]) / 10;
        setRadiationPenalty(Math.round(penalty * 10) / 10);
      }
    }

    setLookupMsg(`Loaded ${member.nation_name} — ${cities.length} cities, avg ${avgInfra} infra, avg ${avgLand} land.`);
  }

  const infraNum = parseFloat(infra) || 0;
  const landNum  = parseFloat(land) || 0;
  const ready = infraNum >= 100;
  const categoryColors: Record<string, string> = {
    power: "text-yellow-400",
    commerce: "text-blue-400",
    manufacturing: "text-purple-400",
    resource: "text-green-400",
    civil: "text-teal-400",
  };
  const categoryBg: Record<string, string> = {
    power: "bg-yellow-900/30 border-yellow-700/30",
    commerce: "bg-blue-900/30 border-blue-700/30",
    manufacturing: "bg-purple-900/30 border-purple-700/30",
    resource: "bg-green-900/30 border-green-700/30",
    civil: "bg-teal-900/30 border-teal-700/30",
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-white">City Build Optimizer</h2>
          <p className="text-slate-400 text-sm">
            Enter a nation ID to auto-fill their average infra & land, then see the most profitable improvement build.
          </p>
        </div>

        {/* Inputs */}
        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 space-y-4">
          <h3 className="text-sm font-semibold text-slate-300">Nation & City Stats</h3>

          {/* Nation lookup */}
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex flex-col gap-1 w-52">
              <label className="text-xs text-slate-400">Nation ID</label>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text" placeholder="e.g. 123456"
                  value={nationId} onChange={e => setNationId(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && lookupNation()}
                  className="bg-[#1e2540] border border-[#2a3150] rounded-lg text-sm text-white pl-8 pr-3 py-1.5 focus:outline-none focus:border-blue-500 w-full placeholder-slate-600"
                />
              </div>
            </div>
            <button
              onClick={lookupNation}
              disabled={isLoading}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {isLoading ? "Loading…" : "Look up"}
            </button>
            {lookupMsg && <p className="text-xs text-slate-400 self-end pb-1.5">{lookupMsg}</p>}
          </div>

          {/* Infra / Land */}
          <div className="flex gap-4 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Avg Infra / City</label>
              <input type="number" min={0} placeholder="e.g. 2500" value={infra} onChange={e => setInfra(e.target.value)} className={inputCls} style={{ width: 140 }} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Avg Land / City</label>
              <input type="number" min={0} placeholder="e.g. 5000" value={land} onChange={e => setLand(e.target.value)} className={inputCls} style={{ width: 140 }} />
            </div>
          </div>

          {/* Projects */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Relevant Projects</label>
            <div className="flex gap-4 flex-wrap">
              {[
                { key: "massIrrigation", label: "Mass Irrigation", state: hasMassIrrigation, set: setHasMassIrrigation },
                { key: "uraniumEnrichment", label: "Uranium Enrichment Program", state: hasUraniumEnrichment, set: setHasUraniumEnrichment },
              ].map(({ key, label, state, set }) => (
                <label key={key} className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
                  <input type="checkbox" checked={state} onChange={e => set(e.target.checked)} className="accent-blue-500" />
                  {label}
                </label>
              ))}
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400">Max Commerce %</label>
                <select
                  value={maxCommerce}
                  onChange={e => setMaxCommerce(Number(e.target.value))}
                  className="bg-[#1e2540] border border-[#2a3150] rounded text-xs text-slate-200 px-2 py-1 focus:outline-none focus:border-blue-500"
                >
                  <option value={100}>100% (base)</option>
                  <option value={115}>115% (ITC)</option>
                  <option value={125}>125% (ITC + Telecom Sat)</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400">
                  Radiation Penalty %
                  {gameInfo?.radiation && (
                    <span className="text-slate-600 ml-1" title={`Global: ${gameInfo.radiation.global.toFixed(1)} | NA: ${gameInfo.radiation.north_america.toFixed(1)} | SA: ${gameInfo.radiation.south_america.toFixed(1)} | EU: ${gameInfo.radiation.europe.toFixed(1)} | AF: ${gameInfo.radiation.africa.toFixed(1)} | AS: ${gameInfo.radiation.asia.toFixed(1)} | AU: ${gameInfo.radiation.australia.toFixed(1)}`}>ⓘ</span>
                  )}
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={radiationPenalty}
                  onChange={e => setRadiationPenalty(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                  style={{ width: 70 }}
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          {/* Military buildings */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-slate-400">Military Buildings <span className="text-slate-600">(consume slots, no income)</span></label>
            <div className="flex flex-wrap gap-3">
              {MIL_BUILDINGS.map(b => (
                <div key={b.key} className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">{b.name} <span className="text-slate-600">(max {b.max})</span></span>
                  <div className="flex items-center gap-1">
                    <button
                      className="w-7 h-7 rounded bg-[#1e2540] text-slate-300 hover:bg-[#2a3150] font-bold text-sm flex items-center justify-center"
                      onClick={() => setMilCounts(p => ({ ...p, [b.key]: Math.max(0, (p[b.key] ?? 0) - 1) }))}
                    >−</button>
                    <input
                      type="number" min={0} max={b.max}
                      value={milCounts[b.key] ?? 0}
                      onChange={e => setMilCounts(p => ({ ...p, [b.key]: Math.min(b.max, Math.max(0, Number(e.target.value))) }))}
                      className="w-12 text-center bg-[#0f1117] border border-[#2a3150] rounded text-white text-sm font-bold py-0.5 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      className="w-7 h-7 rounded bg-[#1e2540] text-slate-300 hover:bg-[#2a3150] font-bold text-sm flex items-center justify-center"
                      onClick={() => setMilCounts(p => ({ ...p, [b.key]: Math.min(b.max, (p[b.key] ?? 0) + 1) }))}
                    >+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Civil buildings */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-slate-400">
              Civil Buildings
              <span className="text-slate-600"> — Subway adds 8% commerce &amp; reduces pollution. Hospitals eliminate disease for full population.</span>
            </label>
            <div className="flex flex-wrap gap-3">
              {CIVIL_BUILDINGS.map(b => (
                <div key={b.key} className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">{b.name} <span className="text-slate-600">(max {b.max})</span></span>
                  <div className="flex items-center gap-1">
                    <button
                      className="w-7 h-7 rounded bg-[#1e2540] text-slate-300 hover:bg-[#2a3150] font-bold text-sm flex items-center justify-center"
                      onClick={() => setCivilCounts(p => ({ ...p, [b.key]: Math.max(0, (p[b.key] ?? 0) - 1) }))}
                    >−</button>
                    <input
                      type="number" min={0} max={b.max}
                      value={civilCounts[b.key] ?? 0}
                      onChange={e => setCivilCounts(p => ({ ...p, [b.key]: Math.min(b.max, Math.max(0, Number(e.target.value))) }))}
                      className="w-12 text-center bg-[#0f1117] border border-[#2a3150] rounded text-white text-sm font-bold py-0.5 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      className="w-7 h-7 rounded bg-[#1e2540] text-slate-300 hover:bg-[#2a3150] font-bold text-sm flex items-center justify-center"
                      onClick={() => setCivilCounts(p => ({ ...p, [b.key]: Math.min(b.max, (p[b.key] ?? 0) + 1) }))}
                    >+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Resource prices (collapsible) */}
        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-hidden">
          <button
            onClick={() => setPricesOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-[#1a2035] transition-colors"
          >
            <div className="flex items-center gap-3">
              <span>Resource Prices</span>
              <span className={`text-xs font-normal ${pricesOverridden ? "text-yellow-400" : tradePrices ? "text-green-400" : "text-slate-500"}`}>
                {pricesOverridden ? "manual override" : tradePrices ? `live — ${new Date(tradePrices.date).toLocaleDateString()}` : "using fallback defaults"}
              </span>
            </div>
            {pricesOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {pricesOpen && (
            <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 border-t border-[#2a3150] pt-3">
              {Object.keys(FALLBACK_PRICES).map(r => (
                <PriceRow key={r} resource={r} prices={prices}
                  onChange={(res, v) => { setPricesOverridden(true); setPrices(p => ({ ...p, [res]: v })); }}
                />
              ))}
              {pricesOverridden && (
                <button
                  onClick={() => { setPricesOverridden(false); if (tradePrices) setPrices(tradePriceToMap(tradePrices)); else setPrices(FALLBACK_PRICES); }}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors col-span-full text-left mt-1"
                >
                  ↺ Reset to live prices
                </button>
              )}
            </div>
          )}
        </div>

        {/* Results */}
        {!result && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center text-slate-500 text-sm">
            {"Enter at least 100 infra above to see the optimal city build."}
          </div>
        )}

        {result && (
          <>
            {/* Slot breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: "Total Slots", value: result.totalSlots, sub: `floor(${infraNum}/50)`, color: "text-slate-300" },
                { label: "Power Slots", value: result.powerSlots, sub: "Nuclear plants", color: "text-yellow-400" },
                { label: "Military Slots", value: result.milSlots, sub: result.milSlots > 0 ? `${fmtMoney(result.dailyMilCost)}/day` : "none set", color: "text-red-400" },
                { label: "Civil Slots", value: result.civilSlots, sub: result.civilSlots > 0 ? `${fmtMoney(result.dailyCivilCost)}/day` : "none set", color: "text-teal-400" },
                { label: "Avail. Slots", value: result.availableSlots, sub: "for improvements", color: "text-blue-400" },
                { label: "Max Commerce", value: `${maxCommerce}%`, sub: result.commercePct >= maxCommerce ? "cap reached" : `${result.commercePct}% reached`, color: "text-green-400" },
              ].map(({ label, value, sub, color }) => (
                <div key={label} className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
                  <p className="text-xs text-slate-400 mb-1">{label}</p>
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
                </div>
              ))}
            </div>

            {/* Disease, pollution & crime info */}
            <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 text-sm grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-slate-300 font-semibold mb-1">Disease Rate</p>
                <p className="text-xs text-slate-400">
                  Base (infra): <span className={result.baseDiseasePct > 0 ? "text-red-400" : "text-green-400"}>{result.baseDiseasePct.toFixed(2)}%</span>
                </p>
                {result.pollutionDisease > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    Pollution ({result.totalPollution > 0 ? `+${result.totalPollution}` : result.totalPollution}): <span className="text-orange-400">+{result.pollutionDisease.toFixed(2)}%</span>
                  </p>
                )}
                {result.totalPollution < 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    Pollution ({result.totalPollution}): <span className="text-green-400">{result.pollutionDisease.toFixed(2)}%</span>
                  </p>
                )}
                {(civilCounts.hospitals ?? 0) > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    Hospitals (×{civilCounts.hospitals}): <span className="text-green-400">−{((civilCounts.hospitals ?? 0) * 2.5).toFixed(1)}%</span>
                  </p>
                )}
                <p className="text-xs font-medium mt-1">
                  Final disease: <span className={result.correctedDiseasePct > 0 ? "text-yellow-400" : "text-green-400"}>{result.correctedDiseasePct.toFixed(2)}%</span>
                  {result.correctedDiseasePct > 0 && result.baseDiseasePct > 0 && (
                    <span className="text-slate-500 font-normal"> ({result.hospitalsNeeded}h to zero)</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-slate-300 font-semibold mb-1">Crime Rate</p>
                <p className="text-xs text-slate-400">
                  Commerce ({result.commercePct}%): <span className="text-green-400">−{result.commercePct.toFixed(0)}%</span>
                </p>
                {(civilCounts.police_stations ?? 0) > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    Police (×{civilCounts.police_stations}): <span className="text-green-400">−{((civilCounts.police_stations ?? 0) * 2.5).toFixed(1)}%</span>
                  </p>
                )}
                <p className="text-xs font-medium mt-1">
                  Final crime: <span className={result.crimePct > 10 ? "text-yellow-400" : result.crimePct > 0 ? "text-orange-400" : "text-green-400"}>{result.crimePct.toFixed(2)}%</span>
                </p>
                <p className="text-xs text-slate-500 mt-0.5 italic">max(0, 103 − police×2.5 − commerce)</p>
              </div>
              <div>
                <p className="text-slate-300 font-semibold mb-1">Effective Population</p>
                <p className="text-xs text-slate-400">Base: {Math.round(infraNum * 100).toLocaleString()}</p>
                {result.correctedDiseasePct > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">Disease −{result.correctedDiseasePct.toFixed(2)}%: <span className="text-red-400">−{Math.round(infraNum * 100 * result.correctedDiseasePct / 100).toLocaleString()}</span></p>
                )}
                {result.crimePct > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">Crime −{result.crimePct.toFixed(2)}%: <span className="text-red-400">−{Math.round(infraNum * 100 * (1 - result.correctedDiseasePct / 100) * result.crimePct / 100).toLocaleString()}</span></p>
                )}
                <p className="text-xs font-medium mt-1">
                  Effective: <span className="text-slate-300">{Math.round(infraNum * 100 * result.effectivePopMod).toLocaleString()}</span>
                </p>
                <p className="text-xs text-slate-400 mt-1">Commerce: <span className="text-blue-300 font-medium">{fmtMoney(result.dailyCommerce)}/day</span></p>
              </div>
            </div>

            {/* Power cost info */}
            <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 text-sm">
              <div className="flex items-center gap-2 mb-2">
                <Zap size={14} className="text-yellow-400" />
                <span className="text-slate-300 font-semibold">Power Plant Cost</span>
              </div>
              <p className="text-slate-400 text-xs">
                {result.powerSlots} × Nuclear Power Plant — {fmtMoney(POWER_TYPES.nuclear.dailyCost)}/day operating + {POWER_TYPES.nuclear.fuelPerDay} uranium/day × {result.powerSlots} plants
              </p>
              <p className="text-yellow-400 font-medium mt-1">{fmtMoney(result.dailyPowerCost)}/day total</p>
            </div>

            {/* Recommended build */}
            <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#2a3150] flex items-center gap-2">
                <TrendingUp size={14} className="text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-300">Recommended Build — Per City</h3>
              </div>
              <div className="divide-y divide-[#1e2540]">
                {/* Power row */}
                <div className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <span className={`text-xs px-2 py-0.5 rounded border mr-2 ${categoryBg.power}`}>
                      <span className={categoryColors.power}>Power</span>
                    </span>
                    <span className="text-sm text-white">{result.powerSlots} × Nuclear Power Plant</span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Cost</p>
                    <p className="text-red-400 text-sm font-medium">−{fmtMoney(result.dailyPowerCost)}/day</p>
                  </div>
                </div>

                {/* Military buildings row */}
                {result.milSlots > 0 && (
                  <div className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <span className="text-xs px-2 py-0.5 rounded border mr-2 bg-red-900/30 border-red-700/30">
                        <span className="text-red-400">Military</span>
                      </span>
                      <span className="text-sm text-white">
                        {MIL_BUILDINGS.filter(b => (milCounts[b.key] ?? 0) > 0)
                          .map(b => `${milCounts[b.key]} × ${b.name}`)
                          .join(", ")}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">{result.milSlots} slots</p>
                      <p className="text-red-400 text-sm font-medium">−{fmtMoney(result.dailyMilCost)}/day</p>
                    </div>
                  </div>
                )}

                {/* Civil buildings row */}
                {result.civilSlots > 0 && (
                  <div className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <span className="text-xs px-2 py-0.5 rounded border mr-2 bg-teal-900/30 border-teal-700/30">
                        <span className="text-teal-400">Civil</span>
                      </span>
                      <span className="text-sm text-white">
                        {CIVIL_BUILDINGS.filter(b => (civilCounts[b.key] ?? 0) > 0)
                          .map(b => b.key === "subway"
                            ? `${civilCounts[b.key]} × ${b.name} (+${(civilCounts[b.key] ?? 0) * 8}% commerce)`
                            : `${civilCounts[b.key]} × ${b.name}`)
                          .join(", ")}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">{result.civilSlots} slots</p>
                      <p className="text-red-400 text-sm font-medium">−{fmtMoney(result.dailyCivilCost)}/day</p>
                    </div>
                  </div>
                )}

                {/* Build entries */}
                {result.build.map((entry, i) => (
                  <div key={i} className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <span className={`text-xs px-2 py-0.5 rounded border mr-2 ${categoryBg[entry.category]}`}>
                        <span className={categoryColors[entry.category]}>{entry.category.charAt(0).toUpperCase() + entry.category.slice(1)}</span>
                      </span>
                      <span className="text-sm text-white">{entry.count} × {entry.name}</span>
                    </div>
                    <div className="text-right text-xs space-y-0.5">
                      <p className="text-slate-400">Revenue: <span className="text-green-400">{fmtMoney(entry.dailyRevenue)}/day</span></p>
                      <p className="text-slate-400">Cost: <span className="text-red-400">{fmtMoney(entry.dailyCost)}/day</span></p>
                      <p className="text-slate-400">Net: <span className={entry.dailyRevenue - entry.dailyCost >= 0 ? "text-blue-300 font-medium" : "text-red-400"}>
                        {fmtMoney(entry.dailyRevenue - entry.dailyCost)}/day
                      </span></p>
                    </div>
                  </div>
                ))}

                {/* Summary */}
                <div className="px-4 py-3 bg-[#1a2035]">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="space-y-1 text-xs text-slate-400">
                      <p>Commerce income: <span className="text-blue-300">{fmtMoney(result.dailyCommerce)}/day</span></p>
                      <p>Production revenue: <span className="text-green-300">{fmtMoney(result.dailyProduction)}/day</span></p>
                      <p>Total costs: <span className="text-red-300">{fmtMoney(result.dailyPowerCost + result.dailyCommerceCost + result.dailyProductionCost + result.dailyMilCost + result.dailyCivilCost)}/day</span></p>
                      {result.dailyMilCost > 0 && <p className="text-slate-500">incl. {fmtMoney(result.dailyMilCost)}/day military upkeep</p>}
                      {result.dailyCivilCost > 0 && <p className="text-slate-500">incl. {fmtMoney(result.dailyCivilCost)}/day civil upkeep</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">Estimated Net Profit / City</p>
                      <p className={`text-2xl font-bold ${(result.dailyCommerce + result.dailyProduction - result.dailyPowerCost - result.dailyCommerceCost - result.dailyProductionCost - result.dailyMilCost - result.dailyCivilCost) >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {fmtMoney(result.dailyCommerce + result.dailyProduction - result.dailyPowerCost - result.dailyCommerceCost - result.dailyProductionCost - result.dailyMilCost - result.dailyCivilCost)}/day
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Improvement comparison table */}
            <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#2a3150]">
                <h3 className="text-sm font-semibold text-slate-300">Improvement Profitability — Per Slot Per Day</h3>
                <p className="text-xs text-slate-500 mt-0.5">Manufacturing assumes buying inputs from market. Sorted by net profit.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-[#2a3150]">
                      <th className="text-left px-4 py-2 text-xs font-medium text-slate-400">Improvement</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-slate-400">Category</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-slate-400">Detail</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-green-400">Revenue/Slot</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-red-400">Cost/Slot</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-blue-400">Profit/Slot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Commerce improvements */}
                    {COMMERCE_IMPS.map(ci => {
                      const revenue = ci.pct * (0.725 / 50) * (infraNum * 100) * 12;
                      const profit = revenue - ci.dailyCost;
                      return (
                        <tr key={ci.name} className="border-b border-[#1e2540] hover:bg-[#1a2035]">
                          <td className="px-4 py-2 text-white">{ci.name}</td>
                          <td className="px-4 py-2">
                            <span className="text-xs bg-blue-900/30 text-blue-400 border border-blue-700/30 px-1.5 py-0.5 rounded">Commerce</span>
                          </td>
                          <td className="px-4 py-2 text-right text-slate-400 text-xs">+{ci.pct}% commerce (max {ci.max}/city)</td>
                          <td className="px-4 py-2 text-right text-green-400">{fmtMoney(revenue)}</td>
                          <td className="px-4 py-2 text-right text-red-400">{fmtMoney(ci.dailyCost)}</td>
                          <td className={`px-4 py-2 text-right font-medium ${profit >= 0 ? "text-blue-300" : "text-red-400"}`}>{fmtMoney(profit)}</td>
                        </tr>
                      );
                    })}
                    {/* Manufacturing, resource & civil options */}
                    {result.improvementOptions.map((opt, i) => (
                      <tr key={`${opt.name}-${i}`} className="border-b border-[#1e2540] hover:bg-[#1a2035]">
                        <td className="px-4 py-2 text-white">{opt.name}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${
                            opt.category === "Manufacturing" ? "bg-purple-900/30 text-purple-400 border-purple-700/30"
                            : opt.category === "Civil" ? "bg-teal-900/30 text-teal-400 border-teal-700/30"
                            : "bg-green-900/30 text-green-400 border-green-700/30"
                          }`}>
                            {opt.category}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right text-slate-400 text-xs">{opt.detail}</td>
                        <td className="px-4 py-2 text-right text-green-400">{fmtMoney(opt.revenuePerSlot)}</td>
                        <td className="px-4 py-2 text-right text-red-400">{fmtMoney(opt.costPerSlot)}</td>
                        <td className={`px-4 py-2 text-right font-medium ${opt.profitPerSlot >= 0 ? "text-blue-300" : "text-red-400"}`}>{fmtMoney(opt.profitPerSlot)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              Commerce income formula: <code>((commerce/50)×0.725 + 0.725) × (infra×100) × 12</code>. Resource prices are the 24h average from the P&amp;W API, updated each sync. Improvement formulas sourced from the P&amp;W wiki — may not reflect recent balance changes.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
