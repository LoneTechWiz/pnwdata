import { NextResponse } from "next/server";
import db from "@/lib/db";
import {
  recruitsIn,
  retentionFor,
  retentionPercent,
  type MembershipRow,
} from "@/lib/recruitment-stats";

export const dynamic = "force-dynamic";

interface AllianceRow {
  id: number;
  name: string;
  acronym: string | null;
  score: number | null;
  color: string | null;
  rank: number | null;
}

interface RecruitmentStatus {
  last_synced_at: number | null;
  status: string;
  error: string | null;
  nations_scanned: number | null;
  alliances_scanned: number | null;
  first_snapshot_at: number | null;
}

export async function GET() {
  const statusRow = db.prepare(`
    SELECT last_synced_at, status, error, nations_scanned, alliances_scanned, first_snapshot_at
    FROM recruitment_sync_status WHERE id = 1
  `).get() as RecruitmentStatus | undefined;

  const now = Date.now();
  const firstSnapshotAt = statusRow?.first_snapshot_at ?? null;
  const alliances = db.prepare("SELECT id, name, acronym, score, color, rank FROM alliance_names").all() as AllianceRow[];
  const memberships = db.prepare("SELECT nation_id, alliance_id, join_date, left_at FROM alliance_memberships").all() as MembershipRow[];

  const byAlliance = new Map<number, MembershipRow[]>();
  for (const membership of memberships) {
    const rows = byAlliance.get(membership.alliance_id) ?? [];
    rows.push(membership);
    byAlliance.set(membership.alliance_id, rows);
  }

  function percentage(bucket: ReturnType<typeof retentionFor>) {
    return {
      numerator: bucket.numerator,
      denominator: bucket.denominator,
      percent: retentionPercent(bucket),
    };
  }

  const rows = alliances.map((alliance) => {
    const memberRows = byAlliance.get(alliance.id) ?? [];
    return {
      ...alliance,
      active_members: memberRows.filter((membership) => membership.left_at == null).length,
      recruits_7d: recruitsIn(memberRows, 7, now),
      recruits_30d: recruitsIn(memberRows, 30, now),
      recruits_60d: recruitsIn(memberRows, 60, now),
      recruits_90d: recruitsIn(memberRows, 90, now),
      retention_30d: percentage(retentionFor(memberRows, 30, now, firstSnapshotAt)),
      retention_60d: percentage(retentionFor(memberRows, 60, now, firstSnapshotAt)),
      retention_90d: percentage(retentionFor(memberRows, 90, now, firstSnapshotAt)),
    };
  });

  const filtered = rows.filter((row) =>
    row.active_members > 0 || row.recruits_7d > 0 || row.recruits_30d > 0 ||
    row.recruits_60d > 0 || row.recruits_90d > 0,
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
