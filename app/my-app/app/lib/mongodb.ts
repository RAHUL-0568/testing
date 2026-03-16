import { createHash } from "crypto";
import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI ?? "";
const dbName = process.env.MONGODB_DB ?? "cray";

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function getClient(): Promise<MongoClient> {
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (global._mongoClientPromise) return global._mongoClientPromise;
  const promise = new MongoClient(uri).connect();
  global._mongoClientPromise = promise;
  return promise;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(dbName);
}

/**
 * Legacy user id used before we had a stable id – sha256(accessToken).
 * Kept for migration so existing records remain visible.
 */
export function getLegacyUserIdFromToken(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}

/**
 * Prefer a stable id based on the JWT `sub` claim so the same user
 * keeps the same id across logins, even when the access token changes.
 * Falls back to the legacy hash if parsing fails.
 */
export function getUserIdFromToken(accessToken: string): string {
  try {
    const parts = accessToken.split(".");
    if (parts.length >= 2) {
      const payloadPart = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded =
        payloadPart + "=".repeat((4 - (payloadPart.length % 4)) % 4);
      const json = Buffer.from(padded, "base64").toString("utf8");
      const payload = JSON.parse(json) as { sub?: string };
      if (payload.sub && typeof payload.sub === "string") {
        return payload.sub;
      }
    }
  } catch {
    // ignore and fall back to legacy hash
  }
  return getLegacyUserIdFromToken(accessToken);
}
