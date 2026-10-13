import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateStaff, staffJson } from "../lib/staff.server";
import { STATUSES, setStatus, type Status } from "../lib/orders.server";

/** POST /api/staff/status  { ids: string[], status: "new" | "printed" | "packed" } */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return staffJson({ error: "Method not allowed" }, 405);
  const { shop } = await authenticateStaff(request);
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; status?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const status = String(body.status) as Status;
  if (!STATUSES.includes(status)) return staffJson({ error: "Unknown status" }, 400);
  if (!ids.length) return staffJson({ error: "Nothing selected." }, 400);
  return staffJson({ updated: await setStatus(shop.id, ids, status) });
};
