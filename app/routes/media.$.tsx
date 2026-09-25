import type { LoaderFunctionArgs } from "@remix-run/node";
import { get } from "../lib/storage.server";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  webp: "image/webp", pdf: "application/pdf",
};

/**
 * Serves stored card images and rendered PDFs.
 *
 * Local disk only — this route exists so the rest of the app can reference a
 * stable URL. Point a CDN at object storage instead before real traffic; the
 * database stores keys, not URLs, precisely so that swap costs nothing.
 */
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const key = params["*"];
  if (!key) return new Response("Not found", { status: 404 });

  try {
    const data = await get(key);
    const ext = key.split(".").pop()?.toLowerCase() ?? "";
    return new Response(data, {
      headers: {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};
