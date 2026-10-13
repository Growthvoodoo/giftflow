import { jsonResponse } from "./http.server";
import { createHash, randomBytes } from "node:crypto";
import prisma from "../db.server";

/**
 * Staff API keys — how the GiftFlow-Dashboard (the standalone print dashboard
 * for the warehouse) talks to this app without a Shopify admin session.
 *
 * One key per shop, generated in Settings and shown once. Only its SHA-256 is
 * stored, so a database leak does not leak working keys, and regenerating
 * the key instantly cuts off every dashboard using the old one.
 */

const PREFIX = "gfs_";

function digest(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function generateStaffKey(shopId: string): Promise<string> {
  const key = `${PREFIX}${randomBytes(24).toString("base64url")}`;
  await prisma.settings.update({
    where: { shopId },
    data: {
      staffApiKeyHash: digest(key),
      staffApiKeyHint: `${key.slice(0, 8)}…${key.slice(-4)}`,
      staffApiKeyCreatedAt: new Date(),
    },
  });
  return key;
}

export async function revokeStaffKey(shopId: string): Promise<void> {
  await prisma.settings.update({
    where: { shopId },
    data: { staffApiKeyHash: null, staffApiKeyHint: null, staffApiKeyCreatedAt: null },
  });
}

/** CORS is not opened: the dashboard calls this server-to-server. */
function json(body: unknown, status = 200): Response {
  return jsonResponse(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const staffJson = json;

/**
 * Resolves `Authorization: Bearer gfs_…` to the shop it belongs to, or throws
 * a 401 Response that a loader/action can let propagate.
 */
export async function authenticateStaff(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key.startsWith(PREFIX) || key.length < 20) {
    throw json({ error: "Missing or malformed API key." }, 401);
  }

  const settings = await prisma.settings.findUnique({
    where: { staffApiKeyHash: digest(key) },
    include: { shop: true },
  });
  if (!settings || settings.shop.uninstalledAt) {
    throw json({ error: "Invalid API key." }, 401);
  }
  return { shop: settings.shop, settings };
}
