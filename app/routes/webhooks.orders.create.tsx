import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { verifyToken } from "../lib/token.server";

/**
 * orders/create
 *
 * Resolves each `_gift_token` on the order into a GiftOrder the merchant can
 * print. The draft's contents are copied rather than referenced: a merchant who
 * later edits or deletes a card design must not be able to change what was
 * already ordered.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: shopDomain, payload, topic } = await authenticate.webhook(request);
  if (topic !== "ORDERS_CREATE") return new Response();

  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) return new Response(); // uninstalled between order and delivery

  const order = payload as {
    id: number | string;
    name?: string;
    created_at?: string;
    customer?: { first_name?: string; last_name?: string };
    line_items?: Array<{
      id: number | string;
      properties?: Array<{ name: string; value: string }> | Record<string, string>;
    }>;
  };

  const customerName = [order.customer?.first_name, order.customer?.last_name]
    .filter(Boolean)
    .join(" ") || null;

  for (const line of order.line_items ?? []) {
    // Shopify sends properties as an array on the REST payload and as an object
    // on some others; accept both rather than assuming.
    const props = Array.isArray(line.properties)
      ? Object.fromEntries(line.properties.map((p) => [p.name, p.value]))
      : (line.properties ?? {});

    const token = props["_gift_token"];
    if (!token) continue;

    // Reject a forged token before it costs a lookup.
    if (!verifyToken(shopDomain, token)) {
      console.warn(`[giftflow] order ${order.id}: token failed signature check`);
      continue;
    }

    const draft = await prisma.giftDraft.findUnique({
      where: { token },
      include: { shop: false },
    });
    if (!draft || draft.shopId !== shop.id) {
      console.warn(`[giftflow] order ${order.id}: no draft for token`);
      continue;
    }

    const card = draft.cardDesignId
      ? await prisma.cardDesign.findUnique({
          where: { id: draft.cardDesignId },
          select: { title: true, imageKey: true },
        })
      : null;

    await prisma.giftOrder.upsert({
      // Redelivery is normal — Shopify retries, and a duplicate must not
      // produce a second card to print.
      where: { shopId_lineItemId: { shopId: shop.id, lineItemId: String(line.id) } },
      update: {},
      create: {
        shopId: shop.id,
        orderId: String(order.id),
        orderName: order.name ?? null,
        lineItemId: String(line.id),
        orderedAt: order.created_at ? new Date(order.created_at) : new Date(),
        customerName,
        cardTitle: card?.title ?? (draft.uploadKey ? "Customer upload" : null),
        cardImageKey: card?.imageKey ?? draft.uploadKey,
        messageHtml: draft.messageHtml,
        messageText: draft.messageText,
        recipient: draft.recipient,
        sender: draft.sender,
      },
    });

    // The draft has served its purpose; the snapshot is what matters now.
    await prisma.giftDraft.delete({ where: { id: draft.id } }).catch(() => {});
  }

  return new Response();
};
