import type { LoaderFunctionArgs } from "@remix-run/node";
import { get, isPublicKey, mimeFor } from "../lib/storage.server";

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
