import { describe, expect, it } from "vitest";
import { hasAccess, type RoleConfig } from "./role-config";

const config: RoleConfig = {
  pages: {
    "/dashboard": ["role-a", "role-b"],
    "/members": ["role-b"],
  },
};

describe("hasAccess", () => {
  it("grants access when user has a matching role", () => {
    expect(hasAccess(config, "/dashboard", ["role-a"])).toBe(true);
    expect(hasAccess(config, "/members", ["role-b"])).toBe(true);
  });

  it("denies access for unknown routes", () => {
    expect(hasAccess(config, "/war-config", ["role-a"])).toBe(false);
  });

  it("denies access when route exists but roles do not match", () => {
    expect(hasAccess(config, "/dashboard", ["role-x"])).toBe(false);
    expect(hasAccess(config, "/members", ["role-a"])).toBe(false);
  });

  it("denies access with empty role list", () => {
    expect(hasAccess(config, "/dashboard", [])).toBe(false);
  });
});