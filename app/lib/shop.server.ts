import prisma from "../db.server";

/**
 * Every install has exactly one Shop row and one Settings row. Both are created
 * on first sight rather than at OAuth, so a shop that installed before this
 * code existed still works, and a failed install cannot leave a half-set-up
 * store behind.
 */
export async function getShop(domain: string) {
  return prisma.shop.upsert({
    where: { domain },
    update: { uninstalledAt: null },
    create: { domain, settings: { create: {} } },
    include: { settings: true },
  });
}

export async function getSettings(domain: string) {
  const shop = await getShop(domain);
  if (shop.settings) return { shop, settings: shop.settings };
  const settings = await prisma.settings.create({ data: { shopId: shop.id } });
  return { shop, settings };
}

/**
 * What the storefront is allowed to know. The theme extension renders from
 * this, so it must never carry anything merchant-private.
 */
export function publicSettings(s: {
  messageMaxChars: number;
  allowUploads: boolean;
  maxUploadBytes: number;
  cardVariantId: string | null;
  cardPriceMinor: number;
  giftCollectionHandle: string | null;
}) {
  return {
    messageMaxChars: s.messageMaxChars,
    allowUploads: s.allowUploads,
    maxUploadBytes: s.maxUploadBytes,
    cardVariantId: s.cardVariantId,
    cardPriceMinor: s.cardPriceMinor,
    giftCollectionHandle: s.giftCollectionHandle,
  };
}
