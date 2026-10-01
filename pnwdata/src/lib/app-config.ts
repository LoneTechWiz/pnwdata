import { supabase } from "./supabase";

export async function readAppConfig<T>(key: string): Promise<T> {
  const { data, error } = await supabase.from("app_config").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(`Configuration ${key}: ${error.message}`);
  if (!data) throw new Error(`Configuration ${key} is missing`);
  return data.value as T;
}

export async function writeAppConfig<T>(key: string, value: T): Promise<void> {
  const { error } = await supabase.from("app_config").upsert({ key, value, updated_at: Date.now() });
  if (error) throw new Error(`Configuration ${key}: ${error.message}`);
}
