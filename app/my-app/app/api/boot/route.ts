import { NextResponse } from "next/server";

const globalForBoot = globalThis as unknown as { __bootId?: string };

export async function GET() {
  if (!globalForBoot.__bootId) {
    globalForBoot.__bootId =
      Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
  return NextResponse.json({ bootId: globalForBoot.__bootId });
}
