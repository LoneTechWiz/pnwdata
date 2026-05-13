import { NextResponse } from "next/server";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

interface AllianceRow {
  id: number;
  name: string;
  acronym: string | null;
  score: number | null;
  color: string | null;
  rank: number | null;
}

interface MembershipRow {
  nation_id: number;
  alliance_id: number;
  join_date: number;
  left_at: number | null;
}

export async function GET() {
  const statusRow = db.prepare(
    `SELECT last_synced_at, status, error, nations_scanned, alliances_scanned, first_snapshot_at FROM recruitment_sync_status WHERE id=1`
  ).get() as
    | {
        last_synced_at: number | null;
        status: string;
        error: string | null;
        nations_scanned: number | null;
        alliances_scanned: number | null;
        first_snapshot_at: number | null;
      }
    | undefined;

  const now = Date.now();
  const firstSnapshotAt = statusRow?.first_snapshot_at ?? null;

  const alliances = db.prepare(
    `SELECT id, name, acronym, score, color, rank FROM alliance_names`
  ).all() as AllianceRow[];

  const memberships = db.prepare(
    `SELECT nation_id, alliance_id, join_date, left_at FROM alliance_memberships`
  ).all() as MembershipRow[];

  const byAlliance = new Map<number, MembershipRow[]>();
  for (const m of memberships) {
    let list = byAlliance.get(m.alliance_id);
    if (!list) {
      list = [];
      byAlliance.set(m.alliance_id, list);
    }
    list.push(m);
  }

  // For retention to be reliable, only count cohort memberships whose join_date is
  // on or after first_snapshot_at — otherwise we may have missed earlier departures.
  function retentionFor(rows: MembershipRow[], days: number) {
    const cutoff = now - days * DAY_MS;
    let numerator = 0;
    let denominator = 0;
    for (const m of rows) {
      if (m.join_date > cutoff) continue; // cohort must have had time to reach N days
      if (firstSnapshotAt != null && m.join_date < firstSnapshotAt) continue;
      denominator++;
      const retainedUntil = m.left_at ?? now;
      if (retainedUntil - m.join_date >= days * DAY_MS) numerator++;
    }
    return { numerator, denominator };
  }

  function recruitsIn(rows: MembershipRow[], days: number): number {
    const cutoff = now - days * DAY_MS;
    let count = 0;
    for (const m of rows) if (m.join_date >= cutoff) count++;
    return count;
  }

  function pct(b: { numerator: number; denominator: number }) {
    return {
      numerator: b.numerator,
      denominator: b.denominator,
      percent: b.denominator > 0 ? b.numerator / b.denominator : null,
    };
  }

  const rows = alliances.map((a) => {
    const memberRows = byAlliance.get(a.id) ?? [];
    const active = memberRows.filter((m) => m.left_at == null).length;
    return {
      id: a.id,
      name: a.name,
      acronym: a.acronym,
      score: a.score,
      color: a.color,
      rank: a.rank,
      active_members: active,
      recruits_7d: recruitsIn(memberRows, 7),
      recruits_30d: recruitsIn(memberRows, 30),
      recruits_60d: recruitsIn(memberRows, 60),
      recruits_90d: recruitsIn(memberRows, 90),
      retention_30d: pct(retentionFor(memberRows, 30)),
      retention_60d: pct(retentionFor(memberRows, 60)),
      retention_90d: pct(retentionFor(memberRows, 90)),
    };
  });

  // Filter out alliances with zero observed memberships across the board.
  const filtered = rows.filter(
    (r) =>
      r.active_members > 0 ||
      r.recruits_7d > 0 ||
      r.recruits_30d > 0 ||
      r.recruits_60d > 0 ||
      r.recruits_90d > 0
  );

  return NextResponse.json({
    meta: {
      last_synced_at: statusRow?.last_synced_at ?? null,
      status: statusRow?.status ?? "never",
      error: statusRow?.error ?? null,
      first_snapshot_at: firstSnapshotAt,
      nations_scanned: statusRow?.nations_scanned ?? 0,
      alliances_scanned: statusRow?.alliances_scanned ?? 0,
      now,
    },
    alliances: filtered,
  });
}
