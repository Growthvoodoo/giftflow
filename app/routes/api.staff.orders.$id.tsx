import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { authenticateStaff, staffJson } from "../lib/staff.server";
import { serializeOrder } from "../lib/orders.server";
import { publicUrlFor } from "../lib/storage.server";

/** GET /api/staff/orders/:id */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await authenticateStaff(request);
  const order = await prisma.giftOrder.findFirst({ where: { id: params.id, shopId: shop.id } });
  if (!order) return staffJson({ error: "Not found" }, 404);
  const origin = new URL(request.url).origin;
  return staffJson({ order: serializeOrder(order, (k) => publicUrlFor(k, origin)) });
};
