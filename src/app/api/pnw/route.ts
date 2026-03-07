import { NextRequest, NextResponse } from "next/server";

const PNW_API_URL = "https://api.politicsandwar.com/graphql";

export async function POST(request: NextRequest) {
  const apiKey = process.env.PNW_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  const body = await request.json();
  const url = `${PNW_API_URL}?api_key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return NextResponse.json(data);
}
