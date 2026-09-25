import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings, publicSettings } from "../lib/shop.server";
import { urlFor } from "../lib/storage.server";

/**
 * GET /apps/giftflow/cards
 *
 * The card catalogue and the public settings, for the theme extension.
 * `authenticate.public.appProxy` verifies Shopify's signature, so the shop
 * domain is trustworthy and the storefront needs no credential of its own.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session?.shop) return Response.json({ error: "Unknown shop" }, { status: 401 });

  const { shop, settings } = await getSettings(session.shop);

  const [categories, cards] = await Promise.all([
    prisma.cardCategory.findMany({
      where: { shopId: shop.id, active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, handle: true },
    }),
    prisma.cardDesign.findMany({
      where: { shopId: shop.id, active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      select: {
        id: true, title: true, categoryId: true, tags: true,
        priceMinor: true, imageKey: true, thumbnailKey: true,
      },
    }),
  ]);

  return Response.json(
    {
      settings: publicSettings(settings),
      categories,
      cards: cards.map((c) => ({
        id: c.id,
        title: c.title,
        categoryId: c.categoryId,
        tags: c.tags ? c.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        priceMinor: c.priceMinor,
        image: urlFor(c.imageKey),
        thumbnail: urlFor(c.thumbnailKey ?? c.imageKey),
      })),
    },
    // Short cache: the catalogue changes rarely, and every shopper hits this.
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
};
