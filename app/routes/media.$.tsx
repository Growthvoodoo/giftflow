import type { LoaderFunctionArgs } from "@remix-run/node";
import { blobRead, get, isPublicKey, mimeFor, usingBlob } from "../lib/storage.server";

/**
 * Serves stored card images — catalogue artwork and customer uploads — to the
 * storefront, the admin and the staff dashboard.
 *
 * Images only. Rendered PDFs carry customer messages and are never served
 * here; they come from the authenticated print routes. File names are random
 * (see storage.server.ts), so an image URL cannot be guessed.
 *
 * Local disk for now. Point a CDN at object storage before real traffic; rows
 * store keys, not URLs, so that swap costs no migration.
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const key = decodeURIComponent(params["*"] ?? "");
  if (!key || !isPublicKey(key)) return new Response("Not found", { status: 404 });

  // On Blob the store is private, so the image is streamed through here
  // with the token. Card artwork should stay under ~4 MB: Vercel caps a
  // function response at about 4.5 MB.
  if (usingBlob()) {
    const found = await blobRead(key);
    if (!found) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(found.data), {
      headers: {
        "Content-Type": found.contentType || mimeFor(key),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }

  try {
    const data = await get(key);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": mimeFor(key),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        // The storefront shows these from the shop's own domain.
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};
