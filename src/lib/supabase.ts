import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be configured for server-side database access");
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function selectAll<T>(table: string, columns = "*"): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < 1000) return rows;
  }
}

export async function readJsonRows(table: string) {
  return (await selectAll<{ data: unknown }>(table, "data")).map(row => row.data);
}

export async function readJsonSingleton(table: string) {
  const { data, error } = await supabase.from(table).select("data").eq("id", 1).maybeSingle();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data?.data ?? null;
}

type NationData = { discord?: string | null };

export async function findNationByDiscord(username: string) {
  for (const table of ["nations", "applicants"]) {
    const { data, error } = await supabase.from(table).select("id, data");
    if (error) throw new Error(`${table}: ${error.message}`);
    const match = data?.find(row => String((row.data as NationData)?.discord ?? "").toLowerCase() === username.toLowerCase());
    if (match) return match as { id: number; data: NationData };
  }
  return null;
}

export async function getNationRecord(id: number) {
  for (const table of ["nations", "applicants"]) {
    const { data, error } = await supabase.from(table).select("id, data").eq("id", id).maybeSingle();
    if (error) throw new Error(`${table}: ${error.message}`);
    if (data) return data as { id: number; data: NationData };
  }
  return null;
}
