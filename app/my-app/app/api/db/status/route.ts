import { NextResponse } from "next/server";
import { getDb } from "@/app/lib/mongodb";

/**
 * GET /api/db/status
 * Returns whether MongoDB is connected and reachable.
 */
export async function GET() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    return NextResponse.json(
      {
        connected: false,
        message: "MONGODB_URI is not set in environment",
      },
      { status: 200 }
    );
  }

  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return NextResponse.json({
      connected: true,
      message: "MongoDB is connected",
      db: db.databaseName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    console.error("DB status check failed:", err);
    return NextResponse.json(
      {
        connected: false,
        message,
      },
      { status: 200 }
    );
  }
}
