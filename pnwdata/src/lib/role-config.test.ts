import { describe, expect, it } from "vitest";
import { accessiblePages, ADMIN_PAGE_PATHS, hasAccess, type RoleConfig } from "./role-config";

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

describe("accessiblePages", () => {
  it("gives the Discord admin every application page, including pages missing from role config", () => {
    expect(accessiblePages(config, [], true)).toEqual(ADMIN_PAGE_PATHS);
    expect(accessiblePages(config, [], true)).toContain("/raid-finder");
    expect(accessiblePages(config, [], true)).toContain("/raid-config");
    expect(accessiblePages(config, [], true)).toContain("/relink");
  });

  it("limits ordinary members to their configured role mappings", () => {
    expect(accessiblePages(config, ["role-a"], false)).toEqual(["/dashboard"]);
  });
});
