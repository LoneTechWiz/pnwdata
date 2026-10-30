import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { MAX_AMOUNT, TRADEABLE_RESOURCES, averagePricePaid } from "@/lib/average-price-paid";

export const dynamic = "force-dynamic";

/**
 * GET /api/average-price-paid?nation_id=123&resource=steel&amount=500000
 * The average price per unit the nation paid for that amount of the resource, from its most recent purchases.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const nationId = Number(params.get("nation_id"));
  if (!Number.isSafeInteger(nationId) || nationId <= 0) {
    return NextResponse.json({ error: "nation_id must be a positive whole number" }, { status: 400 });
  }

  const resource = (params.get("resource") ?? "").toLowerCase();
  if (!(TRADEABLE_RESOURCES as readonly string[]).includes(resource)) {
    return NextResponse.json({ error: `resource must be one of: ${TRADEABLE_RESOURCES.join(", ")}` }, { status: 400 });
  }

  const amountText = params.get("amount");
  const amount = Number(amountText);
  if (!amountText || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return NextResponse.json({ error: `amount must be a number greater than 0 and at most ${MAX_AMOUNT}` }, { status: 400 });
  }

  return NextResponse.json(averagePricePaid(db, nationId, resource, amount));
}
