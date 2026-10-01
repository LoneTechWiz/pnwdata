import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "./session";

const payload = {
  discordId: "123",
  username: "testuser",
  avatar: "abc",
  roleIds: ["111", "222"],
  isEmperor: false,
};

describe("session tokens", () => {
  it("round-trips a valid JWT payload", async () => {
    const token = await createSessionToken(payload);
    const verified = await verifySessionToken(token);
    expect(verified).toMatchObject(payload);
    expect(verified?.exp).toBeTypeOf("number");
    expect(verified?.iat).toBeTypeOf("number");
  });

  it("returns null for tampered tokens", async () => {
    const token = await createSessionToken(payload);
    const verified = await verifySessionToken(token.slice(0, -4) + "xxxx");
    expect(verified).toBeNull();
  });

  it("returns null for empty input", async () => {
    expect(await verifySessionToken("")).toBeNull();
  });
});