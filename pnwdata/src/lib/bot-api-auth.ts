import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export function isBotRequestAuthorized(request: NextRequest): boolean {
  const expected = process.env.BOT_SERVICE_TOKEN;
  const header = request.headers.get("authorization");
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || !supplied) return false;

  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}
