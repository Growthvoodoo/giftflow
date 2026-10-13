import { jsonResponse } from "../lib/http.server";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings, publicSettings } from "../lib/shop.server";
import { publicUrlFor } from "../lib/storage.server";
import { storedPlan } from "../lib/billing.server";

/**
 * GET /apps/giftflow/cards
 *
 * The card catalogue and the public settings, for the theme extension.
 * `authenticate.public.appProxy` verifies Shopify's signature, so the shop
 * domain is trustworthy and the storefront needs no credential of its own.
 *
 * Image URLs are absolute: this response is used on the shop's own domain,
 * where a relative /media path would point at the shop, not at this app.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session?.shop) return jsonResponse({ error: "Unknown shop" }, { status: 401 });

  const { shop, settings } = await getSettings(session.shop);
  const plan = await storedPlan(shop.id);

  const [categories, cards] = await Promise.all([
    prisma.cardCategory.findMany({
      where: { shopId: shop.id, active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, handle: true },
    }),
    prisma.cardDesign.findMany({
      where: { shopId: shop.id, active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      // A plan with a card limit shows only that many, oldest-sorted first.
      take: plan.maxCards ?? undefined,
      select: {
        id: true, title: true, categoryId: true, tags: true,
        priceMinor: true, imageKey: true, thumbnailKey: true,
      },
    }),
  ]);

  const origin = new URL(request.url).origin;
  return jsonResponse(
    {
      settings: {
        ...publicSettings(settings),
        // Uploads are a paid feature; the storefront hides the control.
        allowUploads: settings.allowUploads && plan.uploads,
      },
      categories,
      cards: cards.map((c) => ({
        id: c.id,
        title: c.title,
        categoryId: c.categoryId,
        tags: c.tags ? c.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        priceMinor: c.priceMinor,
        image: publicUrlFor(c.imageKey, origin),
        thumbnail: publicUrlFor(c.thumbnailKey ?? c.imageKey, origin),
      })),
    },
    // Short cache: the catalogue changes rarely, and every shopper hits this.
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
};
