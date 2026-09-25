import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../lib/shop.server";
import { batchPdf } from "../lib/pdf.server";

/**
 * Streams the merged PDF for the selected orders.
 *
 * A resource route rather than an action so the browser can open it in a tab
 * and hand it straight to the print dialog.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { shop } = await getSettings(session.shop);

  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",").filter(Boolean);
  if (!ids.length) return new Response("Nothing to print", { status: 400 });

  // Scope to this shop before rendering anything.
  const mine = await prisma.giftOrder.findMany({
    where: { id: { in: ids }, shopId: shop.id },
    select: { id: true },
    orderBy: { orderedAt: "asc" },
  });
  if (!mine.length) return new Response("Nothing to print", { status: 404 });

  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

  try {
    const pdf = await batchPdf(mine.map((m) => m.id), baseUrl);
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="giftflow-${mine.length}-cards.pdf"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[giftflow] render failed:", message);
    return new Response(
      `Could not render the cards: ${message}`,
      { status: 500, headers: { "Content-Type": "text/plain" } },
    );
  }
};
