/** Strip trailing #0 (new-format placeholder discriminator). */
export function normalizeDiscord(raw: string): string {
  return raw.replace(/#0$/, "");
}

/** True if username has a legacy numeric discriminator (not #0 / #0000). */
export function isLegacyDiscord(raw: string): boolean {
  const m = raw.match(/#(\d+)$/);
  return m != null && m[1] !== "0" && m[1] !== "0000";
}

/**
 * Prefer BK Net username unless it is legacy; then PnW; then legacy BK Net.
 */
export function resolveNationDiscord(
  bknet: string | undefined,
  pnw: string | null | undefined
): string | null {
  const pnwTrim = pnw?.trim() || null;
  if (bknet && !isLegacyDiscord(bknet)) return normalizeDiscord(bknet);
  if (pnwTrim) return normalizeDiscord(pnwTrim);
  if (bknet) return bknet;
  return null;
}