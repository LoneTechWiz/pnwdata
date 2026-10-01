/** Strip trailing #0 (new-format placeholder discriminator). */
export function normalizeDiscord(raw: string): string {
  return raw.replace(/#0$/, "");
}

/** Normalize the Discord username stored on a P&W nation. */
export function resolveNationDiscord(pnw: string | null | undefined): string | null {
  const pnwTrim = pnw?.trim() || null;
  if (pnwTrim) return normalizeDiscord(pnwTrim);
  return null;
}
