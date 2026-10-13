import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { verifyToken } from "../lib/token.server";
import { ordersThisMonth, storedPlan } from "../lib/billing.server";

/**
 * orders/create
 *
 * Resolves each `_gift_token` on the order into a GiftOrder the merchant can
 * print. The draft's contents are copied rather than referenced: a merchant who
 * later edits or deletes a card design must not be able to change what was
 * already ordered.
 *
 * One token can appear on two lines (the gift and the card-charge line), so
 * tokens are de-duplicated: one card per token, attached to the gift line.
 */

type LineItem = {
  id: number | string;
  variant_id?: number | string | null;
  properties?: Array<{ name: string; value: string }> | Record<string, string> | null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: shopDomain, payload, topic } = await authenticate.webhook(request);
  if (topic !== "ORDERS_CREATE") return new Response();

  const shop = await prisma.shop.findUnique({
    where: { domain: shopDomain },
    include: { settings: true },
  });
  if (!shop) return new Response(); // uninstalled between order and delivery

  const order = payload as {
    id: number | string;
    name?: string;
    created_at?: string;
    email?: string | null;
    customer?: { first_name?: string; last_name?: string; email?: string } | null;
    line_items?: LineItem[];
  };

  const customerName =
    [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") || null;
  const customerEmail = order.customer?.email ?? order.email ?? null;
  const cardVariantId = shop.settings?.cardVariantId ?? null;

  // token -> every line carrying it.
  const linesByToken = new Map<string, LineItem[]>();
  for (const line of order.line_items ?? []) {
    // Shopify sends properties as an array on the REST payload and as an object
    // on some others; accept both rather than assuming.
    const props = Array.isArray(line.properties)
      ? Object.fromEntries(line.properties.map((p) => [p.name, p.value]))
      : (line.properties ?? {});
    const token = props["_gift_token"];
    if (!token) continue;
    linesByToken.set(token, [...(linesByToken.get(token) ?? []), line]);
  }

  // One card per token, attached to the gift line rather than the card-charge
  // line, whatever order Shopify lists them in.
  const isCardLine = (l: LineItem) =>
    cardVariantId !== null && String(l.variant_id) === String(cardVariantId);
  const byToken = new Map<string, LineItem>();
  for (const [token, lines] of linesByToken) {
    byToken.set(token, lines.find((l) => !isCardLine(l)) ?? lines[0]);
  }
  if (!byToken.size) return new Response();

  const plan = await storedPlan(shop.id);
  let used = await ordersThisMonth(shop.id);

  for (const [token, line] of byToken) {
    // Reject a forged token before it costs a lookup.
    if (!verifyToken(shopDomain, token)) {
      console.warn(`[giftflow] order ${order.id}: token failed signature check`);
      continue;
    }

    // Redelivery is normal — Shopify retries, and a duplicate must not produce
    // a second card to print.
    const already = await prisma.giftOrder.findUnique({
      where: { shopId_lineItemId: { shopId: shop.id, lineItemId: String(line.id) } },
      select: { id: true },
    });
    if (already) continue;

    const draft = await prisma.giftDraft.findUnique({ where: { token } });
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

    // Over the plan limit: recorded anyway, so nothing is lost, but held from
    // printing until the merchant upgrades.
    const overLimit = plan.monthlyOrders !== null && used >= plan.monthlyOrders;
    used += 1;

    await prisma.giftOrder.create({
      data: {
        shopId: shop.id,
        orderId: String(order.id),
        orderName: order.name ?? null,
        lineItemId: String(line.id),
        orderedAt: order.created_at ? new Date(order.created_at) : new Date(),
        customerName,
        customerEmail,
        cardTitle: card?.title ?? (draft.uploadKey ? "Customer upload" : null),
        cardImageKey: card?.imageKey ?? draft.uploadKey,
        uploadStatus: draft.uploadKey ? draft.uploadStatus ?? "pending" : null,
        uploadHash: draft.uploadHash,
        messageHtml: draft.messageHtml,
        messageText: draft.messageText,
        recipient: draft.recipient,
        sender: draft.sender,
        overLimit,
      },
    });

    // The draft has served its purpose; the snapshot is what matters now.
    await prisma.giftDraft.delete({ where: { id: draft.id } }).catch(() => {});
  }

  return new Response();
};
