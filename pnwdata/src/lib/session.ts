// src/lib/session.ts
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

export interface SessionPayload {
  discordId: string;
  username: string;
  avatar: string | null;
  roleIds: string[];
  isEmperor: boolean;
}

export const SESSION_COOKIE = "__session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_MAX_AGE,
  path: "/",
};

function getKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

/** Signs and returns the raw JWT token string. Callers set the cookie themselves. */
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getKey());
}

/** Verifies a raw JWT token string and returns the payload, or null if invalid. */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Reads the session from the request (middleware/route handlers with NextRequest)
 * or from next/headers cookies() (server components / route handlers without req).
 */
export async function getSession(req?: NextRequest): Promise<SessionPayload | null> {
  let token: string | undefined;
  if (req) {
    token = req.cookies.get(SESSION_COOKIE)?.value;
  } else {
    const jar = await cookies();
    token = jar.get(SESSION_COOKIE)?.value;
  }
  if (!token) return null;
  return verifySessionToken(token);
}
