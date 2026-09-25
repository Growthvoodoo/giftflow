import { createHash } from "node:crypto";
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

/** The URL the storefront and admin fetch a stored file from. */
export function urlFor(key: string | null | undefined): string | null {
  return key ? `/media/${key}` : null;
}

/** Content hash — used to spot the same upload arriving twice. */
export function hash(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function keyForUpload(shopDomain: string, ext: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${shopDomain}/uploads/${stamp}-${rand}.${ext}`;
}

export function keyForPdf(shopDomain: string, id: string): string {
  return `${shopDomain}/pdf/${id}.pdf`;
}
