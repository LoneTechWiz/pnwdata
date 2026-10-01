interface RequestOriginSource {
  headers: Pick<Headers, "get">;
  nextUrl: {
    origin: string;
    protocol: string;
  };
}

function firstHeaderValue(value: string | null): string | undefined {
  return value?.split(",", 1)[0]?.trim() || undefined;
}

export function getPublicOrigin(request?: RequestOriginSource): string {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("PUBLIC_APP_URL must use http or https");
    }
    return url.origin;
  }

  if (request) {
    const host = firstHeaderValue(request.headers.get("x-forwarded-host"))
      ?? firstHeaderValue(request.headers.get("host"));
    const protocol = firstHeaderValue(request.headers.get("x-forwarded-proto"))
      ?? request.nextUrl.protocol.replace(/:$/, "");
    if (host && (protocol === "http" || protocol === "https")) {
      return new URL(`${protocol}://${host}`).origin;
    }
    return request.nextUrl.origin;
  }

  return "http://localhost:3000";
}

export function getPublicUrl(path: string, request?: RequestOriginSource): URL {
  return new URL(path, getPublicOrigin(request));
}
