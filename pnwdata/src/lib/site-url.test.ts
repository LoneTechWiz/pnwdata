import { afterEach, describe, expect, it } from "vitest";
import { getPublicOrigin, getPublicUrl } from "./site-url";

const originalPublicAppUrl = process.env.PUBLIC_APP_URL;

afterEach(() => {
  if (originalPublicAppUrl === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = originalPublicAppUrl;
});

function request(origin: string, headers: Record<string, string> = {}) {
  const url = new URL(origin);
  return {
    headers: new Headers(headers),
    nextUrl: { origin: url.origin, protocol: url.protocol },
  };
}

describe("public site URL", () => {
  it("prefers the configured public origin over the container origin", () => {
    process.env.PUBLIC_APP_URL = "https://pnwdata.lonetechwiz.com/";
    const internalRequest = request("http://0.0.0.0:3000");

    expect(getPublicOrigin(internalRequest)).toBe("https://pnwdata.lonetechwiz.com");
    expect(getPublicUrl("/login", internalRequest).href).toBe("https://pnwdata.lonetechwiz.com/login");
  });

  it("uses trusted proxy headers when no public URL is configured", () => {
    delete process.env.PUBLIC_APP_URL;
    const proxiedRequest = request("http://0.0.0.0:3000", {
      host: "0.0.0.0:3000",
      "x-forwarded-host": "pnwdata.lonetechwiz.com",
      "x-forwarded-proto": "https",
    });

    expect(getPublicOrigin(proxiedRequest)).toBe("https://pnwdata.lonetechwiz.com");
  });
});
