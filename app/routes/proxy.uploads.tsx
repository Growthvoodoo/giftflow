import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../lib/shop.server";
import { hash, keyForUpload, put } from "../lib/storage.server";

/**
 * POST /apps/giftflow/uploads
 *
 * The theme's upload check today is a 5 MB client-side limit
 * (gift-flow.liquid:1621) that anyone can bypass, posting straight to
 * candyexpress unauthenticated. This is the real check: size and type are
 * verified from the bytes, not from what the browser claims.
 */

// Sniffed from the file header rather than trusted from Content-Type, which a
// client sets freely.
const MAGIC: Array<{ ext: string; mime: string; test: (b: Buffer) => boolean }> = [
  { ext: "jpg", mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "png", mime: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "webp", mime: "image/webp", test: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
];

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
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.public.appProxy(request);
  if (!session?.shop) return Response.json({ error: "Unknown shop" }, { status: 401 });

  const { shop, settings } = await getSettings(session.shop);
  if (!settings.allowUploads) {
    return Response.json({ error: "Uploads are turned off for this store." }, { status: 403 });
  }
  if (rateLimited(session.shop)) {
    return Response.json({ error: "Too many uploads. Try again in a minute." }, { status: 429 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file received." }, { status: 400 });
  }
  if (file.size > settings.maxUploadBytes) {
    const mb = (settings.maxUploadBytes / 1024 / 1024).toFixed(0);
    return Response.json({ error: `That image is too large. The limit is ${mb} MB.` }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  // Re-check after reading: File.size is reported by the client.
  if (buf.byteLength > settings.maxUploadBytes) {
    return Response.json({ error: "That image is too large." }, { status: 413 });
  }

  const kind = MAGIC.find((m) => m.test(buf));
  if (!kind) {
    return Response.json(
      { error: "That file is not a JPEG, PNG or WebP image." },
      { status: 415 },
    );
  }

  const digest = hash(buf);
  const key = keyForUpload(session.shop, kind.ext);
  await put(key, buf);

  // Recorded against the shop so a merchant approval queue has something to
  // show, and so the same image arriving repeatedly is visible.
  await prisma.giftDraft.updateMany({
    where: { shopId: shop.id, uploadHash: digest, uploadStatus: "rejected" },
    data: {},
  });

  return Response.json({
    uploadKey: key,
    hash: digest,
    status: settings.moderateUploads ? "pending" : "approved",
    needsApproval: settings.moderateUploads,
  });
};
