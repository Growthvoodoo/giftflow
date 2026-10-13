import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * The three mandatory GDPR webhooks. A public app is rejected without them, and
 * this app holds real personal data — a customer's message, and often the
 * recipient's name — so these do actual work rather than returning 200.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop: shopDomain, payload } = await authenticate.webhook(request);
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      // Shopify requires the merchant be able to hand the customer their data.
      // Logged rather than mailed: the merchant exports from the admin.
      const orderIds = (payload.orders_requested ?? []).map(String);
      console.log(
        `[giftflow] data request for ${shopDomain}, orders ${orderIds.join(", ") || "(none)"}`,
      );
      break;
    }

    case "CUSTOMERS_REDACT": {
      if (!shop) break;
      const orderIds = (payload.orders_to_redact ?? []).map(String);
      if (orderIds.length) {
        // The message and recipient are the personal parts. The row stays so
        // the merchant's order history and counts are not silently rewritten.
        await prisma.giftOrder.updateMany({
          where: { shopId: shop.id, orderId: { in: orderIds } },
          data: {
            messageHtml: "",
            uploadHash: null,
            messageText: "[redacted]",
            recipient: null,
            sender: null,
            customerName: null,
            customerEmail: null,
          },
        });
      }
      break;
    }

    case "SHOP_REDACT": {
      // 48 hours after uninstall. Everything goes.
      if (shop) await prisma.shop.delete({ where: { id: shop.id } }).catch(() => {});
      await prisma.session.deleteMany({ where: { shop: shopDomain } });
      break;
    }
  }

  return new Response();
};
