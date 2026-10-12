/** Alliance spheres: named groups of alliances compared side by side. Safe to import from client code. */
export interface SphereConfig {
  name: string;
  alliance_ids: number[];
}

export interface AllianceSpheresConfig {
  spheres: SphereConfig[];
}

export const MAX_SPHERES = 12;
export const MAX_SPHERE_NAME = 40;
/** Alliances offered on the config page, ranked by score. */
export const TOP_ALLIANCES = 50;

export const DEFAULT_SPHERES_CONFIG: AllianceSpheresConfig = {
  spheres: [
    { name: "Sphere 1", alliance_ids: [] },
    { name: "Sphere 2", alliance_ids: [] },
  ],
};

/** Returns a clean config, or an error message describing the first problem. */
export function validateSpheresConfig(value: unknown): { config: AllianceSpheresConfig } | { error: string } {
  const spheres = (value as { spheres?: unknown } | null)?.spheres;
  if (!Array.isArray(spheres) || spheres.length < 1 || spheres.length > MAX_SPHERES) {
    return { error: `There must be between 1 and ${MAX_SPHERES} spheres` };
  }

  const owner = new Map<number, string>();
  const clean: SphereConfig[] = [];
  for (const raw of spheres) {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    if (!name || name.length > MAX_SPHERE_NAME) {
      return { error: `Each sphere needs a name of up to ${MAX_SPHERE_NAME} characters` };
    }
    if (!Array.isArray(raw.alliance_ids)) return { error: `Sphere "${name}" has an invalid alliance list` };

    const ids: number[] = [];
    for (const item of raw.alliance_ids) {
      const id = Number(item);
      if (!Number.isInteger(id) || id <= 0) return { error: `Sphere "${name}" has an invalid alliance ID` };
      const other = owner.get(id);
      if (other !== undefined && other !== name) {
        return { error: `Alliance ${id} can only be in one sphere (it is in "${other}" and "${name}")` };
      }
      owner.set(id, name);
      if (!ids.includes(id)) ids.push(id);
    }
    clean.push({ name, alliance_ids: ids });
  }

  const names = clean.map((sphere) => sphere.name.toLowerCase());
  if (new Set(names).size !== names.length) return { error: "Sphere names must be different from each other" };
  return { config: { spheres: clean } };
}

export interface SphereAlliance {
  id: number;
  name: string;
  acronym: string | null;
  score: number;
  nations: number;
  rank: number;
}

export interface SphereStats {
  name: string;
  totalScore: number;
  totalNations: number;
  /** Share of all alliances' combined score, 0–1. */
  shareOfWorld: number;
  avgScorePerNation: number;
  alliances: SphereAlliance[];
  /** Configured alliance IDs that no longer exist. */
  missingIds: number[];
}

export interface SourceAlliance {
  id: string | number;
  name: string;
  acronym: string | null;
  score: number;
  rank: number;
  nation_count: number;
}

/** Combines each sphere's alliances into totals, in the order the spheres are configured. */
export function buildSphereStats(config: AllianceSpheresConfig, source: SourceAlliance[]): SphereStats[] {
  const byId = new Map(source.map((a) => [Number(a.id), a]));
  const worldScore = source.reduce((sum, a) => sum + a.score, 0);

  return config.spheres.map((sphere) => {
    const alliances: SphereAlliance[] = [];
    const missingIds: number[] = [];
    for (const id of sphere.alliance_ids) {
      const a = byId.get(id);
      if (!a) { missingIds.push(id); continue; }
      alliances.push({ id, name: a.name, acronym: a.acronym, score: a.score, nations: a.nation_count, rank: a.rank });
    }
    alliances.sort((x, y) => y.score - x.score || x.id - y.id);

    const totalScore = alliances.reduce((sum, a) => sum + a.score, 0);
    const totalNations = alliances.reduce((sum, a) => sum + a.nations, 0);
    return {
      name: sphere.name,
      totalScore,
      totalNations,
      shareOfWorld: worldScore > 0 ? totalScore / worldScore : 0,
      avgScorePerNation: totalNations > 0 ? totalScore / totalNations : 0,
      alliances,
      missingIds,
    };
  });
}
