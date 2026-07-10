export const DAY_MS = 24 * 60 * 60 * 1000;

export interface MembershipRow {
  nation_id: number;
  alliance_id: number;
  join_date: number;
  left_at: number | null;
}

export interface RetentionBucket {
  numerator: number;
  denominator: number;
}

export function retentionFor(
  rows: MembershipRow[],
  days: number,
  now: number,
  firstSnapshotAt: number | null
): RetentionBucket {
  const cutoff = now - days * DAY_MS;
  let numerator = 0;
  let denominator = 0;
  for (const m of rows) {
    if (m.join_date > cutoff) continue;
    if (firstSnapshotAt != null && m.join_date < firstSnapshotAt) continue;
    denominator++;
    const retainedUntil = m.left_at ?? now;
    if (retainedUntil - m.join_date >= days * DAY_MS) numerator++;
  }
  return { numerator, denominator };
}

export function recruitsIn(rows: MembershipRow[], days: number, now: number): number {
  const cutoff = now - days * DAY_MS;
  let count = 0;
  for (const m of rows) if (m.join_date >= cutoff) count++;
  return count;
}

export function retentionPercent(bucket: RetentionBucket): number | null {
  return bucket.denominator > 0 ? bucket.numerator / bucket.denominator : null;
}