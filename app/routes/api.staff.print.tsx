import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateStaff, staffJson } from "../lib/staff.server";
import { PrintError, printOrders } from "../lib/orders.server";
import { storedPlan } from "../lib/billing.server";

/**
 * POST /api/staff/print  { ids: string[], markPrinted?: boolean }  → application/pdf
 *
 * POST rather than GET: a day's batch can be hundreds of ids, more than a URL
 * comfortably carries.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return staffJson({ error: "Method not allowed" }, 405);
  const { shop } = await authenticateStaff(request);
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; markPrinted?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (!ids.length) return staffJson({ error: "Nothing selected." }, 400);

  try {
    const { pdf, count } = await printOrders(shop.id, ids, await storedPlan(shop.id), {
      markPrinted: body.markPrinted === true,
    });
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="giftflow-${count}-cards.pdf"`,
        "Cache-Control": "no-store",
        "X-Card-Count": String(count),
      },
    });
  } catch (e) {
    if (e instanceof PrintError) return staffJson({ error: e.message }, e.status);
    console.error("[giftflow] staff print failed:", e);
    return staffJson({ error: `Could not render the cards: ${e instanceof Error ? e.message : e}` }, 500);
  }
};
