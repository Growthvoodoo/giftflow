import { jsonResponse } from "../lib/http.server";
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../lib/shop.server";
import { hash, keyForUpload, put, usingBlob } from "../lib/storage.server";
import { sniffImage } from "../lib/images.server";
import { storedPlan } from "../lib/billing.server";

/**
 * POST /apps/giftflow/uploads
 *
 * The theme's upload check today is a 5 MB client-side limit
 * (gift-flow.liquid:1621) that anyone can bypass, posting straight to
 * candyexpress unauthenticated. This is the real check: size and type are
 * verified from the bytes, not from what the browser claims.
 */

/** Crude per-shop throttle. Enough to stop a script; not a substitute for a
 *  real limiter once this is behind more than one instance. */
const recent = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

function rateLimited(shopDomain: string): boolean {
  const now = Date.now();
  const hits = (recent.get(shopDomain) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  recent.set(shopDomain, hits);
  return hits.length > MAX_PER_WINDOW;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.public.appProxy(request);
  if (!session?.shop) return jsonResponse({ error: "Unknown shop" }, { status: 401 });

  const { shop, settings } = await getSettings(session.shop);
  const plan = await storedPlan(shop.id);
  if (!settings.allowUploads || !plan.uploads) {
    return jsonResponse({ error: "Uploads are turned off for this store." }, { status: 403 });
  }
  if (rateLimited(session.shop)) {
    return jsonResponse({ error: "Too many uploads. Try again in a minute." }, { status: 429 });
  }

  // On Vercel, images are served through a function capped at ~4.5 MB.
  const maxBytes = usingBlob()
    ? Math.min(settings.maxUploadBytes, 4 * 1024 * 1024)
    : settings.maxUploadBytes;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonResponse({ error: "No file received." }, { status: 400 });
  }
  if (file.size > maxBytes) {
    const mb = (maxBytes / 1024 / 1024).toFixed(0);
    return jsonResponse({ error: `That image is too large. The limit is ${mb} MB.` }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  // Re-check after reading: File.size is reported by the client.
  if (buf.byteLength > maxBytes) {
    return jsonResponse({ error: "That image is too large." }, { status: 413 });
  }

  const kind = sniffImage(buf);
  if (!kind) {
    return jsonResponse(
      { error: "That file is not a JPEG, PNG or WebP image." },
      { status: 415 },
    );
  }

  const digest = hash(buf);

  // An image the merchant has already rejected is refused outright, so the
  // same picture cannot simply be uploaded again.
  const rejected = await prisma.giftOrder.findFirst({
    where: { shopId: shop.id, uploadHash: digest, uploadStatus: "rejected" },
    select: { id: true },
  });
  if (rejected) {
    return jsonResponse({ error: "This image can't be used. Please choose another." }, { status: 422 });
  }

  const key = keyForUpload(session.shop, kind.ext);
  await put(key, buf);

  return jsonResponse({
    uploadKey: key,
    hash: digest,
    status: settings.moderateUploads ? "pending" : "approved",
    needsApproval: settings.moderateUploads,
  });
};
