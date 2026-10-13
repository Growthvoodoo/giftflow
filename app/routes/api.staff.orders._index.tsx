import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticateStaff, staffJson } from "../lib/staff.server";
import { isView, listOrders, serializeOrder } from "../lib/orders.server";
import { publicUrlFor } from "../lib/storage.server";

/**
 * GET /api/staff/orders?view=new|review|held|printed|packed|all&q=&take=&skip=
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await authenticateStaff(request);
  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  const { rows, total } = await listOrders(shop.id, {
    view: isView(view) ? view : "new",
    q: url.searchParams.get("q") ?? undefined,
    take: Number(url.searchParams.get("take") ?? 100) || 100,
    skip: Number(url.searchParams.get("skip") ?? 0) || 0,
  });
  return staffJson({
    total,
    orders: rows.map((o) => serializeOrder(o, (k) => publicUrlFor(k, url.origin))),
  });
};
