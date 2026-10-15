import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Card images and rendered PDFs.
 *
 * Two backends behind the same functions:
 *  - Vercel Blob, when BLOB_READ_WRITE_TOKEN is set (Vercel, or any host).
 *    Required on Vercel: its functions cannot keep files on disk.
 *  - Local disk (STORAGE_DIR) otherwise — development, or a normal server.
 *
 * Rows store a KEY, never a URL, so switching backends needs no migration.
 * Every key carries a random part, so a public Blob URL cannot be guessed.
 */

export function usingBlob(): boolean {
  // A store connected to the Vercel project provides BLOB_STORE_ID (the SDK
  // then authenticates with Vercel's OIDC token); a manually added token
  // provides BLOB_READ_WRITE_TOKEN. Either one switches storage to Blob.
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Vercel Blob stores are created either public or private and cannot change.
 * Private (the default here) means every read goes through this app with the
 * token, so customer images and PDFs are never directly reachable. Set
 * BLOB_ACCESS=public only if the store was created as public.
 */
function blobAccess(): "public" | "private" {
  return process.env.BLOB_ACCESS === "public" ? "public" : "private";
}

async function blob() {
  return import("@vercel/blob");
}

/** Reads a blob as a stream, or null when it does not exist. */
export async function blobStream(
  key: string,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number; contentType: string } | null> {
  const { get: blobGet } = await blob();
  try {
    const res = await blobGet(key, { access: blobAccess() });
    if (!res || res.statusCode !== 200) return null;
    return { stream: res.stream, size: res.blob.size, contentType: res.blob.contentType };
  } catch {
    return null;
  }
}

const ROOT = resolve(process.env.STORAGE_DIR || "./storage");

function pathFor(key: string): string {
  // A key is built by this module, but it also arrives from the database, so a
  // traversal attempt is worth refusing rather than trusting.
  const full = resolve(join(ROOT, key));
  if (!full.startsWith(ROOT)) throw new Error("Invalid storage key");
  return full;
}

export async function put(key: string, data: Buffer): Promise<string> {
  if (usingBlob()) {
    const { put: blobPut } = await blob();
    await blobPut(key, data, {
      access: blobAccess(),
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: mimeFor(key),
      cacheControlMaxAge: 31536000,
    });
    return key;
  }
  const full = pathFor(key);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}

export async function get(key: string): Promise<Buffer> {
  if (usingBlob()) {
    const found = await blobStream(key);
    if (!found) throw new Error(`Not found: ${key}`);
    return Buffer.from(await new Response(found.stream).arrayBuffer());
  }
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

/** Starts with `${id}-` so a cached render can be recognised; random after that. */
export function keyForPdf(shopDomain: string, id: string): string {
  return `${shopDomain}/pdf/${id}-${randomBytes(9).toString("base64url")}.pdf`;
}
