import { jsonResponse } from "../lib/http.server";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/shop.server";
import { PrintError, printOrders } from "../lib/orders.server";
import { storedPlan } from "../lib/billing.server";

/**
 * GET /app/print?ids=a,b,c[&mark=1]  → application/pdf
 *
 * Called with fetch() from the orders page. App Bridge adds the session token
 * to that request, which a plain link or a new tab would not carry — so the
 * page fetches the PDF as a blob and opens that instead.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = await getSettings(session.shop);

  const url = new URL(request.url);
  const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
  if (!ids.length) return jsonResponse({ error: "Nothing to print." }, { status: 400 });

  try {
    const { pdf, count } = await printOrders(shop.id, ids, await storedPlan(shop.id), {
      markPrinted: url.searchParams.get("mark") === "1",
    });
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="giftflow-${count}-cards.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof PrintError) return jsonResponse({ error: e.message }, { status: e.status });
    const message = e instanceof Error ? e.message : String(e);
    console.error("[giftflow] render failed:", message);
    return jsonResponse({ error: `Could not render the cards: ${message}` }, { status: 500 });
  }
};
