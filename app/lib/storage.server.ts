import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Card images and rendered PDFs.
 *
 * Local disk for now, deliberately behind three functions so the move to object
 * storage is a change here and nowhere else. Rows store a KEY, never a URL, so
 * nothing in the database has to be rewritten when that happens.
 */

const ROOT = resolve(process.env.STORAGE_DIR || "./storage");

function pathFor(key: string): string {
  // A key is built by this module, but it also arrives from the database, so a
  // traversal attempt is worth refusing rather than trusting.
  const full = resolve(join(ROOT, key));
  if (!full.startsWith(ROOT)) throw new Error("Invalid storage key");
  return full;
}

export async function put(key: string, data: Buffer): Promise<string> {
  const full = pathFor(key);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}

export async function get(key: string): Promise<Buffer> {
  return readFile(pathFor(key));
}

/**
 * The URL the admin fetches a stored file from. Relative: the embedded admin
 * runs on the app's own origin.
 */
export function urlFor(key: string | null | undefined): string | null {
  return key ? `/media/${encodeKey(key)}` : null;
}

/**
 * Absolute URL, for anything rendered somewhere other than the app's origin —
 * the storefront (which runs on the shop's domain) and the staff dashboard.
 * A relative /media path there would resolve against the wrong host.
 */
export function publicUrlFor(key: string | null | undefined, origin?: string): string | null {
  if (!key) return null;
  const base = (process.env.SHOPIFY_APP_URL || origin || "").replace(/\/$/, "");
  return `${base}/media/${encodeKey(key)}`;
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** Only images are served publicly. PDFs carry customer messages. */
export function isPublicKey(key: string): boolean {
  return /\/(uploads|cards)\/[^/]+\.(jpe?g|png|webp)$/i.test(key);
}

/** An upload key the storefront hands back must be one minted for this shop. */
export function isUploadKeyFor(shopDomain: string, key: string): boolean {
  return (
    typeof key === "string" &&
    key.startsWith(`${shopDomain}/uploads/`) &&
    !key.includes("..") &&
    isPublicKey(key)
  );
}

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  pdf: "application/pdf",
};

export function mimeFor(key: string): string {
  return MIME[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/**
 * The file inlined as a data: URI. The PDF renderer uses this so headless
 * Chromium never has to fetch over the network — no tunnel, no CDN, no
 * timing, and nothing for a crafted URL to reach.
 */
export async function dataUriFor(key: string): Promise<string | null> {
  try {
    const buf = await get(key);
    return `data:${mimeFor(key)};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Content hash — used to spot the same upload arriving twice. */
export function hash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Unguessable: an upload URL is public, so the name is the only protection. */
function randomName(ext: string): string {
  return `${Date.now().toString(36)}-${randomBytes(12).toString("base64url")}.${ext}`;
}

export function keyForUpload(shopDomain: string, ext: string): string {
  return `${shopDomain}/uploads/${randomName(ext)}`;
}

export function keyForCard(shopDomain: string, ext: string): string {
  return `${shopDomain}/cards/${randomName(ext)}`;
}

export function keyForPdf(shopDomain: string, id: string): string {
  return `${shopDomain}/pdf/${id}.pdf`;
}
